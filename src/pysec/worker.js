/**
 * Wire cors.manus.space for all pysec live tools (httpx, fetch, nuclei, …).
 *   1) Saved manus key
 *   2) mintManusKey → cors.manus.space tRPC
 *   3) configure base_url=https://cors.manus.space/api/proxy
 * Live tools go through ALL /api/proxy/:targetUrl (x-api-key).
 */

/**
 * Route pysec _http through MW fabric (libcurl+Wisp) when available.
 * Monkey-patches pyodide_security._http.http_request to call window.goarHostFetchJson.
 */

/**
 * Route pysec _http through MW fabric (libcurl+Wisp).
 * Rebinds http_request on _http AND every already-imported consumer module.
 */
async function wirePysecThroughFabric() {
  if (!__pyodide) return { ok: false, error: "no pyodide" };
  if (window.__GOAR_PYSEC_FABRIC_WIRED) {
    // re-apply in case pyodide reloaded
  }
  try {
    if (typeof ensureMwFabric === "function") await ensureMwFabric();
  } catch (_) {}
  try {
    await __pyodide.runPythonAsync(`
import json, sys, types

async def _goar_fabric_http_request(url, method="GET", headers=None, body=None, timeout_ms=30000, use_proxy=None):
    import time
    t0 = time.perf_counter()
    headers = headers or {}
    from js import goarHostFetchJson
    raw = await goarHostFetchJson(
        str(url),
        str(method or "GET"),
        json.dumps({str(k): str(v) for k, v in (headers or {}).items()}),
        None if body is None else (body if isinstance(body, str) else body.decode("utf-8", "replace")),
    )
    data = json.loads(raw)
    ms = round((time.perf_counter() - t0) * 1000, 2)
    return {
        "ok": bool(data.get("ok")),
        "status": int(data.get("status") or 0),
        "headers": data.get("headers") or {},
        "body": data.get("body") or "",
        "url": url,
        "final_url": data.get("url") or url,
        "error": data.get("error"),
        "elapsed_ms": data.get("ms") or ms,
        "via_proxy": True,
        "via": data.get("via"),
        "engine": "goar-mw-fabric",
    }

import pyodide_security._http as _h
_orig = getattr(_h, "http_request", None)

async def http_request(url, method="GET", headers=None, body=None, timeout_ms=30000, use_proxy=None):
    try:
        return await _goar_fabric_http_request(url, method, headers, body, timeout_ms, use_proxy)
    except Exception as e1:
        if _orig is not None:
            try:
                return await _orig(url, method=method, headers=headers, body=body, timeout_ms=timeout_ms, use_proxy=use_proxy)
            except Exception as e2:
                return {"ok": False, "status": 0, "error": f"fabric:{e1}; orig:{e2}", "url": url, "headers": {}, "body": ""}
        return {"ok": False, "status": 0, "error": str(e1), "url": url, "headers": {}, "body": ""}

_h.http_request = http_request

# Rebind imported names in every loaded pyodide_security submodule
n = 0
for name, mod in list(sys.modules.items()):
    if not name or not name.startswith("pyodide_security"):
        continue
    if not isinstance(mod, types.ModuleType):
        continue
    if getattr(mod, "http_request", None) is not None:
        try:
            mod.http_request = http_request
            n += 1
        except Exception:
            pass

print("fabric rebound modules", n)
`)
    window.__GOAR_PYSEC_FABRIC_WIRED = true;
    console.log("[goar] pysec HTTP → MW fabric (rebound)");
    return { ok: true };
  } catch (e) {
    console.warn("[goar] wirePysecThroughFabric", e);
    return { ok: false, error: String(e.message || e) };
  }
}

