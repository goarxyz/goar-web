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
  } catch (_) {}
}

function initTerm() {
  if (typeof Terminal === "undefined") throw new Error("terminal failed to load");
  term = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    fontSize: 13,
    lineHeight: 1.2,
    theme: {
      background: "#050505", foreground: "#f2f2f2", cursor: "#f2f2f2", cursorAccent: "#050505",
      selectionBackground: "#ffffff22",
      black:"#050505", red:"#b8b8b8", green:"#f2f2f2", yellow:"#d0d0d0",
      blue:"#9a9a9a", magenta:"#c8c8c8", cyan:"#aeaeae", white:"#f2f2f2",
      brightBlack:"#4d4d4d", brightRed:"#d0d0d0", brightGreen:"#ffffff", brightYellow:"#e8e8e8",
      brightBlue:"#c0c0c0", brightMagenta:"#eeeeee", brightCyan:"#d8d8d8", brightWhite:"#fff",
    },
    scrollback: 10000,
    convertEol: true,
    allowProposedApi: true,
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
  // xterm → serial: Linux line discipline wants LF; map CR→LF
  let _typed = "";
  term.onData((data) => {
    if (typeof sshReady === "function" && sshReady() && typeof sshWrite === "function") {
      try { sshWrite(data); } catch (_) {}
      return;
    }
    if (typeof ensureSsh === "function") {
      try {
        ensureSsh({ reason: "term" }).then(function (st) {
          if (st && st.ready && typeof sshWrite === "function") {
            try { sshWrite(data); } catch (_) {}
          }
        }).catch(function () {});
      } catch (_) {}
    }
    if (window.__GOAR_UNIX && typeof unixOnData === "function") {
      unixOnData(data);
      return;
    }
    const emu = emulator || window.__emulator;
    const send = window.__serialSend || (emu && function (s) { emu.serial0_send(s); });
    if (!send) return;
    if (data === "\r" || data === "\n") {
      const line = _typed.trim();
      _typed = "";
      const pip = line.match(/^(?:sudo\s+)?(?:python3?\s+-m\s+)?pip3?\s+install\s+(.+)$/i);
      if (pip && typeof guestPipInstall === "function") {
        try { send("\u0003"); } catch (_) {}
        try { term.write("\r\n\x1b[90minstalling " + pip[1].trim() + " …\x1b[0m\r\n"); } catch (_) {}
        guestPipInstall(pip[1].trim()).then(function (r) {
          const body = String((r && (r.output || r.error)) || JSON.stringify(r) || "").replace(/\n/g, "\r\n");
          try {
            term.write((r && r.ok ? "\x1b[32m" : "\x1b[31m") + (r && r.via ? r.via : "") + "\x1b[0m\r\n");
            term.write(body.slice(0, 6000) + "\r\n");
          } catch (_) {}
          try { send("\r"); } catch (_) {}
        }).catch(function (e) {
          try { term.write("\x1b[31m" + String(e && e.message ? e.message : e) + "\x1b[0m\r\n"); } catch (_) {}
          try { send("\r"); } catch (_) {}
        });
        return;
      }
    } else if (data === "\u007f" || data === "\b") {
      _typed = _typed.slice(0, -1);
    } else if (data === "\u0003" || data === "\u0015") {
      _typed = "";
    } else if (data.length === 1 && data >= " ") {
      _typed += data;
    } else if (data.length > 1 && data.indexOf("\x1b") < 0) {
      _typed += data;
    }
    try {
      send(String(data).replace(/\r\n/g, "\r").replace(/\n/g, "\r"));
    } catch (_) {}
  });
  // Push geometry to guest TTY when xterm resizes
  let _ttySized = false;
  const pushTtySize = () => {
    if (_ttySized || !emulator || !term) return;
    try {
      const c = term.cols | 0, r = term.rows | 0;
      if (c > 0 && r > 0) {
        _ttySized = true;
        const cmd = "stty -echo 2>/dev/null; stty cols " + c + " rows " + r
          + " 2>/dev/null; export COLUMNS=" + c + " LINES=" + r + "; stty echo 2>/dev/null";
        emulator.serial0_send(cmd + "\n");
      }
    } catch (_) {}
  };
  window.__pushTtySize = pushTtySize;
  const host = document.getElementById("term-stage") || termMount;
  if (host && host.addEventListener) host.addEventListener("pointerdown", focusLiveTerm);
  window.addEventListener("resize", () => {
    try { fitAddon.fit(); } catch (_) {}
    /* no stty spam */
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      try { fitAddon.fit(); } catch (_) {}
      /* no stty spam */
    });
  }
  // expose for post-boot
  window.__pushTtySize = pushTtySize;
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
  };
  fit();
  requestAnimationFrame(() => {
    fit();
    requestAnimationFrame(fit);
  });
  try {
    if (typeof sshReady === "function" && sshReady() && typeof sshWrite === "function") {
      sshWrite("stty echo 2>/dev/null; export PS1='GOAR# '\n");
    } else if (typeof ensureSsh === "function") {
      ensureSsh({ reason: "term" }).catch(function () {});
    }
  } catch (_) {}
  if (stage && !stage._goarFocus) {
    stage._goarFocus = true;
    stage.addEventListener("pointerdown", () => focusLiveTerm());
  }
  try {
    const up = (typeof envReady !== "undefined" && envReady) || window.__GOAR_ENV_READY || window.__emulator || window.__GOAR_UNIX;
    if (up && typeof markTermReady === "function") markTermReady();
    if (up && window.__GOAR_UNIX) {
      if (!window.__GOAR_TERM_HINT && term && term.write) {
        window.__GOAR_TERM_HINT = true;
      }
      return;
    }
    if (up && typeof markTermReady === "function") markTermReady();
    if (up && typeof fixGuestTty === "function") {
      window.__ttyFixed = false;
      fixGuestTty();
    }
    try {
      const emu = window.__emulator || (typeof emulator !== "undefined" ? emulator : null);
      if (emu && emu.serial0_send) {
        emu.serial0_send("stty sane echo icanon icrnl opost onlcr 2>/dev/null; echo\n");
      }
    } catch (_) {}
    if (up && !window.__GOAR_TERM_HINT && term && term.write) {
      window.__GOAR_TERM_HINT = true;
      term.write("\r\n\x1b[90munix  ·  python3  ·  pip install <pkg>\x1b[0m\r\n");
    }
    if (up && typeof ensureGuestNet === "function" && !window.__GOAR_TERM_NET) {
      window.__GOAR_TERM_NET = true;
      ensureGuestNet().catch(function () {});
    }
  } catch (_) {}
}


