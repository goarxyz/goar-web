/**
 * GOAR Python runtime — one Pyodide in a Worker.
 * UI stays live. Main thread owns Unix JSFS + proxy; worker owns CPython.
 * Host fetch is RPC'd back so pysec keeps the Manus proxy.
 */
(function (global) {
  "use strict";

  const PY_WORKER_SRC = `
const pending = new Map();
let rid = 1;
let py = null;
let _pyOps = 0;

const origFetch = self.fetch.bind(self);
const EMBED = new Map();
function embedLookup(url) {
  const s = String(url || "").split("?")[0].split("#")[0];
  const tail = s.includes("/assets/") ? s.slice(s.indexOf("/assets/") + 1) : s.split("/").pop();
  return EMBED.get(tail) || EMBED.get(s.split("/").pop()) || null;
}
function embedMime(url) {
  const s = String(url || "");
  if (s.endsWith(".wasm")) return "application/wasm";
  if (s.endsWith(".mjs") || s.endsWith(".js")) return "text/javascript";
  if (s.endsWith(".json")) return "application/json";
  if (s.endsWith(".zip") || s.endsWith(".whl")) return "application/zip";
  if (s.endsWith(".zst")) return "application/octet-stream";
  return "application/octet-stream";
}
self.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  const buf = embedLookup(url);
  if (buf) return new Response(buf, { headers: { "content-type": embedMime(url) } });
  try {
    if (self.caches && /pyodide|pythonhosted|jsdelivr/i.test(url)) {
      const cache = await caches.open("goar-pyodide-v1");
      const hit = await cache.match(url);
      if (hit) {
        self.postMessage({ type: "progress", file: String(url).split("/").pop(), cached: true });
        return hit;
      }
      if (/\.(wasm|zip)$/i.test(url)) {
        self.postMessage({ type: "progress", file: String(url).split("/").pop(), cached: false });
      }
      const res = await origFetch(input, init);
      if (res && res.ok) {
        try { cache.put(url, res.clone()).catch(function () {}); } catch (_) {}
      }
      return res;
    }
  } catch (_) {}
  return origFetch(input, init);
};

function hostCall(op, data) {
  const id = ++rid;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    self.postMessage({ type: "host", id, op, data });
  });
}

self.goarHostFetchJson = function (url, method, headers, body) {
  return hostCall("fetchJson", { url, method, headers, body });
};

const GOAR_JIT_WASM_B64 = "AGFzbQEAAAABGwRgA39/fwF8YAJ/fwF8YAN/f3wAYAR/f398AAMFBAABAgMFAwEAEAcmBQZtZW1vcnkCAANkb3QAAANzdW0AAQVzY2FsZQACBXNheHB5AAMK6QMEjAEDAn8BfAF7/QwAAAAAAAAAAAAAAAAAAAAAIQYgAkF+cSEEA0AgAyAESQRAIAYgACADQQN0av0AAAAgASADQQN0av0AAAD98gH98AEhBiADQQJqIQMMAQsLIAb9IQAgBv0hAaAhBSAEIAJJBEAgBSAAIARBA3RqKwMAIAEgBEEDdGorAwCioCEFCyAFC3EDAn8BfAF7/QwAAAAAAAAAAAAAAAAAAAAAIQUgAUF+cSEDA0AgAiADSQRAIAUgACACQQN0av0AAAD98AEhBSACQQJqIQIMAQsLIAX9IQAgBf0hAaAhBCADIAFJBEAgBCAAIANBA3RqKwMAoCEECyAEC2UCAn8BeyAC/RQhBSABQX5xIQQDQCADIARJBEAgACADQQN0aiAAIANBA3Rq/QAAACAF/fIB/QsAACADQQJqIQMMAQsLIAQgAUkEQCAAIARBA3RqIAAgBEEDdGorAwAgAqI5AwALC4ABAgJ/AXsgA/0UIQYgAkF+cSEFA0AgBCAFSQRAIAAgBEEDdGogACAEQQN0av0AAAAgASAEQQN0av0AAAAgBv3yAf3wAf0LAAAgBEECaiEEDAELCyAFIAJJBEAgACAFQQN0aiAAIAVBA3RqKwMAIAEgBUEDdGorAwAgA6KgOQMACws=";
let __jitInst = null;
let __jitMem = null;
(function bootJit() {
  const bin = atob(GOAR_JIT_WASM_B64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  __jitInst = new WebAssembly.Instance(new WebAssembly.Module(u8), {});
  __jitMem = __jitInst.exports.memory;
})();
function __jitWrite(off, arr) {
  const v = new Float64Array(__jitMem.buffer);
  for (let i = 0; i < arr.length; i++) v[off + i] = +arr[i];
}
self.goarJit = function (op, payload) {
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch (_) { payload = {}; }
  }
  payload = payload || {};
  payload = payload || {};
  if (payload && typeof payload.toJs === "function") {
    try { payload = payload.toJs({ dict_converter: Object.fromEntries }); } catch (_) {}
  }
  if (payload && typeof payload.get === "function" && !Array.isArray(payload)) {
    const o = {};
    try {
      for (const k of ["a", "b", "y", "x", "k"]) {
        if (payload.has && payload.has(k)) o[k] = payload.get(k);
      }
      payload = Object.assign(o, payload);
    } catch (_) {}
  }
  function arr(x) {
    if (!x) return [];
    if (x && typeof x.toJs === "function") {
      try { x = x.toJs(); } catch (_) {}
    }
    if (Array.isArray(x)) return x.map(Number);
    if (typeof x.length === "number") return Array.from(x, Number);
    return [];
  }
  if (op === "status") return { ok: true, ready: true, compiled: true, simd: true, lanes: "f64x2", engine: "goar-jit.wasm", kernels: ["dot","sum","scale","saxpy"] };
  const a = arr(payload.a);
  const b = arr(payload.b);
  if (op === "dot") {
    const n = Math.min(a.length, b.length);
    __jitWrite(0, a); __jitWrite(n + 8, b);
    return { ok: true, value: __jitInst.exports.dot(0, (n + 8) * 8, n), n, via: "goar-jit.wasm" };
  }
  if (op === "sum") {
    __jitWrite(0, a);
    return { ok: true, value: __jitInst.exports.sum(0, a.length), n: a.length, via: "goar-jit.wasm" };
  }
  if (op === "scale") {
    __jitWrite(0, a);
    __jitInst.exports.scale(0, a.length, Number(payload.k));
    const v = new Float64Array(__jitMem.buffer);
    return { ok: true, value: Array.from(v.subarray(0, a.length)), n: a.length, via: "goar-jit.wasm" };
  }
  if (op === "saxpy") {
    const y = payload.y || [];
    const x = payload.x || [];
    const n = Math.min(y.length, x.length);
    __jitWrite(0, y); __jitWrite(n + 8, x);
    __jitInst.exports.saxpy(0, (n + 8) * 8, n, Number(payload.a));
    const v = new Float64Array(__jitMem.buffer);
    return { ok: true, value: Array.from(v.subarray(0, n)), n, via: "goar-jit.wasm" };
  }
  return { ok: false, error: "unknown kernel " + op };
};

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "hostResult") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.value);
    return;
  }
  if (msg.type === "embed") {
    const files = msg.files || {};
    for (const k of Object.keys(files)) {
      let buf = files[k];
      if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
      EMBED.set(k, buf);
      const base = String(k).split("/").pop();
      if (base) EMBED.set(base, buf);
    }
    return;
  }
  if (msg.type !== "rpc") return;
  const { id, op, data } = msg;
  try {
    const value = await handle(op, data || {});
    let safe = value;
    try {
      if (safe && typeof safe.toJs === "function") safe = safe.toJs({ dict_converter: Object.fromEntries });
      if (safe && typeof safe === "object" && !(safe instanceof ArrayBuffer) && !(safe instanceof Uint8Array)) {
        safe = JSON.parse(JSON.stringify(safe));
      }
    } catch (_) {
      safe = String(safe);
    }
    self.postMessage({ type: "rpcResult", id, value: safe });
  } catch (err) {
    self.postMessage({ type: "rpcResult", id, error: String(err && err.message ? err.message : err) });
  }
};

async function handle(op, data) {
  if (op === "boot") {
    const indexURL = data.indexURL;
    let mjsUrl = indexURL + "pyodide.mjs";
    const mjsBuf = embedLookup("assets/pyodide/pyodide.mjs") || embedLookup("pyodide.mjs");
    if (mjsBuf) {
      mjsUrl = URL.createObjectURL(new Blob([mjsBuf], { type: "text/javascript" }));
    }
    const mod = await import(mjsUrl);
    py = await mod.loadPyodide({
      indexURL,
      lockFileURL: data.lockFileURL || (indexURL + "pyodide-lock.json"),
      stdLibURL: data.stdLibURL || (indexURL + "python_stdlib.zip"),
      packages: ["micropip"],
      fullStdLib: false,
      checkAPIVersion: false,
    });
    let packed = false;
    if (data.secPackURL) {
      try {
        const res = await origFetch(data.secPackURL);
        if (res && res.ok) {
          py.unpackArchive(await res.arrayBuffer(), "zip", { extractDir: "/home/pyodide" });
          await py.runPythonAsync("import sys; sys.path.insert(0,'/home/pyodide'); import pyodide_security");
          packed = true;
        }
      } catch (e) {
        console.warn("[goar] sec pack", e);
      }
    }
    await py.runPythonAsync(\`
import hashlib, hmac
if not hasattr(hashlib, "pbkdf2_hmac"):
    def _pbkdf2_hmac(hash_name, password, salt, iterations, dklen=None):
        hn = str(hash_name).lower().replace("sha-", "sha")
        def prf(p, m):
            return hmac.new(p, m, hn).digest()
        hlen = len(prf(password, salt))
        if dklen is None: dklen = hlen
        out = bytearray(); block = 1
        while len(out) < dklen:
            u = prf(password, salt + block.to_bytes(4, "big"))
            f = bytearray(u)
            for _ in range(1, int(iterations)):
                u = prf(password, u)
                for i in range(len(f)): f[i] ^= u[i]
            out.extend(f); block += 1
        return bytes(out[:dklen])
    hashlib.pbkdf2_hmac = _pbkdf2_hmac
\`);
    return { ok: true, version: String(py.version || "pyodide"), packed: packed };
  }
  if (op === "unpackZip") {
    const res = await origFetch(data.url);
    if (!res.ok) throw new Error("unpack " + res.status);
    py.unpackArchive(await res.arrayBuffer(), data.fmt || "zip", { extractDir: data.dest || "/home/pyodide" });
    return { ok: true };
  }
  if (!py) throw new Error("python worker not booted");
  if (op === "mkdir") { py.FS.mkdirTree(data.path); return { ok: true }; }
  if (op === "write") {
    const bin = atob(String(data.b64 || ""));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    py.FS.mkdirTree(data.path.slice(0, Math.max(1, data.path.lastIndexOf("/"))));
    py.FS.writeFile(data.path, u8);
    return { ok: true, n: u8.length };
  }
  if (op === "read") {
    const u8 = py.FS.readFile(data.path);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(s) };
  }
  if (op === "unlink") {
    try { py.FS.unlink(data.path); } catch (_) { try { py.FS.rmdir(data.path); } catch (e) { throw e; } }
    return { ok: true };
  }
  if (op === "readdir") {
    return { names: py.FS.readdir(data.path) };
  }
  if (op === "walk") {
    const out = [];
    const root = String(data.path || "/workspace");
    function walk(dir) {
      let names;
      try { names = py.FS.readdir(dir); } catch (_) { return; }
      for (const name of names) {
        if (name === "." || name === "..") continue;
        const p = (dir === "/" ? "" : dir) + "/" + name;
        try {
          const info = py.FS.analyzePath(p);
          if (info && info.exists && py.FS.isDir(info.object.mode)) walk(p);
          else {
            const u8 = py.FS.readFile(p);
            let s = "";
            for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            out.push({ path: p, b64: btoa(s) });
          }
        } catch (_) {}
      }
    }
    walk(root);
    return { files: out };
  }
  if (op === "stat") {
    try {
      const info = py.FS.analyzePath(data.path);
      return { exists: !!(info && info.exists), dir: !!(info && info.exists && py.FS.isDir(info.object.mode)) };
    } catch (_) {
      return { exists: false, dir: false };
    }
  }
  if (op === "set") {
    py.globals.set(data.name, data.value);
    return { ok: true };
  }
  if (op === "loadPackage") {
    await py.loadPackage(data.names);
    return { ok: true };
  }
  if (op === "py") {
    const result = await py.runPythonAsync(String(data.src || ""));
    _pyOps++;
    if (_pyOps % 8 === 0) {
      try { py.runPython("import gc; gc.collect()"); } catch (_) {}
    }
    if (result && typeof result.toJs === "function") {
      try {
        const js = result.toJs();
        try { result.destroy(); } catch (_) {}
        if (js && typeof js.get === "function") {
          const tuple = [js.get(0), String(js.get(1) || ""), String(js.get(2) || "")];
          try { js.destroy(); } catch (_) {}
          return { tuple };
        }
        if (Array.isArray(js)) return { tuple: js };
        return { value: js };
      } catch (_) {
        return { value: String(result) };
      }
    }
    return { value: result };
  }
  throw new Error("unknown op " + op);
}
`;

  let worker = null;
  let ready = null;
  let seq = 1;
  const waits = new Map();

  function b64enc(u8) {
    const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8 || []);
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64dec(b64) {
    const bin = atob(String(b64 || ""));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function rpc(op, data) {
    if (!worker) return Promise.reject(new Error("python worker missing"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waits.set(id, { resolve, reject });
      worker.postMessage({ type: "rpc", id, op, data: data || {} });
    });
  }

  async function onWorkerMsg(e) {
    const msg = e.data || {};
    if (msg.type === "progress") {
      try {
        const f = String(msg.file || "python");
        if (typeof setProgress === "function") {
          setProgress(msg.cached ? 42 : 28, "Python", (msg.cached ? "cache · " : "") + f);
        }
      } catch (_) {}
      return;
    }
    if (msg.type === "rpcResult") {
      const w = waits.get(msg.id);
      if (!w) return;
      waits.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error));
      else w.resolve(msg.value);
      return;
    }
    if (msg.type === "host") {
      try {
        let value = null;
        if (msg.op === "fetchJson") {
          const d = msg.data || {};
          if (typeof goarHostFetchJson === "function") {
            value = await goarHostFetchJson(d.url, d.method, d.headers, d.body);
          } else {
            throw new Error("goarHostFetchJson missing");
          }
        }
        worker.postMessage({ type: "hostResult", id: msg.id, value });
      } catch (err) {
        worker.postMessage({ type: "hostResult", id: msg.id, error: String(err && err.message ? err.message : err) });
      }
    }
  }

  async function freezePyodide(indexURL) {
    if (!global.caches) return { ok: false };
    const cache = await caches.open("goar-pyodide-v1");
    const names = [
      "pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm",
      "python_stdlib.zip", "pyodide-lock.json",
      "micropip-0.8.0-py3-none-any.whl",
      "packaging-24.2-py3-none-any.whl",
      "six-1.16.0-py2.py3-none-any.whl",
    ];
    let n = 0;
    await Promise.all(names.map(async (name) => {
      const url = indexURL + name;
      try {
        if (await cache.match(url)) { n++; return; }
        const res = await fetch(url);
        if (res && res.ok) { await cache.put(url, res); n++; }
      } catch (_) {}
    }));
    return { ok: true, files: n };
  }

  function makeProxy() {
    const FS = {
      mkdirTree: (p) => rpc("mkdir", { path: p }),
      writeFile: (p, data) => rpc("write", { path: p, b64: typeof data === "string" ? b64enc(new TextEncoder().encode(data)) : b64enc(data) }),
      readFile: async (p) => b64dec((await rpc("read", { path: p })).b64),
      unlink: (p) => rpc("unlink", { path: p }),
      rmdir: (p) => rpc("unlink", { path: p }),
      readdir: async (p) => (await rpc("readdir", { path: p })).names,
      analyzePath: async () => ({ exists: true }),
      isDir: () => false,
    };
    return {
      worker: true,
      version: "pyodide-worker",
      FS,
      globals: {
        set: (name, value) => rpc("set", { name, value: value == null ? "" : (typeof value === "string" ? value : JSON.stringify(value)) }),
      },
      loadPackage: (names) => rpc("loadPackage", { names: Array.isArray(names) ? names : [names] }),
      runPythonAsync: async (src) => {
        const r = await rpc("py", { src });
        if (r && r.tuple) {
          return { get: (i) => r.tuple[i], destroy: function () {} };
        }
        return r ? r.value : null;
      },
    };
  }

  async function pyBoot() {
    if (ready) return ready;
    ready = (async () => {
      let indexURL = "./assets/pyodide/";
      try {
        if (typeof goarResolveIndex === "function") {
          indexURL = await goarResolveIndex("./assets/pyodide/", "assets/pyodide/");
        }
      } catch (_) {}
      const base = (typeof document !== "undefined" && document.baseURI) || location.href;
      indexURL = new URL(indexURL, base).href;
      if (!indexURL.endsWith("/")) indexURL += "/";
      try { if (typeof setProgress === "function") setProgress(18, "Python", "runtime"); } catch (_) {}
      const blob = new Blob([PY_WORKER_SRC], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url, { type: "module" });
      worker.onmessage = onWorkerMsg;
      worker.onerror = (e) => console.warn("[goar] python worker", e && e.message);
      try {
        const pack = global.__GOAR_EMBED_BUF;
        if (pack && typeof pack === "object") {
          const files = {};
          for (const k of Object.keys(pack)) {
            const u8 = pack[k];
            if (u8 && u8.buffer) files[k] = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
          }
          worker.postMessage({ type: "embed", files });
        }
      } catch (e) {
        console.warn("[goar] embed to worker", e);
      }
      const boot = await rpc("boot", {
        indexURL,
        lockFileURL: indexURL + "pyodide-lock.json",
        stdLibURL: indexURL + "python_stdlib.zip",
        secPackURL: indexURL + "pyodide-security.zip",
      });
      if (boot && boot.packed) {
        try { global.__GOAR_PYSEC_PACKED = true; } catch (_) {}
      }
      const proxy = makeProxy();
      try { global.__pyodide = proxy; } catch (_) {}
      try { global.__GOAR_PY_WORKER = true; } catch (_) {}
      return proxy;
    })();
    return ready;
  }

  global.pyBoot = pyBoot;
  global.pyRpc = rpc;
  global.freezePyodide = freezePyodide;
  global.__pyMakeProxy = makeProxy;
})(typeof window !== "undefined" ? window : globalThis);
