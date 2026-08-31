/**
 * GOAR host network fabric — cors.manus.space stack.
 *
 *   HTTP  ALL /api/proxy/:targetUrl   x-api-key · render · extract · ttl
 *   WISP  wss://cors.manus.space/wisp/   Alpine + libcurl + epoxy
 */

const MW_FABRIC = {
  engine: null,
  ready: false,
  loading: null,
  wispUrl: "",
  wispTried: [],
  libcurl: null,
  epoxy: null,
  lastError: "",
  probe: null,
};

const MANUS_LS = "pyodide_security_manus_api_key";
const MANUS_LS_LEGACY = "goar_manus_key";

const DEFAULT_WISP_POOL = [
  "wss://cors.manus.space/wisp/",
];
const MANUS_ORIGIN = (typeof window !== "undefined" && window.GOAR_MANUS_ORIGIN) || "https://cors.manus.space";
const MANUS_PROXY = (typeof window !== "undefined" && window.GOAR_CORS_PROXY) || (MANUS_ORIGIN + "/api/proxy");

function normalizeWispUrl(u) {
  u = String(u || "").trim();
  if (!u) return "";
  if (u.startsWith("wisps://")) u = "wss://" + u.slice(8);
  if (u.startsWith("wisp://")) u = "ws://" + u.slice(7);
  if (!/^wss?:\/\//i.test(u)) return "";
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "";
    if (!parsed.hostname || /\s/.test(parsed.hostname)) return "";
  } catch (_) {
    return "";
  }
  if (!/\/$/.test(u) && !/[?#]/.test(u)) u += "/";
  return u;
}

function manusWispUrl(key) {
  const base = "wss://cors.manus.space/wisp/";
  const k = String(key || "").trim();
  if (!k) return base;
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "apikey=" + encodeURIComponent(k);
}

function wispPool() {
  const pool = [];
  const push = (u) => {
    const n = normalizeWispUrl(u);
    if (n && pool.indexOf(n) === -1) pool.push(n);
  };
  const key = readManusKey();
  push(manusWispUrl(key));
  try {
    const s = typeof loadSettings === "function" ? loadSettings() : {};
    if (s && s.wispUrl) push(s.wispUrl);
  } catch (_) {}
  if (typeof window !== "undefined" && window.GOAR_WISP_URL) {
    const forced = String(window.GOAR_WISP_URL);
    push(key && /cors\.manus\.space\/wisp/i.test(forced) ? manusWispUrl(key) : forced);
  }
  return pool;
}

function probeWisp(url, timeoutMs) {
  const wisp = normalizeWispUrl(url);
  return new Promise((resolve) => {
    let settled = false;
    let ws;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      try { if (ws) ws.close(); } catch (_) {}
      resolve({ ok: !!ok, url: wisp, error: err || null });
    };
    try {
      ws = new WebSocket(wisp);
      ws.binaryType = "arraybuffer";
      const t = setTimeout(() => finish(false, "timeout"), timeoutMs || 3500);
      ws.onopen = () => { clearTimeout(t); finish(true); };
      ws.onerror = () => { clearTimeout(t); finish(false, "error"); };
      ws.onclose = () => { clearTimeout(t); if (!settled) finish(false, "closed"); };
    } catch (e) {
      finish(false, String(e && e.message ? e.message : e));
    }
  });
}

async function pickWispUrl() {
  const pool = wispPool();
  MW_FABRIC.wispTried = [];
  for (const url of pool) {
    const p = await probeWisp(url, 3500);
    MW_FABRIC.wispTried.push(p);
    if (p.ok) {
      try { localStorage.setItem("goar_wisp_url", url); } catch (_) {}
      MW_FABRIC.wispUrl = url;
      return url;
    }
    try {
      if (localStorage.getItem("goar_wisp_url") === url) localStorage.removeItem("goar_wisp_url");
    } catch (_) {}
  }
  return "";
}

function resolveWispUrl() {
  const u = MW_FABRIC.wispUrl || wispPool()[0] || DEFAULT_WISP_POOL[0];
  return normalizeWispUrl(u) || DEFAULT_WISP_POOL[0];
}
try {
  const saved = localStorage.getItem("goar_wisp_url");
  if (saved && !normalizeWispUrl(saved)) localStorage.removeItem("goar_wisp_url");
} catch (_) {}

function mwAssetBase() {
  if (typeof goarAssetUrl === "function") return goarAssetUrl("assets/net/");
  if (typeof GOAR_REMOTE === "string" && GOAR_REMOTE) return GOAR_REMOTE + "assets/net/";
  try {
    if (typeof location !== "undefined") {
      const base = location.pathname.replace(/\/[^/]*$/, "/");
      return (location.origin || "") + base + "assets/net/";
    }
  } catch (_) {}
  return "./assets/net/";
}

async function loadLibcurlEngine(wispUrl) {
  const base = mwAssetBase();
  const mod = await import(base + "libcurl.mjs");
  const lc = mod.libcurl || mod.default || mod;
  await lc.load_wasm(base + "libcurl.wasm");
  lc.set_websocket(wispUrl);
  MW_FABRIC.libcurl = lc;
  MW_FABRIC.engine = "libcurl";
  try { globalThis.__GOAR_LIBCURL = lc; } catch (_) {}
  return lc;
}

async function loadEpoxyEngine() { return null; }

async function ensureMwFabric(opts) {
  if (MW_FABRIC.ready && MW_FABRIC.engine && !(opts && opts.force)) {
    return mwFabricStatus();
  }
  if (MW_FABRIC.loading) return MW_FABRIC.loading;
  MW_FABRIC.loading = (async () => {
    MW_FABRIC.lastError = "";
    try { await mintManusKey(); } catch (_) {}
    const wisp = await pickWispUrl();
    MW_FABRIC.wispUrl = wisp;
    try {
      if (wisp) await loadLibcurlEngine(wisp);
      MW_FABRIC.ready = true;
      await probeMwFabric();
      console.log("[goar] fabric ready via", MW_FABRIC.engine, wisp);
      return mwFabricStatus();
    } catch (e) {
      MW_FABRIC.lastError = String(e && e.message ? e.message : e);
      MW_FABRIC.ready = false;
      MW_FABRIC.engine = null;
      console.warn("[goar] fabric unavailable", MW_FABRIC.lastError);
      return mwFabricStatus();
    } finally {
      MW_FABRIC.loading = null;
    }
  })();
  return MW_FABRIC.loading;
}

async function probeMwFabric() {
  try {
    const r = await goarHostFetch("https://example.com/", { method: "GET", maxBytes: 800 });
    MW_FABRIC.probe = {
      ok: !!(r && r.ok),
      status: r && r.status,
      via: r && r.via,
      ms: r && r.ms,
    };
  } catch (e) {
    MW_FABRIC.probe = { ok: false, error: String(e.message || e) };
  }
  return MW_FABRIC.probe;
}

function mwFabricStatus() {
  return {
    ready: !!MW_FABRIC.ready,
    engine: MW_FABRIC.engine,
    wispUrl: MW_FABRIC.wispUrl,
    wispTried: MW_FABRIC.wispTried.slice(),
    lastError: MW_FABRIC.lastError || null,
    probe: MW_FABRIC.probe,
    stack: "cors.manus.space /api/proxy · wisp · libcurl",
  };
}

function persistManusKey(key) {
  key = String(key || "").trim();
  if (!key) return;
  try { localStorage.setItem(MANUS_LS, key); } catch (_) {}
  try { localStorage.setItem(MANUS_LS_LEGACY, key); } catch (_) {}
  try {
    if (typeof loadSettings === "function" && typeof saveSettings === "function") {
      const s = loadSettings() || {};
      s.manusKey = key;
      saveSettings(s);
    }
  } catch (_) {}
}

async function mintManusKey() {
  const have = readManusKey();
  if (have && /^cpx_/.test(have)) return have;
  async function parseKey(text) {
    try {
      const j = JSON.parse(text);
      return (
        (j && j.key) ||
        (j && j.result && j.result.data && j.result.data.json && j.result.data.json.key) ||
        ""
      );
    } catch (_) {
      return "";
    }
  }
  try {
    const local = new URL("/api/manus-key", location.href).href;
    const r = await fetch(local, { method: "POST", headers: { accept: "application/json" } });
    const key = await parseKey(await r.text());
    if (key && /^cpx_/.test(key)) {
      persistManusKey(String(key));
      return String(key);
    }
  } catch (e) {
    console.warn("[goar] manus key mint via host", e);
  }
  const body = JSON.stringify({ json: { label: "goar" } });
  const url = MANUS_ORIGIN + "/api/trpc/apiKey.generate";
  try {
    if (MW_FABRIC.libcurl && MW_FABRIC.libcurl.fetch) {
      const res = await MW_FABRIC.libcurl.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
      });
      const key = await parseKey(await res.text());
      if (key) {
        persistManusKey(String(key));
        return String(key);
      }
    }
  } catch (e) {
    console.warn("[goar] manus key mint via wisp", e);
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
    const key = await parseKey(await r.text());
    if (key) {
      persistManusKey(String(key));
      return String(key);
    }
  } catch (e) {
    console.warn("[goar] manus key mint", e);
  }
  return have || "";
}