/** One-shot guest TTY repair over serial (job control + size) */
function fixGuestTty() {
  if (!emulator || window.__ttyFixed) return;
  window.__ttyFixed = true;
  try {
    const c = (term && term.cols) || 100;
    const r = (term && term.rows) || 30;
    const cmd = "stty -echo 2>/dev/null; stty sane cols " + c + " rows " + r
      + " 2>/dev/null; export TERM=xterm-256color COLUMNS=" + c + " LINES=" + r
      + "; stty echo 2>/dev/null; echo [goar-seq] tty-ok";
    emulator.serial0_send(cmd + "\n");
  } catch (_) {}
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
  if (!emulator) return;
  try {
    const s = /[\r\n]$/.test(cmd) ? cmd.replace(/\n/g, "\r") : cmd + "\r";
    if (typeof emulator.serial0_send === "function") emulator.serial0_send(s);
  } catch (_) {}
}

/** Host automation: hide command echo on guest TTY */
function sendQuiet(cmd) {
  if (!emulator) return;
  const body = cmd.endsWith("\n") ? cmd.slice(0, -1) : cmd;
  try {
    emulator.serial0_send("stty -echo 2>/dev/null\n");
    emulator.serial0_send(body + "\r");
    emulator.serial0_send("stty echo 2>/dev/null\n");
  } catch (_) {}
}
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function waitForSerial(patterns, timeoutMs) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const regs = list.map((p) => (p instanceof RegExp ? p : new RegExp(p)));
  const start = Date.now();
  const baseline = serialBuf.length;
  return new Promise((resolve) => {
    const tick = () => {
      const slice = serialBuf.slice(Math.max(0, baseline - 200));
      for (const r of regs) {
        if (r.test(slice) || r.test(serialBuf.slice(-800))) {
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
  const s = ensureDefaultSettings();
  const key = (s.apiKey || "").trim();
  if (!key) return null;
  const base = (s.apiBase || DEFAULTS.apiBase).replace(/\/+$/, "");
  const model = (s.apiModel || DEFAULTS.apiModel).trim();
  const dnsMap = window.__GOAR_DNS_MAP || s.dnsMap || "";
  // Fully OpenAI-compatible env — works with NIM, OpenAI, Groq, OpenRouter, custom, ...
  const lines = [
    "export OPENAI_API_KEY=" + shellQuote(key),
    "export GOAR_API_KEY=" + shellQuote(key),
    "export OPENAI_BASE_URL=" + shellQuote(base),
    "export GOAR_API_URL=" + shellQuote(base),
    "export OPENAI_MODEL=" + shellQuote(model),
    "export GOAR_MODEL=" + shellQuote(model),
    "export GOAR_AUTO_APPROVE=1",
    "export GOAR_OPERATOR_CORE=1",
    "export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt",
    "export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt",
    "export CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt",
    "export PYTHONPATH=/usr/lib/python3.11/site-packages",
    "export PYTHONUNBUFFERED=1",
    "export PIP_BREAK_SYSTEM_PACKAGES=1",
    "export TERM=xterm-256color",
    "export COLORTERM=truecolor",
    "export COLUMNS=100",
    "export LINES=30",
    "export GOAR_WORKDIR=/workspace",
    "export GOAR_CONFIG_DIR=/opt/goar",
    "unset GOAR_PROXY_LIST",
  ];
  // NVIDIA aliases only when using NIM
  if (/nvidia\.com/i.test(base) || key.startsWith("nvapi-")) {
    lines.push("export NVIDIA_API_KEY=" + shellQuote(key));
    lines.push("export NGC_API_KEY=" + shellQuote(key));
  }
  if (dnsMap) lines.push("export GOAR_DNS_MAP=" + shellQuote(dnsMap));
  return lines.join("\n") + "\n";
}





/* Parse custom DNS: NextDNS id, DoH URL, or comma-separated IPs */
