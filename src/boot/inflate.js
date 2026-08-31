function b64Clean(b64) { return String(b64 || "").replace(/[^A-Za-z0-9+/=]/g, ""); }
function b64utf8(str) {
  // UTF-8 safe base64 for tool payloads
  const s = String(str ?? "");
  try {
    return btoa(unescape(encodeURIComponent(s)));
  } catch (_) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
}

function b64ToU8(b64) {
  const s = b64Clean(b64);
  if (!s) return new Uint8Array(0);
  const lut = _B64_LUT, len = s.length;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((len >> 2) * 3 - pad);
  let o = 0, end = len - pad, i = 0;
  for (; i + 4 <= end; i += 4) {
    const n = (lut[s.charCodeAt(i)] << 18) | (lut[s.charCodeAt(i + 1)] << 12) |
      (lut[s.charCodeAt(i + 2)] << 6) | lut[s.charCodeAt(i + 3)];
    out[o++] = (n >> 16) & 255; out[o++] = (n >> 8) & 255; out[o++] = n & 255;
  }
  if (pad && i < len) {
    const a = lut[s.charCodeAt(i)], b = lut[s.charCodeAt(i + 1)];
    if (pad === 2) out[o++] = ((a << 2) | (b >> 4)) & 255;
    else {
      const c = lut[s.charCodeAt(i + 2)];
      const n = (a << 10) | (b << 4) | (c >> 2);
      out[o++] = (n >> 8) & 255; out[o++] = n & 255;
    }
  }
  return out;
}

/** gzip (pako) or raw — auto-detect gzip magic 1f 8b */
function inflateMaybe(u8) {
  if (!u8 || !u8.length) return u8;
  const isGz = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  if (!isGz) return u8;
  const p = window.pako;
  if (!p || typeof p.ungzip !== "function") {
    throw new Error("pako.ungzip missing — cannot decompress embedded gzip");
  }
  return p.ungzip(u8);
}

async function b64Gunzip(b64, label) {
  const t0 = performance.now();
  const u8 = b64ToU8(b64);
  let raw;
  try {
    if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b && typeof workerGunzip === "function") {
      raw = await workerGunzip(u8);
    } else {
      raw = inflateMaybe(u8);
    }
  } catch (_) {
    raw = inflateMaybe(u8);
  }
  const ms = performance.now() - t0;
  if (label) {
    const ratio = u8.length && raw.length ? (100 * u8.length / raw.length).toFixed(0) : "?";
    console.log("[goar] inflate", label, (u8.length/1048576).toFixed(2), "→", (raw.length/1048576).toFixed(2), "MB", ms.toFixed(0) + "ms", ratio + "% of raw");
  }
  return raw;
}

