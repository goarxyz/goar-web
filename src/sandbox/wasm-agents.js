/**
 * Host bridge for the wasm-agents port.
 * Tracing off. LLM in JS. No OpenAI Python client.
 */
(function (G) {
  "use strict";

  function parseMessage(data) {
    const msg = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
    return {
      text: msg.content || data.text || "",
      tool_calls: msg.tool_calls || data.tool_calls || [],
      message: msg,
    };
  }

  G.goarLlmComplete = function (jsonStr) {
    const req = typeof jsonStr === "string" ? JSON.parse(jsonStr) : (jsonStr || {});
    return (async () => {
      if (typeof openaiChat !== "function") throw new Error("openaiChat missing");
      const data = await openaiChat({
        messages: req.messages || [],
        tools: req.tools || [],
        stream: false,
        includeTools: !!(req.tools && req.tools.length),
      });
      return JSON.stringify(parseMessage(data));
    })();
  };

  G.goarVisitWebpage = function (url, timeout, maxLength) {
    return (async () => {
      const u = String(url || "");
      const max = Math.min(Number(maxLength || 8000), 40000);
      if (!/^https?:\/\//i.test(u)) return "error: http(s) url required";
      if (typeof goarHostFetch === "function") {
        const r = await goarHostFetch(u, { method: "GET", maxBytes: max });
        const body = String((r && (r.body || r.error)) || "");
        return "HTTP " + ((r && r.status) || "?") + "\n" + body.slice(0, max);
      }
      if (typeof toolWebFetch === "function") return String(await toolWebFetch({ url: u }));
      return "error: no fetch plane";
    })();
  };

  async function ensureWasmAgents() {
    if (G.__GOAR_WASM_AGENTS) return true;
    const py = G.__pyodide || (typeof unixPy === "function" ? unixPy() : null);
    if (!py || typeof py.runPythonAsync !== "function") return false;
    const src = typeof WASM_AGENTS_SRC === "string" ? WASM_AGENTS_SRC : "";
    if (!src) return false;
    try { py.FS.mkdirTree("/home/pyodide"); } catch (_) {}
    py.FS.writeFile("/home/pyodide/agents.py", src);
    await py.runPythonAsync(`
import sys
sys.path.insert(0, "/home/pyodide")
import importlib
import agents
importlib.reload(agents)
agents.set_tracing_disabled(True)
`);
    G.__GOAR_WASM_AGENTS = true;
    console.log("[goar] wasm-agents port ready (tracing off)");
    return true;
  }

  async function wasmAgentRun(prompt, opts) {
    opts = opts || {};
    const ok = await ensureWasmAgents();
    if (!ok) return { ok: false, error: "python not ready" };
    const py = G.__pyodide;
    py.globals.set("_wa_prompt", String(prompt || ""));
    py.globals.set("_wa_instr", String(opts.instructions || "You are a helpful agent. Use tools when needed."));
    py.globals.set("_wa_name", String(opts.name || "Assistant"));
    py.globals.set("_wa_tools", opts.tools === false ? "0" : "1");
    const raw = await py.runPythonAsync(`
from agents import Agent, Runner, ModelSettings, count_character_occurrences, visit_webpage, set_tracing_disabled
set_tracing_disabled(True)
_tools = [count_character_occurrences, visit_webpage] if _wa_tools == "1" else []
_agent = Agent(name=_wa_name, instructions=_wa_instr, tools=_tools, model_settings=ModelSettings(extra_args={"timeout": 30}))
_result = await Runner.run(_agent, _wa_prompt)
_result.final_output
`);
    return { ok: true, final_output: raw == null ? "" : String(raw) };
  }

  async function wasmAgentHandoff(prompt, specs) {
    const ok = await ensureWasmAgents();
    if (!ok) return { ok: false, error: "python not ready" };
    const py = G.__pyodide;
    py.globals.set("_wa_prompt", String(prompt || ""));
    py.globals.set("_wa_specs", JSON.stringify(specs || []));
    const raw = await py.runPythonAsync(`
import json
from agents import Agent, Runner, ModelSettings, set_tracing_disabled
set_tracing_disabled(True)
specs = json.loads(_wa_specs)
kids = [Agent(name=s.get("name") or "Agent", instructions=s.get("instructions") or "", model_settings=ModelSettings()) for s in specs]
triage = Agent(name="Triage agent", instructions="Handoff to the appropriate agent based on the main characteristics of the request.", handoffs=kids, model_settings=ModelSettings())
_result = await Runner.run(triage, _wa_prompt)
_result.final_output
`);
    return { ok: true, final_output: raw == null ? "" : String(raw) };
  }

  G.ensureWasmAgents = ensureWasmAgents;
  G.wasmAgentRun = wasmAgentRun;
  G.wasmAgentHandoff = wasmAgentHandoff;
})(typeof window !== "undefined" ? window : globalThis);
