/* GOAR Scramjet v2 service worker — same as scramjet.mercurywork.shop */
importScripts("/controller/controller.sw.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  try {
    if ($scramjetController && $scramjetController.shouldRoute(e)) {
      e.respondWith($scramjetController.route(e));
    }
  } catch (err) {
    e.respondWith(
      new Response("Scramjet SW error: " + (err && err.message ? err.message : err), {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );
  }
});