async function manusHttpFetch(url, opts) {
  opts = opts || {};
  const key = await mintManusKey();
  if (!key) return null;
  const method = String(opts.method || "GET").toUpperCase();
  const hop = buildManusProxyUrl(url, {
    render: opts.render,
    extract: opts.extract,
    selector: opts.selector,
    ttl: opts.ttl,
    method: method !== "GET" && method !== "HEAD" ? method : "",
    input: opts.input,
    output: opts.output,
    reqHeaders: opts.reqHeaders,
    resHeaders: opts.resHeaders,
  });
  const headers = Object.assign({}, opts.headers || {}, {
    "x-api-key": key,
    "x-target-url": String(url),
  });
  const init = { method, headers };
  if (opts.body != null && method !== "GET" && method !== "HEAD") init.body = opts.body;
  const res = await fetch(hop, init);
  const text = await res.text();
  return {
    ok: res.status >= 200 && res.status < 400,
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "" },
    body: text,
    via: opts.render ? "manus-proxy+render" : "manus-proxy",
    url,
  };
}

function buildManusProxyUrl(target, extra) {
  extra = extra || {};
  const origin = String(MANUS_ORIGIN || "https://cors.manus.space").replace(/\/$/, "");
  const dest = String(target || "").trim();
  let path = "/api/proxy/" + encodeURIComponent(dest);
  const q = [];
  const add = (k, v) => {
    if (v == null || v === "" || v === false) return;
    q.push(encodeURIComponent(k) + "=" + encodeURIComponent(v === true ? "true" : String(v)));
  };
  if (extra.render) add("render", "true");
  if (extra.extract) add("extract", extra.extract === true ? "1" : String(extra.extract));
  if (extra.selector) add("selector", extra.selector);
  if (extra.ttl) add("ttl", extra.ttl);
  if (extra.method) add("method", extra.method);
  if (extra.input) add("input", extra.input);
  if (extra.output) add("output", extra.output);
  if (extra.reqHeaders) {
    add("reqHeaders", typeof extra.reqHeaders === "string" ? extra.reqHeaders : JSON.stringify(extra.reqHeaders));
  }
  if (extra.resHeaders) {
    add("resHeaders", typeof extra.resHeaders === "string" ? extra.resHeaders : JSON.stringify(extra.resHeaders));
  }
  try {
    const k = extra.apikey || extra.apiKey || readManusKey();
    if (k) add("apikey", k);
  } catch (_) {}
  if (!q.length) return origin + path;
  return origin + path + (path.indexOf("?") >= 0 ? "&" : "?") + q.join("&");
}

