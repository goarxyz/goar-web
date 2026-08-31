#!/usr/bin/env python3
"""One-file GOAR.html: current loader markup + all pack JS/CSS. WASM stays remote."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
src_html = (root / "index.html").read_text(encoding="utf-8")
cut = src_html.find("  <script>\n  (function () {\n    \"use strict\";\n    const PACKS")
if cut < 0:
    raise SystemExit("could not find pack loader in index.html")
head = src_html[:cut].rstrip()

order = json.loads((root / "src/LOAD_ORDER.json").read_text())
css = [
    ("xterm", "src/css/xterm.css"),
    ("app", "src/css/app.css"),
    ("shell", "src/css/ghtml-shell.css"),
    ("bridge", "src/css/goar-bridge.css"),
    ("chat", "src/css/grok-chat.css"),
    ("particles", "src/css/particles-layer.css"),
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

def esc(s: str) -> str:
    return s.replace("</script>", "<\\/script>").replace("</SCRIPT>", "<\\/SCRIPT>")

def banner(title: str) -> str:
    return (
        "\n<!-- ====================================================================== -->\n"
        f"<!-- {title} -->\n"
        "<!-- ====================================================================== -->\n"
    )

out = [head, ""]
out.append(banner("CSS"))
for name, p in css:
    fp = root / p
    if not fp.is_file():
        raise SystemExit("missing " + p)
    out.append(banner("CSS / " + name))
    out.append(f'<style data-src="{p}">')
    out.append(fp.read_text(encoding="utf-8", errors="replace").rstrip())
    out.append("</style>")

out.append(banner("SETTINGS CLICK"))
out.append("""<script>
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
</script>""")

seen = set()
for p in js:
    if p in seen:
        continue
    seen.add(p)
    fp = root / p
    if not fp.is_file():
        raise SystemExit("missing " + p)
    name = Path(p).name
    out.append(banner("JS / " + name))
    out.append(f'<script data-src="{p}">')
    out.append(esc(fp.read_text(encoding="utf-8", errors="replace")).rstrip())
    out.append("</script>")

out.append("\n</body>\n</html>\n")
text = "\n".join(out)
dests = [root / "GOAR.html", Path("/workspace/GOAR.html")]
for d in dests:
    d.write_text(text, encoding="utf-8")
    print("wrote", d, d.stat().st_size)