async function installGoarPythonNet() {
  if (!__pyodide) return { ok: false, error: "no pyodide" };
  let key = "";
  try {
    if (typeof mintManusKey === "function") key = (await mintManusKey()) || "";
    if (!key && typeof readManusKey === "function") key = readManusKey() || "";
  } catch (_) {}
  const payload = JSON.stringify({
    key: key,
    base: "https://cors.manus.space/api/proxy/",
  });
  try {
    __pyodide.globals.set("_goar_net_cfg", payload);
    await __pyodide.runPythonAsync(`
import json, io, os
from http.client import HTTPMessage
from urllib.parse import quote
from js import XMLHttpRequest

_cfg = json.loads(_goar_net_cfg)
_KEY = str(_cfg.get("key") or "")
_BASE = str(_cfg.get("base") or "https://cors.manus.space/api/proxy/")

class _GoarResp(io.BytesIO):
    def __init__(self, body, status, url):
        raw = body if isinstance(body, (bytes, bytearray)) else str(body or "").encode("utf-8", "replace")
        super().__init__(raw)
        self.status = int(status or 0)
        self.code = self.status
        self.url = url
        self.headers = HTTPMessage()
    def getcode(self):
        return self.status
    def geturl(self):
        return self.url
    def info(self):
        return self.headers

def _goar_urlopen(url, data=None, timeout=None, *a, **k):
    req = url if hasattr(url, "get_full_url") else None
    target = req.get_full_url() if req else str(url)
    method = "POST" if data is not None else (req.get_method() if req else "GET")
    body = None
    if data is not None:
        body = data.decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else str(data)
    hop = _BASE + quote(target, safe="")
    if _KEY:
        hop += ("&" if "?" in hop else "?") + "apikey=" + quote(_KEY, safe="")
    xhr = XMLHttpRequest.new()
    xhr.open(method, hop, False)
    if _KEY:
        xhr.setRequestHeader("x-api-key", _KEY)
        xhr.setRequestHeader("x-target-url", target)
    try:
        xhr.send(body if body is not None else None)
        return _GoarResp(xhr.responseText or "", int(xhr.status or 0), target)
    except Exception as e:
        return _GoarResp(str(e), 0, target)

import urllib.request as _u
_u.urlopen = _goar_urlopen
os.environ["GOAR_NET"] = "1"
print("goar python net", "key" if _KEY else "nokey")
`);
    return { ok: true, key: !!key };
  } catch (e) {
    console.warn("[goar] installGoarPythonNet", e);
    return { ok: false, error: String(e.message || e) };
  }
}

async function ensurePysecNetwork() {
  if (!__pyodide) return { ok: false, error: "pyodide not ready" };
  const origin = (typeof location !== "undefined" && location.origin) ? location.origin : "";
  let key = "";
  let source = "";
  try {
    if (typeof readManusKey === "function") key = readManusKey() || "";
  } catch (_) {}
  if (!key) {
    try {
      if (typeof mintManusKey === "function") {
        key = await mintManusKey();
        if (key) source = "manus-mint";
      }
    } catch (_) {}
  }
  if (!key) {
    try {
      const s = typeof loadSettings === "function" ? loadSettings() : {};
      key = String((s && (s.manusKey || s.manus_api_key)) || "").trim();
      if (key) source = "settings";
    } catch (_) {}
  } else if (!source) {
    source = "storage";
  }

  // Local serve can mint a key; production uses cors.manus.space tRPC via mintManusKey
  let mintMeta = null;
  if (!key && origin) {
    try {
      const r = await fetch(origin + "/api/manus-key", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      });
      if (r.ok) {
        mintMeta = await r.json();
        if (mintMeta && mintMeta.key) {
          key = String(mintMeta.key).trim();
          source = mintMeta.source || "manus-key";
          try {
            if (typeof persistManusKey === "function") persistManusKey(key);
            else {
              localStorage.setItem("pyodide_security_manus_api_key", key);
              localStorage.setItem("goar_manus_key", key);
            }
          } catch (_) {}
        }
      } else {
        console.warn("[goar] /api/manus-key HTTP", r.status);
      }
    } catch (e) {
      console.warn("[goar] /api/manus-key", e);
    }
  }

  // Also try Python proxy.generate (same endpoint) if still no key
  if (!key && origin) {
    try {
      __pyodide.globals.set("_goar_origin", origin);
      const raw = await __pyodide.runPythonAsync(`
import json
from pyodide_security import proxy_tool
r = await proxy_tool.generate(origin=_goar_origin, auto_configure=False)
json.dumps(r)
`);
      const j = JSON.parse(raw);
      if (j && j.ok && j.key) {
        key = String(j.key).trim();
        source = "proxy.generate";
        mintMeta = j;
        try {
          if (typeof persistManusKey === "function") persistManusKey(key);
        } catch (_) {}
      }
    } catch (e) {
      console.warn("[goar] proxy.generate", e);
    }
  }

  // cors.manus.space is the proxy.
  let baseUrl = (typeof window !== "undefined" && window.GOAR_CORS_PROXY) || "https://cors.manus.space/api/proxy";
  if (!key) {
    console.warn("[goar] no Manus proxy key — live HTTP needs cors.manus.space");
    return { ok: false, error: "no proxy key" };
  }

  __pyodide.globals.set("_k", key);
  __pyodide.globals.set("_base", baseUrl);
  const probe = await __pyodide.runPythonAsync(`
from pyodide_security import proxy_tool
import json
st = proxy_tool.configure(api_key=_k, enabled=True, base_url=_base, auth_mode="both")
r = await proxy_tool.test(target="https://example.com/")
# If Manus key fails auth, leave configured state but report
json.dumps({"status": st, "test": r})
`);
  let result;
  try { result = JSON.parse(probe); } catch (_) { result = { raw: probe }; }

  const ok = !!(result && result.test && result.test.ok);
  window.__GOAR_PROXY = {
    ok,
    source,
    baseUrl: (result && result.status && result.status.base_url) || baseUrl,
    masked: result && result.status && result.status.api_key_masked,
    test: result && result.test,
  };
  if (ok) console.log("[goar] pysec CORS proxy ok via", source, window.__GOAR_PROXY.baseUrl);
  else console.warn("[goar] pysec CORS proxy NOT ready", window.__GOAR_PROXY);
  return window.__GOAR_PROXY;
}

