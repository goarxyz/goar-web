/**
 * Monaco from Microsoft vscode-cdn, inside GOAR's existing editor chrome.
 * Does not load vscode.dev workbench UI.
 */
(function (global) {
  "use strict";

  const COMMIT = "a5b500951314efd502d07465bd138dfbd714a960";
  const VS = "https://main.vscode-cdn.net/stable/" + COMMIT + "/out/vs";
  const STATE = { editor: null, monaco: null, loading: null, path: "", lang: "plaintext" };

  function langId(name) {
    const ext = String(name || "").split(".").pop().toLowerCase();
    const map = {
      js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript",
      tsx: "typescript", jsx: "javascript", json: "json", py: "python",
      md: "markdown", html: "html", css: "css", sh: "shell", bash: "shell",
      yml: "yaml", yaml: "yaml", toml: "ini", rs: "rust", go: "go",
      c: "c", h: "c", cpp: "cpp", hpp: "cpp", java: "java", rb: "ruby",
      php: "php", sql: "sql", xml: "xml", svg: "xml", txt: "plaintext"
    };
    return map[ext] || "plaintext";
  }

  function loadMonaco() {
    if (STATE.monaco) return Promise.resolve(STATE.monaco);
    if (STATE.loading) return STATE.loading;
    STATE.loading = new Promise(function (resolve, reject) {
      if (global.monaco && global.monaco.editor) {
        STATE.monaco = global.monaco;
        resolve(STATE.monaco);
        return;
      }
      const s = document.createElement("script");
      s.src = VS + "/loader.js";
      s.onload = function () {
        try {
          const req = global.require;
          req.config({ paths: { vs: VS }, "vs/nls": { availableLanguages: {} } });
          req(["vs/editor/editor.main"], function () {
            STATE.monaco = global.monaco;
            resolve(STATE.monaco);
          });
        } catch (e) {
          reject(e);
        }
      };
      s.onerror = function () { reject(new Error("vscode-cdn loader failed")); };
      document.head.appendChild(s);
    });
    return STATE.loading;
  }

  function wrap() {
    return document.getElementById("ide-editor-wrap") || document.getElementById("ide-body");
  }

  async function ensureVscode() {
    const monaco = await loadMonaco();
    const host = wrap();
    if (!host) return STATE;
    const ide = document.getElementById("ide-shell");
    if (ide) ide.classList.add("vscode-on");
    const ta = document.getElementById("ide-editor");
    if (ta) ta.style.display = "none";
    let box = document.getElementById("monaco-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "monaco-box";
      box.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
      host.appendChild(box);
    }
    if (!STATE.editor) {
      STATE.editor = monaco.editor.create(box, {
        value: ta ? ta.value : "",
        language: "plaintext",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
        scrollBeyondLastLine: false,
        wordWrap: "off",
        renderLineHighlight: "line",
        padding: { top: 8 },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
      });
      STATE.editor.onDidChangeModelContent(function () {
        const v = STATE.editor.getValue();
        if (ta) ta.value = v;
        const sz = document.getElementById("ide-status-size");
        if (sz) sz.textContent = v.length + " B";
        const dirty = document.getElementById("ide-status-dirty");
        if (dirty) dirty.textContent = "·";
      });
    }
    return STATE;
  }

  async function vscodeOpen(path, text, language) {
    await ensureVscode();
    const monaco = STATE.monaco;
    const value = text == null ? "" : String(text);
    STATE.path = path || "";
    STATE.lang = language || langId(path);
    if (STATE.editor) {
      const model = monaco.editor.createModel(value, STATE.lang);
      const prev = STATE.editor.getModel();
      STATE.editor.setModel(model);
      if (prev) prev.dispose();
    }
    const ta = document.getElementById("ide-editor");
    if (ta) ta.value = value;
    return { ok: true, path: STATE.path, language: STATE.lang };
  }

  function vscodeGetValue() {
    if (STATE.editor) return STATE.editor.getValue();
    const ta = document.getElementById("ide-editor");
    return ta ? ta.value : "";
  }

  function vscodeSetValue(text) {
    if (STATE.editor) STATE.editor.setValue(String(text || ""));
    const ta = document.getElementById("ide-editor");
    if (ta) ta.value = String(text || "");
  }

  global.ensureVscode = ensureVscode;
  global.vscodeOpen = vscodeOpen;
  global.vscodeGetValue = vscodeGetValue;
  global.vscodeSetValue = vscodeSetValue;
  global.vscodeLangId = langId;
  global.vscodeStatus = function () {
    return { ready: !!STATE.editor, path: STATE.path, lang: STATE.lang, via: "vscode-cdn monaco" };
  };
})(typeof window !== "undefined" ? window : globalThis);
