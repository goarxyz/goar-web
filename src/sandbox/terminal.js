function markTermReady() {
  try {
    const el = document.getElementById("terminal") || document.getElementById("term-stage");
    if (el) {
      el.classList.add("live");
      el.style.pointerEvents = "auto";
    }
    const tab = document.getElementById("term-tab");
    if (tab) tab.classList.remove("loading");
    window.__GOAR_TERM_READY = true;
    paintTermStatus();
  } catch (_) {}
}

function termGuestWrite(data) {
  if (typeof sshReady === "function" && sshReady() && typeof sshWrite === "function") {
    try { sshWrite(data); return "ssh"; } catch (_) {}
  }
  if (window.__GOAR_UNIX && typeof unixOnData === "function") {
    try { unixOnData(data); return "unix"; } catch (_) {}
  }
  return "";
}

function paintTermStatus() {
  const el = document.getElementById("term-status");
  if (!el) return;
  let bits = [];
  try {
    if (typeof sshReady === "function" && sshReady()) {
      const st = typeof sshStatus === "function" ? sshStatus() : {};
      bits.push((st.user || "root") + "@" + (st.host || "kali"));
      if (st.port) bits.push(":" + st.port);
    } else if (window.Unix && window.Unix.ready) {
      bits.push("BusyBox");
    } else {
      bits.push("connecting");
    }
  } catch (_) { bits.push("term"); }
  try {
    if (typeof term !== "undefined" && term) bits.push(term.cols + "×" + term.rows);
  } catch (_) {}
  el.textContent = bits.join(" · ");
}

function pushSshTtySize() {
  try {
    if (typeof term === "undefined" || !term) return;
    const c = term.cols | 0, r = term.rows | 0;
    if (c < 8 || r < 4) return;
    const sess = window.SSH && window.SSH.sock && window.SSH.sock.session;
    if (sess && typeof sess.resizeTerminal === "function") {
      sess.resizeTerminal(c, r).catch(function () {});
    }
  } catch (_) {}
}

function initTerm() {
  if (typeof Terminal === "undefined") throw new Error("terminal failed to load");
  term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: 'JetBrains Mono,ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    fontSize: 13,
    lineHeight: 1.25,
    letterSpacing: 0,
    theme: {
      background: "#050505", foreground: "#f2f2f2", cursor: "#f2f2f2", cursorAccent: "#050505",
      selectionBackground: "#ffffff28",
      black:"#050505", red:"#b8b8b8", green:"#f2f2f2", yellow:"#d0d0d0",
      blue:"#9a9a9a", magenta:"#c8c8c8", cyan:"#aeaeae", white:"#f2f2f2",
      brightBlack:"#4d4d4d", brightRed:"#d0d0d0", brightGreen:"#ffffff", brightYellow:"#e8e8e8",
      brightBlue:"#c0c0c0", brightMagenta:"#eeeeee", brightCyan:"#d8d8d8", brightWhite:"#fff",
    },
    scrollback: 12000,
    convertEol: true,
    allowProposedApi: true,
    macOptionIsMeta: true,
    rightClickSelectsWord: true,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch (_) {}
  const termMount = (typeof el !== "undefined" && el.terminal) || document.getElementById("terminal");
  if (!termMount) throw new Error("terminal mount #terminal missing");
  term.open(termMount);
  try { fitAddon.fit(); } catch (_) {}
  try { if (typeof attachTermView === "function") attachTermView(); } catch (_) {}
  markTermReady();
  term.onData((data) => {
    const via = termGuestWrite(data);
    if (via) return;
    if (typeof ensureSsh === "function" && !window.__GOAR_TERM_SSH_KICK) {
      window.__GOAR_TERM_SSH_KICK = true;
      ensureSsh({ reason: "term" }).then(function (st) {
        window.__GOAR_TERM_SSH_KICK = false;
        if (st && st.ready) termGuestWrite(data);
      }).catch(function () { window.__GOAR_TERM_SSH_KICK = false; });
    }
    if (window.__GOAR_UNIX && typeof unixOnData === "function") return;
    try { term.write(data === "\r" ? "\r\n" : data.replace(/\x7f/g, "\b \b")); } catch (_) {}
  });
  try {
    term.attachCustomKeyEventHandler(function (ev) {
      if (!ev || ev.type !== "keydown") return true;
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "C" || ev.key === "c")) {
        copyTermSel();
        return false;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "V" || ev.key === "v")) {
        pasteTerm();
        return false;
      }
      return true;
    });
  } catch (_) {}
  const host = document.getElementById("term-stage") || termMount;
  if (host && host.addEventListener) host.addEventListener("pointerdown", focusLiveTerm);
  window.addEventListener("resize", () => {
    try { fitAddon.fit(); } catch (_) {}
    pushSshTtySize();
    paintTermStatus();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      try { fitAddon.fit(); } catch (_) {}
    });
  }
  wireTermChrome();
}

function copyTermSel() {
  try {
    const t = term && term.getSelection ? term.getSelection() : "";
    if (t && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t);
  } catch (_) {}
}

function pasteTerm() {
  const send = function (t) {
    if (!t) return;
    termGuestWrite(t.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  };
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(send).catch(function () {});
    return;
  }
}

function sendTermLine(line) {
  const s = String(line == null ? "" : line);
  const payload = /[\r\n]$/.test(s) ? s : s + "\n";
  const via = termGuestWrite(payload);
  if (!via) {
    try { term.write(payload.replace(/\n/g, "\r\n")); } catch (_) {}
  }
  return via || "echo";
}

