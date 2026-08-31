self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  const op = String(msg.op || "");
  try {
    const out = await runOp(op, msg.data);
    const xfer = [];
    if (out && out.buffer instanceof ArrayBuffer) xfer.push(out.buffer);
    if (out && out.bytes instanceof ArrayBuffer) xfer.push(out.bytes);
    self.postMessage({ id, ok: true, result: out }, xfer);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};

async function runOp(op, data) {
  data = data || {};
  if (op === "ping") {
    return { pong: true, ts: Date.now() };
  }
  if (op === "gzip") {
    const u8 = toU8(data);
    const gz = await gzipU8(u8);
    return { bytes: gz.buffer, length: gz.byteLength };
  }
  if (op === "gunzip") {
    const u8 = toU8(data);
    const raw = await gunzipU8(u8);
    return { bytes: raw.buffer, length: raw.byteLength };
  }
  if (op === "hash") {
    const algo = mapAlgo(data.algo);
    const u8 = typeof data.text === "string" ? new TextEncoder().encode(data.text) : toU8(data);
    const buf = await crypto.subtle.digest(algo, u8);
    return { hex: hex(buf), algo: algo.toLowerCase().replace("-", ""), bytes: u8.byteLength };
  }
  if (op === "tokens") {
    const s = typeof data === "string" ? data : typeof data.text === "string" ? data.text : JSON.stringify(data.messages || data);
    return { tokens: Math.max(1, Math.floor(String(s || "").length / 4)), chars: String(s || "").length };
  }
  if (op === "json") {
    const s = typeof data.text === "string" ? data.text : JSON.stringify(data.value);
    const parsed = JSON.parse(s);
    return { chars: s.length, tokens: Math.max(1, Math.floor(s.length / 4)), keys: parsed && typeof parsed === "object" ? Object.keys(parsed).length : 0 };
  }
  throw new Error("unknown op " + op);
}

function toU8(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.buffer.byteLength);
  if (data && data.bytes instanceof ArrayBuffer) return new Uint8Array(data.bytes);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data && typeof data.text === "string") return new TextEncoder().encode(data.text);
  return new Uint8Array(0);
}

async function gzipU8(u8) {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipU8(u8) {
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8;
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function mapAlgo(a) {
  const s = String(a || "sha256").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === "sha1") return "SHA-1";
  if (s === "sha384") return "SHA-384";
  if (s === "sha512") return "SHA-512";
  return "SHA-256";
}

function hex(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, "0");
  return s;
}
