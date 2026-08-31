/**
 * GOAR Adaptive Engineer — extension plane (frontend only)
 * - Framework phase tracking (ASSESS…DELIVER)
 * - micropip_install into Pyodide
 * - create_tool dynamic agent tools for the session
 */

const FRAMEWORK_PHASES = [
  "ASSESS",
  "PLAN",
  "VALIDATE",
  "EXECUTE",
  "REVIEW",
  "VERIFY",
  "DELIVER",
];

/** @type {{ name: string, description: string, parameters: object, kind: string, body: string }[]} */
const __dynamicTools = [];

if (typeof agentState !== "undefined" && agentState) {
  if (!agentState.framework) {
    agentState.framework = {
      phase: "ASSESS",
      phaseHistory: [],
      extensions: [],
      micropip: [],
    };
  }
}

function ensureFrameworkState() {
  if (!agentState.framework) {
    agentState.framework = {
      phase: "ASSESS",
      phaseHistory: [],
      extensions: [],
      micropip: [],
    };
  }
  return agentState.framework;
}

function toolSetPhase(args) {
  const fw = ensureFrameworkState();
  const phase = String(args.phase || args.name || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!FRAMEWORK_PHASES.includes(phase)) {
    return "error: phase must be one of " + FRAMEWORK_PHASES.join(", ");
  }
  const note = String(args.note || "").trim();
  fw.phaseHistory.push({ phase, note, ts: Date.now() });
  fw.phaseHistory = fw.phaseHistory.slice(-40);
  fw.phase = phase;
  if (note) {
    try {
      agentState.ledger.currentStep = phase + (note ? ": " + note : "");
    } catch (_) {}
  }
  return "FRAMEWORK PHASE → " + phase + (note ? " · " + note : "");
}

/**
 * Install pure-Python package into Pyodide (browser plane).
 * Prefer this before asking for guest pip when the work is analysis / pure compute.
 */
async function toolMicropipInstall(args) {
  const pkg = String((args && (args.package || args.pkg || args.name)) || "").trim();
  if (!pkg) return "error: package required";
  if (!/^[A-Za-z0-9_.\-\[\],=<>!]+$/.test(pkg) || pkg.length > 80) {
    return "error: invalid package name";
  }
  try {
    await ensurePysecWorker();
  } catch (e) {
    return "error: pyodide not ready: " + (e && e.message ? e.message : e);
  }
  try {
    try {
      await __pyodide.loadPackage("micropip");
    } catch (_) {}
    __pyodide.globals.set("_mp_pkg", pkg);
    const out = await __pyodide.runPythonAsync(`
import json
import micropip
try:
    await micropip.install(_mp_pkg)
    base = _mp_pkg.split("[")[0].split("==")[0].split(">=")[0].split("<=")[0].replace("-", "_")
    ok_import = True
    err_import = None
    try:
        __import__(base)
    except Exception as ie:
        ok_import = False
        err_import = str(ie)
    json.dumps({"ok": True, "package": _mp_pkg, "importable": ok_import, "import_error": err_import, "plane": "pyodide"})
except Exception as e:
    json.dumps({"ok": False, "package": _mp_pkg, "error": f"{type(e).__name__}: {e}", "plane": "pyodide"})
`);
    const raw = typeof out === "string" ? out : JSON.stringify(out);
    try {
      const j = JSON.parse(raw);
      if (j.ok) {
        const fw = ensureFrameworkState();
        fw.micropip.push({ package: pkg, ts: Date.now() });
        fw.micropip = fw.micropip.slice(-30);
      }
    } catch (_) {}
    return raw;
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), plane: "pyodide" });
  }
}

/**
 * Register a new session tool the model can call immediately.
 * kind:
 *  - "js"     body is async JS expression/function receiving (args)
 *  - "python" body is Pyodide Python (async allowed) with `args` dict in scope
 *  - "guest"  body is shell template; {key} from args substituted (sanitized)
 */
async function toolCreateTool(args) {
  const name = String((args && args.name) || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 48);
  if (!name || name === "create_tool") return "error: valid name required";
  // reserve core names
  const reserved = new Set(
    (typeof CORE_AGENT_TOOLS !== "undefined" ? CORE_AGENT_TOOLS : [])
      .map((t) => t.function && t.function.name)
      .filter(Boolean),
  );
  if (reserved.has(name) && !__dynamicTools.find((d) => d.name === name)) {
    return "error: name reserved by core tools";
  }
  const description = String((args && args.description) || "User-created tool").slice(0, 400);
  const kind = String((args && args.kind) || "python").toLowerCase();
  if (!["js", "python", "guest"].includes(kind)) return "error: kind must be js|python|guest";
  const body = String((args && (args.body || args.code || args.source)) || "");
  if (!body || body.length < 2) return "error: body required";
  if (body.length > 80_000) return "error: body too large";

  let parameters = args.parameters;
  if (typeof parameters === "string") {
    try {
      parameters = JSON.parse(parameters);
    } catch (_) {
      parameters = null;
    }
  }
  if (!parameters || typeof parameters !== "object") {
    parameters = {
      type: "object",
      properties: {
        input: { type: "string", description: "Primary input" },
      },
    };
  }

  // upsert
  const entry = { name, description, parameters, kind, body };
  const ix = __dynamicTools.findIndex((d) => d.name === name);
  if (ix >= 0) __dynamicTools[ix] = entry;
  else __dynamicTools.push(entry);

  const fw = ensureFrameworkState();
  fw.extensions = __dynamicTools.map((d) => d.name);
  try {
    if (typeof refreshAgentTools === "function") refreshAgentTools();
  } catch (_) {}

  return JSON.stringify({
    ok: true,
    name,
    kind,
    registered: true,
    total_dynamic: __dynamicTools.length,
    note: "Session tool available as " + name + " (edit via edit_tool / create_tool same name)",
  });
}

