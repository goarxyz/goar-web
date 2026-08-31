const FREEZE_VERSION = "goar-freeze-v5-pip";
const FREEZE_OPFS_DIR = "goaros";
const FREEZE_OPFS_FILE = "frozen-session.bin";
const FREEZE_OPFS_META = "frozen-session.meta.json";

async function opfsRoot() {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  return await navigator.storage.getDirectory();
}

async function opfsGetDir(name, create = true) {
  const root = await opfsRoot();
  if (!root) return null;
  return await root.getDirectoryHandle(name, { create });
}

async function opfsWriteBytes(dirName, fileName, bytes) {
  const dir = await opfsGetDir(dirName, true);
  if (!dir) throw new Error("OPFS unavailable");
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
}

async function opfsReadBytes(dirName, fileName) {
  try {
    const dir = await opfsGetDir(dirName, false);
    if (!dir) return null;
    const fh = await dir.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (_) {
    return null;
  }
}

async function opfsRemove(dirName, fileName) {
  try {
    const dir = await opfsGetDir(dirName, false);
    if (!dir) return;
    await dir.removeEntry(fileName);
  } catch (_) {}
}

function abToU8(ab) {
  return ab instanceof Uint8Array ? ab : new Uint8Array(ab);
}

async function gzipBytes(u8) {
  try {
    if (typeof workerGzip === "function") return await workerGzip(u8);
  } catch (_) {}
  try {
    if (typeof CompressionStream !== "undefined") {
      const cs = new CompressionStream("gzip");
      const stream = new Blob([u8]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
  } catch (_) {}
  if (typeof pako !== "undefined" && pako.gzip) {
    return pako.gzip(u8);
  }
  return u8; // uncompressed fallback
}

async function gunzipBytes(u8) {
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8;
  try {
    if (typeof workerGunzip === "function") return await workerGunzip(u8);
  } catch (_) {}
  try {
    if (typeof DecompressionStream !== "undefined") {
      const ds = new DecompressionStream("gzip");
      const stream = new Blob([u8]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
  } catch (_) {}
  if (typeof pako !== "undefined" && pako.ungzip) {
    return pako.ungzip(u8);
  }
  throw new Error("gzip frozen state but no decompressor");
}

async function loadOpfsFreeze() {
  const metaBytes = await opfsReadBytes(FREEZE_OPFS_DIR, FREEZE_OPFS_META);
  if (!metaBytes) return null;
  let meta = {};
  try { meta = JSON.parse(new TextDecoder().decode(metaBytes)); } catch (_) { return null; }
  if (!meta || meta.version !== FREEZE_VERSION) return null;
  const gz = await opfsReadBytes(FREEZE_OPFS_DIR, FREEZE_OPFS_FILE);
  if (!gz || gz.byteLength < 1000) return null;
  const state = await gunzipBytes(gz);
  return {
    state: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
    meta,
  };
}

async function loadPackagedFreeze() {
  // Stale RAM snapshots undo rootfs fixes (pip distlib). Only OPFS with this
  // FREEZE_VERSION is accepted. Ship a new frozen.bin.gz after a verified boot.
  return null;
}

async function loadSessionSnapshot() {
  if (typeof window !== "undefined" && window.GOAR_FORCE_COLD) return null;
  try {
    const opfs = await loadOpfsFreeze();
    if (opfs && opfs.state) {
      window.__GOAR_FROZEN_META = opfs.meta || {};
      return opfs;
    }
  } catch (e) {
    console.warn("opfs freeze", e);
  }
  return null;
}

async function saveSessionSnapshot(reason = "auto") {
  if (!emulator || typeof emulator.save_state !== "function") {
    throw new Error("emulator not ready for freeze");
  }
  try { if (el.status) el.status.textContent = "freezing verified session..."; } catch (_) {}
  try { await navigator.storage?.persist?.(); } catch (_) {}

  // Pause lightly: leave agent as-is; save_state snapshots full RAM
  const raw = await emulator.save_state();
  const u8 = abToU8(raw);
  const gz = await gzipBytes(u8);
  const plan = window.__GOAR_MEM_PLAN || {};
  const meta = {
    version: FREEZE_VERSION,
    reason,
    ts: Date.now(),
    rawBytes: u8.byteLength,
    gzBytes: gz.byteLength,
    guestRamMB: plan.guestRamMB || null,
    verify: window.__GOAR_LAST_VERIFY || null,
  };
  await opfsWriteBytes(FREEZE_OPFS_DIR, FREEZE_OPFS_FILE, gz);
  await opfsWriteBytes(
    FREEZE_OPFS_DIR,
    FREEZE_OPFS_META,
    new TextEncoder().encode(JSON.stringify(meta)),
  );
  window.__GOAR_FROZEN_META = meta;
  console.log("[goar] freeze saved OPFS", meta);
  try {
    if (el.status) {
      el.status.textContent =
        "frozen · " + (gz.byteLength / 1048576).toFixed(1) + " MB gzip · next load is instant";
    }
  } catch (_) {}
  return meta;
}

async function downloadGoarSession() {
  const raw = await opfsReadBytes(FREEZE_OPFS_DIR, FREEZE_OPFS_FILE);
  if (!raw) throw new Error("no freeze yet — wait for verify or Save session");
  const blob = new Blob([raw], { type: "application/gzip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "goar-frozen-state.bin.gz";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function clearGoarSession() {
  await opfsRemove(FREEZE_OPFS_DIR, FREEZE_OPFS_FILE);
  await opfsRemove(FREEZE_OPFS_DIR, FREEZE_OPFS_META);
  window.__GOAR_INITIAL_STATE = undefined;
  window.__GOAR_FROZEN_META = null;
}

// Public aliases used by buttons / auto path
window.saveGoarSession = async (reason) => saveSessionSnapshot(reason || "manual");
window.loadSessionSnapshot = loadSessionSnapshot;
window.clearGoarSession = clearGoarSession;
window.downloadGoarSession = downloadGoarSession;



window.exportFrozenImage = async function exportFrozenImage() {
  if (!emulator || typeof emulator.save_state !== "function") {
    throw new Error("emulator not ready");
  }
  const raw = await emulator.save_state();
  const gz = await gzipBytes(abToU8(raw));
  return { gz: gz, rawBytes: abToU8(raw).byteLength, gzBytes: gz.byteLength };
};
