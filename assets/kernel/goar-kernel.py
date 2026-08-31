"""GOAR 2.7.1 WASM kernel — full operator OS inside Pyodide.

Faithful port of the desktop GOAR script minus multi-agent (delegate / swarm /
council / ModelOrchestrator) and host-only pieces (subprocess sandbox, SOCKS
proxies, Textual TUI, venv, Termux). Filesystem is MEMFS under /workspace.
"""
from __future__ import annotations

import ast
import base64
import fnmatch
import hashlib
import io
import json
import os
import re
import shlex
import shutil
import sys
import time
import traceback
import uuid
from collections import deque
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

__version__ = "2.7.1"
__goar_version__ = "2.7.1-wasm"

WORKSPACE = Path("/workspace")
CONFIG_DIR = WORKSPACE / ".goar"
TOOLS_DIR = CONFIG_DIR / "tools"
SKILLS_DIR = CONFIG_DIR / "skills"
MEMORY_DIR = CONFIG_DIR / "memory"
HISTORY_DIR = CONFIG_DIR / "history"
PLANS_DIR = CONFIG_DIR / "plans"
ADAPTIVE_DIR = CONFIG_DIR / "adaptive"
CACHE_FILE = CONFIG_DIR / "cache.json"
LOOPS_FILE = CONFIG_DIR / "loops.json"
LEDGER_FILE = CONFIG_DIR / "task_ledger.json"
DLQ_FILE = CONFIG_DIR / "dlq.json"
HEALTH_FILE = CONFIG_DIR / "tool_health.json"
GIT_DIR = WORKSPACE / ".git-wasm"

for _d in (
    WORKSPACE, CONFIG_DIR, TOOLS_DIR, SKILLS_DIR, MEMORY_DIR, HISTORY_DIR,
    PLANS_DIR, ADAPTIVE_DIR, WORKSPACE / "examples", GIT_DIR / "objects",
    TOOLS_DIR / "_retired",
):
    _d.mkdir(parents=True, exist_ok=True)

_MEMORY_CATEGORIES = ("episodic", "semantic", "procedural", "user_pref")
_DEDUP_WINDOW = 60.0
_LEDGER_MAX = 20
AUTO_COMPACT_THRESHOLD = 200_000
MAX_HISTORY = 80
MAX_AGENT_STEPS = 80
MAX_TOOL_CALLS_PER_TURN = 25
MAX_DOWNLOAD_BYTES = 8_000_000

TASK_KEYWORDS: dict[str, list[str]] = {
    "debug": ["fix", "bug", "error", "crash", "exception", "traceback", "broken", "fail"],
    "create": ["create", "build", "write", "generate", "make", "implement", "develop", "add"],
    "refactor": ["refactor", "clean", "improve", "optimise", "optimize", "restructure", "rename"],
    "explain": ["explain", "how does", "what is", "describe", "understand", "walk me through"],
    "test": ["test", "unittest", "pytest", "coverage", "assert", "mock", "spec"],
    "deploy": ["deploy", "docker", "kubernetes", "ci/cd", "pipeline", "release", "publish"],
    "research": ["research", "find", "search", "look up", "investigate", "analyse", "analyze"],
    "security": [
        "nmap", "scan port", "enumerate", "subdomain", "fingerprint", "footprint",
        "pentest", "penetration", "exploit", "vulnerability", "sqlmap", "injection",
        "audit", "assess", "red team", "bug bounty",
    ],
}
TASK_TO_MODE: dict[str, str] = {
    "debug": "react", "create": "plan", "refactor": "think", "explain": "default",
    "test": "think", "deploy": "plan", "research": "think", "security": "react",
    "general": "default",
}

_PLAN_TEMPLATES: dict[str, list[str]] = {
    "debug": [
        "Reproduce the issue and collect the full error",
        "Identify root cause by tracing the call stack",
        "Write the minimal fix",
        "Verify the fix and check for regressions",
    ],
    "create": [
        "Define requirements and acceptance criteria",
        "Design the architecture / module structure",
        "Implement core functionality",
        "Write tests and verify correctness",
        "Polish and document",
    ],
    "refactor": [
        "Audit the current code for issues",
        "Define the target structure",
        "Apply changes incrementally",
        "Verify behaviour is preserved",
    ],
    "deploy": [
        "Validate build and tests pass",
        "Prepare deployment config and secrets",
        "Deploy to target environment",
        "Smoke-test and monitor",
    ],
    "research": [
        "Define the research question",
        "Gather primary sources",
        "Analyse and cross-reference",
        "Synthesise findings",
    ],
    "security": [
        "Define scope and enumerate targets",
        "Gather intelligence and map the surface",
        "Probe, scan, and fingerprint",
        "Identify weaknesses and validate findings",
        "Build proof and demonstrate impact",
        "Document everything and deliver the report",
    ],
    "test": [
        "Identify what needs testing",
        "Write unit tests for core logic",
        "Write integration tests for critical paths",
        "Run the test suite and review failures",
        "Improve coverage for edge cases",
    ],
    "explain": [
        "Identify the target concept or code",
        "Gather relevant context",
        "Build the explanation from first principles",
        "Use concrete examples",
        "Verify explanation is accurate",
    ],
    "general": ["Understand the goal", "Plan the approach", "Execute", "Verify the outcome"],
}

IMPORT_TO_PIP = {
    "bs4": "beautifulsoup4", "PIL": "pillow", "cv2": "opencv-python",
    "sklearn": "scikit-learn", "skimage": "scikit-image", "yaml": "pyyaml",
    "dateutil": "python-dateutil", "dotenv": "python-dotenv", "cv": "opencv-python",
    "wx": "wxpython", "gi": "pygobject", "Crypto": "pycryptodome",
    "Cryptodome": "pycryptodome", "serial": "pyserial", "usb": "pyusb",
    "Image": "pillow", "lxml": "lxml", "bs": "beautifulsoup4",
}
PYODIDE_WHEELS = {
    "numpy", "pandas", "scipy", "matplotlib", "sympy", "scikit-learn",
    "networkx", "pillow", "pyyaml", "regex", "lxml", "beautifulsoup4",
    "micropip", "packaging", "pytz", "statsmodels", "shapely",
}

USER_NS: dict[str, Any] = {"__name__": "__main__", "__builtins__": __builtins__}
_CWD = WORKSPACE
_ENV: dict[str, str] = {"HOME": "/workspace", "PWD": "/workspace", "USER": "operator", "GOAR": "wasm"}
_CLIPBOARD = ""
_TASK_COMPLETE = False
_LAST_BASH_RC = 0


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return default


def _save_json(data: Any, path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)
    except (OSError, TypeError, ValueError):
        pass


def _safe_path(path: str | Path) -> Path:
    raw = str(path or "").strip() or "."
    if raw in (".", "./"):
        p = _CWD
    elif raw.startswith("/workspace"):
        p = Path(raw)
    elif raw.startswith("/"):
        p = WORKSPACE / raw.lstrip("/")
    else:
        p = _CWD / raw
    resolved = p.resolve()
    root = WORKSPACE.resolve()
    if resolved != root and root not in resolved.parents:
        raise PermissionError(f"path outside /workspace: {path}")
    return resolved


def _is_tool_failure(result: str) -> bool:
    if not result:
        return False
    head = result.lstrip()[:40].lower()
    return head.startswith("[") and any(
        tag in head for tag in ("error", "fail", "blocked", "denied", "timeout", "not found", "invalid")
    )


def kernel_info() -> str:
    return json.dumps({
        "version": __goar_version__,
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "implementation": sys.implementation.name,
        "workspace": str(WORKSPACE),
        "cwd": str(_CWD),
    })


# ── Memory ──────────────────────────────────────────────────────────────────

@dataclass
class MemoryEntry:
    id: str
    category: str
    content: str
    importance: float
    timestamp: float
    access_count: int = 0
    tags: list[str] = field(default_factory=list)

    def relevance(self, query: str, now: float | None = None) -> float:
        now = now or time.time()
        age_hours = (now - self.timestamp) / 3600.0
        recency = max(0.0, 1.0 - age_hours / 168.0)
        q = query.lower()
        overlap = sum(1 for w in q.split() if w in self.content.lower()) / max(len(q.split()), 1) if q.strip() else 0.0
        freq = min(self.access_count / 10.0, 1.0)
        return self.importance * 0.35 + recency * 0.35 + overlap * 0.20 + freq * 0.10


class MemoryManager:
    def __init__(self, memory_dir: Path | None = None, max_per_category: int = 500) -> None:
        self._dir = memory_dir or MEMORY_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._max = max_per_category
        self._pools: dict[str, list[MemoryEntry]] = {c: [] for c in _MEMORY_CATEGORIES}
        self._load_all()

    def _path(self, category: str) -> Path:
        return self._dir / f"{category}.json"

    def _load_all(self) -> None:
        for cat in _MEMORY_CATEGORIES:
            raw = _load_json(self._path(cat), [])
            pool: list[MemoryEntry] = []
            if isinstance(raw, list):
                for e in raw:
                    try:
                        pool.append(MemoryEntry(**e))
                    except (TypeError, KeyError):
                        pass
            self._pools[cat] = pool

    def _save(self, category: str) -> None:
        _save_json([e.__dict__ for e in self._pools[category]], self._path(category))

    def store(self, content: str, category: str = "episodic",
              importance: float = 0.5, tags: list[str] | None = None) -> str:
        if category not in _MEMORY_CATEGORIES:
            category = "episodic"
        now = time.time()
        pool = self._pools[category]
        for existing in pool[-20:]:
            if existing.content == content and (now - existing.timestamp) < _DEDUP_WINDOW:
                return existing.id
        entry = MemoryEntry(
            id=str(uuid.uuid4())[:8],
            category=category,
            content=content,
            importance=max(0.0, min(1.0, float(importance))),
            timestamp=now,
            tags=tags or [],
        )
        pool.append(entry)
        if len(pool) > self._max:
            pool.sort(key=lambda e: e.relevance("", now))
            self._pools[category] = pool[len(pool) - self._max:]
        self._save(category)
        return entry.id

    def retrieve(self, query: str, category: str | None = None, top_k: int = 5) -> list[MemoryEntry]:
        now = time.time()
        if category and category in _MEMORY_CATEGORIES:
            pool = self._pools[category]
        else:
            pool = [e for p in self._pools.values() for e in p]
        scored = sorted(pool, key=lambda e: e.relevance(query, now), reverse=True)
        results = scored[: max(1, int(top_k or 5))]
        for e in results:
            e.access_count += 1
        return results

    def format_for_prompt(self, query: str, top_k: int = 6) -> str:
        entries = self.retrieve(query, top_k=top_k)
        if not entries:
            return ""
        lines = ["## Relevant Memory\n"]
        for e in entries:
            tag_str = f" [{', '.join(e.tags)}]" if e.tags else ""
            lines.append(f"[{e.category}{tag_str}] {e.content}")
        return "\n".join(lines)

    def consolidate(self, min_importance: float = 0.1) -> int:
        now = time.time()
        removed = 0
        for cat, pool in self._pools.items():
            before = len(pool)
            self._pools[cat] = [
                e for e in pool
                if e.relevance("", now) >= min_importance or e.importance >= 0.7
            ]
            cat_removed = before - len(self._pools[cat])
            removed += cat_removed
            if cat_removed:
                self._save(cat)
        return removed

    def stats(self) -> dict[str, int]:
        return {cat: len(pool) for cat, pool in self._pools.items()}


