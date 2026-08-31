/**
 * GOAR G · KV plane (HeyPuter/kv.js)
 *
 * Redis-style in-memory cache (+ optional IndexedDB when dbName set).
 * Interconnects with mind memory, settings, gecko prefs, fabric meta.
 * Additive — does not replace guest FS or freeze OPFS.
 *
 * window:
 *   ensureGoarKv() → kvjs instance
 *   goarKvGet/Set/Del/Incr/Expire/Keys/Status
 *   GOAR_KV  — raw instance after ensure
 */
(function (global) {
  "use strict";

  const NS = {
    mem: "goar:mem:",
    mission: "goar:mission:",
    settings: "goar:settings:",
    gecko: "goar:gecko:",
    session: "goar:session:",
    tool: "goar:tool:",
    meta: "goar:meta:",
  };

  const STATE = {
    kv: null,
    ready: false,
    loading: null,
    lastError: "",
    dbName: "goar-kv",
  };

  function nsKey(namespace, key) {
    const prefix = NS[namespace] || (namespace ? String(namespace) + ":" : "");
    return prefix + String(key || "");
  }

  async function ensureGoarKv(opts) {
    opts = opts || {};
    if (STATE.ready && STATE.kv) return STATE.kv;
    if (STATE.loading) return STATE.loading;

    STATE.loading = (async () => {
      STATE.lastError = "";
      if (typeof global.kvjs !== "function") {
        throw new Error("kvjs not loaded — include vendor/kv.js/kv-browser.js before kv-plane");
      }
      const dbName = opts.dbName || global.GOAR_KV_DB || STATE.dbName;
      const kv = new global.kvjs({ dbName: dbName });
      // Wait for IndexedDB hydrate if present
      if (kv.initPromise) {
        try {
          await kv.initPromise;
        } catch (e) {
          console.warn("[goar] kv idb hydrate", e);
        }
      } else {
        // small yield for _initIndexedDB race
        await Promise.resolve();
        if (kv.initPromise) {
          try {
            await kv.initPromise;
          } catch (_) {}
        }
      }
      STATE.kv = kv;
      STATE.ready = true;
      STATE.dbName = dbName;
      global.GOAR_KV = kv;
      global.__GOAR_KV_READY = true;
      // meta boot stamp
      try {
        if (!kv.get(nsKey("meta", "created_at"))) {
          kv.set(nsKey("meta", "created_at"), Date.now());
        }
        kv.set(nsKey("meta", "last_boot"), Date.now());
      } catch (_) {}
      console.log("[goar] kv plane ready", { dbName, idb: !!kv.isIndexedDBAvailable });
      return kv;
    })()
      .catch((e) => {
        STATE.lastError = String(e && e.message ? e.message : e);
        STATE.ready = false;
        STATE.kv = null;
        console.error("[goar] kv plane failed", e);
        throw e;
      })
      .finally(() => {
        STATE.loading = null;
      });

    return STATE.loading;
  }

  function goarKvStatus() {
    const kv = STATE.kv;
    let keys = 0;
    try {
      if (kv && typeof kv.keys === "function") {
        const k = kv.keys("*");
        keys = Array.isArray(k) ? k.length : 0;
      } else if (kv && kv.store && typeof kv.store.size === "number") {
        keys = kv.store.size;
      }
    } catch (_) {}
    return {
      plane: "kv",
      ready: !!STATE.ready,
      dbName: STATE.dbName,
      idb: !!(kv && kv.isIndexedDBAvailable),
      keys,
      lastError: STATE.lastError || null,
      namespaces: Object.keys(NS),
      note: STATE.ready
        ? "HeyPuter kv.js live — agent cache / memory / prefs (not guest FS)"
        : "Call ensureGoarKv / kv_set to boot",
    };
  }

  async function goarKvSet(key, value, opts) {
    const kv = await ensureGoarKv();
    opts = opts || {};
    const k = opts.ns ? nsKey(opts.ns, key) : String(key);
    const setOpts = {};
    if (opts.ex != null) setOpts.EX = Number(opts.ex);
    if (opts.px != null) setOpts.PX = Number(opts.px);
    if (opts.nx) setOpts.NX = true;
    if (opts.xx) setOpts.XX = true;
    // stringify objects for safe idb
    let v = value;
    if (v !== null && typeof v === "object") {
      try {
        v = JSON.stringify(v);
      } catch (_) {}
    }
    const r = kv.set(k, v, setOpts);
    return { ok: r !== null && r !== false, key: k, result: r };
  }

  async function goarKvGet(key, opts) {
    const kv = await ensureGoarKv();
    opts = opts || {};
    const k = opts.ns ? nsKey(opts.ns, key) : String(key);
    let v = kv.get(k);
    if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
      try {
        v = JSON.parse(v);
      } catch (_) {}
    }
    return { ok: v != null, key: k, value: v };
  }

  async function goarKvDel(keys, opts) {
    const kv = await ensureGoarKv();
    opts = opts || {};
    const list = Array.isArray(keys) ? keys : [keys];
    const full = list.map((k) => (opts.ns ? nsKey(opts.ns, k) : String(k)));
    const n = kv.del.apply(kv, full);
    return { ok: true, deleted: n, keys: full };
  }

  async function goarKvIncr(key, by, opts) {
    const kv = await ensureGoarKv();
    opts = opts || {};
    const k = opts.ns ? nsKey(opts.ns, key) : String(key);
    const n = by != null && by !== 1 ? kv.incrby(k, Number(by)) : kv.incr(k);
    return { ok: true, key: k, value: n };
  }

  async function goarKvExpire(key, seconds, opts) {
    const kv = await ensureGoarKv();
    opts = opts || {};
    const k = opts.ns ? nsKey(opts.ns, key) : String(key);
    const r = kv.expire(k, Number(seconds));
    return { ok: !!r, key: k, seconds: Number(seconds) };
  }

  async function goarKvKeys(pattern, opts) {
    const kv = await ensureGoarKv();
    opts = opts || {};
    let pat = pattern || "*";
    if (opts.ns) pat = nsKey(opts.ns, pat === "*" ? "*" : pat);
    let keys = [];
    if (typeof kv.keys === "function") {
      keys = kv.keys(pat) || [];
    }
    return { ok: true, pattern: pat, keys: keys, count: keys.length };
  }

  /** Bridge mind store_memory → kv (best-effort, non-breaking) */
  function wireMemoryBridge() {
    if (global.__GOAR_KV_MEM_WIRED) return;
    global.__GOAR_KV_MEM_WIRED = true;
    // Soft: tools still use agentState; we also mirror to kv
    global.__goarKvMirrorMemory = async function (id, content) {
      try {
        await goarKvSet(id || "note", content, { ns: "mem" });
      } catch (_) {}
    };
  }

  wireMemoryBridge();

  global.ensureGoarKv = ensureGoarKv;
  global.goarKvStatus = goarKvStatus;
  global.goarKvGet = goarKvGet;
  global.goarKvSet = goarKvSet;
  global.goarKvDel = goarKvDel;
  global.goarKvIncr = goarKvIncr;
  global.goarKvExpire = goarKvExpire;
  global.goarKvKeys = goarKvKeys;
  global.GOAR_KV_NS = NS;
  global.__GOAR_KV_STATUS = goarKvStatus;

  // Warm on load (non-blocking) so mind/settings can use it quickly
  try {
    ensureGoarKv().catch(() => {});
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