function readManusKey() {
  try {
    const s = typeof loadSettings === "function" ? loadSettings() : {};
    const fromS = String((s && (s.manusKey || s.manus_api_key)) || "").trim();
    if (fromS) return fromS;
  } catch (_) {}
  try {
    const a = localStorage.getItem(MANUS_LS);
    if (a) return a;
  } catch (_) {}
  try {
    const b = localStorage.getItem(MANUS_LS_LEGACY);
    if (b) return b;
  } catch (_) {}
  return "";
}

async function goarLoopbackFetch(url, opts) {
  if (typeof toolGuestHttp !== "function") return null;
  if (typeof envReady !== "undefined" && !envReady && !(typeof window !== "undefined" && window.__emulator)) return null;
  const headers = (opts && opts.headers) || {};
  const hdrText = typeof headers === "string"
    ? headers
    : Object.keys(headers).map((k) => k + ": " + headers[k]).join("\n");
  const r = await toolGuestHttp({
    url: url,
    method: (opts && opts.method) || "GET",
    headers: hdrText,
    body: opts && opts.body,
    max_bytes: (opts && opts.maxBytes) || 80000,
  });
  const text = String(r || "");
  const statusM = text.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
  return {
    ok: /exit 0/.test(text) || !!(statusM && Number(statusM[1]) < 400),
    status: statusM ? Number(statusM[1]) : (/exit 0/.test(text) ? 200 : 0),
    headers: {},
    body: text.slice(0, (opts && opts.maxBytes) || 80000),
    via: "guest-curl",
    url: url,
  };
}