@dataclass
class LayerState:
    layer_id: str
    created_at: str
    prompt: str
    status: str
    consensus: list[dict[str, Any]] = field(default_factory=list)
    residues: list[dict[str, Any]] = field(default_factory=list)
    successful_skills: list[str] = field(default_factory=list)
    created_tools: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class LayeredMemory:
    def __init__(self, memory_dir: Path | None = None) -> None:
        self._dir = ((memory_dir or MEMORY_DIR) / "layers").resolve()
        self._dir.mkdir(parents=True, exist_ok=True)
        self.current_layer: LayerState | None = None

    def create_layer(self, prompt: str, metadata: dict[str, Any] | None = None) -> str:
        layer_id = f"layer_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        layer = LayerState(
            layer_id=layer_id,
            created_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            prompt=prompt,
            status="active",
            metadata=metadata or {},
        )
        self._save(layer)
        self.current_layer = layer
        return layer_id

    def add_consensus(self, layer_id: str, entry: dict[str, Any]) -> None:
        layer = self._get_or_load(layer_id)
        if layer:
            layer.consensus.append({"ts": time.strftime("%Y-%m-%d %H:%M:%S"), **entry})
            self._save(layer)

    def add_residue(self, layer_id: str, lesson: str, details: dict[str, Any] | None = None) -> None:
        layer = self._get_or_load(layer_id)
        if layer:
            layer.residues.append({
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                "lesson": lesson,
                "details": details or {},
            })
            self._save(layer)

    def record_skill_success(self, layer_id: str, skill_name: str) -> None:
        layer = self._get_or_load(layer_id)
        if layer and skill_name not in layer.successful_skills:
            layer.successful_skills.append(skill_name)
            self._save(layer)

    def record_tool_created(self, layer_id: str, tool_name: str) -> None:
        layer = self._get_or_load(layer_id)
        if layer and tool_name not in layer.created_tools:
            layer.created_tools.append(tool_name)
            self._save(layer)

    def close_layer(self, layer_id: str, status: str = "completed") -> None:
        layer = self._get_or_load(layer_id)
        if layer:
            layer.status = status
            self._save(layer)
            if self.current_layer and self.current_layer.layer_id == layer_id:
                self.current_layer = None

    def get_rehydration_context(self, max_layers: int = 5) -> str:
        layers = self._recent_completed(max_layers)
        if not layers:
            return "No previous layered memory yet."
        parts = ["## Re-hydrated Context from Previous Sessions\n"]
        for layer in layers:
            parts.append(f"### Session {layer.layer_id} ({layer.created_at})")
            parts.append(f"Goal: {layer.prompt[:350]}")
            if layer.successful_skills:
                parts.append("Used successfully: " + ", ".join(layer.successful_skills[-8:]))
            if layer.residues:
                parts.append("Lessons:")
                for r in layer.residues[-4:]:
                    parts.append(f"  - {r.get('lesson', '')}")
            if layer.consensus:
                parts.append("Outcomes:")
                for c in layer.consensus[-3:]:
                    parts.append(f"  - {c.get('summary', str(c))[:160]}")
            parts.append("")
        return "\n".join(parts)

    def _get_or_load(self, layer_id: str) -> LayerState | None:
        if self.current_layer and self.current_layer.layer_id == layer_id:
            return self.current_layer
        return self._load_layer(layer_id)

    def _load_layer(self, layer_id: str) -> LayerState | None:
        path = self._dir / f"{layer_id}.json"
        if not path.exists():
            return None
        try:
            return LayerState(**json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return None

    def _save(self, layer: LayerState) -> None:
        path = self._dir / f"{layer.layer_id}.json"
        _save_json(asdict(layer), path)

    def _recent_completed(self, limit: int) -> list[LayerState]:
        if limit <= 0:
            return []
        try:
            files = sorted(self._dir.glob("layer_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        except OSError:
            return []
        results: list[LayerState] = []
        for f in files[: max(limit * 4, 20)]:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if data.get("status") in ("completed", "active"):
                    results.append(LayerState(**data))
                    if len(results) >= limit:
                        break
            except Exception:
                continue
        return results


# ── Plan / Adaptive / Ledger ────────────────────────────────────────────────

@dataclass
class PlanStep:
    id: str
    description: str
    status: str = "pending"
    tool_calls: list[str] = field(default_factory=list)
    result: str = ""
    depends_on: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    completed_at: float = 0.0


@dataclass
class ExecutionPlan:
    id: str
    goal: str
    steps: list[PlanStep]
    task_type: str = "general"
    status: str = "pending"
    created_at: float = field(default_factory=time.time)


class PlanEngine:
    def __init__(self, plans_dir: Path | None = None) -> None:
        self._dir = (plans_dir or PLANS_DIR).resolve()
        self._dir.mkdir(parents=True, exist_ok=True)
        self._plans_file = self._dir / "plans.json"
        self._plans: list[ExecutionPlan] = self._load()
        self._active: ExecutionPlan | None = next((p for p in self._plans if p.status != "completed"), None)

    def _load(self) -> list[ExecutionPlan]:
        raw = _load_json(self._plans_file, [])
        plans = []
        for d in raw if isinstance(raw, list) else []:
            try:
                steps = [PlanStep(**s) for s in d.get("steps", [])]
                plans.append(ExecutionPlan(
                    id=d["id"], goal=d["goal"], steps=steps,
                    task_type=d.get("task_type", "general"),
                    status=d.get("status", "pending"),
                    created_at=d.get("created_at", 0.0),
                ))
            except (KeyError, TypeError):
                pass
        return plans

    def _save(self) -> None:
        data = [{
            "id": p.id, "goal": p.goal, "task_type": p.task_type,
            "status": p.status, "created_at": p.created_at,
            "steps": [s.__dict__ for s in p.steps],
        } for p in self._plans]
        _save_json(data, self._plans_file)

    def generate_steps(self, goal: str, task_type: str) -> list[str]:
        return list(_PLAN_TEMPLATES.get(task_type, _PLAN_TEMPLATES["general"]))

    def create(self, goal: str, task_type: str = "general", steps: list[str] | None = None) -> ExecutionPlan:
        step_descs = steps or self.generate_steps(goal, task_type)
        plan = ExecutionPlan(
            id=f"plan_{int(time.time())}_{uuid.uuid4().hex[:6]}",
            goal=goal,
            steps=[PlanStep(id=f"step_{i}", description=desc) for i, desc in enumerate(step_descs)],
            task_type=task_type,
        )
        self._plans.append(plan)
        self._active = plan
        self._save()
        return plan

    def mark_step(self, plan_id: str, step_id: str, status: str, result: str = "") -> str:
        plan = self.get(plan_id) or self._active
        if not plan:
            return f"Plan {plan_id} not found"
        found = False
        for step in plan.steps:
            if step.id == step_id or step.id == f"step_{step_id}" or str(step.id).endswith(str(step_id)):
                step.status = status
                step.result = result
                if status in ("completed", "failed"):
                    step.completed_at = time.time()
                found = True
                break
        if not found:
            try:
                step = plan.steps[int(step_id)]
                step.status = status
                step.result = result
                found = True
            except Exception:
                return f"Step {step_id} not found in plan {plan.id}"
        if all(s.status in ("completed", "failed") for s in plan.steps):
            plan.status = "completed" if all(s.status == "completed" for s in plan.steps) else "failed"
        self._save()
        return f"Step {step_id} → {status}"

    def get(self, plan_id: str) -> ExecutionPlan | None:
        for p in self._plans:
            if p.id == plan_id:
                return p
        return None

    def format_active(self) -> str:
        if not self._active:
            return ""
        p = self._active
        lines = [f"## Plan: {p.goal}", f"plan_id: {p.id}", f"Task type: {p.task_type}", ""]
        for s in p.steps:
            icon = {"pending": "○", "in_progress": "◉", "active": "◉", "completed": "✓", "failed": "✗", "blocked": "!"}.get(s.status, "?")
            lines.append(f"  {icon} [{s.id}] {s.description}")
            if s.result:
                lines.append(f"       → {s.result[:80]}")
        return "\n".join(lines)


class AdaptiveEngine:
    REASONING_MODES = frozenset({"default", "think", "plan", "react", "auto", "research"})

    def __init__(self) -> None:
        self._dir = ADAPTIVE_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._outcomes_file = self._dir / "outcomes.json"
        self._scores_file = self._dir / "task_scores.json"
        self._outcomes: list[dict[str, Any]] = _load_json(self._outcomes_file, [])
        self._task_scores: dict[str, dict[str, float]] = _load_json(self._scores_file, {})
        if not isinstance(self._outcomes, list):
            self._outcomes = []
        if not isinstance(self._task_scores, dict):
            self._task_scores = {}
        self._current_mode = "auto"
        self._mode_pinned = False

    def classify_task(self, message: str) -> str:
        msg = message.lower()
        for task_type, keywords in TASK_KEYWORDS.items():
            if any(kw in msg for kw in keywords):
                return task_type
        return "general"

    def select_mode(self, task_type: str) -> str:
        scores = self._task_scores.get(task_type, {})
        if scores:
            return max(scores, key=lambda m: scores[m])
        return TASK_TO_MODE.get(task_type, "default")

    def pin_mode(self, mode: str) -> None:
        if mode not in self.REASONING_MODES:
            raise ValueError(f"Unknown mode: {mode}")
        self._current_mode = mode
        self._mode_pinned = mode != "auto"

    def unpin_mode(self) -> None:
        self._mode_pinned = False
        self._current_mode = "auto"

    def adapt(self, message: str) -> tuple[str, str]:
        task_type = self.classify_task(message)
        if self._mode_pinned:
            return task_type, self._current_mode
        mode = self.select_mode(task_type)
        self._current_mode = mode
        return task_type, mode

    def record_outcome(self, task_type: str, mode: str, success: bool, turns: int = 1) -> None:
        scores = self._task_scores.setdefault(task_type, {})
        prev = scores.get(mode, 0.5)
        scores[mode] = max(0.0, min(1.0, prev + (0.1 if success else -0.05)))
        self._outcomes.append({"task_type": task_type, "mode": mode, "success": success, "turns": turns})
        if len(self._outcomes) > 1000:
            self._outcomes = self._outcomes[-1000:]
        _save_json(self._outcomes, self._outcomes_file)
        _save_json(self._task_scores, self._scores_file)

    @property
    def current_mode(self) -> str:
        return self._current_mode


@dataclass
class TaskLedger:
    goal: str = ""
    current_step: str = ""
    facts: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    dead_ends: list[str] = field(default_factory=list)

    @staticmethod
    def _add(bucket: list[str], item: str) -> None:
        item = (item or "").strip()
        if not item or any(item.lower() == x.lower() for x in bucket):
            return
        bucket.append(item)
        if len(bucket) > _LEDGER_MAX:
            del bucket[0]

    def update(self, goal: str | None = None, current_step: str | None = None,
               fact: str | None = None, decision: str | None = None,
               dead_end: str | None = None) -> None:
        if goal:
            self.goal = goal.strip()
        if current_step is not None:
            self.current_step = current_step.strip()
        self._add(self.facts, fact or "")
        self._add(self.decisions, decision or "")
        self._add(self.dead_ends, dead_end or "")

    def is_empty(self) -> bool:
        return not (self.goal or self.current_step or self.facts or self.decisions or self.dead_ends)

    def render(self) -> str:
        if self.is_empty():
            return ""
        lines = ["## Task Ledger — persistent spine; this survives history compaction"]
        if self.goal:
            lines.append(f"**Goal:** {self.goal}")
        if self.current_step:
            lines.append(f"**Current step:** {self.current_step}")
        if self.decisions:
            lines.append("**Key decisions:**")
            lines += [f"  - {d}" for d in self.decisions]
        if self.facts:
            lines.append("**Confirmed facts / findings:**")
            lines += [f"  - {f}" for f in self.facts]
        if self.dead_ends:
            lines.append("**Dead ends — do NOT repeat these:**")
            lines += [f"  - {d}" for d in self.dead_ends]
        return "\n".join(lines)

    def reset(self) -> None:
        self.goal = ""
        self.current_step = ""
        self.facts.clear()
        self.decisions.clear()
        self.dead_ends.clear()
        self.save()

    def save(self) -> None:
        _save_json(asdict(self), LEDGER_FILE)

    @classmethod
    def load(cls) -> "TaskLedger":
        data = _load_json(LEDGER_FILE, {})
        if not isinstance(data, dict):
            return cls()
        return cls(
            goal=str(data.get("goal", "")),
            current_step=str(data.get("current_step", "")),
            facts=list(data.get("facts", []))[:_LEDGER_MAX],
            decisions=list(data.get("decisions", []))[:_LEDGER_MAX],
            dead_ends=list(data.get("dead_ends", []))[:_LEDGER_MAX],
        )


# ── Circuit / DLQ / Sessions / Perf / Cache / Loops ─────────────────────────

class CircuitBreaker:
    CLOSED, OPEN, HALF_OPEN = "closed", "open", "half_open"

    def __init__(self, failure_threshold: int = 3, recovery_timeout: float = 30.0) -> None:
        self._state = self.CLOSED
        self._failures = 0
        self._last_failure = 0.0
        self._threshold = failure_threshold
        self._timeout = recovery_timeout

    @property
    def state(self) -> str:
        return self._state

    def can_execute(self) -> bool:
        if self._state == self.OPEN:
            if time.monotonic() - self._last_failure >= self._timeout:
                self._state = self.HALF_OPEN
                return True
            return False
        return True

    def seconds_until_retry(self) -> float:
        if self._state != self.OPEN:
            return 0.0
        return max(0.0, self._timeout - (time.monotonic() - self._last_failure))

    def record_success(self) -> None:
        if self._state in (self.HALF_OPEN, self.OPEN):
            self._state = self.CLOSED
            self._failures = 0
        else:
            self._failures = max(0, self._failures - 1)

    def record_failure(self) -> None:
        self._failures += 1
        self._last_failure = time.monotonic()
        if self._failures >= self._threshold:
            self._state = self.OPEN

    def snapshot(self) -> dict[str, Any]:
        return {"state": self._state, "failures": self._failures, "retry_in": round(self.seconds_until_retry(), 1)}


class DeadLetterQueue:
    def __init__(self, max_size: int = 500) -> None:
        self._queue: list[dict[str, Any]] = []
        self._max = max_size
        raw = _load_json(DLQ_FILE, [])
        if isinstance(raw, list):
            self._queue = raw[-max_size:]

    def _save(self) -> None:
        _save_json(self._queue, DLQ_FILE)

    def enqueue(self, tool_name: str, args: dict[str, Any], error: str) -> None:
        self._queue.append({
            "tool": tool_name, "args": args, "error": error,
            "ts": time.time(), "retries": 0,
        })
        if len(self._queue) > self._max:
            self._queue.pop(0)
        self._save()

    def dequeue(self) -> dict[str, Any] | None:
        if not self._queue:
            return None
        item = self._queue.pop(0)
        self._save()
        return item

    def clear(self) -> int:
        n = len(self._queue)
        self._queue.clear()
        self._save()
        return n

    @property
    def items(self) -> list[dict[str, Any]]:
        return list(self._queue)

    @property
    def size(self) -> int:
        return len(self._queue)


@dataclass
class SessionMeta:
    id: str
    name: str
    model: str
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    total_turns: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    checkpoints: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)


class SessionManager:
    _MAX_CHECKPOINTS = 20

    def __init__(self) -> None:
        self._dir = HISTORY_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._meta_file = self._dir / "sessions.json"
        self._sessions: dict[str, SessionMeta] = {}
        self._active_id: str | None = None
        self._load_meta()

    def _load_meta(self) -> None:
        data = _load_json(self._meta_file, {})
        for raw in (data.get("sessions") or []) if isinstance(data, dict) else []:
            try:
                fields = {k: v for k, v in raw.items() if k in SessionMeta.__dataclass_fields__}
                m = SessionMeta(**fields)
                self._sessions[m.id] = m
            except (TypeError, KeyError):
                pass
        if data.get("active_id") in self._sessions:
            self._active_id = data["active_id"]

    def _save_meta(self) -> None:
        rows = [asdict(m) for m in self._sessions.values()]
        _save_json({"sessions": rows, "active_id": self._active_id}, self._meta_file)

    def create(self, model: str, name: str | None = None) -> str:
        sid = str(uuid.uuid4())[:8]
        self._sessions[sid] = SessionMeta(id=sid, name=name or f"session_{sid}", model=model)
        self._active_id = sid
        self._save_meta()
        return sid

    @property
    def active_id(self) -> str | None:
        return self._active_id

    def activate(self, session_id: str) -> bool:
        if session_id in self._sessions:
            self._active_id = session_id
            self._save_meta()
            return True
        return False

    def update_stats(self, turns: int = 0, tokens: int = 0, cost: float = 0.0) -> None:
        if not self._active_id:
            return
        m = self._sessions.get(self._active_id)
        if m:
            m.total_turns += turns
            m.total_tokens += tokens
            m.total_cost_usd += cost
            m.last_active = time.time()
            self._save_meta()

    def save_checkpoint(self, history: list[dict[str, Any]], label: str = "") -> str | None:
        if not self._active_id:
            return None
        m = self._sessions.get(self._active_id)
        if not m:
            return None
        label = label or f"checkpoint_{int(time.time())}"
        ckpt_file = self._dir / f"{self._active_id}_{label}.json"
        safe = []
        for msg in history:
            entry = {
                k: (str(v) if not isinstance(v, (str, int, float, bool, type(None), list, dict)) else v)
                for k, v in msg.items()
            }
            safe.append(entry)
        _save_json({"label": label, "timestamp": time.time(), "history": safe}, ckpt_file)
        if label not in m.checkpoints:
            m.checkpoints.append(label)
        if len(m.checkpoints) > self._MAX_CHECKPOINTS:
            drop = m.checkpoints[:-self._MAX_CHECKPOINTS]
            m.checkpoints = m.checkpoints[-self._MAX_CHECKPOINTS:]
            for lab in drop:
                try:
                    (self._dir / f"{m.id}_{lab}.json").unlink(missing_ok=True)
                except OSError:
                    pass
        self._save_meta()
        return label

    def load_checkpoint(self, label: str) -> list[dict[str, Any]] | None:
        if not self._active_id:
            return None
        data = _load_json(self._dir / f"{self._active_id}_{label}.json", None)
        if not isinstance(data, dict):
            return None
        return data.get("history", [])

    def list_checkpoints(self) -> list[str]:
        if not self._active_id:
            return []
        return list(self._sessions.get(self._active_id, SessionMeta("", "", "")).checkpoints)

    def list_sessions(self) -> list[SessionMeta]:
        return sorted(self._sessions.values(), key=lambda m: m.last_active, reverse=True)


@dataclass
class TurnMetrics:
    turn: int
    duration_ms: float
    prompt_tokens: int
    completion_tokens: int
    tool_calls: int
    cost_usd: float = 0.0


class PerformanceTracker:
    def __init__(self) -> None:
        self._start = 0.0
        self._history: list[TurnMetrics] = []
        self._model = ""

    def set_model(self, model: str) -> None:
        self._model = model

    def start_turn(self) -> None:
        self._start = time.monotonic()

    def end_turn(self, turn: int, *, prompt_tokens: int = 0,
                 completion_tokens: int = 0, tool_calls: int = 0) -> TurnMetrics:
        duration_ms = (time.monotonic() - self._start) * 1000 if self._start else 0
        cost = (prompt_tokens * 0.5 + completion_tokens * 0.5) / 1_000_000
        tm = TurnMetrics(turn=turn, duration_ms=duration_ms, prompt_tokens=prompt_tokens,
                         completion_tokens=completion_tokens, tool_calls=tool_calls, cost_usd=cost)
        self._history.append(tm)
        return tm

    def summary(self) -> dict[str, float | int]:
        if not self._history:
            return {}
        return {
            "turns": len(self._history),
            "prompt_tokens": sum(m.prompt_tokens for m in self._history),
            "completion_tokens": sum(m.completion_tokens for m in self._history),
            "total_tokens": sum(m.prompt_tokens + m.completion_tokens for m in self._history),
            "tool_calls": sum(m.tool_calls for m in self._history),
            "cost_usd": round(sum(m.cost_usd for m in self._history), 6),
            "avg_turn_ms": round(sum(m.duration_ms for m in self._history) / len(self._history), 1),
        }


class CacheManager:
    def __init__(self) -> None:
        self._cache: dict[str, Any] = _load_json(CACHE_FILE, {}) or {}
        if not isinstance(self._cache, dict):
            self._cache = {}

    def get(self, section: str, key: str, default: Any = None) -> Any:
        return self._cache.get(section, {}).get(key, default)

    def set(self, section: str, key: str, value: Any) -> None:
        self._cache.setdefault(section, {})[key] = value
        _save_json(self._cache, CACHE_FILE)


@dataclass
class ScheduledLoop:
    id: str
    prompt: str
    interval_seconds: int
    next_fire_at: float
    enabled: bool = True


class LoopManager:
    def __init__(self) -> None:
        self._loops: dict[str, ScheduledLoop] = {}
        data = _load_json(LOOPS_FILE, {})
        for loop_data in (data.get("loops") or []) if isinstance(data, dict) else []:
            try:
                loop = ScheduledLoop(**loop_data)
                self._loops[loop.id] = loop
            except TypeError:
                pass

    def _save(self) -> None:
        _save_json({"loops": [asdict(loop) for loop in self._loops.values()]}, LOOPS_FILE)

    def add(self, prompt: str, interval: int, loop_id: str | None = None) -> str:
        loop_id = loop_id or str(uuid.uuid4())[:8]
        self._loops[loop_id] = ScheduledLoop(
            id=loop_id, prompt=prompt, interval_seconds=int(interval),
            next_fire_at=time.time() + int(interval),
        )
        self._save()
        return loop_id

    def remove(self, loop_id: str | None = None, all_loops: bool = False) -> None:
        if all_loops:
            self._loops.clear()
        elif loop_id and loop_id in self._loops:
            del self._loops[loop_id]
        self._save()

    def get_due(self, now: float | None = None) -> list[ScheduledLoop]:
        now = now or time.time()
        return [loop for loop in self._loops.values() if loop.enabled and loop.next_fire_at <= now]

    def reschedule(self, loop_id: str) -> None:
        loop = self._loops.get(loop_id)
        if not loop:
            return
        loop.next_fire_at = max(loop.next_fire_at + loop.interval_seconds, time.time())
        self._save()

    def list_loops(self) -> list[ScheduledLoop]:
        return list(self._loops.values())


# ── Tool quality / scanner / skills / health / gaps ─────────────────────────

class ToolQualityGate:
    _DANGEROUS_IMPORTS = frozenset({
        "ctypes", "mmap", "resource", "pty", "subprocess", "importlib", "runpy",
    })
    _DANGEROUS_ATTR_CALLS = frozenset({
        "os.system", "os.popen", "os.fork", "os.exec", "os.spawn",
    })
    _REQUIRED_EXPORTS = frozenset({"name", "run"})

    def validate(self, source: str) -> tuple[bool, list[str]]:
        issues: list[str] = []
        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            return False, [f"Syntax error: {exc}"]
        exports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        exports.add(target.id)
            elif isinstance(node, ast.FunctionDef) and node.name == "run":
                exports.add("run")
        missing = self._REQUIRED_EXPORTS - exports
        if missing:
            issues.append(f"Missing required exports: {sorted(missing)}")
        issues.extend(self._scan_danger(tree))
        return len(issues) == 0, issues

    def validate_fragment(self, source: str) -> tuple[bool, list[str]]:
        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            return False, [f"Syntax error: {exc}"]
        issues = self._scan_danger(tree)
        return len(issues) == 0, issues

    def _scan_danger(self, tree: ast.AST) -> list[str]:
        issues: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    base = alias.name.split(".")[0]
                    if base in self._DANGEROUS_IMPORTS:
                        issues.append(f"Blocked import: {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                if any(mod == b or mod.startswith(b + ".") for b in self._DANGEROUS_IMPORTS):
                    issues.append(f"Blocked import: {mod}")
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id in ("eval", "exec", "compile", "__import__"):
                    issues.append(f"Dangerous call to {node.func.id}()")
                if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                    attr_path = f"{node.func.value.id}.{node.func.attr}"
                    if attr_path in self._DANGEROUS_ATTR_CALLS:
                        issues.append(f"Dangerous call to {attr_path}()")
        return issues


class ToolGapAnalyzer:
    _GAP_PATTERNS = [
        (re.compile(r"(?i)cannot\s+(?:find|locate)\s+(.+)"), "search", "Advanced file/content search tool"),
        (re.compile(r"(?i)no\s+tool\s+for\s+(.+)"), "utility", "General utility tool"),
        (re.compile(r"(?i)unsupported\s+format\s*(?:[:\-])?\s*(.+)"), "parser", "Format parser tool"),
        (re.compile(r"(?i)can\'t\s+(?:parse|read|decode)\s*(.+)"), "parser", "Data parser tool"),
        (re.compile(r"(?i)needs?\s+(?:a|an)?\s+(.+)\s+tool"), "specialized", "Specialized domain tool"),
        (re.compile(r"(?i)(?:image|video|audio|pdf|docx)\s+(?:processing|conversion|extraction)"), "media", "Media processing tool"),
        (re.compile(r"(?i)(?:database|sql|query)\s+(?:connection|access|operation)"), "database", "Database connector tool"),
        (re.compile(r"(?i)(?:api|http|rest|webhook)\s+(?:call|request|integration)"), "api", "API integration tool"),
        (re.compile(r"(?i)(?:chart|graph|plot|visualization)"), "viz", "Visualization tool"),
        (re.compile(r"(?i)(?:encrypt|decrypt|hash|sign|verify)"), "crypto", "Cryptographic tool"),
    ]

    def __init__(self, max_history: int = 50) -> None:
        self._history: deque = deque(maxlen=max_history)
        self._gaps: dict[str, int] = {}

    def record_failure(self, tool_name: str, args: dict[str, Any], result: str) -> None:
        self._history.append({"ts": time.time(), "tool": tool_name, "args": args, "result": result[:500]})
        for pattern, category, _s in self._GAP_PATTERNS:
            match = pattern.search(result)
            if match:
                detail = match.group(1).strip()[:30] if match.lastindex else category
                gap_key = f"{category}_{detail}"
                self._gaps[gap_key] = self._gaps.get(gap_key, 0) + 1

    def get_gaps(self, min_confidence: int = 2) -> list[dict[str, Any]]:
        return [
            {"name": k, "confidence": v, "suggested_tool": self._suggest_tool_name(k)}
            for k, v in sorted(self._gaps.items(), key=lambda x: -x[1])
            if v >= min_confidence
        ]

    @staticmethod
    def _suggest_tool_name(gap_key: str) -> str:
        parts = gap_key.split("_", 1)
        if len(parts) == 2:
            return f"{parts[0]}_{parts[1][:20].replace(' ', '_').replace('-', '_')}"
        return gap_key


class ToolDesigner:
    _DESIGN_PROMPT = (
        "You are a tool designer for GOAR. Design a new tool module in Python.\n"
        "Exports: name (str), description (str), parameters (JSON schema dict), run(**kwargs) -> str\n"
        "Gap to fill: {gap_name}\nDescription: {gap_desc}\nGenerate ONLY the Python source."
    )

    def design(self, gap_name: str, gap_desc: str) -> str:
        return self._DESIGN_PROMPT.format(gap_name=gap_name, gap_desc=gap_desc)


class ToolHealthTracker:
    def __init__(self) -> None:
        data = _load_json(HEALTH_FILE, {})
        self._stats: dict[str, dict[str, Any]] = data if isinstance(data, dict) else {}

    def _blank(self) -> dict[str, Any]:
        return {"runs": 0, "fails": 0, "consec_fails": 0, "healed": 0, "last_error": "", "last_ts": 0.0}

    def record(self, name: str, ok: bool, error: str = "") -> None:
        s = self._stats.setdefault(name, self._blank())
        s["runs"] += 1
        s["last_ts"] = time.time()
        if ok:
            s["consec_fails"] = 0
        else:
            s["fails"] += 1
            s["consec_fails"] += 1
            s["last_error"] = (error or "")[:200]
        _save_json(self._stats, HEALTH_FILE)

    def reset(self, name: str) -> None:
        if name in self._stats:
            del self._stats[name]
            _save_json(self._stats, HEALTH_FILE)

    def should_retire(self, name: str, min_runs: int = 5, fail_rate: float = 0.8, min_consec: int = 3) -> bool:
        s = self._stats.get(name)
        if not s or s["runs"] < min_runs:
            return False
        return (s["fails"] / s["runs"]) >= fail_rate and s["consec_fails"] >= min_consec

    def failing(self, min_runs: int = 4, fail_rate: float = 0.5) -> list[dict[str, Any]]:
        out = []
        for name, s in self._stats.items():
            runs = s.get("runs", 0)
            if runs >= min_runs and (s.get("fails", 0) / runs) >= fail_rate:
                out.append({
                    "name": name, "runs": runs, "fails": s.get("fails", 0),
                    "rate": round(s.get("fails", 0) / runs, 2),
                    "last_error": s.get("last_error", ""),
                })
        return sorted(out, key=lambda x: -x["rate"])


@dataclass
class DiscoveredTool:
    name: str
    description: str
    parameters: dict[str, Any]
    run: Callable[..., Any]
    source_file: str = ""
    schema: dict[str, Any] = field(default_factory=dict)

    def build_schema(self) -> dict[str, Any]:
        props: dict[str, Any] = {}
        required: list[str] = []
        for param_name, param_info in (self.parameters or {}).items():
            if isinstance(param_info, dict):
                props[param_name] = {k: v for k, v in param_info.items() if k != "required"}
                if param_info.get("required"):
                    required.append(param_name)
            else:
                props[param_name] = {"type": "string", "description": str(param_info)}
        self.schema = {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {"type": "object", "properties": props, "required": required},
            },
        }
        return self.schema


_TOOL_SKIP = frozenset({"base", "utils", "shared", "helpers", "registry", "__init__"})
_REQUIRED_ATTRS = ("name", "description", "parameters", "run")


class ToolsScanner:
    def __init__(self) -> None:
        self._dir = TOOLS_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self.tools: dict[str, DiscoveredTool] = {}
        self.scan()

    def scan(self) -> list[str]:
        loaded: list[str] = []
        for py_file in sorted(self._dir.rglob("*.py")):
            if py_file.name.startswith("_") or py_file.stem in _TOOL_SKIP:
                continue
            tool = self._load_tool(py_file)
            if tool:
                self.tools[tool.name] = tool
                loaded.append(tool.name)
        return loaded

    def scan_file(self, path: Path) -> str | None:
        tool = self._load_tool(Path(path))
        if not tool:
            return None
        self.tools[tool.name] = tool
        return tool.name

    def _load_tool(self, path: Path) -> DiscoveredTool | None:
        if not path.exists():
            return None
        ns: dict[str, Any] = {"__name__": path.stem, "__file__": str(path)}
        try:
            exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), ns, ns)
        except Exception:
            return None
        if any(not hasattr_ns(ns, a) for a in _REQUIRED_ATTRS):
            return None
        if not callable(ns.get("run")):
            return None
        tool = DiscoveredTool(
            name=str(ns["name"]),
            description=str(ns.get("description", "")),
            parameters=dict(ns.get("parameters") or {}),
            run=ns["run"],
            source_file=str(path),
        )
        tool.build_schema()
        return tool

    def get(self, name: str) -> DiscoveredTool | None:
        return self.tools.get(name)

    def schemas(self) -> list[dict[str, Any]]:
        return [t.schema for t in self.tools.values() if t.schema]

    def unload(self, name: str) -> None:
        self.tools.pop(name, None)


