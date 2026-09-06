# GOAR

In-browser workspace: chat, Firefox (Scramjet), Kali SSH, terminal, and Create.

## Run

Open **`GOAR.html`** (single file) or serve the repo root:

```bash
python3 -m http.server 8080
# then open http://127.0.0.1:8080/GOAR.html
```

`index.html` is the modular loader (`goar.pack.zip`). Prefer `GOAR.html` for a working copy.

## Build

```bash
python3 scripts/build-single-html.py   # writes GOAR.html
python3 scripts/build-pack.py          # writes goar.pack.zip
```

## Network

Chat, the browser, and Kali SSH share one WISP tunnel (`wss://wisp.mercurywork.shop/`) via libcurl / epoxy. Client headers rotate per hop. No API key required for the built-in chat path.

## Layout

| Path | What |
|---|---|
| `GOAR.html` | Single-file app |
| `src/` | Modular source (`LOAD_ORDER.json`) |
| `scramjet/` + `controller/` | Firefox proxy (Scramjet v2) |
| `libcurl-transport/` | HTTP over WISP |
| `sw.js` | Service worker (Scramjet routes only) |
| `assets/` | WASM / unix box / SSH client |