async function ensurePysecWorker() {
  // name kept for slash/API compatibility — now embedded single-file Pyodide (no external assets)
  if (__pysecInitPromise) return __pysecInitPromise;
  __pysecInitPromise = (async () => {
    try { syncIndicators({ kit: "loading" }); } catch (_) {}
    await loadPysecCatalog();
    if (typeof pyBoot === "function") {
      __pyodide = await pyBoot();
    } else {
      const indexURL = new URL("./assets/pyodide/", document.baseURI || location.href).href;
      const mod = await import(indexURL + "pyodide.mjs");
      __pyodide = await mod.loadPyodide({ indexURL, packages: ["micropip"], fullStdLib: false, checkAPIVersion: false });
    }
    try { window.__pyodide = __pyodide; } catch (_) {}

    if (!window.__GOAR_PYSEC_PACKED) {
      const files = await inflatePysecPackage();
      const root = "/home/pyodide";
      await Promise.resolve(__pyodide.FS.mkdirTree(root));
      for (const [path, data] of Object.entries(files)) {
        const full = root + "/" + path;
        const dir = full.slice(0, full.lastIndexOf("/"));
        await Promise.resolve(__pyodide.FS.mkdirTree(dir));
        await Promise.resolve(__pyodide.FS.writeFile(full, data));
      }
    }
    await __pyodide.runPythonAsync(`
import sys
sys.path.insert(0, "/home/pyodide")
import pyodide_security as ps
try:
    from pyodide_security import _KW_ALIASES
    _KW_ALIASES.setdefault("text", ("data", "text", "content"))
    _KW_ALIASES.setdefault("data", ("data", "text"))
    _KW_ALIASES.setdefault("policy", ("csp", "policy"))
    _KW_ALIASES.setdefault("csp", ("csp", "policy"))
    _KW_ALIASES.setdefault("encoding", ("format", "encoding"))
    _KW_ALIASES.setdefault("format", ("format", "encoding"))
    _KW_ALIASES.setdefault("algo", ("algorithm", "algo"))
    _KW_ALIASES.setdefault("algorithm", ("algorithm", "algo"))
except Exception:
    pass
try:
    from pyodide_security import policy
    policy.configure(max_requests=400, allow_active_scanning=True, reset_budget=True)
except Exception:
    pass
print("pysec", getattr(ps, "VERSION", "?"), "tools", len(ps.list_tools()))
`);
    __pysecReady = true;
    try { window.__pysecReady = true; } catch (_) {}
    try { syncIndicators({ kit: "ready" }); } catch (_) {}
    try { await wirePysecThroughFabric(); } catch (e) { console.warn("[goar] pysec fabric", e); }
    try { await hardenLivePysecTools(); } catch (e) { console.warn("[goar] pysec harden", e); }
    try { await ensurePysecNetwork(); } catch (e) { console.warn("[goar] pysec net", e); }
    try { await installGoarPythonNet(); } catch (e) { console.warn("[goar] python net", e); }
    console.log("[goar] pysec ready");
    return true;
  })();
  return __pysecInitPromise;
}

