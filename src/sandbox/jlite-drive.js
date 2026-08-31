/**
 * GOAR drive — JupyterLite BrowserStorageDrive methods, no Jupyter UI.
 * IndexedDB persistence for the shared Unix/Pyodide filesystem.
 * Paths under /workspace, /opt/goar, /root survive reload.
 */
const JLITE_DB = "goar-drive";
const JLITE_STORE = "files";
const JLITE_META = "meta";
const JLITE_KEEP = ["/workspace", "/opt/goar", "/root"];

function jliteKeep(path) {
  const p = String(path || "");
  return JLITE_KEEP.some((root) => p === root || p.startsWith(root + "/"));
}

function jliteOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(JLITE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(JLITE_STORE)) db.createObjectStore(JLITE_STORE);
      if (!db.objectStoreNames.contains(JLITE_META)) db.createObjectStore(JLITE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function jliteTx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function jliteReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function jliteEncode(u8) {
  let s = "";
  const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8 || []);
  for (let i = 0; i < b.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + 0x8000, b.length)));
  }
  return btoa(s);
}

function jliteDecode(b64) {
  const bin = atob(String(b64 || ""));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function jlitePut(path, rec) {
  const db = await jliteOpen();
  try {
    await jliteReq(jliteTx(db, JLITE_STORE, "readwrite").put(rec, path));
  } finally {
    db.close();
  }
}

async function jliteDel(path) {
  const db = await jliteOpen();
  try {
    await jliteReq(jliteTx(db, JLITE_STORE, "readwrite").delete(path));
  } finally {
    db.close();
  }
}

async function jliteAll() {
  const db = await jliteOpen();
  try {
    return (await jliteReq(jliteTx(db, JLITE_STORE, "readonly").getAllKeys())).map(String);
  } finally {
    db.close();
  }
}

async function jliteGet(path) {
  const db = await jliteOpen();
  try {
    return await jliteReq(jliteTx(db, JLITE_STORE, "readonly").get(path));
  } finally {
    db.close();
  }
}

let _jliteTimer = 0;
function jliteSchedulePersist() {
  if (_jliteTimer) clearTimeout(_jliteTimer);
  _jliteTimer = setTimeout(() => {
    _jliteTimer = 0;
    jlitePersistTree().catch((e) => console.warn("[goar] drive persist", e));
  }, 350);
}

function jliteCollectTree() {
  const out = [];
  const seen = new Set();
  const add = (path, dir, data, mode) => {
    if (!jliteKeep(path) || seen.has(path)) return;
    seen.add(path);
    out.push({
      path,
      type: dir ? "directory" : "file",
      mode: mode || (dir ? 0o755 : 0o644),
      mtime: Date.now(),
      b64: dir ? "" : jliteEncode(data || new Uint8Array(0)),
    });
  };
  if (typeof Unix !== "undefined" && Unix.jsfs) {
    for (const [path, node] of Unix.jsfs) {
      if (!jliteKeep(path)) continue;
      add(path, node.type === "dir", node.data, node.mode);
    }
  }
  const py = (typeof unixPy === "function" && unixPy()) || (typeof window !== "undefined" && window.__pyodide);
  if (py && py.FS) {
    const walk = (p) => {
      let st;
      try { st = py.FS.analyzePath(p); } catch (_) { return; }
      if (!st || !st.exists) return;
      const isDir = py.FS.isDir(st.object.mode);
      if (isDir) {
        add(p, true, null, st.object.mode);
        let names = [];
        try { names = py.FS.readdir(p); } catch (_) { return; }
        for (const n of names) {
          if (n === "." || n === "..") continue;
          walk((p === "/" ? "" : p) + "/" + n);
        }
      } else {
        try { add(p, false, py.FS.readFile(p), st.object.mode); } catch (_) {}
      }
    };
    for (const root of JLITE_KEEP) walk(root);
  }
  return out;
}

async function jlitePersistTree() {
  const rows = jliteCollectTree();
  const db = await jliteOpen();
  try {
    const keys = (await jliteReq(jliteTx(db, JLITE_STORE, "readonly").getAllKeys())).map(String);
    const keep = new Set(rows.map((r) => r.path));
    const w = db.transaction(JLITE_STORE, "readwrite");
    const store = w.objectStore(JLITE_STORE);
    for (const r of rows) store.put(r, r.path);
    for (const k of keys) if (!keep.has(k) && jliteKeep(k)) store.delete(k);
    await new Promise((res, rej) => { w.oncomplete = res; w.onerror = () => rej(w.error); });
    const m = db.transaction(JLITE_META, "readwrite");
    m.objectStore(JLITE_META).put({ ts: Date.now(), files: rows.length, source: "jupyterlite-drive" }, "head");
    await new Promise((res, rej) => { m.oncomplete = res; m.onerror = () => rej(m.error); });
  } finally {
    db.close();
  }
  return { ok: true, files: rows.length };
}

async function jliteRestoreTree() {
  const db = await jliteOpen();
  let recs = [];
  try {
    const keys = (await jliteReq(jliteTx(db, JLITE_STORE, "readonly").getAllKeys())).map(String);
    for (const k of keys) {
      const rec = await jliteReq(jliteTx(db, JLITE_STORE, "readonly").get(k));
      if (rec) recs.push(rec);
    }
  } finally {
    db.close();
  }
  recs.sort((a, b) => String(a.path).length - String(b.path).length);
  for (const rec of recs) {
    const p = rec.path;
    if (!p || !jliteKeep(p)) continue;
    if (rec.type === "directory") {
      if (typeof unixMkdirp === "function") unixMkdirp(p);
    } else {
      const u8 = rec.b64 ? jliteDecode(rec.b64) : new Uint8Array(0);
      if (typeof unixWrite === "function") unixWrite(p, u8);
    }
  }
  return { ok: true, files: recs.length };
}

async function jliteClear() {
  const db = await jliteOpen();
  try {
    await jliteReq(jliteTx(db, JLITE_STORE, "readwrite").clear());
    await jliteReq(jliteTx(db, JLITE_META, "readwrite").clear());
  } finally {
    db.close();
  }
}

try {
  window.jlitePersistTree = jlitePersistTree;
  window.jliteRestoreTree = jliteRestoreTree;
  window.jliteSchedulePersist = jliteSchedulePersist;
  window.jliteClear = jliteClear;
} catch (_) {}
