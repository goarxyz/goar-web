#!/usr/bin/env python3
"""Zip src + vendor for the compact loader."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
out = root / "goar.pack.zip"
order = json.loads((root / "src/LOAD_ORDER.json").read_text())
files = [
    "src/LOAD_ORDER.json",
    "src/css/xterm.css",
    "src/css/app.css",
    "src/css/ghtml-shell.css",
    "src/css/goar-bridge.css",
    "src/css/grok-chat.css",
    "src/css/particles-layer.css",
    "src/vendor/xterm.js",
    "src/vendor/xterm-addon-fit.js",
    "src/vendor/xterm-addon-web-links.js",
    "src/vendor/pako-inflate.js",
    "src/vendor/json-schema.js",
    "vendor/kv.js/kv-browser.js",
]
for p in order:
    files.append("src/" + p.replace("src/", ""))
seen = set()
missing = []
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in files:
        if p in seen:
            continue
        seen.add(p)
        fp = root / p
        if not fp.is_file():
            missing.append(p)
            continue
        z.write(fp, p)
print("wrote", out, out.stat().st_size, "files", len(seen) - len(missing))
if missing:
    print("missing", missing)
    raise SystemExit(1)
