/**
 * Agent WASM loader + host capability probe.
 *
 * Wasm GC (part of Wasm 3.0, 2025) adds host-managed struct/array heap
 * types so Kotlin/Dart/Java can drop their own collectors. CPython /
 * Emscripten / WASI BusyBox / our JIT still use linear memory. You cannot
 * retrofit GC onto those binaries — they own pymalloc / dlmalloc.
 * This file only detects the feature and loads linear-memory modules.
 */
const WASM_MODS = Object.create(null);

const WASM_FEATURE_BINS = {
  mvp: [0, 97, 115, 109, 1, 0, 0, 0],
  simd: [
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1,
    20, 0, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11,
  ],
  // Wasm 3.0 rec-group struct (final GC encoding)
  gc: [0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 78, 1, 95, 0],
  // older / alternate: subtype-final + struct
  gcSub: [0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 80, 0, 95, 0],
  // bare struct comptype
  gcBare: [0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 95, 0],
  refTypes: [
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 1, 111, 0, 3, 2, 1, 0, 10, 4, 1, 2,
    0, 11,
  ],
  sharedMem: [0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 3, 1, 1],
  memory64: [0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1],
  tailCall: [
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 6, 1, 4, 0,
    18, 0, 11,
  ],
};

function wasmValidateBytes(arr) {
  try {
    return WebAssembly.validate(Uint8Array.from(arr));
  } catch (_) {
    return false;
  }
}

function goarWasmCaps() {
  const gc =
    wasmValidateBytes(WASM_FEATURE_BINS.gc) ||
    wasmValidateBytes(WASM_FEATURE_BINS.gcSub) ||
    wasmValidateBytes(WASM_FEATURE_BINS.gcBare);
  const caps = {
    webassembly: typeof WebAssembly !== "undefined",
    streaming: typeof WebAssembly.instantiateStreaming === "function",
    compileStreaming: typeof WebAssembly.compileStreaming === "function",
    simd: wasmValidateBytes(WASM_FEATURE_BINS.simd),
    gc,
    gcEncoding: wasmValidateBytes(WASM_FEATURE_BINS.gc)
      ? "rec-struct"
      : wasmValidateBytes(WASM_FEATURE_BINS.gcSub)
        ? "sub-struct"
        : wasmValidateBytes(WASM_FEATURE_BINS.gcBare)
          ? "bare-struct"
          : "none",
    refTypes: wasmValidateBytes(WASM_FEATURE_BINS.refTypes),
    threads: wasmValidateBytes(WASM_FEATURE_BINS.sharedMem),
    memory64: wasmValidateBytes(WASM_FEATURE_BINS.memory64),
    tailCall: wasmValidateBytes(WASM_FEATURE_BINS.tailCall),
    isolated: typeof crossOriginIsolated !== "undefined" && !!crossOriginIsolated,
    sab: typeof SharedArrayBuffer !== "undefined",
    // Our planes: linear memory only. GC cannot collect CPython/WASI heaps.
    planes: {
      pyodide: "linear+emscripten",
      busybox: "linear+wasi",
      jit: "linear+simd",
      gecko: "linear",
    },
  };
  try {
    if (typeof goarWasmMemory === "function") caps.memory = goarWasmMemory();
  } catch (_) {}
  try {
    window.__GOAR_WASM_CAPS = caps;
  } catch (_) {}
  return caps;
}

async function wasmBytes(src) {
  if (src instanceof ArrayBuffer) return src;
  if (src instanceof Uint8Array) return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
  const s = String(src || "");
  if (/^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("./")) {
    const r = await fetch(s);
    if (!r.ok) throw new Error("wasm fetch " + r.status);
    return r.arrayBuffer();
  }
  if (/^[A-Za-z0-9+/=]+$/.test(s.replace(/\s/g, "")) && s.length > 24) {
    const bin = atob(s.replace(/\s/g, ""));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  throw new Error("wasm src must be url or base64");
}

async function runHostWasm(args) {
  args = args || {};
  const action = String(args.action || args.op || "status").toLowerCase();
  const id = String(args.id || args.name || "mod");

  if (action === "caps" || action === "features") {
    return { ok: true, caps: goarWasmCaps() };
  }

  if (action === "validate") {
    const buf = await wasmBytes(args.url || args.src || args.bytes);
    return { ok: WebAssembly.validate(buf), bytes: buf.byteLength };
  }

  if (action === "load" || action === "instantiate") {
    const src = args.url || args.src || args.bytes;
    const buf = await wasmBytes(src);
    if (!WebAssembly.validate(buf)) return { ok: false, error: "invalid wasm" };
    let inst;
    try {
      if (args.url && typeof WebAssembly.instantiateStreaming === "function" && /^https?:/i.test(String(args.url))) {
        const obj = await WebAssembly.instantiateStreaming(fetch(args.url), args.imports || {});
        inst = obj.instance;
      } else {
        const obj = await WebAssembly.instantiate(buf, args.imports || {});
        inst = obj.instance;
      }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
    WASM_MODS[id] = inst;
    return { ok: true, id, exports: Object.keys(inst.exports || {}) };
  }

  if (action === "call") {
    const inst = WASM_MODS[id];
    if (!inst) return { ok: false, error: "load first (id=" + id + ")" };
    const fn = inst.exports[args.fn || args.export || args.func];
    if (typeof fn !== "function") {
      return { ok: false, error: "no export", exports: Object.keys(inst.exports || {}) };
    }
    const params = Array.isArray(args.args) ? args.args : args.params != null ? [].concat(args.params) : [];
    const out = fn.apply(null, params);
    return { ok: true, result: out };
  }

  if (action === "list" || action === "status") {
    const ids = Object.keys(WASM_MODS);
    const map = {};
    for (const k of ids) map[k] = Object.keys(WASM_MODS[k].exports || {});
    return { ok: true, modules: map, webassembly: typeof WebAssembly !== "undefined", caps: goarWasmCaps() };
  }

  return { ok: false, error: "wasm action load|call|validate|list|caps" };
}

try {
  window.runHostWasm = runHostWasm;
  window.goarWasmCaps = goarWasmCaps;
} catch (_) {}