def hasattr_ns(ns: dict, key: str) -> bool:
    return key in ns


class SkillRegistry:
    def __init__(self) -> None:
        self._dir = SKILLS_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._skills: dict[str, Callable] = {}
        self._meta: dict[str, dict[str, Any]] = {}
        self.discover()

    def discover(self) -> list[str]:
        found: list[str] = []
        for py_file in self._dir.rglob("*.py"):
            if py_file.name.startswith("_") or py_file.stem in _TOOL_SKIP:
                continue
            ns: dict[str, Any] = {"__name__": py_file.stem}
            try:
                exec(compile(py_file.read_text(encoding="utf-8"), str(py_file), "exec"), ns, ns)
            except Exception:
                continue
            run = ns.get("run")
            name = str(ns.get("name", py_file.stem))
            if callable(run):
                self._skills[name] = run
                self._meta[name] = {
                    "name": name,
                    "description": str(ns.get("description", "")),
                    "parameters": ns.get("parameters") or {},
                }
                found.append(name)
        return found

    def get(self, name: str) -> Callable | None:
        return self._skills.get(name)

    def schemas(self) -> list[dict[str, Any]]:
        out = []
        for name, meta in self._meta.items():
            props = {}
            for n, d in (meta.get("parameters") or {}).items():
                props[n] = d if isinstance(d, dict) else {"type": "string", "description": str(d)}
            out.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": meta.get("description") or "",
                    "parameters": {"type": "object", "properties": props, "required": list(props)},
                },
            })
        return out

    def list_skills(self) -> list[dict[str, Any]]:
        return list(self._meta.values())

    def create(self, name: str, description: str, code: str | None = None) -> str:
        safe = "".join(c for c in name if c.isalnum() or c in "_-").lower()
        if not safe:
            return "[skills] invalid name"
        path = self._dir / f"{safe}.py"
        if not code:
            code = (
                f'name = "{safe}"\n'
                f'description = {description!r}\n'
                "parameters = {}\n\n"
                "def run(**kwargs):\n"
                "    return \"skill ran\"\n"
            )
        path.write_text(code, encoding="utf-8")
        self.discover()
        return f"skill '{safe}' written to {path}"


