#!/usr/bin/env python3
"""One-file GOAR.embedded.html — JS/CSS plus every runtime asset inlined."""
from pathlib import Path
import base64
import json
import mimetypes

root = Path(__file__).resolve().parents[1]
src_html = (root / "index.html").read_text(encoding="utf-8")
cut = src_html.find("  <script>\n  (function () {\n    \"use strict\";\n    const PACKS")
if cut < 0:
    raise SystemExit("could not find pack loader in index.html")
head = src_html[:cut].rstrip()

# Point icons at a tiny in-page data URI so the file works offline
PNG_B64 = base64.b64encode((root / "assets/brand/g.png").read_bytes()).decode("ascii")
LOGO = "data:image/png;base64," + PNG_B64
head = head.replace("https://cdn.jsdelivr.net/gh/KkDevAu/goar-next@cdn/assets/brand/g.png", LOGO)
head = head.replace("https://cdn.jsdelivr.net/gh/KkDevAu/goar@main/assets/brand/g.png", LOGO)

order = json.loads((root / "src/LOAD_ORDER.json").read_text())
css = [
    ("xterm", "src/css/xterm.css"),
    ("app", "src/css/app.css"),
    ("shell", "src/css/ghtml-shell.css"),
    ("bridge", "src/css/goar-bridge.css"),
    ("chat", "src/css/grok-chat.css"),
    ("particles", "src/css/particles-layer.css"),
    ("mono", "src/css/mono-jet.css"),
]
js = [
    "src/vendor/xterm.js",
    "src/vendor/xterm-addon-fit.js",
    "src/vendor/xterm-addon-web-links.js",
    "src/vendor/pako-inflate.js",
    "src/vendor/json-schema.js",
    "vendor/kv.js/kv-browser.js",
]
for p in order:
    js.append("src/" + p.replace("src/", ""))

EMBED_FILES = [
    "assets/brand/g.png",
    "assets/jit/goar-jit.wasm",
    "assets/kernel/goar-kernel.py",
    "assets/unix/goar-box.wasm",
    "assets/gecko/gecko.js",
    "assets/gecko/gecko.wasm.zst",
    "assets/pyodide/pyodide.mjs",
    "assets/pyodide/pyodide.asm.js",
    "assets/pyodide/pyodide.asm.wasm",
    "assets/pyodide/pyodide-lock.json",
    "assets/pyodide/python_stdlib.zip",
    "assets/pyodide/pyodide-security.zip",
    "assets/pyodide/micropip-0.8.0-py3-none-any.whl",
    "assets/pyodide/packaging-24.2-py3-none-any.whl",
    "assets/pyodide/six-1.16.0-py2.py3-none-any.whl",
    "assets/net/libcurl.wasm",
    "assets/net/libcurl.mjs",
    "assets/net/epoxy/epoxy-bundled.js",
    "assets/net/wisp/wisp.mjs",
    "assets/net/wisp/polyfill.mjs",
    "assets/net/wisp/compat.mjs",
    "assets/eruda/eruda.js",
]
for p in (root / "assets/unix/wasi").glob("*.js"):
    EMBED_FILES.append("assets/unix/wasi/" + p.name)
for p in (root / "assets/crypto-js").glob("*.js"):
    EMBED_FILES.append("assets/crypto-js/" + p.name)

def esc(s: str) -> str:
    return s.replace("</script>", "<\\/script>").replace("</SCRIPT>", "<\\/SCRIPT>")

def banner(title: str) -> str:
    return (
        "\n<!-- ====================================================================== -->\n"
        f"<!-- {title} -->\n"
        "<!-- ====================================================================== -->\n"
    )

dest = root / "GOAR.embedded.html"
workspace_dest = Path("/workspace/GOAR.embedded.html")

