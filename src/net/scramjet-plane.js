/**
 * Scramjet v2 — same stack as https://scramjet.mercurywork.shop/
 * scramjet.js + controller.api.js + libcurl-transport over WISP
 */
(function (global) {
  "use strict";

  const SJ = {
    ready: false,
    loading: null,
    controller: null,
    frame: null,
    lastError: "",
    lastUrl: "",
    transport: "",
  };

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { reject(new Error(label + " timeout")); }, ms);
      Promise.resolve(promise).then(
        function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); }
      );
    });
  }

  function wispUrl() {
    try {
      if (typeof resolveGeckoWisp === "function") {
        const u = resolveGeckoWisp();
        if (u) return u.endsWith("/") ? u : u + "/";
      }
    } catch (_) {}
    return "wss://wisp.mercurywork.shop/";
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-sj="' + src + '"]')) {
        resolve(true);
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.setAttribute("data-sj", src);
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error("script " + src)); };
      document.head.appendChild(s);
    });
  }

  async function makeTransport() {
    const wisp = wispUrl();
    const mod = await import("/libcurl-transport/index.mjs");
    const LibcurlClient = mod.LibcurlClient || mod.default;
    const t = new LibcurlClient({ wisp: wisp });
    if (t && t.init) await withTimeout(t.init(), 12000, "libcurl-init");
    SJ.transport = "libcurl";
    return t;
  }

  async function ensureScramjet() {
    if (SJ.ready && SJ.controller) return SJ;
    if (SJ.loading) return SJ.loading;
    SJ.loading = (async function () {
      if (!("serviceWorker" in navigator)) throw new Error("no service worker");
      if (typeof registerGoarSW === "function") {
        try { await registerGoarSW(); } catch (_) {}
      }
      await withTimeout(loadScript("/scramjet/scramjet.js"), 8000, "scramjet.js");
      await withTimeout(loadScript("/controller/controller.api.js"), 8000, "controller.api");
      if (!global.$scramjetController || !global.$scramjetController.Controller) {
        throw new Error("Scramjet controller missing");
      }
      const transport = await makeTransport();
      let sw = navigator.serviceWorker.controller;
      if (!sw) {
        try {
          const ready = await withTimeout(navigator.serviceWorker.ready, 8000, "sw-ready");
          sw = ready && ready.active;
        } catch (_) {}
      }
      if (!sw) {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        sw = reg.active || reg.waiting;
      }
      if (!sw) throw new Error("no service worker available");
      const controller = new global.$scramjetController.Controller({
        serviceworker: sw,
        transport: transport,
        config: {
          prefix: "/~/sj/",
          scramjetPath: "/scramjet/scramjet.js",
          injectPath: "/controller/controller.inject.js",
          wasmPath: "/scramjet/scramjet.wasm",
        },
      });
      await withTimeout(controller.wait(), 15000, "sj-wait");
      SJ.controller = controller;
      SJ.ready = true;
      SJ.lastError = "";
      try {
        const w = wispUrl();
        if (typeof MW_FABRIC !== "undefined" && MW_FABRIC) MW_FABRIC.wispUrl = w;
        localStorage.setItem("goar_wisp_url", w);
      } catch (_) {}
      return SJ;
    })().catch(function (e) {
      SJ.loading = null;
      SJ.lastError = e && e.message ? e.message : String(e);
      throw e;
    });
    return SJ.loading;
  }

  function hostFrame() {
    return document.getElementById("goar-live-frame")
      || document.querySelector("#browser-frame-wrap iframe");
  }

  async function scramjetGo(url) {
    const target = String(url || "").trim();
    if (!target) return { ok: false, error: "url required" };
    const abs = /^https?:\/\//i.test(target) ? target : ("https://" + target.replace(/^\/+/, ""));
    await ensureScramjet();
    const iframe = hostFrame();
    if (!iframe) throw new Error("no browser frame");
    try { iframe.removeAttribute("srcdoc"); } catch (_) {}
    if (!SJ.frame || SJ.frame.element !== iframe) {
      SJ.frame = SJ.controller.createFrame(iframe);
    }
    SJ.frame.go(abs);
    SJ.lastUrl = abs;
    try {
      const bar = document.getElementById("browser-url");
      if (bar) bar.value = abs;
    } catch (_) {}
    try { if (typeof setUrlLabel === "function") setUrlLabel(abs); } catch (_) {}
    return { ok: true, via: "scramjet", url: abs, transport: SJ.transport };
  }

  function wrapLiveNavigate() {
    const prev = global.liveNavigate;
    if (prev && prev._scramjet) return;
    const wrapped = async function (url, opts) {
      const raw = String(url || "").trim();
      if (!raw || raw === "about:home" || raw === "about:blank" || raw === "goar:home") {
        return prev ? prev(url, opts) : { ok: true };
      }
      try {
        const r = await scramjetGo(raw);
        if (r && r.ok) return r;
      } catch (e) {
        SJ.lastError = e && e.message ? e.message : String(e);
      }
      if (typeof prev === "function") return prev(url, opts);
      return { ok: false, error: SJ.lastError || "scramjet failed" };
    };
    wrapped._scramjet = true;
    global.liveNavigate = wrapped;
  }

  function scramjetStatus() {
    return {
      plane: "scramjet",
      ready: !!SJ.ready,
      transport: SJ.transport || "",
      lastUrl: SJ.lastUrl || "",
      lastError: SJ.lastError || "",
      wisp: wispUrl(),
    };
  }

  wrapLiveNavigate();
  global.ensureScramjet = ensureScramjet;
  global.scramjetGo = scramjetGo;
  global.scramjetStatus = scramjetStatus;
})(typeof window !== "undefined" ? window : globalThis);
