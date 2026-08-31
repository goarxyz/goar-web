/**
 * Peak preload — cache + planes after Python is up.
 * Gecko and Wasm download start earlier via startHeavyWarm / startGeckoWarm.
 */
(function (global) {
  "use strict";

  function asset(rel) {
    try {
      if (typeof goarAssetUrl === "function") return goarAssetUrl(rel);
    } catch (_) {}
    return "./" + String(rel).replace(/^\.\//, "");
  }

  async function warmPythonPeak() {
    const py = global.__pyodide;
    if (!py || typeof py.runPythonAsync !== "function") return { ok: false };
    try {
      if (typeof installGoarJitPy === "function") await installGoarJitPy();
    } catch (_) {}
    const raw = await py.runPythonAsync(`
import json, sys
sys.path.insert(0, "/home/pyodide")
out = {"modules": 0, "failed": [], "tools": 0, "jit": None, "version": None}
try:
    import pyodide_security as ps
    out["version"] = getattr(ps, "VERSION", None) or getattr(ps, "__version__", None)
    out["tools"] = len(ps.list_tools())
except Exception as e:
    out["failed"].append("pyodide_security:" + str(e)[:120])
try:
    import goar_jit
    out["jit"] = goar_jit.status()
except Exception as e:
    out["failed"].append("goar_jit:" + str(e)[:80])
json.dumps(out)
`);
    let info = {};
    try { info = JSON.parse(String(raw || "{}")); } catch (_) { info = { raw: raw }; }
    global.__GOAR_PYSEC_PRELOADED = true;
    global.__GOAR_PYSEC_PRELOAD = info;
    return info;
  }

  async function warmBox() {
    if (typeof ensureWasiBox !== "function") return false;
    const ok = await ensureWasiBox();
    if (!ok || typeof wasiBusybox !== "function") return !!ok;
    try {
      const r = await wasiBusybox(["busybox", "--list"], "", "/workspace");
      global.__GOAR_BOX_LIST = r && r.stdout;
    } catch (_) {}
    return true;
  }

  async function preloadGoarPeak() {
    if (global.__GOAR_PEAK) return global.__GOAR_PEAK_STATE;
    const state = {
      cache: 0,
      fabric: false,
      epoxy: false,
      box: false,
      gecko: !!global.__GOAR_GECKO_READY,
      pysec: null,
      jit: !!global.__GOAR_JIT,
    };
    try { if (typeof setProgress === "function") setProgress(86, "Peak preload", "libraries"); } catch (_) {}

    try {
      if (typeof startHeavyWarm === "function") {
        const w = await startHeavyWarm();
        state.cache = (w && w.cache) || 0;
      }
    } catch (_) {}

    const jobs = [];
    if (typeof ensureJit === "function") {
      try { ensureJit(); state.jit = true; } catch (_) {}
    }
    if (typeof ensureMwFabric === "function") {
      jobs.push(
        ensureMwFabric()
          .then((s) => { state.fabric = !!(s && s.ready); })
          .catch(() => {})
      );
    }
    if (typeof ensureEpoxy === "function" || typeof ensureGoarEpoxy === "function") {
      const epoxyFn = typeof ensureEpoxy === "function" ? ensureEpoxy : ensureGoarEpoxy;
      jobs.push(
        epoxyFn()
          .then((c) => { state.epoxy = !!c; })
          .catch(() => {})
      );
    }
    jobs.push(warmBox().then((ok) => { state.box = !!ok; }));
    jobs.push(
      warmPythonPeak()
        .then((info) => { state.pysec = info; })
        .catch((e) => { state.pysec = { ok: false, error: String(e && e.message ? e.message : e) }; })
    );
    try { if (typeof startGeckoWarm === "function") startGeckoWarm(); } catch (_) {}

    await Promise.all(jobs);
    state.gecko = !!global.__GOAR_GECKO_READY;
    global.__GOAR_PEAK = true;
    global.__GOAR_PEAK_STATE = state;
    console.log("[goar] peak preload", state);
    return state;
  }

  global.preloadGoarPeak = preloadGoarPeak;
  global.warmPythonPeak = warmPythonPeak;
})(typeof window !== "undefined" ? window : globalThis);
