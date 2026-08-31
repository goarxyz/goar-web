/**
 * GOAR system plane — single source of truth so every subsystem complements the others.
 *
 * Planes:
 *  A guest   — Wasm Unix (ash + busybox) on a shared FS; Python is Pyodide
 *  B host    — browser fetch/search + Manus CORS proxy
 *  C python  — Pyodide (same runtime as the shell) + live proxy HTTP
 *  D mind    — Adaptive Engineer cognition + ADK compaction
 *  E extend  — create_tool dynamic registry
 *  F gecko   — Firefox WASM agent browser
 *  G kv      — HeyPuter kv.js in-memory + IndexedDB cache
 *
 * Routing policy (automatic hints injected into LIVE STATUS + tool wrappers):
 *  - Live HTTP          → Manus proxy / web_fetch / browser
 *  - Python             → Pyodide (same process as the shell)
 *  - pip / micropip     → Pyodide micropip
 *  - Shell / files      → Wasm Unix applets on the shared FS
 *  - Missing capability → create_tool (python|js) then use it
 */

const GOAR_PLANES = {
  guest: "A",
  host: "B",
  kit: "C",
  mind: "D",
  extend: "E",
  gecko: "F", // Firefox WASM browser — independent of the Unix plane
  kv: "G", // HeyPuter kv.js cache/memory (IndexedDB) — additive
};

/** Tool name → framework phase inference */
const TOOL_PHASE_MAP = {
  env_info: "ASSESS",
  kit_status: "ASSESS",
  browser_status: "ASSESS",
  kv_status: "ASSESS",
  kv_get: "ASSESS",
  kv_set: "EXECUTE",
  kv_del: "EXECUTE",
  kv_keys: "ASSESS",
  gecko_status: "ASSESS",
  gecko_open: "EXECUTE",
  gecko_load: "EXECUTE",
  gecko_hide: "EXECUTE",
  browse: "VALIDATE",
  workspace_tree: "ASSESS",
  list_dir: "ASSESS",
  net_diag: "ASSESS",
  think: "ASSESS",
  create_plan: "PLAN",
  todo: "PLAN",
  update_ledger: "PLAN",
  set_phase: "PLAN",
  web_search: "VALIDATE",
  web_fetch: "VALIDATE",
  py_check: "VALIDATE",
  write_file: "EXECUTE",
  edit_file: "EXECUTE",
  bash: "EXECUTE",
  python_exec: "EXECUTE",
  install_flask: "EXECUTE",
  micropip_install: "EXECUTE",
  create_tool: "EXECUTE",
  mkdir: "EXECUTE",
  delete_file: "EXECUTE",
  move_file: "EXECUTE",
  copy_file: "EXECUTE",
  read_file: "REVIEW",
  grep: "REVIEW",
  glob: "REVIEW",
  http_request: "VERIFY",
  guest_http: "VERIFY",
  pysec: "VERIFY",
  complete_task: "DELIVER",
  store_memory: "DELIVER",
  recall_memory: "ASSESS",
};

