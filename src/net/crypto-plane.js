/**
 * Host crypto — Web Crypto first, crypto-js only for MD5 / SHA3 / RIPEMD / OpenSSL-AES.
 * Used by kit crypto. Instant. No Pyodide wait.
 */
const HOST_CRYPTO = { loaded: Object.create(null) };

function cryptoAsset(name) {
  try {
    const path = location.pathname.replace(/\/[^/]*$/, "/");
    return (location.origin || "") + path + "assets/crypto-js/" + name;
  } catch (_) {
    if (typeof goarAssetUrl === "function") return goarAssetUrl("assets/crypto-js/" + name);
    return "./assets/crypto-js/" + name;
  }
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const hit = document.querySelector('script[data-cj="' + src + '"]');
    if (hit) {
      if (hit.dataset.ready) return resolve();
      hit.addEventListener("load", () => resolve(), { once: true });
      hit.addEventListener("error", () => reject(new Error("load " + src)), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.cj = src;
    s.onload = () => { s.dataset.ready = "1"; resolve(); };
    s.onerror = () => reject(new Error("load " + src));
    document.head.appendChild(s);
  });
}

async function ensureCryptoJS(kind) {
  const file =
    kind === "md5" ? "md5.js"
    : kind === "sha3" ? "sha3.js"
    : kind === "ripemd160" ? "ripemd160.js"
    : kind === "aes" ? "aes.js"
    : kind === "pbkdf2" ? "pbkdf2.js"
    : kind === "hmac" ? "hmac-sha256.js"
    : kind === "sha1" ? "sha1.js"
    : kind === "sha512" ? "sha512.js"
    : "sha256.js";
  if (!HOST_CRYPTO.loaded[file]) {
    await loadScriptOnce(cryptoAsset(file));
    HOST_CRYPTO.loaded[file] = true;
  }
  return window.CryptoJS;
}

function bufToHex(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, "0");
  return s;
}

async function hostHash(algo, data) {
  const a = String(algo || "sha256").toLowerCase().replace(/[^a-z0-9]/g, "");
  const text = String(data == null ? "" : data);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  const web =
    a === "sha1" ? "SHA-1"
    : a === "sha256" ? "SHA-256"
    : a === "sha384" ? "SHA-384"
    : a === "sha512" ? "SHA-512"
    : null;
  if (subtle && web) {
    if (text.length > 16384 && typeof workerHash === "function") {
      const r = await workerHash(a, text);
      return { ok: true, algo: a, hex: r.hex, via: "worker" };
    }
    const buf = await subtle.digest(web, new TextEncoder().encode(text));
    return { ok: true, algo: a, hex: bufToHex(buf), via: "webcrypto" };
  }
  const CJ = await ensureCryptoJS(
    a === "md5" ? "md5" : a === "sha3" || a === "sha3256" ? "sha3" : a === "ripemd160" ? "ripemd160" : a
  );
  const fn =
    a === "md5" ? CJ.MD5
    : a === "sha1" ? CJ.SHA1
    : a === "sha512" ? CJ.SHA512
    : a === "sha3" || a === "sha3256" ? CJ.SHA3
    : a === "ripemd160" ? CJ.RIPEMD160
    : CJ.SHA256;
  if (!fn) return { ok: false, error: "algo " + a };
  return { ok: true, algo: a, hex: String(fn(text)), via: "crypto-js" };
}

async function hostHmac(algo, data, key) {
  const a = String(algo || "sha256").toLowerCase();
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && (a === "sha256" || a === "sha1" || a === "sha512")) {
    const name = a === "sha1" ? "SHA-1" : a === "sha512" ? "SHA-512" : "SHA-256";
    const k = await subtle.importKey(
      "raw",
      new TextEncoder().encode(String(key || "")),
      { name: "HMAC", hash: name },
      false,
      ["sign"]
    );
    const sig = await subtle.sign("HMAC", k, new TextEncoder().encode(String(data || "")));
    return { ok: true, hex: bufToHex(sig), via: "webcrypto" };
  }
  const CJ = await ensureCryptoJS("hmac");
  return { ok: true, hex: String(CJ.HmacSHA256(String(data || ""), String(key || ""))), via: "crypto-js" };
}

async function hostAes(op, plaintext, password) {
  const CJ = await ensureCryptoJS("aes");
  const p = String(password || "");
  if (op === "decrypt") {
    const out = CJ.AES.decrypt(String(plaintext || ""), p).toString(CJ.enc.Utf8);
    return { ok: !!out, text: out, via: "crypto-js" };
  }
  return { ok: true, ciphertext: CJ.AES.encrypt(String(plaintext || ""), p).toString(), via: "crypto-js" };
}

async function runHostCrypto(args) {
  args = args || {};
  const action = String(args.action || args.op || "hash").toLowerCase();
  const data = args.data != null ? args.data : args.text != null ? args.text : args.input;
  const algo = args.algo || args.algorithm || "sha256";
  if (action === "hash" || action === "digest") return hostHash(algo, data);
  if (action === "hmac") return hostHmac(algo, data, args.key || args.password);
  if (action === "encrypt" || action === "aes_encrypt") {
    return hostAes("encrypt", data, args.password || args.key);
  }
  if (action === "decrypt" || action === "aes_decrypt") {
    return hostAes("decrypt", data, args.password || args.key);
  }
  if (action === "random") {
    const n = Math.max(1, Math.min(64, Number(args.bytes) || 16));
    const u = new Uint8Array(n);
    crypto.getRandomValues(u);
    return { ok: true, hex: bufToHex(u.buffer) };
  }
  return hostHash("sha256", data);
}

try {
  window.runHostCrypto = runHostCrypto;
  window.hostHash = hostHash;
} catch (_) {}
