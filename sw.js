const CACHE = "goar-wasm-v1";
const HEAVY = /\.(wasm|zst)(\?|$)|python_stdlib|pyodide\.asm|gecko\.js|libcurl|epoxy-bundled|goar-box|pyodide-security/;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([CACHE, "goar-peak-v1", "goar-assets", "goar-pyodide-v1"]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("goar-") && !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type !== "precache" || !Array.isArray(msg.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(msg.urls.filter(Boolean).map(async (u) => {
      try {
        if (await cache.match(u)) return;
        const res = await fetch(u, { mode: "cors", credentials: "omit" });
        if (res && res.ok) await cache.put(u, res.clone());
      } catch (_) {}
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const dest = req.destination;
  const isolate = dest === "document" || dest === "iframe" || dest === "worker" || dest === "script" || req.mode === "navigate";
  if (isolate) {
    event.respondWith((async () => {
      const res = await fetch(req);
      const h = new Headers(res.headers);
      h.set("Cross-Origin-Embedder-Policy", "credentialless");
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      h.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    })());
    return;
  }
  if (!HEAVY.test(req.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      try { await cache.put(req, res.clone()); } catch (_) {}
    }
    return res;
  })());
});