async function goarHostFetch(url, opts) {
  const t0 = performance.now();
  opts = opts || {};
  const method = String(opts.method || "GET").toUpperCase();
  try {
    const host = new URL(url, "https://local").hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
      const g = await goarLoopbackFetch(url, opts);
      if (g) {
        g.ms = Math.round(performance.now() - t0);
        return g;
      }
    }
  } catch (_) {}
  let headers = opts.headers || {};
  if (typeof headers === "string") {
    const h = {};
    headers.split("\n").forEach((line) => {
      const i = line.indexOf(":");
      if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    headers = h;
  }
  const maxBytes = Math.min(Number(opts.maxBytes) || 250000, 2_000_000);
  const body = opts.body != null ? String(opts.body) : undefined;

  if (!MW_FABRIC.ready) {
    try { await ensureMwFabric(); } catch (_) {}
  }

  try {
    const man = await manusHttpFetch(url, {
      method,
      headers,
      body,
      render: opts.render,
      extract: opts.extract,
      selector: opts.selector,
      ttl: opts.ttl,
      input: opts.input,
      output: opts.output,
    });
    if (man && (man.body || man.ok || man.status)) {
      man.body = String(man.body || "").slice(0, maxBytes);
      man.ms = Math.round(performance.now() - t0);
      return man;
    }
  } catch (e) {
    MW_FABRIC.lastError = String(e && e.message ? e.message : e);
  }

  if (MW_FABRIC.engine === "libcurl" && MW_FABRIC.libcurl) {
    try {
      const init = { method, headers };
      if (body != null && method !== "GET" && method !== "HEAD") init.body = body;
      const res = await MW_FABRIC.libcurl.fetch(url, init);
      const text = await res.text();
      const hdrs = {};
      try {
        if (res.headers && typeof res.headers.forEach === "function") {
          res.headers.forEach((v, k) => { hdrs[k] = v; });
        } else if (res.rawHeaders) {
          Object.assign(hdrs, res.rawHeaders);
        }
      } catch (_) {}
      return {
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        headers: hdrs,
        body: text.slice(0, maxBytes),
        via: "libcurl+wisp",
        ms: Math.round(performance.now() - t0),
        url,
      };
    } catch (e) {
      console.warn("[goar] libcurl fetch fail", e);
      MW_FABRIC.lastError = String(e.message || e);
    }
  }

  if (MW_FABRIC.engine === "epoxy" && MW_FABRIC.epoxy) {
    try {
      const res = await MW_FABRIC.epoxy.fetch(url, { method, headers, body: body });
      const text = await res.text();
      return {
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        headers: res.headers || {},
        body: text.slice(0, maxBytes),
        via: "epoxy+wisp",
        ms: Math.round(performance.now() - t0),
        url,
      };
    } catch (e) {
      MW_FABRIC.lastError = String(e.message || e);
    }
  }

  try {
    const init = { method, headers, mode: "cors" };
    if (body != null && method !== "GET" && method !== "HEAD") init.body = body;
    const res = await fetch(url, init);
    const text = await res.text();
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "" },
      body: text.slice(0, maxBytes),
      via: "browser-cors",
      ms: Math.round(performance.now() - t0),
      url,
    };
  } catch (_) {}

  return {
    ok: false,
    status: 0,
    headers: {},
    body: "",
    error: MW_FABRIC.lastError || "proxy hop failed",
    via: "failed",
    ms: Math.round(performance.now() - t0),
    url,
  };
}