print("writing", dest)
with dest.open("w", encoding="utf-8") as f:
    f.write(head)
    f.write("\n")
    f.write(banner("EMBED FLAG"))
    f.write(
        "<script>\n"
        "window.GOAR_FORCE_CDN = false;\n"
        "window.__GOAR_EMBEDDED = true;\n"
        "window.__GOAR_EMBED_B64 = Object.create(null);\n"
        "window.__GOAR_EMBED_BUF = Object.create(null);\n"
        "</script>\n"
    )
    f.write(banner("EMBEDDED ASSETS"))
    f.write("<script>\n")
    total = 0
    for rel in EMBED_FILES:
        fp = root / rel
        if not fp.is_file():
            print("skip missing", rel)
            continue
        raw = fp.read_bytes()
        b64 = base64.b64encode(raw).decode("ascii")
        total += len(raw)
        key = rel.replace("\\", "/")
        f.write("window.__GOAR_EMBED_B64[")
        f.write(json.dumps(key))
        f.write("]=")
        f.write(json.dumps(b64))
        f.write(";\n")
        print("  embed", key, len(raw))
    f.write("</script>\n")
    f.write(banner("EMBED DECODE + FETCH"))
    f.write(
        r"""<script>
(function () {
  function b64ToU8(s) {
    var bin = atob(s);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function mime(p) {
    p = String(p || "");
    if (/\.wasm$/i.test(p)) return "application/wasm";
    if (/\.mjs$|\.js$/i.test(p)) return "text/javascript";
    if (/\.json$/i.test(p)) return "application/json";
    if (/\.zip$|\.whl$/i.test(p)) return "application/zip";
    if (/\.png$/i.test(p)) return "image/png";
    if (/\.zst$/i.test(p)) return "application/octet-stream";
    return "application/octet-stream";
  }
  var b64 = window.__GOAR_EMBED_B64 || {};
  var buf = window.__GOAR_EMBED_BUF;
  var blobs = Object.create(null);
  Object.keys(b64).forEach(function (k) {
    var u8 = b64ToU8(b64[k]);
    buf[k] = u8;
    buf[k.split("/").pop()] = u8;
    var url = URL.createObjectURL(new Blob([u8], { type: mime(k) }));
    blobs[k] = url;
    blobs[k.split("/").pop()] = url;
  });
  window.__GOAR_EMBED_URL = blobs;
  if (blobs["assets/gecko/gecko.js"]) window.GOAR_GECKO_JS_URL = blobs["assets/gecko/gecko.js"];
  if (blobs["assets/gecko/gecko.wasm.zst"]) window.GOAR_GECKO_WASM_URL = blobs["assets/gecko/gecko.wasm.zst"];
  function resolve(u) {
    u = String(u || "").split("?")[0].split("#")[0];
    if (blobs[u]) return blobs[u];
    var i = u.indexOf("/assets/");
    if (i >= 0 && blobs[u.slice(i + 1)]) return blobs[u.slice(i + 1)];
    var base = u.split("/").pop();
    if (blobs[base]) return blobs[base];
    if (u.indexOf("assets/") === 0 && blobs[u]) return blobs[u];
    return "";
  }
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var hit = resolve(url);
    if (hit) return origFetch(hit, init);
    return origFetch(input, init);
  };
  var _ga;
  Object.defineProperty(window, "goarAssetUrl", {
    configurable: true,
    get: function () { return _ga; },
    set: function (fn) {
      _ga = function (rel) {
        var hit = resolve(rel) || resolve(String(rel || "").replace(/^\.\//, ""));
        if (hit) return hit;
        return typeof fn === "function" ? fn(rel) : String(rel || "");
      };
    }
  });
})();
</script>
"""
    )

    f.write(banner("CSS"))
    for name, p in css:
        fp = root / p
        if not fp.is_file():
            raise SystemExit("missing " + p)
        f.write(banner("CSS / " + name))
        f.write(f'<style data-src="{p}">\n')
        f.write(fp.read_text(encoding="utf-8", errors="replace").rstrip())
        f.write("\n</style>\n")

    f.write(banner("SETTINGS CLICK"))
    f.write(
        """<script>
document.addEventListener("click", function (e) {
  var t = e.target && e.target.closest && e.target.closest("#btn-settings, #menu-settings, #drawer-settings");
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof openSettings === "function") openSettings();
  else {
    var box = document.getElementById("settings");
    if (box) { box.classList.add("open"); box.style.display = "flex"; box.style.zIndex = "10000"; }
  }
}, true);
</script>
"""
    )

    seen = set()
    for p in js:
        if p in seen:
            continue
        seen.add(p)
        fp = root / p
        if not fp.is_file():
            raise SystemExit("missing " + p)
        f.write(banner("JS / " + Path(p).name))
        f.write(f'<script data-src="{p}">\n')
        f.write(esc(fp.read_text(encoding="utf-8", errors="replace")).rstrip())
        f.write("\n</script>\n")

    f.write("\n</body>\n</html>\n")

size = dest.stat().st_size
print("embedded bytes", total, "html", size)
workspace_dest.write_bytes(dest.read_bytes())
print("wrote", dest, dest.stat().st_size)
print("wrote", workspace_dest, workspace_dest.stat().st_size)
# also expose as GOAR.html at workspace root for download
Path("/workspace/GOAR.html").write_bytes(dest.read_bytes())
print("wrote /workspace/GOAR.html", Path("/workspace/GOAR.html").stat().st_size)
