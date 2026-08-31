(function (global) {
  "use strict";

  const STATE = { worker: null, seq: 0, pending: new Map(), ready: false, lastError: "" };

  function workerUrl() {
    try {
      const path = location.pathname.replace(/\/[^/]*$/, "/");
      return (location.origin || "") + path + "src/net/compute-worker.js";
    } catch (_) {
      return "./src/net/compute-worker.js";
    }
  }

  function ensureComputeWorker() {
    if (STATE.worker) return STATE.worker;
    try {
      const w = new Worker(workerUrl());
      w.onmessage = (ev) => {
        const msg = ev.data || {};
        const p = STATE.pending.get(msg.id);
        if (!p) return;
        STATE.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || "worker failed"));
      };
      w.onerror = (e) => {
        STATE.lastError = String(e && e.message ? e.message : e);
        STATE.pending.forEach((p) => p.reject(new Error(STATE.lastError)));
        STATE.pending.clear();
      };
      STATE.worker = w;
      STATE.ready = true;
      global.__GOAR_COMPUTE_WORKER = true;
    } catch (e) {
      STATE.lastError = String(e && e.message ? e.message : e);
      STATE.ready = false;
    }
    return STATE.worker;
  }

  function computeCall(op, data, transfer) {
    const w = ensureComputeWorker();
    if (!w) return Promise.reject(new Error("workers unavailable"));
    const id = ++STATE.seq;
    return new Promise((resolve, reject) => {
      STATE.pending.set(id, { resolve, reject });
      try {
        w.postMessage({ id, op, data }, transfer || []);
      } catch (e) {
        STATE.pending.delete(id);
        reject(e);
      }
    });
  }

  async function workerGzip(u8) {
    const buf = u8 instanceof Uint8Array ? u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) : u8;
    const r = await computeCall("gzip", buf, [buf]);
    return new Uint8Array(r.bytes);
  }

  async function workerGunzip(u8) {
    const buf = u8 instanceof Uint8Array ? u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) : u8;
    const r = await computeCall("gunzip", buf, [buf]);
    return new Uint8Array(r.bytes);
  }

  async function workerHash(algo, textOrBytes) {
    if (typeof textOrBytes === "string") return computeCall("hash", { algo, text: textOrBytes });
    const u8 = textOrBytes instanceof Uint8Array ? textOrBytes : new Uint8Array(textOrBytes || []);
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    return computeCall("hash", { algo, bytes: buf }, [buf]);
  }

  async function workerTokens(messagesOrText) {
    if (typeof messagesOrText === "string") return computeCall("tokens", { text: messagesOrText });
    return computeCall("tokens", { messages: messagesOrText });
  }

  function computeStatus() {
    return {
      ok: STATE.ready && !!STATE.worker,
      pending: STATE.pending.size,
      error: STATE.lastError || "",
      workers: typeof Worker !== "undefined",
    };
  }

  global.ensureComputeWorker = ensureComputeWorker;
  global.computeCall = computeCall;
  global.workerGzip = workerGzip;
  global.workerGunzip = workerGunzip;
  global.workerHash = workerHash;
  global.workerTokens = workerTokens;
  global.computeStatus = computeStatus;
  try { ensureComputeWorker(); } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
