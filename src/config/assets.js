const GOAR_REMOTE = "https://cdn.jsdelivr.net/gh/goarxyz/goar-web@main/";
const GOAR_BIN = "https://raw.githubusercontent.com/goarxyz/goar-web/refs/heads/main/";
const ROOTFS_REV = "v5-pip";

function goarUseCdn() {
  try {
    if (typeof window !== "undefined") {
      if (window.GOAR_FORCE_CDN === true) return true;
      if (window.GOAR_FORCE_CDN === false) return false;
      if (String(location.protocol || "") === "file:") return true;
      const h = String(location.hostname || "");
      if (h === "127.0.0.1" || h === "localhost") return false;
    }
  } catch (_) {}
  return true;
}

async function goarResolveIndex(localRel, cdnRel) {
  const local = String(localRel || "./assets/pyodide/").replace(/\/?$/, "/");
  const cdn = (typeof GOAR_REMOTE === "string" ? GOAR_REMOTE : "https://cdn.jsdelivr.net/gh/goarxyz/goar-web@main/") + String(cdnRel || "assets/pyodide/").replace(/^\//, "");
  const cdnUrl = cdn.endsWith("/") ? cdn : cdn + "/";
  if (goarUseCdn()) return cdnUrl;
  try {
    const r = await fetch(local + "pyodide.mjs", { method: "HEAD", cache: "no-store" });
    if (r && r.ok) return new URL(local, location.href).href;
  } catch (_) {}
  return cdnUrl;
}

async function goarResolveFile(localRel, remoteAbs) {
  const local = "./" + String(localRel || "").replace(/^\.\//, "");
  if (!goarUseCdn()) {
    try {
      const r = await fetch(local, { method: "HEAD", cache: "no-store" });
      if (r && r.ok) return new URL(local, location.href).href;
    } catch (_) {}
  }
  return remoteAbs || goarAssetUrl(localRel);
}

function goarAssetUrl(rel) {
  let p = String(rel || "").replace(/^\.\//, "").replace(/^\//, "");
  if (!p.startsWith("assets/") && !p.startsWith("goar.")) p = "assets/" + p;
  // Brand is local — never the stale CDN mark.
  if (/assets\/brand\//i.test(p)) return "./" + p;
  if (!goarUseCdn()) return "./" + p;
  // jsDelivr rejects files over ~20 MB — those go through raw GitHub
  if (/\.(gz|zst)$/i.test(p) || /frozen|rootfs|gecko\.wasm|vmlinuz|chrome-assets\.tar/i.test(p)) {
    return GOAR_BIN + p;
  }
  return GOAR_REMOTE + p;
}

const CACHE_NAME = "goar-assets";
const GOAR_LOGO = goarAssetUrl("assets/brand/g.png");

const HEAVY = {
  gecko: goarAssetUrl("assets/gecko/gecko.wasm.zst"),
  geckoJs: goarAssetUrl("assets/gecko/gecko.js"),
  libcurl: goarAssetUrl("assets/net/libcurl.wasm"),
  libcurlJs: goarAssetUrl("assets/net/libcurl.mjs"),
  epoxy: goarAssetUrl("assets/net/epoxy/epoxy-bundled.js"),
  pyodide: "./assets/pyodide/",
  kernel: goarAssetUrl("assets/kernel/goar-kernel.py"),
  secPack: goarAssetUrl("assets/pyodide/pyodide-security.zip"),
  pack: goarAssetUrl("goar.pack.zip"),
  logo: GOAR_LOGO,
};

const HEAVY_REMOTE = {
  gecko: GOAR_BIN + "assets/gecko/gecko.wasm.zst",
  geckoJs: GOAR_REMOTE + "assets/gecko/gecko.js",
  libcurl: GOAR_BIN + "assets/net/libcurl.wasm",
  libcurlJs: GOAR_REMOTE + "assets/net/libcurl.mjs",
  epoxy: GOAR_REMOTE + "assets/net/epoxy/epoxy-bundled.js",
  pyodide: GOAR_REMOTE + "assets/pyodide/",
  pack: GOAR_REMOTE + "goar.pack.zip",
  kernel: GOAR_REMOTE + "assets/kernel/goar-kernel.py",
  secPack: GOAR_REMOTE + "assets/pyodide/pyodide-security.zip",
  logo: GOAR_REMOTE + "assets/brand/g.png",
};

const LOCAL_ASSETS = HEAVY;
const ASSETS = {
  gecko: [HEAVY.gecko, HEAVY_REMOTE.gecko],
};

try {
  window.GOAR_REMOTE = GOAR_REMOTE;
  window.GOAR_BIN = GOAR_BIN;
  window.GOAR_LOGO = GOAR_LOGO;
  window.HEAVY = HEAVY;
  window.HEAVY_REMOTE = HEAVY_REMOTE;
  window.LOCAL_ASSETS = LOCAL_ASSETS;
  window.ASSETS = ASSETS;
  window.CACHE_NAME = CACHE_NAME;
  window.goarAssetUrl = goarAssetUrl;
  window.goarUseCdn = goarUseCdn;
  window.goarResolveIndex = goarResolveIndex;
  window.goarResolveFile = goarResolveFile;
  window.ROOTFS_REV = ROOTFS_REV;
} catch (_) {}
