/**
 * WASI BusyBox — goar-box.wasm via browser_wasi_shim.
 * Same /workspace as Pyodide: import tree, run, write back.
 */
(function (global) {
  "use strict";

  const BOX_APPLETS = {
    echo: 1, printf: 1, cat: 1, ls: 1, pwd: 1, mkdir: 1, rm: 1, rmdir: 1,
    cp: 1, mv: 1, touch: 1, head: 1, tail: 1, wc: 1, grep: 1, sed: 1,
    sort: 1, uniq: 1, cut: 1, tr: 1, find: 1, basename: 1, dirname: 1,
    env: 1, date: 1, uname: 1, whoami: 1, seq: 1, true: 1, false: 1,
    test: 1, tee: 1, cksum: 1, sha256sum: 1, sleep: 1, help: 1, busybox: 1,
  };

  let shim = null;
  let wasmMod = null;
  let ready = null;

  function boxUrl() {
    if (typeof goarAssetUrl === "function") return goarAssetUrl("assets/unix/goar-box.wasm");
    return "./assets/unix/goar-box.wasm";
  }
  function shimUrl() {
    if (typeof goarAssetUrl === "function") return goarAssetUrl("assets/unix/wasi/index.js");
    return "./assets/unix/wasi/index.js";
  }

  async function ensureBox() {
    if (wasmMod && shim) return true;
    if (ready) return ready;
    ready = (async () => {
      shim = await import(/* webpackIgnore: true */ shimUrl());
      const res = await fetch(boxUrl());
      if (!res.ok) throw new Error("box wasm " + res.status);
      try {
        wasmMod = await WebAssembly.compileStreaming(res.clone());
      } catch (_) {
        wasmMod = await WebAssembly.compile(await res.arrayBuffer());
      }
      global.__GOAR_WASI_BOX = true;
      return true;
    })().catch((e) => {
      ready = null;
      console.warn("[goar] WASI box", e);
      return false;
    });
    return ready;
  }

  function jsfsFiles() {
    const files = [];
    try {
      if (typeof Unix !== "undefined" && Unix.jsfs) {
        Unix.jsfs.forEach((rec, path) => {
          if (!rec || rec.type === "dir") return;
          files.push([path, rec.data instanceof Uint8Array ? rec.data : new Uint8Array(0)]);
        });
      }
    } catch (_) {}
    return files;
  }

  async function pyFiles() {
    const files = [];
    if (typeof pyRpc !== "function") return files;
    for (const root of ["/workspace", "/tmp", "/root", "/opt/goar"]) {
      try {
        const r = await pyRpc("walk", { path: root });
        const list = (r && r.files) || [];
        for (const f of list) {
          if (!f || !f.path) continue;
          const bin = atob(String(f.b64 || ""));
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          files.push([f.path, u8]);
        }
      } catch (_) {}
    }
    return files;
  }

  function mergeFiles(a, b) {
    const map = new Map();
    for (const [p, d] of a) map.set(p, d);
    for (const [p, d] of b) map.set(p, d);
    return [...map.entries()];
  }

  function nestPreopen(files) {
    const tree = {};
    for (const [path, data] of files) {
      const parts = String(path).replace(/^\//, "").split("/").filter(Boolean);
      if (!parts.length) continue;
      let cur = tree;
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        if (i === parts.length - 1) cur[name] = data;
        else {
          if (!cur[name] || cur[name] instanceof Uint8Array) cur[name] = {};
          cur = cur[name];
        }
      }
    }
    function convert(obj) {
      const pairs = [];
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v instanceof Uint8Array) pairs.push([k, new shim.File(v)]);
        else pairs.push([k, new shim.Directory(convert(v))]);
      }
      return pairs;
    }
    return new shim.PreopenDirectory("/", convert(tree));
  }

  function harvest(node, prefix, out) {
    if (!node) return;
    const contents = node.contents || (node.dir && node.dir.contents);
    if (node.data instanceof Uint8Array) {
      out.push([prefix || "/", node.data]);
      return;
    }
    if (!contents || typeof contents.entries !== "function") return;
    for (const [name, child] of contents.entries()) {
      const p = (prefix === "/" ? "" : prefix) + "/" + name;
      harvest(child, p, out);
    }
  }

  function writeBack(files) {
    for (const [path, data] of files) {
      try {
        if (typeof unixWrite === "function") unixWrite(path, data);
        else if (typeof unixJsWrite === "function") unixJsWrite(path, data);
      } catch (_) {}
    }
    try {
      if (typeof unixSyncJsIntoPy === "function") unixSyncJsIntoPy();
    } catch (_) {}
    try {
      if (typeof jliteSchedulePersist === "function") jliteSchedulePersist();
    } catch (_) {}
  }

  async function wasiBusybox(argv, stdin, cwd) {
    const ok = await ensureBox();
    if (!ok) return null;
    const args = Array.isArray(argv) && argv.length ? argv.map(String) : ["busybox"];
    const enc = new TextEncoder();
    const stdinU8 = enc.encode(stdin == null ? "" : String(stdin));
    let stdout = "";
    let stderr = "";
    const files = jsfsFiles();
    const root = nestPreopen(files);
    const fds = [
      new shim.OpenFile(new shim.File(stdinU8)),
      shim.ConsoleStdout.lineBuffered((m) => { stdout += m + "\n"; }),
      shim.ConsoleStdout.lineBuffered((m) => { stderr += m + "\n"; }),
      root,
    ];
    const env = [
      "PWD=" + (cwd || "/workspace"),
      "HOME=/root",
      "PATH=/usr/bin:/bin",
      "USER=root",
    ];
    const wasi = new shim.WASI(args, env, fds);
    const inst = await WebAssembly.instantiate(wasmMod, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    let code = 0;
    try {
      const rc = wasi.start(inst);
      if (typeof rc === "number") code = rc;
    } catch (e) {
      if (e && e.name === "WASIProcExit") code = e.code | 0;
      else if (e && typeof e.status === "number") code = e.status;
      else stderr += String(e && e.message ? e.message : e) + "\n";
    }
    const outFiles = [];
    try { harvest(root.dir || root, "", outFiles); } catch (_) {}
    try { writeBack(outFiles); } catch (_) {}
    return { code: code | 0, stdout, stderr, via: "wasi-busybox" };
  }

  function boxCan(cmd) {
    return !!BOX_APPLETS[String(cmd || "").replace(/^\/(usr\/)?bin\//, "")];
  }

  global.ensureWasiBox = ensureBox;
  global.wasiBusybox = wasiBusybox;
  global.wasiBoxCan = boxCan;
  global.WASI_BOX_APPLETS = BOX_APPLETS;
})(typeof window !== "undefined" ? window : globalThis);
