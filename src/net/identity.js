/**
 * Per-hop browser identity. Nothing persistent, nothing GOAR-named.
 * Used by chat, Duck, Scramjet, and host fetch so free providers
 * do not see a fixed client fingerprint.
 */
(function (global) {
  "use strict";

  const CHROME = [120, 124, 128, 131, 136, 139, 140, 141];
  const OS = [
    "Windows NT 10.0; Win64; x64",
    "Windows NT 11.0; Win64; x64",
    "Macintosh; Intel Mac OS X 10_15_7",
    "Macintosh; Intel Mac OS X 13_6_0",
    "X11; Linux x86_64",
    "X11; Ubuntu; Linux x86_64",
    "Linux; Android 14; Pixel 8",
    "Linux; Android 13; SM-S918B",
    "Linux; Android 15; Pixel 9",
  ];
  const LANGS = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "en-AU,en;q=0.9,en;q=0.8",
    "en-US,en;q=0.9,id;q=0.8",
    "en-US,en;q=0.8,es;q=0.5",
  ];
  const BRANDS = [
    function (v) { return "\"Google Chrome\";v=\"" + v + "\", \"Chromium\";v=\"" + v + "\", \"Not=A?Brand\";v=\"24\""; },
    function (v) { return "\"Chromium\";v=\"" + v + "\", \"Not.A/Brand\";v=\"99\", \"Google Chrome\";v=\"" + v + "\""; },
    function (v) { return "\"Not=A?Brand\";v=\"99\", \"Android WebView\";v=\"" + v + "\", \"Chromium\";v=\"" + v + "\""; },
    function (v) { return "\"Microsoft Edge\";v=\"" + v + "\", \"Chromium\";v=\"" + v + "\", \"Not:A-Brand\";v=\"24\""; },
  ];
  const PACKAGES = [
    "",
    "com.android.chrome",
    "com.android.browser",
    "com.google.android.webview",
    "org.mozilla.firefox",
  ];
  const PATHS = ["/", "/chat", "/app", "/c", "/new", "/"];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function nonce(n) {
    n = n || 8;
    try {
      const a = new Uint8Array(n);
      (global.crypto || crypto).getRandomValues(a);
      let s = "";
      for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, "0");
      return s;
    } catch (_) {
      return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function chromeVer() {
    return pick(CHROME);
  }

  function userAgent() {
    const v = chromeVer();
    const os = pick(OS);
    if (/Android/.test(os)) {
      return "Mozilla/5.0 (" + os + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + v + ".0.0.0 Mobile Safari/537.36";
    }
    return "Mozilla/5.0 (" + os + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + v + ".0.0.0 Safari/537.36";
  }

  function platformFromUa(ua) {
    if (/Android/.test(ua)) return "\"Android\"";
    if (/Mac OS X/.test(ua)) return "\"macOS\"";
    if (/Windows/.test(ua)) return "\"Windows\"";
    return "\"Linux\"";
  }

  function originForHost(host) {
    host = String(host || "").toLowerCase();
    if (!host) return "";
    if (/kai9000/.test(host)) {
      return pick(["https://kai9000.com", "https://www.kai9000.com", "https://kai9000.com"]);
    }
    if (/duckduckgo\.com|duck\.ai/.test(host)) {
      return pick(["https://duckduckgo.com", "https://duck.ai"]);
    }
    if (/pollinations/.test(host)) return "https://pollinations.ai";
    if (/free\.ai/.test(host)) return pick(["https://free.ai", "https://www.free.ai"]);
    if (/aiand\.com/.test(host)) return "https://aiand.com";
    if (/openrouter\.ai/.test(host)) return "https://openrouter.ai";
    try { return "https://" + host.replace(/^www\./, ""); } catch (_) { return ""; }
  }

  function refererFor(origin) {
    if (!origin) return "";
    const path = pick(PATHS);
    const q = Math.random() < 0.4 ? ("?v=" + nonce(3)) : "";
    return origin.replace(/\/+$/, "") + path + q;
  }

  function goarBrowserHeaders(url) {
    let host = "";
    try { host = new URL(String(url || ""), "https://local").hostname; } catch (_) {}
    const ua = userAgent();
    const v = (ua.match(/Chrome\/(\d+)/) || [])[1] || String(chromeVer());
    const origin = originForHost(host);
    const mobile = /Mobile/.test(ua);
    const h = {
      "User-Agent": ua,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": pick(LANGS),
      "sec-ch-ua": pick(BRANDS)(v),
      "sec-ch-ua-mobile": mobile ? "?1" : "?0",
      "sec-ch-ua-platform": platformFromUa(ua),
    };
    if (origin) {
      h.Origin = origin;
      h.Referer = refererFor(origin);
    }
    if (mobile && Math.random() < 0.5) {
      const pkg = pick(PACKAGES);
      if (pkg) h["X-Requested-With"] = pkg;
    }
    return h;
  }

  function goarMergeHeaders(url, extra) {
    const base = goarBrowserHeaders(url);
    const out = Object.assign({}, base);
    extra = extra || {};
    Object.keys(extra).forEach(function (k) {
      if (extra[k] == null || extra[k] === "") return;
      out[k] = extra[k];
    });
    return out;
  }

  let _ephemeral = "";
  let _ephemeralAt = 0;
  function goarEphemeralId() {
    const now = Date.now();
    if (!_ephemeral || now - _ephemeralAt > 4 * 60 * 1000) {
      _ephemeral = nonce(12);
      _ephemeralAt = now;
      try { localStorage.removeItem("goar.anon.id"); } catch (_) {}
    }
    return _ephemeral;
  }

  function goarFeVersion() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const ss = String(d.getUTCSeconds()).padStart(2, "0");
    return "serp_" + y + m + day + "_" + hh + mm + ss + "_ET-" + nonce(10);
  }

  try { global.goarBrowserHeaders = goarBrowserHeaders; } catch (_) {}
  try { global.goarMergeHeaders = goarMergeHeaders; } catch (_) {}
  try { global.goarEphemeralId = goarEphemeralId; } catch (_) {}
  try { global.goarFeVersion = goarFeVersion; } catch (_) {}
  try { global.goarNonce = nonce; } catch (_) {}
})(typeof window !== "undefined" ? window : this);