# ── File tools ──────────────────────────────────────────────────────────────

def write_file(path: str, content: str) -> str:
    p = _safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    text = content if isinstance(content, str) else str(content)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(p)
    return f"Written {len(text)} chars to {p}"


def write_bytes_b64(path: str, b64: str) -> str:
    p = _safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = base64.b64decode(b64)
    p.write_bytes(data)
    return f"Downloaded {len(data):,} bytes → {p}"


def read_file(path: str, offset: int = 0, limit: int = 400) -> str:
    p = _safe_path(path)
    if not p.exists():
        return f"[not found] {p}"
    if p.is_dir():
        return f"[is a directory] {p}"
    text = p.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    start = max(0, int(offset or 0))
    cap = int(limit or 0)
    chunk = lines[start:] if not cap else lines[start:start + cap]
    numbered = [f"{start + i + 1}\t{ln}" for i, ln in enumerate(chunk)]
    extra = ""
    if cap and start + cap < len(lines):
        extra = f"\n… +{len(lines) - start - cap} lines"
    return ("\n".join(numbered) + extra) if numbered else "(empty file)"


def list_dir(path: str = "") -> str:
    p = _safe_path(path or str(_CWD))
    if not p.exists():
        return f"[not found] {p}"
    if not p.is_dir():
        return f"[not a directory] {p}"
    rows = []
    for child in sorted(p.iterdir(), key=lambda c: (c.is_file(), c.name.lower()))[:200]:
        rows.append(f"  {child.name}{'/' if child.is_dir() else ''}")
    return "\n".join(rows) or "(empty directory)"


def delete_file(path: str) -> str:
    p = _safe_path(path)
    if not p.exists():
        return f"[not found] {p}"
    if p.is_dir():
        shutil.rmtree(p)
        return f"removed directory {p}"
    p.unlink()
    return f"deleted {p}"


def edit_file(path: str, old_string: str, new_string: str) -> str:
    p = _safe_path(path)
    if not p.exists():
        return f"[not found] {p}"
    text = p.read_text(encoding="utf-8", errors="replace")
    count = text.count(old_string)
    if count == 0:
        return f"[edit error] string not found in {path}"
    if count > 1:
        return f"[edit error] string is ambiguous ({count} matches)"
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text.replace(old_string, new_string, 1), encoding="utf-8")
    tmp.replace(p)
    return f"Edited {p} — replaced 1 occurrence"