function wireTermChrome() {
  if (wireTermChrome._on) return;
  wireTermChrome._on = true;
  const copy = document.getElementById("term-copy");
  const paste = document.getElementById("term-paste");
  const fit = document.getElementById("term-fit");
  const form = document.getElementById("term-cmd");
  const line = document.getElementById("term-line");
  if (copy) copy.addEventListener("click", copyTermSel);
  if (paste) paste.addEventListener("click", pasteTerm);
  if (fit) fit.addEventListener("click", function () {
    try { fitAddon.fit(); } catch (_) {}
    pushSshTtySize();
    focusLiveTerm();
  });
  if (form && line) {
    const hist = [];
    let histI = 0;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const v = line.value;
      line.value = "";
      if (v.trim()) {
        hist.push(v);
        if (hist.length > 80) hist.shift();
        histI = hist.length;
      }
      sendTermLine(v);
      focusLiveTerm();
    });
    line.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!hist.length) return;
        histI = Math.max(0, histI - 1);
        line.value = hist[histI] || "";
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        histI = Math.min(hist.length, histI + 1);
        line.value = histI >= hist.length ? "" : (hist[histI] || "");
      }
    });
  }
  setInterval(paintTermStatus, 2500);
}

function focusLiveTerm() {
  try { if (term && term.focus) term.focus(); } catch (_) {}
  try {
    const root = document.getElementById("term-stage") || document.getElementById("terminal");
    const ta = root && root.querySelector(".xterm-helper-textarea");
    if (ta) {
      ta.style.left = "0";
      ta.style.top = "0";
      ta.style.width = "100%";
      ta.style.height = "100%";
      ta.style.opacity = "0";
      ta.style.zIndex = "8";
      ta.removeAttribute("disabled");
      ta.readOnly = false;
      ta.focus();
    }
  } catch (_) {}
}

function attachTermView() {
  const stage = document.getElementById("term-stage");
  const termEl = document.getElementById("terminal");
  const tab = document.getElementById("term-tab");
  if (tab) {
    tab.style.transform = "none";
    tab.style.filter = "none";
    tab.style.opacity = "1";
    tab.style.pointerEvents = "auto";
  }
  if (stage && termEl && termEl.parentElement !== stage) stage.appendChild(termEl);
  if (termEl) {
    termEl.classList.add("live");
    termEl.style.pointerEvents = "auto";
  }
  const fit = () => {
    try { if (fitAddon && fitAddon.fit) fitAddon.fit(); } catch (_) {}
    focusLiveTerm();
    pushSshTtySize();
    paintTermStatus();
  };
  fit();
  requestAnimationFrame(() => {
    fit();
    requestAnimationFrame(fit);
  });
  if (stage && !stage._goarFocus) {
    stage._goarFocus = true;
    stage.addEventListener("pointerdown", () => focusLiveTerm());
  }
  markTermReady();
}

function setRunning(on, text) {
  try {
    if (el.running) el.running.classList.toggle('on', !!on);
    if (el.runningText && text) el.runningText.textContent = text;
    if (el.statusMid && text) el.statusMid.textContent = text;
    if (el.host) el.host.classList.toggle('agent-on', !!on);
  } catch (_) {}
}

function send(cmd) {
  sendTermLine(cmd);
}

function sendQuiet(cmd) {
  const body = String(cmd || "").replace(/\s+$/, "");
  termGuestWrite("stty -echo 2>/dev/null\n" + body + "\n" + "stty echo 2>/dev/null\n");
}
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function waitForSerial(patterns, timeoutMs) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const regs = list.map((p) => (p instanceof RegExp ? p : new RegExp(p)));
  const start = Date.now();
  const baseline = (typeof serialBuf !== "undefined" && serialBuf) ? serialBuf.length : 0;
  return new Promise((resolve) => {
    const tick = () => {
      const buf = (typeof serialBuf !== "undefined" && serialBuf) ? serialBuf : ((window.SSH && window.SSH.buf) || "");
      const slice = buf.slice(Math.max(0, baseline - 200));
      for (const r of regs) {
        if (r.test(slice) || r.test(buf.slice(-800))) {
          resolve(true);
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function settingsEnvBody() {
  const s = typeof ensureDefaultSettings === "function" ? ensureDefaultSettings() : {};
  const key = (s.apiKey || "").trim();
  if (!key) return null;
  const base = (s.apiBase || "").replace(/\/+$/, "");
  const model = (s.apiModel || "").trim();
  const lines = [
    "export OPENAI_API_KEY=" + shellQuote(key),
    "export GOAR_API_KEY=" + shellQuote(key),
    "export OPENAI_BASE_URL=" + shellQuote(base),
    "export GOAR_API_URL=" + shellQuote(base),
    "export OPENAI_MODEL=" + shellQuote(model),
    "export GOAR_MODEL=" + shellQuote(model),
    "export GOAR_AUTO_APPROVE=1",
    "export TERM=xterm-256color",
    "export COLORTERM=truecolor",
  ];
  return lines.join("\n") + "\n";
}

try {
  window.sendTermLine = sendTermLine;
  window.focusLiveTerm = focusLiveTerm;
  window.paintTermStatus = paintTermStatus;
  window.settingsEnvBody = settingsEnvBody;
} catch (_) {}