function planeSnapshot() {
  const ready = !!(
    (typeof envReady !== "undefined" && envReady) ||
    window.envReady ||
    window.__GOAR_ENV_READY
  );
  const emu = !!window.__emulator;
  const kitReady = !!(typeof __pysecReady !== "undefined" && __pysecReady);
  const proxy = window.__GOAR_PROXY || null;
  const proxyOk = !!(proxy && proxy.ok);
  let mw = null;
  try { mw = typeof mwFabricStatus === "function" ? mwFabricStatus() : null; } catch (_) {}
  const mwOk = !!(mw && mw.ready && mw.probe && mw.probe.ok);
  let freeze = null;
  try {
    freeze = window.__GOAR_FROZEN_META || null;
  } catch (_) {}
  let fw = null;
  try {
    fw = (typeof agentState !== "undefined" && agentState.framework) || null;
  } catch (_) {}
  let dyn = 0;
  try {
    dyn = typeof listDynamicTools === "function" ? listDynamicTools().length : 0;
  } catch (_) {}
  let toolN = 0;
  try {
    toolN = typeof getAgentTools === "function" ? getAgentTools().length : 0;
  } catch (_) {}
  return {
    guest: { ready: ready || emu, emu, online: ready },
    host: {
      proxyOk,
      proxySource: proxy && proxy.source,
      proxyBase: proxy && proxy.baseUrl,
      mwReady: mwOk || !!(mw && mw.ready),
      mwEngine: mw && mw.engine,
      wispUrl: mw && mw.wispUrl,
    },
    kit: { ready: kitReady, tools: toolN },
    mind: {
      phase: (fw && fw.phase) || "ASSESS",
      mission: typeof agentState !== "undefined" ? !!agentState.mission : false,
      wave: typeof agentState !== "undefined" ? agentState.wave || 0 : 0,
    },
    extend: { dynamic: dyn },
    freeze: {
      fromFreeze: !!window.__GOAR_FROM_FREEZE,
      saved: !!(freeze && freeze.gzBytes),
      allow: window.GOAR_ALLOW_FREEZE === true,
    },
    gecko: (function () {
      try {
        return typeof geckoStatus === "function"
          ? geckoStatus()
          : { ready: false, note: "plane not loaded" };
      } catch (e) {
        return { ready: false, error: String(e && e.message ? e.message : e) };
      }
    })(),
    kv: (function () {
      try {
        return typeof goarKvStatus === "function"
          ? goarKvStatus()
          : { ready: false, note: "kv-plane not loaded" };
      } catch (e) {
        return { ready: false, error: String(e && e.message ? e.message : e) };
      }
    })(),
  };
}

/**
 * Dense, model-facing interlock block — refreshed every system rebuild.
 */
function systemPlaneBlurb() {
  return "";
}

/** Infer + set phase from tool name (soft — does not override explicit set_phase mid-call). */
function inferPhaseFromTool(name) {
  if (!name) return null;
  if (TOOL_PHASE_MAP[name]) return TOOL_PHASE_MAP[name];
  if (name.indexOf("p_") === 0 || name.indexOf(".") !== -1) return "VERIFY";
  if (name.indexOf("write") === 0 || name.indexOf("edit") === 0) return "EXECUTE";
  return null;
}

function applyInferredPhase(name, args) {
  try {
    if (name === "set_phase") return;
    const phase = inferPhaseFromTool(name);
    if (!phase) return;
    if (typeof agentState === "undefined") return;
    if (!agentState.framework) {
      agentState.framework = { phase: "ASSESS", phaseHistory: [], extensions: [], micropip: [] };
    }
    // Only auto-advance forward in the cycle (or first set)
    const order = ["ASSESS", "PLAN", "VALIDATE", "EXECUTE", "REVIEW", "VERIFY", "DELIVER"];
    const cur = agentState.framework.phase || "ASSESS";
    const ci = order.indexOf(cur);
    const ni = order.indexOf(phase);
    if (ni >= 0 && (ci < 0 || ni >= ci || cur === "ASSESS")) {
      if (cur !== phase) {
        agentState.framework.phase = phase;
        agentState.framework.phaseHistory = (agentState.framework.phaseHistory || []).concat([
          { phase, note: "auto:" + name, ts: Date.now() },
        ]).slice(-40);
      }
    }
  } catch (_) {}
}

/**
 * Wrap tool output with complementary next-step hints when failures are structural.
 */