def tree(path: str = "/workspace") -> str:
    root = _safe_path(path)
    entries = []

    def walk(d: Path) -> None:
        for child in sorted(d.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
            if child.name in (".git-wasm",):
                continue
            try:
                rel = "/workspace/" + str(child.relative_to(WORKSPACE)).replace("\\", "/")
            except ValueError:
                continue
            if child.is_dir():
                entries.append({"path": rel, "type": "dir", "size": 0})
                walk(child)
            else:
                try:
                    data = child.read_text(encoding="utf-8", errors="replace")
                except Exception:
                    data = ""
                entries.append({
                    "path": rel, "type": "file",
                    "size": child.stat().st_size,
                    "content": data[:200_000],
                })

    if root.exists():
        if root.is_file():
            data = root.read_text(encoding="utf-8", errors="replace")
            entries.append({"path": str(root), "type": "file", "size": root.stat().st_size, "content": data[:200_000]})
        else:
            walk(root)
    return json.dumps(entries)


def grep_files(pattern: str, path: str = ".", recursive: bool = True) -> str:
    if not pattern:
        return "[grep] pattern required"
    try:
        regex = re.compile(pattern)
    except re.error as exc:
        return f"[grep] invalid pattern: {exc}"
    try:
        base = _safe_path(path)
    except PermissionError as exc:
        return f"[blocked] {exc}"
    if not base.exists():
        return f"[grep] path not found: {path}"
    lines_out: list[str] = []
    max_matches = 100

    def scan_file(fp: Path) -> None:
        if len(lines_out) >= max_matches:
            return
        try:
            text = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        for i, line in enumerate(text.splitlines(), 1):
            if regex.search(line):
                lines_out.append(f"{fp}:{i}:{line}")
                if len(lines_out) >= max_matches:
                    return

    if base.is_file():
        scan_file(base)
    elif recursive:
        for fp in base.rglob("*"):
            if fp.is_file() and ".git-wasm" not in fp.parts:
                scan_file(fp)
                if len(lines_out) >= max_matches:
                    break
    else:
        for fp in base.iterdir():
            if fp.is_file():
                scan_file(fp)
                if len(lines_out) >= max_matches:
                    break
    if not lines_out:
        return f"(no matches for {pattern!r} under {path})"
    suffix = "\n... [truncated at 100 matches]" if len(lines_out) >= max_matches else ""
    return "\n".join(lines_out) + suffix


def find_files(pattern: str = "*", path: str = ".", max_results: int = 50, max_depth: int = 12) -> str:
    try:
        base = _safe_path(path)
    except PermissionError as exc:
        return f"[blocked] {exc}"
    if not base.exists():
        return f"[find_files] path not found: {path}"
    out: list[str] = []
    for p in base.rglob(pattern or "*"):
        try:
            rel = p.relative_to(base)
            if len(rel.parts) > max_depth:
                continue
            if ".git-wasm" in p.parts:
                continue
            kind = "dir " if p.is_dir() else "file"
            size = p.stat().st_size if p.is_file() else 0
            out.append(f"{kind}  {size:>10}  {p}")
        except OSError:
            continue
        if len(out) >= int(max_results or 50):
            break
    if not out:
        return f"(no matches for pattern '{pattern}' under {path})"
    header = f"{'type':<6}  {'size':>10}  path\n" + "-" * 60
    return header + "\n" + "\n".join(out)


# ── Virtual bash ────────────────────────────────────────────────────────────

def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(WORKSPACE))
    except ValueError:
        return str(p)


def _expand(token: str) -> str:
    if token.startswith("$"):
        return _ENV.get(token[1:], "")
    return token


def _run_one(argv: list[str], stdin_text: str = "") -> tuple[int, str]:
    global _CWD
    if not argv:
        return 0, ""
    cmd = argv[0]
    args = argv[1:]

    if cmd == "pwd":
        return 0, str(_CWD)
    if cmd == "cd":
        target = args[0] if args else "/workspace"
        try:
            p = _safe_path(target)
        except PermissionError as exc:
            return 1, str(exc)
        if not p.exists() or not p.is_dir():
            return 1, f"cd: {target}: no such directory"
        _CWD = p
        _ENV["PWD"] = str(p)
        return 0, ""
    if cmd == "ls":
        show_all = "-a" in args or "-la" in args or "-al" in args
        long_fmt = "-l" in args or "-la" in args or "-al" in args
        paths = [a for a in args if not a.startswith("-")] or ["."]
        chunks = []
        for raw in paths:
            try:
                p = _safe_path(raw)
            except PermissionError as exc:
                return 1, str(exc)
            if not p.exists():
                return 1, f"ls: {raw}: no such file"
            kids = list(p.iterdir()) if p.is_dir() else [p]
            if not show_all:
                kids = [k for k in kids if not k.name.startswith(".")]
            kids.sort(key=lambda k: k.name.lower())
            if long_fmt:
                lines = []
                for k in kids:
                    kind = "d" if k.is_dir() else "-"
                    size = 0 if k.is_dir() else k.stat().st_size
                    lines.append(f"{kind}rw-r--r--  1 op op {size:>8} {k.name}{'/' if k.is_dir() else ''}")
                chunks.append("\n".join(lines))
            else:
                chunks.append("  ".join(k.name + ("/" if k.is_dir() else "") for k in kids))
        return 0, "\n".join(chunks)
    if cmd == "cat":
        if stdin_text and not args:
            return 0, stdin_text
        parts = []
        for raw in args:
            if raw == "-":
                parts.append(stdin_text)
                continue
            try:
                p = _safe_path(raw)
            except PermissionError as exc:
                return 1, str(exc)
            if not p.exists():
                return 1, f"cat: {raw}: no such file"
            parts.append(p.read_text(encoding="utf-8", errors="replace"))
        return 0, "".join(parts)
    if cmd in ("head", "tail"):
        n = 10
        files = []
        i = 0
        while i < len(args):
            if args[i] in ("-n",) and i + 1 < len(args):
                n = int(args[i + 1])
                i += 2
                continue
            if args[i].startswith("-") and args[i][1:].isdigit():
                n = int(args[i][1:])
                i += 1
                continue
            files.append(args[i])
            i += 1
        text = stdin_text
        if files:
            p = _safe_path(files[0])
            text = p.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        chunk = lines[:n] if cmd == "head" else lines[-n:]
        return 0, "\n".join(chunk)
    if cmd == "wc":
        text = stdin_text
        if args and not args[0].startswith("-"):
            text = _safe_path(args[0]).read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        words = len(text.split())
        return 0, f"{len(lines):8} {words:8} {len(text.encode()):8}"
    if cmd == "echo":
        n = False
        out_args = []
        for a in args:
            if a == "-n":
                n = True
            else:
                out_args.append(_expand(a))
        s = " ".join(out_args)
        return 0, s if n else s + ("\n" if s or not n else "")
    if cmd == "printf":
        fmt = args[0] if args else ""
        try:
            return 0, fmt.replace("\\n", "\n").replace("\\t", "\t")
        except Exception:
            return 0, fmt
    if cmd == "mkdir":
        parents = "-p" in args
        for raw in [a for a in args if not a.startswith("-")]:
            p = _safe_path(raw)
            p.mkdir(parents=parents, exist_ok=True)
        return 0, ""
    if cmd == "rmdir":
        for raw in args:
            p = _safe_path(raw)
            p.rmdir()
        return 0, ""
    if cmd == "rm":
        recursive = "-r" in args or "-rf" in args or "-fr" in args
        for raw in [a for a in args if not a.startswith("-")]:
            p = _safe_path(raw)
            if p.is_dir() and recursive:
                shutil.rmtree(p)
            elif p.is_dir():
                return 1, f"rm: {raw}: is a directory"
            elif p.exists():
                p.unlink()
        return 0, ""
    if cmd == "cp":
        rec = "-r" in args or "-R" in args
        paths = [a for a in args if not a.startswith("-")]
        if len(paths) < 2:
            return 1, "cp: missing operand"
        src, dst = _safe_path(paths[0]), _safe_path(paths[1])
        if src.is_dir():
            if not rec:
                return 1, "cp: -r required for directory"
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.is_dir():
                dst = dst / src.name
            shutil.copy2(src, dst)
        return 0, ""
    if cmd == "mv":
        paths = [a for a in args if not a.startswith("-")]
        if len(paths) < 2:
            return 1, "mv: missing operand"
        src, dst = _safe_path(paths[0]), _safe_path(paths[1])
        if dst.is_dir():
            dst = dst / src.name
        src.replace(dst)
        return 0, ""
    if cmd == "touch":
        for raw in args:
            p = _safe_path(raw)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.touch()
        return 0, ""
    if cmd == "find":
        start = "."
        name = "*"
        i = 0
        while i < len(args):
            if args[i] == "-name" and i + 1 < len(args):
                name = args[i + 1]
                i += 2
                continue
            if not args[i].startswith("-"):
                start = args[i]
            i += 1
        return 0, find_files(name, start)
    if cmd == "grep":
        rec = "-r" in args or "-R" in args
        patt = ""
        path = "."
        rest = [a for a in args if a not in ("-r", "-R", "-n", "-E", "-i")]
        if rest:
            patt = rest[0]
            if len(rest) > 1:
                path = rest[1]
        if stdin_text and (not rest or len(rest) == 1):
            flags = re.I if "-i" in args else 0
            rx = re.compile(patt, flags)
            hits = [ln for ln in stdin_text.splitlines() if rx.search(ln)]
            return 0, "\n".join(hits)
        return 0, grep_files(patt, path, rec or True)
    if cmd in ("python", "python3"):
        if args and args[0] == "-c":
            code = args[1] if len(args) > 1 else ""
            raw = run_python(code)
            payload = json.loads(raw)
            text = (payload.get("stdout") or "") + (payload.get("stderr") or "")
            return (0 if payload.get("ok") else 1), text
        if args:
            p = _safe_path(args[0])
            raw = run_python(p.read_text(encoding="utf-8", errors="replace"))
            payload = json.loads(raw)
            text = (payload.get("stdout") or "") + (payload.get("stderr") or "")
            return (0 if payload.get("ok") else 1), text
        return 1, "python: provide -c CODE or a file"
    if cmd == "pip":
        if args and args[0] == "install":
            return 1, "[bash] use the pip_install tool (micropip) — host pip is not available in WASM"
        return 1, "pip: only `pip install` is meaningful here — use pip_install"
    if cmd == "which":
        builtins = {
            "ls", "cat", "pwd", "cd", "mkdir", "rm", "cp", "mv", "echo", "head", "tail",
            "wc", "grep", "find", "python", "python3", "git", "touch", "true", "false",
        }
        name = args[0] if args else ""
        return (0, f"/workspace/bin/{name}") if name in builtins else (1, "")
    if cmd == "date":
        return 0, datetime.now(timezone.utc).strftime("%a %b %d %H:%M:%S UTC %Y")
    if cmd == "uname":
        return 0, "emscripten wasm32 GOAR-pyodide"
    if cmd == "whoami":
        return 0, "operator"
    if cmd == "env":
        return 0, "\n".join(f"{k}={v}" for k, v in sorted(_ENV.items()))
    if cmd == "export":
        for a in args:
            if "=" in a:
                k, _, v = a.partition("=")
                _ENV[k] = v
        return 0, ""
    if cmd == "true":
        return 0, ""
    if cmd == "false":
        return 1, ""
    if cmd in ("chmod", "chown"):
        return 0, ""
    if cmd == "git":
        op = args[0] if args else "status"
        extra = " ".join(args[1:])
        return 0, git_op(op, extra)
    if cmd in ("curl", "wget"):
        return 1, f"[bash] {cmd} is not a host binary here — use web_fetch / http_request / download_file"
    if cmd in ("apt", "apt-get", "brew", "yum", "npm", "cargo", "node", "ruby", "go"):
        return 1, (
            f"[bash] `{cmd}` is not available in the WASM sandbox. "
            "Python + micropip + load_package are the install path. "
            "JavaScript can run via run_code language=javascript."
        )
    if cmd == "sort":
        lines = (stdin_text or (_safe_path(args[0]).read_text() if args else "")).splitlines()
        return 0, "\n".join(sorted(lines))
    if cmd == "uniq":
        lines = stdin_text.splitlines()
        out, prev = [], object()
        for ln in lines:
            if ln != prev:
                out.append(ln)
            prev = ln
        return 0, "\n".join(out)
    if cmd == "clear":
        return 0, ""
    return 127, f"[bash] command not found: {cmd}  (virtual WASM shell — no host binaries)"


def run_bash(command: str, timeout: float = 60) -> str:
    global _LAST_BASH_RC
    command = (command or "").strip()
    if not command:
        return "[bash] empty command"
    # redirections
    append = False
    redir = None
    m = re.search(r"(>>?)\s*(\S+)\s*$", command)
    if m:
        append = m.group(1) == ">>"
        redir = m.group(2)
        command = command[: m.start()].rstrip()
    stages = [s.strip() for s in command.split("|")]
    stdin_text = ""
    rc = 0
    out = ""
    try:
        for stage in stages:
            try:
                argv = shlex.split(stage, posix=True)
            except ValueError as exc:
                _LAST_BASH_RC = 2
                return f"[bash] parse error: {exc}"
            rc, out = _run_one(argv, stdin_text)
            stdin_text = out
            if rc != 0 and stage is not stages[-1]:
                break
        _LAST_BASH_RC = rc
        if redir:
            p = _safe_path(redir)
            p.parent.mkdir(parents=True, exist_ok=True)
            if append and p.exists():
                p.write_text(p.read_text(encoding="utf-8", errors="replace") + out, encoding="utf-8")
            else:
                p.write_text(out, encoding="utf-8")
            return f"[exit {rc}] wrote {len(out)} chars → {p}" if rc else f"wrote {len(out)} chars → {p}"
        text = out if out.endswith("\n") or not out else out
        if rc != 0:
            return f"[exit {rc}]\n{text}".rstrip()
        return text.rstrip() or "(no output)"
    except PermissionError as exc:
        _LAST_BASH_RC = 1
        return f"[blocked] {exc}"
    except Exception as exc:
        _LAST_BASH_RC = 1
        return f"[sandbox exec error: {exc}]"