async function goarHostFetchBytes(url) {
  const t0 = performance.now();
  url = String(url || "").trim();
  if (!url) return { ok: false, error: "url required", bytes: null };
  if (!MW_FABRIC.ready) {
    try { await ensureMwFabric(); } catch (_) {}
  }
  const key = readManusKey();
  const hop = buildManusProxyUrl(url);
  const headers = key ? { "x-api-key": key, "x-target-url": url } : {};
  try {
    const res = await fetch(hop, { headers });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength) {
        return { ok: true, status: res.status, bytes: buf, via: "manus-proxy", ms: Math.round(performance.now() - t0), url };
      }
    }
  } catch (e) {
    MW_FABRIC.lastError = String(e && e.message ? e.message : e);
  }
  if (MW_FABRIC.libcurl && MW_FABRIC.libcurl.fetch) {
    try {
      const res = await MW_FABRIC.libcurl.fetch(url);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (res.status >= 200 && res.status < 400 && buf.byteLength) {
        return { ok: true, status: res.status, bytes: buf, via: "libcurl+wisp", ms: Math.round(performance.now() - t0), url };
      }
    } catch (e) {
      MW_FABRIC.lastError = String(e && e.message ? e.message : e);
    }
  }
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { ok: true, status: res.status, bytes: buf, via: "browser-cors", ms: Math.round(performance.now() - t0), url };
    }
  } catch (_) {}
  return { ok: false, error: MW_FABRIC.lastError || "binary fetch failed", bytes: null, via: "failed", url };
}

async function goarHostFetchJson(url, method, headersJson, body) {
  let headers = {};
  try {
    headers = headersJson ? JSON.parse(headersJson) : {};
  } catch (_) {}
  const r = await goarHostFetch(url, { method: method || "GET", headers, body: body || undefined });
  return JSON.stringify(r);
}

try {
  window.MW_FABRIC = MW_FABRIC;
  window.ensureMwFabric = ensureMwFabric;
  window.goarHostFetch = goarHostFetch;
  window.goarHostFetchBytes = goarHostFetchBytes;
  window.goarHostFetchJson = goarHostFetchJson;
  window.mwFabricStatus = mwFabricStatus;
  window.resolveWispUrl = resolveWispUrl;
  window.probeMwFabric = probeMwFabric;
  window.probeWisp = probeWisp;
  window.readManusKey = readManusKey;
  window.persistManusKey = persistManusKey;
  window.mintManusKey = mintManusKey;
  window.manusHttpFetch = manusHttpFetch;
  window.manusWispUrl = manusWispUrl;
} catch (_) {}

try { window.goarLoopbackFetch = goarLoopbackFetch; } catch (_) {}