async function hardenLivePysecTools() {
  if (!__pyodide) return { ok: false };
  await __pyodide.runPythonAsync(`
import asyncio, inspect
from pyodide_security import _BY_ID
try:
    from pyodide_security import _KW_ALIASES
    _KW_ALIASES.setdefault("text", ("data", "text", "content"))
    _KW_ALIASES.setdefault("data", ("data", "text"))
    _KW_ALIASES.setdefault("policy", ("csp", "policy"))
    _KW_ALIASES.setdefault("csp", ("csp", "policy"))
    _KW_ALIASES.setdefault("encoding", ("format", "encoding"))
    _KW_ALIASES.setdefault("format", ("format", "encoding"))
    _KW_ALIASES.setdefault("algo", ("algorithm", "algo"))
    _KW_ALIASES.setdefault("algorithm", ("algorithm", "algo"))
except Exception:
    pass

def _wrap_timeout(tid, seconds, port_cap=None):
    meta = _BY_ID.get(tid) or {}
    fn = meta.get("fn")
    if fn is None or getattr(fn, "_goar_capped", False):
        return
    async def _capped(*a, **kw):
        if port_cap:
            raw = kw.get("ports")
            if raw:
                parts = [p.strip() for p in str(raw).split(",") if p.strip()]
                kw["ports"] = ",".join(parts[:port_cap])
            else:
                kw["ports"] = "80,443"
            if "top" in kw:
                try:
                    kw["top"] = min(int(kw["top"] or 0), port_cap)
                except Exception:
                    kw["top"] = 0
        if inspect.iscoroutinefunction(fn):
            return await asyncio.wait_for(fn(*a, **kw), timeout=seconds)
        return fn(*a, **kw)
    _capped._goar_capped = True
    meta["fn"] = _capped
    _BY_ID[tid] = meta

_wrap_timeout("nmap.http_probe", 14, port_cap=3)
_wrap_timeout("nmap.nse_http", 16, port_cap=None)

# katana.crawl: coerce depth/max_urls so string kwargs cannot crash the compare
_meta = _BY_ID.get("katana.crawl") or {}
_fn = _meta.get("fn")
if _fn is not None and not getattr(_fn, "_goar_intfix", False):
    async def _katana_crawl(*a, **kw):
        for k in ("depth", "max_urls", "max_pages"):
            if k in kw:
                try:
                    kw[k] = int(kw[k])
                except Exception:
                    kw.pop(k, None)
        if "max_pages" in kw and "max_urls" not in kw:
            kw["max_urls"] = kw.pop("max_pages")
        return await _fn(*a, **kw) if inspect.iscoroutinefunction(_fn) else _fn(*a, **kw)
    _katana_crawl._goar_intfix = True
    _meta["fn"] = _katana_crawl
    _BY_ID["katana.crawl"] = _meta

`);
  return { ok: true };
}
async function toolPysec(args) {
  let toolId = String((args && (args.tool_id || args.toolId || args.id || args.tool)) || "").trim();
  if (toolId === "list_tools" || toolId === "list" || toolId === "catalog") {
    try {
      await ensurePysecWorker();
      const out = await __pyodide.runPythonAsync(`
import json
from pyodide_security import _BY_ID
ids = sorted(_BY_ID.keys())
json.dumps({"ok": True, "count": len(ids), "tools": ids[:200]})
`);
      return typeof out === "string" ? out : JSON.stringify(out);
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e.message || e) });
    }
  }
  if (!toolId) return "error: tool_id required";
  let kwargs = args.kwargs != null ? args.kwargs : args.arguments;
  if (typeof kwargs === "string") {
    try { kwargs = JSON.parse(kwargs); } catch (_) { kwargs = {}; }
  }
  if (!kwargs || typeof kwargs !== "object" || Array.isArray(kwargs)) {
    kwargs = Object.assign({}, args || {});
    delete kwargs.tool_id; delete kwargs.toolId; delete kwargs.id; delete kwargs.tool;
    delete kwargs.kwargs; delete kwargs.arguments;
  }
  try {
    if (typeof resolvePysecToolId === "function") {
      const resolved = resolvePysecToolId(toolId, kwargs);
      if (resolved && resolved.id) {
        toolId = resolved.id;
        kwargs = resolved.kwargs || kwargs;
      }
    }
  } catch (_) {}
  try {
    await ensurePysecWorker();
    const payload = JSON.stringify({ tool_id: toolId, kwargs: kwargs || {} });
    __pyodide.globals.set("_goar_payload", payload);
    const out = await __pyodide.runPythonAsync(`
import json, inspect
from pyodide_security import run_tool, run_tool_async, _BY_ID
req = json.loads(_goar_payload)
tid = req["tool_id"]
kw = dict(req.get("kwargs") or {})
_ALIASES = {"hash.hash": "hash.digest", "hash": "hash.digest", "sha256": "hash.digest", "md5": "hash.digest"}
tid = _ALIASES.get(str(tid), tid)
if tid == "hash.digest" and not kw.get("algorithm"):
    kw["algorithm"] = "sha256"
meta = _BY_ID.get(tid) or {}
fn = meta.get("fn")
for _k, _v in list(kw.items()):
    if isinstance(_v, str) and _v.strip().lstrip("-+").isdigit():
        try:
            kw[_k] = int(_v)
        except Exception:
            pass
    elif isinstance(_v, float) and _k in ("depth", "max_urls", "max_pages", "timeout_ms", "retries", "limit", "max_probes", "max_checks", "max_requests"):
        kw[_k] = int(_v)
_res = None
if fn is None:
    _res = {"ok": False, "error": "unknown tool: " + tid, "tool_id": tid}
else:
    try:
        sig = inspect.signature(fn)
        if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            pass
        else:
            allowed = set(sig.parameters.keys())
            kw = {k: v for k, v in kw.items() if k in allowed}
    except Exception:
        pass
    if meta.get("async") or inspect.iscoroutinefunction(fn):
        _res = await run_tool_async(tid, **kw)
    else:
        _res = run_tool(tid, **kw)
json.dumps(_res, default=str)
`);
    const raw = typeof out === "string" ? out : JSON.stringify(out);
    try {
      const j = JSON.parse(raw);
      return JSON.stringify({
        agent_toolkit: "pysec",
        tool_id: toolId,
        ok: j.ok !== false && !j.error,
        result: j.result !== undefined ? j.result : j,
        error: j.error || null,
        ms: j.ms,
      }, null, 2);
    } catch (_) {
      return raw;
    }
  } catch (e) {
    return JSON.stringify({
      agent_toolkit: "pysec",
      tool_id: toolId,
      ok: false,
      error: String(e && e.message ? e.message : e),
    });
  }
}

