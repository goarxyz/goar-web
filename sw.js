/* GOAR root SW — Scramjet v2 (mercurywork.shop) + wasm cache */
importScripts("/controller/controller.sw.js");

const CACHE = "goar-wasm-v2";
const HEAVY = /\.(wasm|zst)(\?|$)|python_stdlib|pyodide\.asm|gecko\.js|libcurl|epoxy-bundled|goar-box|pyodide-security/;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  try {
    if ($scramjetController && $scramjetController.shouldRoute(event)) {
      event.respondWith($scramjetController.route(event));
      return;
    }
  } catch (err) {
    event.respondWith(new Response("Scramjet SW error: " + err, { status: 502 }));
    return;
  }
  const req = event.request;
  if (req.method === "GET" && HEAVY.test(req.url)) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return fetch(req);
      }
    })());
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "precache" && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(data.urls.map(async (u) => {
        try {
          const res = await fetch(u);
          if (res && res.ok) await cache.put(u, res.clone());
        } catch (_) {}
      }));
    })());
  }
});
