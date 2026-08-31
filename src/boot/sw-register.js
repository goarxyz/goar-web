function registerGoarSW() {
  if (window.__GOAR_SW) return window.__GOAR_SW;
  window.__GOAR_SW = (async () => {
    try {
      if (!("serviceWorker" in navigator)) return { ok: false, reason: "no-sw" };
      if (location.protocol === "file:") return { ok: false, reason: "file" };
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      return { ok: true, scope: reg.scope };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  })();
  return window.__GOAR_SW;
}

function precacheGoarHeavy(urls) {
  const list = (urls || []).filter(Boolean);
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "precache", urls: list });
    }
  } catch (_) {}
  if (!window.caches || !list.length) return Promise.resolve(0);
  return caches.open("goar-wasm-v1").then(async (cache) => {
    let n = 0;
    await Promise.all(list.map(async (u) => {
      try {
        if (await cache.match(u)) { n++; return; }
        const res = await fetch(u, { mode: "cors", credentials: "omit" });
        if (res && res.ok) {
          await cache.put(u, res.clone());
          n++;
        }
      } catch (_) {}
    }));
    return n;
  }).catch(() => 0);
}

function heavyAssetList() {
  const out = [];
  const add = (u) => { if (u && out.indexOf(u) < 0) out.push(u); };
  try {
    if (typeof HEAVY !== "undefined") {
      add(HEAVY.gecko);
      add(HEAVY.geckoJs);
      add(HEAVY.libcurl);
      add(HEAVY.libcurlJs);
      add(HEAVY.epoxy);
    }
  } catch (_) {}
  add("./assets/pyodide/pyodide.asm.wasm");
  add("./assets/pyodide/python_stdlib.zip");
  add("./assets/pyodide/pyodide.mjs");
  add("./assets/unix/goar-box.wasm");
  add("./assets/jit/goar-jit.wasm");
  try {
    if (typeof goarAssetUrl === "function") {
      add(goarAssetUrl("assets/gecko/gecko.wasm.zst"));
      add(goarAssetUrl("assets/gecko/gecko.js"));
    }
  } catch (_) {}
  return out;
}

function startHeavyWarm() {
  if (window.__GOAR_HEAVY_WARM) return window.__GOAR_HEAVY_WARM;
  window.__GOAR_HEAVY_WARM = (async () => {
    await registerGoarSW();
    const n = await precacheGoarHeavy(heavyAssetList());
    return { cache: n };
  })();
  return window.__GOAR_HEAVY_WARM;
}

function startGeckoWarm() {
  if (window.__GOAR_GECKO_WARM) return window.__GOAR_GECKO_WARM;
  if (typeof ensureGecko !== "function") return Promise.resolve(null);
  const url = window.GOAR_GECKO_HOME || "https://html.duckduckgo.com/html/";
  window.__GOAR_GECKO_WARM = ensureGecko({ mode: "embed", show: false, url }).catch((e) => {
    console.warn("[goar] gecko warm", e);
    return null;
  });
  return window.__GOAR_GECKO_WARM;
}

try { startHeavyWarm(); } catch (_) {}