async function runDynamicTool(name, args) {
  const entry = __dynamicTools.find((d) => d.name === name);
  if (!entry) return null;
  args = args || {};
  try {
    if (entry.kind === "js") {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        "args",
        "runAgentTool",
        "guestExec",
        "return (async () => { " +
          (entry.body.includes("return") ? entry.body : "return (" + entry.body + ")") +
          " })()",
      );
      const out = await fn(args, runAgentTool, typeof guestExec === "function" ? guestExec : null);
      return typeof out === "string" ? out : JSON.stringify(out, null, 2);
    }
    if (entry.kind === "python") {
      await ensurePysecWorker();
      __pyodide.globals.set("_ct_args", JSON.stringify(args));
      __pyodide.globals.set("_ct_body", entry.body);
      const out = await __pyodide.runPythonAsync(`
import json, asyncio, inspect
args = json.loads(_ct_args)
# Execute user body; may define async main or set result
_ns = {"args": args, "json": json}
exec(compile(_ct_body, "<create_tool>", "exec"), _ns)
result = _ns.get("result", _ns.get("out", None))
if inspect.iscoroutine(result):
    result = await result
if "main" in _ns and callable(_ns["main"]):
    r = _ns["main"](args) if _ns["main"].__code__.co_argcount else _ns["main"]()
    if inspect.iscoroutine(r):
        r = await r
    result = r
if result is None and "output" in _ns:
    result = _ns["output"]
json.dumps({"ok": True, "result": result}, default=str)
`);
      return typeof out === "string" ? out : JSON.stringify(out);
    }
    if (entry.kind === "guest") {
      if (typeof envReady !== "undefined" && !envReady && !window.__GOAR_UNIX) return "error: environment not ready";
      let cmd = entry.body;
      for (const [k, v] of Object.entries(args)) {
        const safe = String(v).replace(/'/g, "'\\''");
        cmd = cmd.split("{" + k + "}").join(safe);
      }
      const r = await guestExec(cmd, Number(args.timeout_ms) || 120000);
      return "exit " + r.code + "\n" + String(r.output || "").slice(0, 12000);
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), tool: name });
  }
  return "error: unknown kind";
}

function listDynamicTools() {
  return __dynamicTools.slice();
}

function toolListSessionTools() {
  const fw = ensureFrameworkState();
  return JSON.stringify({
    ok: true,
    plane: "kit",
    dynamic_tools: __dynamicTools.map((d) => ({
      name: d.name,
      kind: d.kind,
      description: d.description,
    })),
    micropip: (fw.micropip || []).slice(),
    note:
      "Pyodide kit: micropip_install pure-Python · create_tool/edit_tool for session tools · guest for heavy builds",
  }, null, 2);
}

async function toolEditTool(args) {
  // Upsert alias of create_tool — keeps body/params/kind editable this session
  const r = await toolCreateTool(args);
  try {
    const j = typeof r === "string" ? JSON.parse(r) : r;
    if (j && j.ok) j.edited = true;
    return typeof r === "string" ? JSON.stringify(j) : JSON.stringify(j);
  } catch (_) {
    return r;
  }
}

function toolRemoveTool(args) {
  const name = String((args && args.name) || "").trim();
  if (!name) return "error: name required";
  const ix = __dynamicTools.findIndex((d) => d.name === name);
  if (ix < 0) return JSON.stringify({ ok: false, error: "not found", name });
  __dynamicTools.splice(ix, 1);
  const fw = ensureFrameworkState();
  fw.extensions = __dynamicTools.map((d) => d.name);
  try {
    if (typeof refreshAgentTools === "function") refreshAgentTools();
  } catch (_) {}
  return JSON.stringify({ ok: true, removed: name, remaining: __dynamicTools.length });
}


function buildDynamicAgentTools() {
  return __dynamicTools.map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: "[ext:" + d.kind + "] " + d.description,
      parameters: d.parameters,
    },
  }));
}

try {
  window.toolSetPhase = toolSetPhase;
  window.toolMicropipInstall = toolMicropipInstall;
  window.toolCreateTool = toolCreateTool;
  window.runDynamicTool = runDynamicTool;
  window.buildDynamicAgentTools = buildDynamicAgentTools;
  window.listDynamicTools = listDynamicTools;
  window.toolListSessionTools = toolListSessionTools;
  window.toolEditTool = toolEditTool;
  window.toolRemoveTool = toolRemoveTool;
  window.FRAMEWORK_PHASES = FRAMEWORK_PHASES;
} catch (_) {}