# ── Mini git ────────────────────────────────────────────────────────────────

def _git_state() -> dict[str, Any]:
    p = GIT_DIR / "state.json"
    data = _load_json(p, None)
    if not isinstance(data, dict):
        data = {"branch": "main", "branches": {"main": None}, "index": {}, "commits": []}
    return data


def _git_save(state: dict[str, Any]) -> None:
    _save_json(state, GIT_DIR / "state.json")


def _file_blob(path: Path) -> str:
    h = hashlib.sha1(path.read_bytes()).hexdigest()
    (GIT_DIR / "objects" / h).write_bytes(path.read_bytes())
    return h


def _workspace_files() -> dict[str, str]:
    out = {}
    for p in WORKSPACE.rglob("*"):
        if not p.is_file():
            continue
        if ".git-wasm" in p.parts or ".goar" in p.parts:
            continue
        rel = str(p.relative_to(WORKSPACE)).replace("\\", "/")
        out[rel] = hashlib.sha1(p.read_bytes()).hexdigest()
    return out


def git_op(op: str, extra: str = "") -> str:
    op = (op or "status").lower().strip()
    extra = (extra or "").strip()
    blocked = {"reset", "push", "force-push", "rebase", "filter-branch"}
    if op in blocked:
        return f"[git_op] '{op}' is not permitted."
    state = _git_state()
    if op == "status":
        tracked = state.get("index") or {}
        work = _workspace_files()
        staged, modified, untracked = [], [], []
        head = None
        cid = state["branches"].get(state.get("branch") or "main")
        commit = next((c for c in state["commits"] if c["id"] == cid), None)
        head_tree = (commit or {}).get("tree") or {}
        for rel, h in tracked.items():
            if rel not in head_tree or head_tree[rel] != h:
                staged.append(rel)
        for rel, h in work.items():
            if rel in tracked and tracked[rel] != h:
                modified.append(rel)
            elif rel not in tracked:
                untracked.append(rel)
        deleted = [rel for rel in tracked if rel not in work]
        lines = [f"On branch {state.get('branch', 'main')}"]
        if staged:
            lines.append("Changes to be committed:")
            lines += [f"  staged: {r}" for r in staged]
        if modified or deleted:
            lines.append("Changes not staged:")
            lines += [f"  modified: {r}" for r in modified]
            lines += [f"  deleted: {r}" for r in deleted]
        if untracked:
            lines.append("Untracked files:")
            lines += [f"  {r}" for r in untracked[:80]]
        if not staged and not modified and not untracked and not deleted:
            lines.append("nothing to commit, working tree clean")
        return "\n".join(lines)
    if op == "add":
        paths = extra.split() if extra else ["."]
        work = {str(p.relative_to(WORKSPACE)).replace("\\", "/"): p
                for p in WORKSPACE.rglob("*") if p.is_file() and ".git-wasm" not in p.parts and ".goar" not in p.parts}
        index = state.setdefault("index", {})
        added = []
        for raw in paths:
            raw = raw.lstrip("./")
            if raw in (".", ""):
                for rel, p in work.items():
                    index[rel] = _file_blob(p)
                    added.append(rel)
            else:
                matches = [rel for rel in work if rel == raw or rel.startswith(raw.rstrip("/") + "/") or fnmatch.fnmatch(rel, raw)]
                for rel in matches:
                    index[rel] = _file_blob(work[rel])
                    added.append(rel)
        _git_save(state)
        return f"added {len(added)} path(s)" if added else "nothing added"
    if op == "commit":
        if not extra:
            return "[git_op] commit requires a non-empty message in 'args'"
        index = state.get("index") or {}
        if not index:
            return "[git_op] nothing staged — git add first"
        cid = uuid.uuid4().hex[:12]
        parent = state["branches"].get(state.get("branch") or "main")
        commit = {
            "id": cid, "parent": parent, "message": extra,
            "ts": time.time(), "tree": dict(index),
            "branch": state.get("branch", "main"),
        }
        state["commits"].append(commit)
        state["branches"][state.get("branch") or "main"] = cid
        _git_save(state)
        return f"[{state.get('branch', 'main')} {cid}] {extra}"
    if op == "log":
        cid = state["branches"].get(state.get("branch") or "main")
        commits = {c["id"]: c for c in state["commits"]}
        lines = []
        while cid and cid in commits and len(lines) < 20:
            c = commits[cid]
            ts = time.strftime("%Y-%m-%d %H:%M", time.localtime(c.get("ts", 0)))
            lines.append(f"{c['id']}  {ts}  {c.get('message', '')}")
            cid = c.get("parent")
        return "\n".join(lines) or "(no commits)"
    if op == "diff":
        index = state.get("index") or {}
        work = _workspace_files()
        lines = []
        for rel, h in work.items():
            if rel in index and index[rel] != h:
                lines.append(f"diff -- {rel}")
                try:
                    new = (WORKSPACE / rel).read_text(encoding="utf-8", errors="replace")
                    old_p = GIT_DIR / "objects" / index[rel]
                    old = old_p.read_text(encoding="utf-8", errors="replace") if old_p.exists() else ""
                    if old != new:
                        lines.append(f"--- a/{rel}\n+++ b/{rel}")
                        lines.append(f"@@ old {len(old.splitlines())} → new {len(new.splitlines())} lines @@")
                except Exception:
                    pass
        return "\n".join(lines) or "(no unstaged diffs vs index)"
    if op == "branch":
        cur = state.get("branch", "main")
        lines = []
        for name, cid in state.get("branches", {}).items():
            mark = "*" if name == cur else " "
            lines.append(f"{mark} {name}  {cid or '(empty)'}")
        if extra and extra not in ("-v", "-a"):
            name = extra.split()[0]
            state["branches"].setdefault(name, state["branches"].get(cur))
            _git_save(state)
            return f"branch '{name}' created"
        return "\n".join(lines) or "* main"
    if op == "show":
        cid = extra or state["branches"].get(state.get("branch") or "main")
        commit = next((c for c in state["commits"] if c["id"] == cid), None)
        if not commit:
            return "(no commit)"
        files = ", ".join(list((commit.get("tree") or {}) .keys())[:20])
        return f"commit {commit['id']}\n{commit.get('message')}\nfiles: {files}"
    if op == "init":
        if not state.get("branches"):
            state = {"branch": "main", "branches": {"main": None}, "index": {}, "commits": []}
            _git_save(state)
        return f"initialized empty git-wasm repo in {GIT_DIR}"
    return f"[git_op] unknown op: {op!r}. Allowed: status, diff, log, branch, show, add, commit, init"


# ── Python exec / tools ─────────────────────────────────────────────────────

def _capture_figures() -> list[str]:
    images: list[str] = []
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return images
    for i, num in enumerate(list(plt.get_fignums())):
        fig = plt.figure(num)
        path = f"/tmp/goar_fig_{i}.png"
        try:
            fig.savefig(path, dpi=120, bbox_inches="tight")
            images.append(path)
        except Exception:
            pass
    try:
        plt.close("all")
    except Exception:
        pass
    return images


def run_python(code: str) -> str:
    stdout, stderr = io.StringIO(), io.StringIO()
    try:
        tree_ast = ast.parse(code, filename="<goar>")
        body = tree_ast.body
        expr = None
        if body and isinstance(body[-1], ast.Expr):
            expr = body.pop()
        compiled = compile(ast.Module(body=body, type_ignores=[]), "<goar>", "exec")
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exec(compiled, USER_NS, USER_NS)
            if expr is not None:
                result = eval(compile(ast.Expression(expr.value), "<goar>", "eval"), USER_NS, USER_NS)
                if result is not None:
                    print(repr(result))
        return json.dumps({
            "ok": True, "stdout": stdout.getvalue(), "stderr": stderr.getvalue(),
            "images": _capture_figures(),
        })
    except Exception:
        return json.dumps({
            "ok": False, "stdout": stdout.getvalue(),
            "stderr": stderr.getvalue() + traceback.format_exc(), "images": [],
        })


# ── Scaffolding ─────────────────────────────────────────────────────────────

def create_webapp(name: str, description: str = "", frontend: str = "react", backend: str = "fastapi") -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", name or ""):
        return "[create_webapp] invalid project name: only A-Z, a-z, 0-9, _, - allowed."
    project_dir = WORKSPACE / name
    if project_dir.exists():
        return f"[create_webapp] directory already exists: {project_dir}"
    project_dir.mkdir(parents=True, exist_ok=True)
    results = [f"Created {name} at {project_dir}"]
    if backend == "fastapi":
        backend_dir = project_dir / "backend"
        backend_dir.mkdir()
        (backend_dir / "main.py").write_text(
            "from fastapi import FastAPI\n"
            "from fastapi.middleware.cors import CORSMiddleware\n\n"
            f"app = FastAPI(title={name!r}, description={description!r})\n"
            "app.add_middleware(CORSMiddleware, allow_origins=['*'],\n"
            "                   allow_credentials=True, allow_methods=['*'], allow_headers=['*'])\n\n"
            "@app.get('/')\n"
            "def root():\n"
            f"    return {{'message': 'Welcome to {name}'}}\n\n"
            "@app.get('/health')\n"
            "def health():\n"
            "    return {'status': 'ok'}\n\n"
            "if __name__ == '__main__':\n"
            "    import uvicorn\n"
            "    uvicorn.run(app, host='0.0.0.0', port=8000)\n",
            encoding="utf-8",
        )
        (backend_dir / "requirements.txt").write_text("fastapi\nuvicorn\n", encoding="utf-8")
        results.append("FastAPI backend scaffold created (files only — uvicorn is not a WASM server)")
    if frontend == "react":
        fe_dir = project_dir / "frontend"
        (fe_dir / "src").mkdir(parents=True)
        (fe_dir / "public").mkdir(parents=True)
        (fe_dir / "package.json").write_text(json.dumps({
            "name": name, "version": "0.1.0", "private": True,
            "dependencies": {"react": "^18.2.0", "react-dom": "^18.2.0"},
            "scripts": {"start": "echo 'not a host npm'"},
        }, indent=2), encoding="utf-8")
        (fe_dir / "src" / "index.js").write_text(
            "import React from 'react';\nimport ReactDOM from 'react-dom/client';\n"
            "import App from './App';\n"
            "ReactDOM.createRoot(document.getElementById('root')).render(<App />);\n",
            encoding="utf-8",
        )
        (fe_dir / "src" / "App.js").write_text(
            "import React from 'react';\n"
            f"export default function App() {{\n  return <div><h1>{name}</h1><p>{description}</p></div>;\n}}\n",
            encoding="utf-8",
        )
        (fe_dir / "public" / "index.html").write_text(
            f"<!DOCTYPE html><html><head><title>{name}</title></head>"
            f"<body><div id=\"root\"></div></body></html>\n",
            encoding="utf-8",
        )
        results.append("React frontend scaffold created")
    (project_dir / "README.md").write_text(
        f"# {name}\n\n{description}\n\nScaffolded inside the GOAR WASM workspace.\n",
        encoding="utf-8",
    )
    return "\n".join(results)


def add_route(project_dir: str, path: str, method: str, handler_code: str) -> str:
    try:
        root = _safe_path(project_dir)
    except PermissionError as exc:
        return f"[blocked] {exc}"
    main_py = root / "backend" / "main.py"
    if not main_py.exists():
        return f"[add_route] backend main.py not found at {main_py}"
    method = (method or "get").lower()
    if method not in {"get", "post", "put", "delete", "patch", "head", "options"}:
        return f"[add_route] invalid method {method}"
    ok, issues = QUALITY.validate_fragment(handler_code or "")
    if not ok:
        return "[add_route] handler_code rejected:\n- " + "\n- ".join(issues)
    route_code = f"\n@app.{method}({path!r})\n{handler_code}\n"
    content = main_py.read_text(encoding="utf-8")
    marker = 'if __name__ == "__main__":'
    if marker in content:
        idx = content.index(marker)
        content = content[:idx] + route_code + "\n" + content[idx:]
    else:
        content += "\n" + route_code
    main_py.write_text(content, encoding="utf-8")
    return f"[ok] Added {method.upper()} route '{path}' to {main_py}"