function enrichToolResult(name, args, out) {
  const s = String(out == null ? "" : out);
  const hints = [];
  const low = s.toLowerCase();
  const snap = planeSnapshot();

  // CORS / proxy / network failures → complementary plane
  if (
    /cors|failed to fetch|networkerror|proxy auth|via_proxy|proxy not|not configured|load failed|typeerror: fetch/i.test(s) ||
    (name === "pysec" && /ok:\s*false/i.test(s) && /http|fetch|probe|scan|httpx|nuclei|requests/i.test(JSON.stringify(args || {})))
  ) {
    if (snap.guest.online) {
      hints.push("HINT: try guest_http or bash curl, then open the page in Firefox.");
    } else {
      hints.push("HINT: environment is still starting — use web_fetch if the origin allows CORS, or wait until Unix is ready.");
    }
    if (!snap.host.proxyOk) {
      hints.push("HINT: CORS proxy is not ready — retry shortly.");
    } else {
      hints.push("HINT: proxy reported ready but this request failed — retry once or use guest_http.");
    }
  }

  // Module missing in pyodide
  if (/modulenotfounderror|no module named/i.test(s)) {
    const m = s.match(/no module named ['\"]?([a-zA-Z0-9_]+)/i);
    const mod = m ? m[1] : "package";
    hints.push(
      "HINT: micropip_install package=" +
        mod +
        " (kit plane) or guest pip install when ONLINE.",
    );
  }

  // flask
  if (/no module named ['\"]flask/i.test(s)) {
    hints.push("HINT: call install_flask then re-run (offline wheels / guest).");
  }

  // unknown tool
  if (/^unknown tool:/i.test(s)) {
    hints.push("HINT: add the capability with create_tool, or call pysec with a catalog id.");
  }

  if (!hints.length) return s;
  return s + "\n\n" + hints.join("\n");
}

/**
 * Ensure complementary host services before a turn (kit + proxy). Non-blocking if already up.
 */
async function ensureSystemPlanes(opts) {
  const o = opts || {};
  const out = { kit: false, proxy: false, mw: false };
  // 1) Network fabric first (libcurl + Wisp) — plane B primary
  try {
    if (typeof ensureMwFabric === "function") {
      const m = await ensureMwFabric(o.forceMw ? { force: true } : undefined);
      out.mw = !!(m && m.ready);
    }
  } catch (e) {
    console.warn("[goar] ensure MW fabric", e);
  }
  // 2) Pyodide kit
  try {
    if (typeof ensurePysecWorker === "function") {
      await ensurePysecWorker();
      out.kit = true;
    }
  } catch (e) {
    console.warn("[goar] ensure kit", e);
  }
  // 3) Patch pysec HTTP to use MW fabric + Manus/CORS fallback
  try {
    if (typeof wirePysecThroughFabric === "function") {
      await wirePysecThroughFabric();
    }
  } catch (e) {
    console.warn("[goar] wire pysec fabric", e);
  }
  // 4) Legacy Manus/local CORS configure (still useful as degraded hop)
  try {
    if (typeof ensurePysecNetwork === "function") {
      const r = await ensurePysecNetwork();
      out.proxy = !!(r && r.ok);
    }
  } catch (e) {
    console.warn("[goar] ensure proxy", e);
  }
  try {
    if (typeof refreshAgentTools === "function") refreshAgentTools();
  } catch (_) {}
  return out;
}

/**
 * Unified system preamble for the model (planes + live status + session + mission rules).
 */
function buildIntegratedSystemCore() {
  const missionExtra = typeof missionContextBlock === "function" ? missionContextBlock() : "";
  const stateCtx = typeof getStateContext === "function" ? getStateContext() : "";
  const live = typeof sandboxStatusBlurb === "function" ? sandboxStatusBlurb() : "";
  const planes = systemPlaneBlurb();
  return (
    (typeof OPERATOR_CORE !== "undefined" ? OPERATOR_CORE : "") +
    "\n\n" +
    planes +
    "\n\n" +
    live +
    (stateCtx ? "\n\n## SESSION STATE\n" + stateCtx : "") +
    missionExtra +
    "\n## INTERLOCK RULES\n" +
    "- Act with tools toward MISSION. Planes A–E complement each other; chain them in one turn.\n" +
    "- Prefer write_file once with full content. Verify with python_exec/bash after writes.\n" +
    "- Tools are always available — never invent a ban. On failure, change approach (see HINTs).\n" +
    "- Compacted history = same mission; continue, do not restart discovery.\n" +
    "- set_phase as you move ASSESS→…→DELIVER (or let auto-phase follow tools).\n" +
    "- complete_task only after VERIFY evidence.\n" +
    "- Trust LIVE STATUS + SYSTEM PLANES over assumptions. Be concise.\n"
  );
}

try {
  window.GOAR_PLANES = GOAR_PLANES;
  window.planeSnapshot = planeSnapshot;
  window.systemPlaneBlurb = systemPlaneBlurb;
  window.inferPhaseFromTool = inferPhaseFromTool;
  window.applyInferredPhase = applyInferredPhase;
  window.enrichToolResult = enrichToolResult;
  window.ensureSystemPlanes = ensureSystemPlanes;
  window.buildIntegratedSystemCore = buildIntegratedSystemCore;
} catch (_) {}