async function toolAudit(args) {
  args = args && typeof args === "object" ? args : {};
  let target = String(args.url || args.target || args.host || args.domain || "").trim();
  if (!target) return JSON.stringify({ ok: false, error: "url required" });
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = "https://" + target.replace(/^\/\//, "");
  let host = target;
  try { host = new URL(target).hostname; } catch (_) {}
  try {
    if (typeof geckoLoad === "function") geckoLoad(target).catch(function () {});
  } catch (_) {}
  await ensurePysecWorker();
  const steps = [
    { id: "fetch.analyze", kwargs: { url: target, method: "GET" } },
    { id: "tech.fingerprint", kwargs: { url: target } },
    { id: "dns.resolve", kwargs: { name: host } },
    { id: "httpx.probe", kwargs: { url: target } },
    { id: "cors.scan", kwargs: { url: target } },
    { id: "url.analyze", kwargs: { url: target } },
  ];
  if (/[?]/.test(target)) {
    steps.push({ id: "sqlmap.scan", kwargs: { url: target, level: 1, risk: 1, max_tests: 12, dry_run: false } });
  }
  steps.push({ id: "nuclei.scan", kwargs: { url: target } });
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    try {
      const raw = await toolPysec({ tool_id: s.id, kwargs: s.kwargs });
      let j = null;
      try { j = JSON.parse(raw); } catch (_) { j = { ok: false, result: raw }; }
      out.push({
        tool: s.id,
        ok: !!(j && j.ok !== false && !j.error),
        error: j && j.error ? String(j.error).slice(0, 240) : null,
        result: j && j.result !== undefined ? j.result : j,
      });
    } catch (e) {
      out.push({ tool: s.id, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  const failed = out.filter(function (x) { return !x.ok; }).map(function (x) { return x.tool; });
  return JSON.stringify({
    ok: true,
    target: target,
    host: host,
    steps: out.length,
    failed: failed,
    findings: out,
  }, null, 2);
}

async function toolGuestHttp(args) {
  if (typeof envReady !== "undefined" && !envReady && !window.__GOAR_UNIX) return "error: environment not ready";
  const url = String((args && args.url) || "").trim();
  if (!url) return "error: url required";
  const method = String((args && args.method) || "GET").toUpperCase();
  const maxB = Math.min(Number(args && args.max_bytes) || 8000, 50000);
  const body = (args && args.body) || "";
  const hdrLines = String((args && args.headers) || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const hdrFlags = hdrLines.map((h) => "-H '" + h.replace(/'/g, "'\\''") + "'").join(" ");
  const uq = url.replace(/'/g, "'\\''");
  let cmd;
  if (method === "GET" || method === "HEAD") {
    cmd = "curl -sS -L -m 25 -X " + method + " " + hdrFlags +
      " -D /tmp/.gh_hdr -o /tmp/.gh_body --max-filesize " + maxB + " '" + uq +
      "'; echo EXIT:$?; echo '---HEADERS---'; head -c 2000 /tmp/.gh_hdr; echo; echo '---BODY---'; head -c " + maxB + " /tmp/.gh_body";
  } else {
    const b64 = btoa(unescape(encodeURIComponent(body)));
    await guestExec("echo '" + b64 + "' | base64 -d > /tmp/.gh_post", 15000);
    cmd = "curl -sS -L -m 25 -X " + method + " " + hdrFlags +
      " -D /tmp/.gh_hdr -o /tmp/.gh_body --max-filesize " + maxB +
      " --data-binary @/tmp/.gh_post '" + uq +
      "'; echo EXIT:$?; echo '---HEADERS---'; head -c 2000 /tmp/.gh_hdr; echo; echo '---BODY---'; head -c " + maxB + " /tmp/.gh_body";
  }
  const r = await guestExec(cmd, 60000);
  return "exit " + r.code + "\n" + String(r.output || "").slice(0, 12000);
}

try {
  try {
    Object.defineProperty(window, "__pysecReady", {
      get() { return !!__pysecReady; },
      set(v) { __pysecReady = !!v; },
      configurable: true,
    });
  } catch (_) {
    window.__pysecReady = false;
  }
  window.ensurePysecWorker = ensurePysecWorker;
  window.wirePysecThroughFabric = wirePysecThroughFabric;
  window.hardenLivePysecTools = hardenLivePysecTools;
  window.toolPysec = toolPysec;
  window.toolAudit = toolAudit;
  window.loadPysecCatalog = loadPysecCatalog;
  window.pysecCatalogBlurb = pysecCatalogBlurb;
  window.pysecCatalogTools = pysecCatalogTools;
  window.pysecCatalogBody = pysecCatalogBody;
  try { pysecCatalogBody(); } catch (_) {}
  window.inflatePysecPackage = inflatePysecPackage;
  window.PYSEC_TOOL_COUNT = typeof PYSEC_TOOL_COUNT !== "undefined" ? PYSEC_TOOL_COUNT : 196;
} catch (_) {}