def add_component(project_dir: str, component_name: str, component_code: str) -> str:
    try:
        root = _safe_path(project_dir)
    except PermissionError as exc:
        return f"[blocked] {exc}"
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", component_name or ""):
        return "[add_component] invalid component name"
    src_dir = root / "frontend" / "src"
    if not src_dir.exists():
        return f"[add_component] frontend src not found at {src_dir}"
    ok, issues = QUALITY.validate_fragment(component_code or "")
    if not ok:
        return "[add_component] component_code rejected:\n- " + "\n- ".join(issues)
    comp_file = src_dir / f"{component_name}.js"
    comp_file.write_text(component_code, encoding="utf-8")
    return f"[ok] Added component {component_name} to {comp_file}"


# ── Singletons ──────────────────────────────────────────────────────────────

MEMORY = MemoryManager()
LAYERED = LayeredMemory()
PLANS = PlanEngine()
ADAPTIVE = AdaptiveEngine()
LEDGER = TaskLedger.load()
CIRCUIT = CircuitBreaker()
DLQ = DeadLetterQueue()
SESSIONS = SessionManager()
PERF = PerformanceTracker()
CACHE = CacheManager()
LOOPS = LoopManager()
QUALITY = ToolQualityGate()
GAPS = ToolGapAnalyzer()
DESIGNER = ToolDesigner()
HEALTH = ToolHealthTracker()
SCANNER = ToolsScanner()
SKILLS = SkillRegistry()
LAYER_ID: str | None = None

if not SESSIONS.active_id:
    SESSIONS.create("grok-4.5", "session_boot")


def create_tool(name: str, code: str) -> str:
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", name or ""):
        return "[create_tool] invalid tool name (use letters, digits, underscore)"
    if not code:
        return "[create_tool] code is required"
    ok, issues = QUALITY.validate(code)
    if not ok:
        return "[create_tool] quality gate rejected the tool:\n- " + "\n- ".join(issues)
    tool_file = TOOLS_DIR / f"{name}.py"
    tool_file.write_text(code, encoding="utf-8")
    loaded = SCANNER.scan_file(tool_file)
    if loaded:
        HEALTH.reset(loaded)
        if LAYER_ID:
            LAYERED.record_tool_created(LAYER_ID, loaded)
        return f"[ok] Tool '{loaded}' created and loaded — ready to use immediately."
    tool_file.unlink(missing_ok=True)
    return "[warn] Tool failed to load (check name/description/parameters/run). File removed."


def run_registered_tool(name: str, args_json: str = "{}") -> str:
    try:
        args = json.loads(args_json or "{}")
        if not isinstance(args, dict):
            args = {}
    except json.JSONDecodeError:
        args = {}
    tool = SCANNER.get(name)
    if tool:
        try:
            out = tool.run(**args)
            text = str(out)
            ok = not _is_tool_failure(text)
            HEALTH.record(name, ok, "" if ok else text[:200])
            if not ok:
                GAPS.record_failure(name, args, text)
                DLQ.enqueue(name, args, text[:500])
                if HEALTH.should_retire(name):
                    text += _retire_tool(tool)
            return text
        except Exception:
            err = "[tool error]\n" + traceback.format_exc()
            HEALTH.record(name, False, err[:200])
            GAPS.record_failure(name, args, err)
            DLQ.enqueue(name, args, err[:500])
            return err
    skill = SKILLS.get(name)
    if skill:
        try:
            return str(skill(**args))
        except Exception as exc:
            return f"[skill error] {exc}"
    return f"[unknown tool] {name}"


def _retire_tool(tool: DiscoveredTool) -> str:
    try:
        src = Path(tool.source_file)
        dest = TOOLS_DIR / "_retired" / f"_{src.name}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.exists():
            src.replace(dest)
        SCANNER.unload(tool.name)
        HEALTH.reset(tool.name)
        GAPS.record_failure(tool.name, {}, f"[retired] generated tool '{tool.name}' chronically failing")
        return (
            f"\n\n[auto-heal] Tool `{tool.name}` failed repeatedly and was quarantined to "
            f"{dest}. Rebuild a corrected version with create_tool if you still need it."
        )
    except OSError as exc:
        return f"\n\n[auto-heal] wanted to retire `{tool.name}` but couldn't: {exc}"


def extra_schemas() -> list[dict[str, Any]]:
    return SCANNER.schemas() + SKILLS.schemas()


def seed_workspace() -> None:
    readme = WORKSPACE / "README.md"
    if not readme.exists():
        readme.write_text(
            "# GOAR workspace\n\n"
            "CPython 3.12 compiled to WebAssembly (Pyodide). This is not a Linux host.\n"
            "Virtual bash covers the common filesystem commands. Use `run_python`,\n"
            "`load_package`, `pip_install` (micropip), and `web_fetch` for the rest.\n",
            encoding="utf-8",
        )
    hello = WORKSPACE / "examples" / "hello.py"
    if not hello.exists():
        hello.write_text(
            '"""Tiny WASM smoke test."""\n'
            "import sys\n"
            'print(f"hello from {sys.implementation.name} {sys.version.split()[0]}")\n'
            'print("platform:", sys.platform)\n',
            encoding="utf-8",
        )
    plot = WORKSPACE / "examples" / "plot.py"
    if not plot.exists():
        plot.write_text(
            "import numpy as np\nimport matplotlib.pyplot as plt\n\n"
            "x = np.linspace(0, 2 * np.pi, 240)\n"
            "plt.figure(figsize=(6, 3.2))\n"
            'plt.plot(x, np.sin(x), color="#ff1a1a", lw=2, label="sin")\n'
            'plt.plot(x, np.cos(x), color="#7aa2f7", lw=1.6, label="cos")\n'
            'plt.title("GOAR · numpy + matplotlib in WASM")\n'
            "plt.legend()\nplt.tight_layout()\n",
            encoding="utf-8",
        )
    skill = SKILLS_DIR / "echo_skill.py"
    if not skill.exists():
        skill.write_text(
            'name = "echo_skill"\n'
            'description = "Echo arguments back as JSON — sample skill."\n'
            'parameters = {"text": {"type": "string", "description": "text to echo"}}\n\n'
            "def run(text: str = \"\", **kwargs):\n"
            "    return f\"echo: {text}\"\n",
            encoding="utf-8",
        )
        SKILLS.discover()


seed_workspace()
USER_NS.update({
    "WORKSPACE": WORKSPACE,
    "write_file": write_file,
    "read_file": read_file,
    "list_dir": list_dir,
})


# ── Dispatch ────────────────────────────────────────────────────────────────

def _ok(message: str = "", **extra: Any) -> str:
    payload = {"ok": True, "message": message}
    payload.update(extra)
    return json.dumps(payload, default=str)


def _err(message: str, **extra: Any) -> str:
    payload = {"ok": False, "message": message, "error": message}
    payload.update(extra)
    return json.dumps(payload, default=str)


def kernel_call(op: str, payload_json: str = "{}") -> str:
    global LAYER_ID, _CLIPBOARD, _TASK_COMPLETE
    try:
        payload = json.loads(payload_json or "{}")
        if not isinstance(payload, dict):
            payload = {}
    except json.JSONDecodeError:
        payload = {}
    try:
        return _dispatch(op, payload)
    except PermissionError as exc:
        return _err(f"[blocked] {exc}")
    except Exception:
        return _err(traceback.format_exc())


