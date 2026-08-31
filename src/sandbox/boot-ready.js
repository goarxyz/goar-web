/**
 * One ready moment. Chat does not unlock until peak preload finishes.
 */
(function (global) {
  "use strict";

  async function waitForGoarReady(ms) {
    const budget = Number(ms) || 120000;
    const state = {
      unix: !!global.__GOAR_UNIX,
      py: !!(global.__pyodide),
      kernel: !!global.__GOAR_KERNEL,
      jit: !!global.__GOAR_JIT,
      pysec: !!global.__pysecReady,
      box: !!global.__GOAR_WASI_BOX,
      gecko: !!global.__GOAR_GECKO_READY,
      peak: null,
    };

    const work = (async () => {
      if (typeof preloadGoarPeak === "function") {
        state.peak = await preloadGoarPeak();
        const p = state.peak || {};
        state.box = !!p.box || state.box;
        state.gecko = !!p.gecko || state.gecko;
        state.jit = !!p.jit || state.jit;
        state.pysec = !!(p.pysec && (p.pysec.tools || p.pysec.version)) || state.pysec;
      } else {
        if (typeof ensureWasiBox === "function") {
          try { state.box = !!(await ensureWasiBox()); } catch (_) {}
        }
        if (typeof ensureGecko === "function") {
          try {
            const st = await ensureGecko({
              mode: "embed",
              show: false,
              url: global.GOAR_GECKO_HOME || "https://duckduckgo.com/",
            });
            state.gecko = !!(st && st.ready);
          } catch (_) {}
        }
      }
    })();

    await Promise.race([
      work,
      new Promise((r) => setTimeout(r, budget)),
    ]);

    state.unix = !!global.__GOAR_UNIX;
    state.py = !!(global.__pyodide);
    state.kernel = !!global.__GOAR_KERNEL;
    state.jit = !!global.__GOAR_JIT || state.jit;
    state.pysec = !!global.__pysecReady || !!global.__GOAR_PYSEC_PRELOADED || state.pysec;
    state.box = !!global.__GOAR_WASI_BOX || state.box;
    state.gecko = !!global.__GOAR_GECKO_READY || state.gecko;

    const core = !!(state.py || state.unix || global.__pyodide || global.__GOAR_UNIX);
    global.__GOAR_READY = !!core;
    global.__GOAR_READY_STATE = state;
    try {
      if (core && typeof __goarMarkEnvReady === "function") __goarMarkEnvReady(true, "ready");
    } catch (_) {}
    console.log("[goar] ready", state);
    return state;
  }

  global.waitForGoarReady = waitForGoarReady;
})(typeof window !== "undefined" ? window : globalThis);
