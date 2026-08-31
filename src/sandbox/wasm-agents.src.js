const WASM_AGENTS_SRC = String.raw`"""GOAR port of mozilla-ai/wasm-agents-blueprint (Apache-2.0).

Drop-in: Agent, Runner, function_tool, ModelSettings, set_tracing_disabled,
set_default_openai_client. Tracing permanently off. LLM via host JS.
"""
from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

__all__ = [
    "Agent", "Runner", "ModelSettings", "RunResult",
    "function_tool", "set_tracing_disabled", "set_default_openai_client",
    "visit_webpage", "count_character_occurrences", "default_tool_agent",
]

def set_tracing_disabled(disabled: bool = True) -> None:
    return None

def set_default_openai_client(client: Any) -> None:
    globals()["_external_client"] = client

@dataclass
class ModelSettings:
    extra_args: dict = field(default_factory=dict)
    timeout: int = 30

def function_tool(fn: Callable | None = None, **_opts):
    def wrap(f: Callable) -> Callable:
        f._is_tool = True
        f._tool_name = f.__name__
        f._tool_desc = (inspect.getdoc(f) or f.__name__).strip()
        f._sig = inspect.signature(f)
        return f
    return wrap(fn) if fn is not None else wrap

def _schema_for(fn: Callable) -> dict:
    props = {}
    required = []
    sig = getattr(fn, "_sig", None) or inspect.signature(fn)
    for name, p in sig.parameters.items():
        if name in ("self", "cls"):
            continue
        props[name] = {"type": "string"}
        if p.default is inspect.Parameter.empty:
            required.append(name)
    return {
        "type": "function",
        "function": {
            "name": getattr(fn, "_tool_name", fn.__name__),
            "description": getattr(fn, "_tool_desc", fn.__name__),
            "parameters": {"type": "object", "properties": props, "required": required},
        },
    }

@dataclass
class Agent:
    name: str
    instructions: str = ""
    tools: list = field(default_factory=list)
    handoffs: list = field(default_factory=list)
    model_settings: Any = None
    model: Optional[str] = None
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "_", self.name.lower()).strip("_") or "agent"

class RunResult:
    def __init__(self, final_output: str, history: list | None = None):
        self.final_output = final_output
        self.history = history or []
    def __str__(self) -> str:
        return str(self.final_output or "")

async def _host_complete_async(payload: dict) -> dict:
    import js
    raw = await js.goarLlmComplete(json.dumps(payload))
    if hasattr(raw, "to_py"):
        raw = raw.to_py()
    if not isinstance(raw, str):
        raw = str(raw)
    try:
        return json.loads(raw)
    except Exception:
        return {"text": raw, "tool_calls": []}

async def _host_fetch_async(url: str, timeout: int = 30, max_length: int = 8000) -> str:
    import js
    fn = getattr(js, "goarVisitWebpage", None)
    if fn is None:
        return "error: host fetch missing"
    raw = await fn(url, timeout, max_length)
    return str(raw)

def _invoke(fn: Callable, args: dict) -> str:
    try:
        sig = getattr(fn, "_sig", None) or inspect.signature(fn)
        kw = {n: args[n] for n in sig.parameters if n in args}
        out = fn(**kw)
        if out is None:
            return ""
        return out if isinstance(out, str) else json.dumps(out, default=str)
    except Exception as e:
        return "error: " + str(e)

class Runner:
    @staticmethod
    async def run(agent: "Agent", prompt: str, max_turns: int = 16) -> RunResult:
        current = agent
        history: list[dict] = [
            {"role": "system", "content": current.instructions or "You are a helpful agent."},
            {"role": "user", "content": str(prompt or "")},
        ]
        for _ in range(max(1, int(max_turns))):
            tools = []
            lookup: dict[str, Any] = {}
            for t in current.tools or []:
                if callable(t):
                    tools.append(_schema_for(t))
                    lookup[getattr(t, "_tool_name", t.__name__)] = ("fn", t)
            for other in current.handoffs or []:
                if not isinstance(other, Agent):
                    continue
                name = "transfer_to_" + other.slug()
                tools.append({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": "Handoff to " + other.name + ". " + (other.instructions or "")[:160],
                        "parameters": {"type": "object", "properties": {"reason": {"type": "string"}}},
                    },
                })
                lookup[name] = ("handoff", other)
            raw = await _host_complete_async({"messages": history, "tools": tools})
            text = str(raw.get("text") or raw.get("content") or "")
            calls = raw.get("tool_calls") or []
            if not calls and isinstance(raw.get("message"), dict):
                text = text or str(raw["message"].get("content") or "")
                calls = raw["message"].get("tool_calls") or []
            if not calls:
                history.append({"role": "assistant", "content": text})
                return RunResult(text, history)
            history.append({"role": "assistant", "content": text, "tool_calls": calls})
            switched = None
            for c in calls:
                fn = (c.get("function") or {})
                name = fn.get("name") or c.get("name") or ""
                try:
                    args = json.loads(fn.get("arguments") or c.get("arguments") or "{}")
                except Exception:
                    args = {}
                kind, target = lookup.get(name, (None, None))
                if kind == "handoff":
                    switched = target
                    out = "Handed off to " + target.name
                elif kind == "fn":
                    out = _invoke(target, args if isinstance(args, dict) else {})
                    if name == "visit_webpage" and isinstance(args, dict):
                        out = await _host_fetch_async(
                            str(args.get("url") or ""),
                            int(args.get("timeout") or 30),
                            int(args.get("max_length") or 8000),
                        )
                else:
                    out = "error: unknown tool " + name
                history.append({
                    "role": "tool",
                    "tool_call_id": c.get("id") or name,
                    "name": name,
                    "content": out,
                })
            if switched is not None:
                current = switched
                history[0] = {"role": "system", "content": current.instructions or "You are a helpful agent."}
        last = ""
        for m in reversed(history):
            if m.get("role") == "assistant" and m.get("content"):
                last = m["content"]
                break
        return RunResult(last or "(no output)", history)

@function_tool
def count_character_occurrences(word: str, char: str):
    """Count occurrences of a character in a word."""
    return str(word or "").count(str(char or ""))

@function_tool
def visit_webpage(url: str, timeout: int = 30, max_length: int = 8000):
    """Visit a webpage and return text. Uses the GOAR host proxy (not raw CORS)."""
    return "fetch:" + str(url or "")

def default_tool_agent(instructions: str | None = None) -> Agent:
    return Agent(
        name="Tool caller",
        instructions=instructions or "You are a helpful agent. Use the available tools to answer the questions.",
        tools=[count_character_occurrences, visit_webpage],
        model_settings=ModelSettings(extra_args={"timeout": 30}),
    )
`;