def _dispatch(op: str, a: dict[str, Any]) -> str:
    global LAYER_ID, _CLIPBOARD, _TASK_COMPLETE, _CWD

    if op == "info":
        return kernel_info()
    if op == "exec":
        return run_python(str(a.get("code") or ""))
    if op == "write":
        return _ok(write_file(str(a.get("path") or ""), str(a.get("content") or "")))
    if op == "write_b64":
        return _ok(write_bytes_b64(str(a.get("path") or ""), str(a.get("b64") or "")))
    if op == "read":
        return _ok(read_file(str(a.get("path") or ""), int(a.get("offset") or 0), int(a.get("limit") or 400)))
    if op == "list":
        return _ok(list_dir(str(a.get("path") or "")))
    if op == "delete":
        return _ok(delete_file(str(a.get("path") or "")))
    if op == "edit":
        return _ok(edit_file(str(a.get("path") or ""), str(a.get("old_string") or ""), str(a.get("new_string") or "")))
    if op == "tree":
        return json.dumps({"ok": True, "entries": json.loads(tree(str(a.get("path") or "/workspace")))})
    if op == "grep":
        return _ok(grep_files(str(a.get("pattern") or ""), str(a.get("path") or "."), bool(a.get("recursive", True))))
    if op == "find_files":
        return _ok(find_files(
            str(a.get("pattern") or "*"), str(a.get("path") or "."),
            int(a.get("max_results") or 50), int(a.get("max_depth") or 12),
        ))
    if op == "bash":
        return _ok(run_bash(str(a.get("command") or ""), float(a.get("timeout") or 60)))
    if op == "git_op":
        return _ok(git_op(str(a.get("op") or "status"), str(a.get("args") or "")))

    if op == "memory_store":
        mid = MEMORY.store(
            str(a.get("content") or ""),
            str(a.get("category") or "episodic"),
            float(a.get("importance") or 0.5),
        )
        return _ok(f"Stored memory {mid} in {a.get('category') or 'episodic'}")
    if op == "memory_recall":
        q = str(a.get("query") or "")
        entries = MEMORY.retrieve(q, top_k=int(a.get("top_k") or 5))
        if not entries:
            return _ok("(no relevant memories found)")
        return _ok("\n".join(f"[{e.category}] {e.content}" for e in entries))
    if op == "memory_format":
        return _ok(MEMORY.format_for_prompt(str(a.get("query") or ""), int(a.get("top_k") or 6)))
    if op == "memory_stats":
        return _ok(json.dumps({"total": sum(MEMORY.stats().values()), "by_category": MEMORY.stats()}))
    if op == "memory_consolidate":
        n = MEMORY.consolidate(float(a.get("min_importance") or 0.1))
        return _ok(f"pruned {n} low-value memories")

    if op == "layer_create":
        LAYER_ID = LAYERED.create_layer(str(a.get("prompt") or "")[:200])
        return _ok(LAYER_ID)
    if op == "layer_context":
        return _ok(LAYERED.get_rehydration_context(int(a.get("max_layers") or 2)))
    if op == "layer_consensus":
        if LAYER_ID:
            LAYERED.add_consensus(LAYER_ID, {"summary": str(a.get("summary") or "")[:300]})
        return _ok("ok")
    if op == "layer_close":
        if LAYER_ID:
            LAYERED.close_layer(LAYER_ID, str(a.get("status") or "completed"))
        return _ok("ok")

    if op == "ledger":
        LEDGER.update(
            goal=a.get("goal"), current_step=a.get("current_step"),
            fact=a.get("fact"), decision=a.get("decision"), dead_end=a.get("dead_end"),
        )
        LEDGER.save()
        recorded = [k for k in ("goal", "current_step", "fact", "decision", "dead_end") if a.get(k)]
        msg = "✓ Ledger updated (" + ", ".join(recorded) + ")." if recorded else \
            "[update_ledger] nothing to record — pass goal/current_step/fact/decision/dead_end."
        return _ok(msg)
    if op == "ledger_render":
        return _ok(LEDGER.render())
    if op == "ledger_reset":
        LEDGER.reset()
        return _ok("ledger cleared")

    if op == "plan_create":
        goal = str(a.get("goal") or "")
        if not goal:
            return _err("[create_plan] goal required")
        task_type = str(a.get("task_type") or ADAPTIVE.classify_task(goal))
        steps = a.get("steps")
        step_list = None
        if isinstance(steps, list):
            step_list = [str(s) for s in steps if str(s).strip()]
        elif isinstance(steps, str) and steps.strip():
            step_list = [s.strip() for s in steps.replace("\n", ",").split(",") if s.strip()]
        PLANS.create(goal, task_type, step_list)
        return _ok(PLANS.format_active())
    if op == "plan_update":
        return _ok(PLANS.mark_step(
            str(a.get("plan_id") or ""), str(a.get("step_id") or a.get("index") or "0"),
            str(a.get("status") or "completed"), str(a.get("result") or a.get("note") or ""),
        ))
    if op == "plan_format":
        return _ok(PLANS.format_active() or "No active plan.")

    if op == "adapt":
        task_type, mode = ADAPTIVE.adapt(str(a.get("message") or ""))
        return json.dumps({"ok": True, "task_type": task_type, "mode": mode, "message": f"{task_type}/{mode}"})
    if op == "adapt_pin":
        ADAPTIVE.pin_mode(str(a.get("mode") or "auto"))
        return _ok(f"mode → {ADAPTIVE.current_mode}")
    if op == "adapt_outcome":
        ADAPTIVE.record_outcome(str(a.get("task_type") or "general"), str(a.get("mode") or "default"),
                                bool(a.get("success", True)), int(a.get("turns") or 1))
        return _ok("recorded")
    if op == "adapt_mode":
        return _ok(ADAPTIVE.current_mode)

    if op == "create_tool":
        return _ok(create_tool(str(a.get("name") or ""), str(a.get("code") or "")))
    if op == "run_tool":
        return _ok(run_registered_tool(str(a.get("name") or ""), json.dumps(a.get("args") or {})))
    if op == "reload":
        tools = SCANNER.scan()
        skills = SKILLS.discover()
        return _ok(f"reloaded tools={tools} skills={skills}")
    if op == "schemas":
        return json.dumps({"ok": True, "schemas": extra_schemas()})
    if op == "list_tools":
        built_in = [
            "bash", "run_code", "read_file", "write_file", "edit_file", "list_dir", "delete_file",
            "grep", "find_files", "web_search", "web_fetch", "browser_open", "http_request",
            "download_file", "git_op", "pip_install", "load_package", "resolve_deps",
            "install_language", "store_memory", "recall_memory", "create_plan", "update_plan_step",
            "think", "ask_user", "create_tool", "create_webapp", "add_route", "add_component",
            "analyze_gaps", "clipboard", "complete_task", "update_ledger",
        ]
        extra = list(SCANNER.tools) + [m["name"] for m in SKILLS.list_skills()]
        return _ok("built-in: " + ", ".join(built_in) + ("\ngenerated: " + ", ".join(extra) if extra else "\ngenerated: (none)"))

    if op == "create_webapp":
        return _ok(create_webapp(str(a.get("name") or ""), str(a.get("description") or ""),
                                 str(a.get("frontend") or "react"), str(a.get("backend") or "fastapi")))
    if op == "add_route":
        return _ok(add_route(str(a.get("project_dir") or ""), str(a.get("path") or "/"),
                             str(a.get("method") or "get"), str(a.get("handler_code") or "")))
    if op == "add_component":
        return _ok(add_component(str(a.get("project_dir") or ""), str(a.get("component_name") or "Component"),
                                 str(a.get("component_code") or "")))
    if op == "analyze_gaps":
        gaps = GAPS.get_gaps(int(a.get("min_confidence") or 2))
        failing = HEALTH.failing()
        if not gaps and not failing:
            return _ok("No recurring capability gaps detected yet.")
        lines: list[str] = []
        if gaps:
            lines.append("Capability gaps inferred from recent tool failures:")
            for g in gaps:
                hint = DESIGNER.design(g["suggested_tool"], g["name"])
                lines.append(f"  - {g['name']} (seen {g['confidence']}×) → {g['suggested_tool']}")
                lines.append("    " + hint.splitlines()[0])
        if failing:
            lines.append("\nGenerated tools failing too often:")
            for f in failing:
                lines.append(f"  - {f['name']}: {f['fails']}/{f['runs']} failed")
        return _ok("\n".join(lines))

    if op == "think":
        thought = str(a.get("thought") or a.get("reasoning") or "")
        if not thought:
            return _err("[think] thought or reasoning required")
        MEMORY.store(thought, category="procedural", importance=0.4)
        return _ok("✓ Reasoning step recorded.")
    if op == "complete_task":
        _TASK_COMPLETE = True
        summary = str(a.get("summary") or "").strip()
        if LAYER_ID:
            LAYERED.add_consensus(LAYER_ID, {"summary": summary[:300]})
            LAYERED.close_layer(LAYER_ID, "completed")
        return _ok(f"[task complete] {summary or 'Task marked complete.'}", complete=True)
    if op == "reset_complete":
        _TASK_COMPLETE = False
        return _ok("ok")
    if op == "task_complete_flag":
        return json.dumps({"ok": True, "complete": _TASK_COMPLETE})

    if op == "clipboard":
        action = str(a.get("action") or "").lower()
        if action == "copy":
            _CLIPBOARD = str(a.get("text") or "")
            return _ok("[ok] copied to clipboard", text=_CLIPBOARD, action="copy")
        if action == "paste":
            return _ok(_CLIPBOARD or "(clipboard empty)", text=_CLIPBOARD, action="paste")
        return _err("[clipboard] action must be 'copy' or 'paste'")

    if op == "resolve_deps":
        names: list[str] = []
        if a.get("name"):
            names.append(str(a["name"]))
        names.extend(str(n) for n in (a.get("names") or []) if n)
        if not names:
            return _err("[resolve_deps] provide 'name' or 'names'")
        mapped = []
        for n in names:
            pkg = IMPORT_TO_PIP.get(n, n)
            kind = "wheel" if pkg.lower().replace("-", "_").replace(".", "_") in {
                x.replace("-", "_") for x in PYODIDE_WHEELS
            } or pkg in PYODIDE_WHEELS else "micropip"
            mapped.append({"name": n, "package": pkg, "via": kind})
        return json.dumps({"ok": True, "message": "mapped", "deps": mapped})

    if op == "install_language":
        lang = str(a.get("language") or "").lower().strip()
        available = {
            "python": "CPython 3.12 via Pyodide — already running. Use run_code language=python.",
            "javascript": "Browser JS — use run_code language=javascript.",
            "js": "Browser JS — use run_code language=javascript.",
            "node": "No Node binary. Use run_code language=javascript.",
            "typescript": "No tsc. Use run_code language=javascript (plain JS).",
            "shell": "Virtual bash — use bash or run_code language=shell.",
        }
        if lang in available:
            return _ok(f"[install_language] {lang}: {available[lang]}")
        return _ok(
            f"[install_language] cannot install '{lang}' inside WebAssembly. "
            "Available runtimes: python (Pyodide), javascript (browser), shell (virtual bash). "
            "There is no apt/brew/winget here."
        )

    if op == "circuit":
        return json.dumps({"ok": True, **CIRCUIT.snapshot()})
    if op == "circuit_ok":
        CIRCUIT.record_success()
        return json.dumps({"ok": True, **CIRCUIT.snapshot()})
    if op == "circuit_fail":
        CIRCUIT.record_failure()
        return json.dumps({"ok": True, **CIRCUIT.snapshot()})

    if op == "dlq_list":
        items = DLQ.items[-20:]
        if not items:
            return _ok("(dlq empty)")
        lines = [f"{time.strftime('%H:%M:%S', time.localtime(i['ts']))}  {i['tool']}: {i['error'][:80]}" for i in items]
        return _ok("\n".join(lines), count=DLQ.size)
    if op == "dlq_clear":
        n = DLQ.clear()
        return _ok(f"cleared {n} dead letters")
    if op == "dlq_retry":
        item = DLQ.dequeue()
        if not item:
            return _ok("(dlq empty)")
        return json.dumps({"ok": True, "message": "retry", "item": item})

    if op == "sessions":
        rows = SESSIONS.list_sessions()
        if not rows:
            return _ok("(no sessions)")
        lines = [f"{'*' if m.id == SESSIONS.active_id else ' '} {m.id}  {m.name}  {m.total_turns} turns  {m.total_tokens} tok" for m in rows]
        return _ok("\n".join(lines))
    if op == "session_create":
        sid = SESSIONS.create(str(a.get("model") or "grok-4.5"), a.get("name"))
        return _ok(sid, id=sid)
    if op == "session_activate":
        ok = SESSIONS.activate(str(a.get("id") or ""))
        return _ok("activated" if ok else "not found")
    if op == "session_stats":
        SESSIONS.update_stats(int(a.get("turns") or 0), int(a.get("tokens") or 0), float(a.get("cost") or 0))
        return _ok("ok")
    if op == "checkpoint_save":
        label = SESSIONS.save_checkpoint(list(a.get("history") or []), str(a.get("label") or ""))
        return _ok(label or "failed")
    if op == "checkpoint_list":
        return _ok("\n".join(SESSIONS.list_checkpoints()) or "(no checkpoints)")
    if op == "checkpoint_load":
        hist = SESSIONS.load_checkpoint(str(a.get("label") or ""))
        return json.dumps({"ok": True, "history": hist or [], "message": "loaded" if hist else "not found"})

    if op == "perf_start":
        PERF.set_model(str(a.get("model") or ""))
        PERF.start_turn()
        return _ok("ok")
    if op == "perf_end":
        tm = PERF.end_turn(int(a.get("turn") or 0), prompt_tokens=int(a.get("prompt_tokens") or 0),
                           completion_tokens=int(a.get("completion_tokens") or 0),
                           tool_calls=int(a.get("tool_calls") or 0))
        return json.dumps({"ok": True, "metrics": tm.__dict__, "summary": PERF.summary()})
    if op == "perf_summary":
        return json.dumps({"ok": True, "summary": PERF.summary(), "message": json.dumps(PERF.summary())})

    if op == "loop_add":
        lid = LOOPS.add(str(a.get("prompt") or ""), int(a.get("interval") or 60))
        return _ok(lid, id=lid)
    if op == "loop_list":
        rows = LOOPS.list_loops()
        if not rows:
            return _ok("(no loops)")
        return _ok("\n".join(f"{l.id}  every {l.interval_seconds}s  next={int(l.next_fire_at - time.time())}s  {l.prompt[:60]}" for l in rows))
    if op == "loop_clear":
        LOOPS.remove(all_loops=True)
        return _ok("loops cleared")
    if op == "loop_due":
        due = LOOPS.get_due()
        return json.dumps({"ok": True, "due": [asdict(l) for l in due]})
    if op == "loop_reschedule":
        LOOPS.reschedule(str(a.get("id") or ""))
        return _ok("ok")

    if op == "skills_list":
        rows = SKILLS.list_skills()
        return _ok("\n".join(f"{r['name']}  {r.get('description', '')}" for r in rows) or "(no skills)")
    if op == "skills_create":
        return _ok(SKILLS.create(str(a.get("name") or ""), str(a.get("description") or ""), a.get("code")))

    if op == "cache_get":
        return json.dumps({"ok": True, "value": CACHE.get(str(a.get("section") or ""), str(a.get("key") or ""))})
    if op == "cache_set":
        CACHE.set(str(a.get("section") or ""), str(a.get("key") or ""), a.get("value"))
        return _ok("ok")

    if op == "extract_html":
        raw = str(a.get("html") or "")
        max_length = int(a.get("max_length") or 10_000)
        text = _extract_readable(raw, max_length)
        return _ok(text)

    return _err(f"unknown kernel op: {op}")


def _extract_readable(raw: str, max_length: int = 10_000) -> str:
    raw = raw or ""
    raw = re.sub(r"(?is)<(script|style|nav|footer|header|aside|iframe|noscript)[^>]*>.*?</\1>", " ", raw)
    title_m = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else ""
    text = re.sub(r"(?is)<h1[^>]*>(.*?)</h1>", r"\n# \1\n", raw)
    text = re.sub(r"(?is)<h2[^>]*>(.*?)</h2>", r"\n## \1\n", text)
    text = re.sub(r"(?is)<h3[^>]*>(.*?)</h3>", r"\n### \1\n", text)
    text = re.sub(r"(?is)<p[^>]*>(.*?)</p>", r"\n\1\n", text)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)<li[^>]*>(.*?)</li>", r"\n- \1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if title:
        text = f"# {title}\n\n{text}"
    if len(text) > max_length:
        text = text[:max_length] + f"\n\n... [truncated at {max_length} chars]"
    return text or "(no content extracted)"
