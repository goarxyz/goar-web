/**
 * GOAR SSH engine — Go WASM, not hand-rolled JS kex.
 *
 *   sshclient-wasm  (VerdigrisTech / npm 0.1.5)
 *     golang.org/x/crypto/ssh compiled to WASM, transport-agnostic
 *
 * Transport is the live WISP TCP (or TLS) socket from ssh-plane.
 * Incoming SSH banner/kex bytes must reach WASM unmolested — never decoded
 * as text or drained into a JS buffer before CustomTransport.onData exists.
 * After login the existing sshExec GOS/GOE framer writes into the PTY.
 */
(function (global) {
  "use strict";

  const SSH_LS_SECRET = "goar_segfault_secret";
  const DEFAULT_USER = "root";
  const DEFAULT_PASS = "segfault";
  const WASM_SSH = (typeof goarAssetUrl === "function")
    ? goarAssetUrl("assets/sshclient/sshclient.wasm")
    : "./assets/sshclient/sshclient.wasm";
  const WASM_EXEC = (typeof goarAssetUrl === "function")
    ? goarAssetUrl("assets/sshclient/wasm_exec.js")
    : "./assets/sshclient/wasm_exec.js";
  const WASM_MOD = (typeof goarAssetUrl === "function")
    ? goarAssetUrl("assets/sshclient/index.esm.js")
    : "./assets/sshclient/index.esm.js";
  const KEYGEN_WRAP = "https://cdn.jsdelivr.net/gh/quexten/ssh-keygen-wasm@main/wrapper.js";

  function enc(s) {
    return new TextEncoder().encode(String(s == null ? "" : s));
  }
  function dec(u8) {
    return new TextDecoder("utf-8", { fatal: false }).decode(u8 instanceof Uint8Array ? u8 : new Uint8Array(0));
  }
  function log() {
    try { console.log.apply(console, ["[goar-ssh-gowasm]"].concat([].slice.call(arguments))); } catch (_) {}
  }
  function readSecret() {
    try { return localStorage.getItem(SSH_LS_SECRET) || ""; } catch (_) { return ""; }
  }
  function storeSecret(secret) {
    secret = String(secret || "").trim();
    if (!secret) return;
    try { localStorage.setItem(SSH_LS_SECRET, secret); } catch (_) {}
    try { if (global.SSH) global.SSH.secret = secret; } catch (_) {}
  }
  function captureSecret(text) {
    const s = String(text || "");
    const pats = [
      /SetEnv\s+SECRET=([A-Za-z0-9+/=_\-]{8,})/i,
      /SECRET\s*=\s*([A-Za-z0-9+/=_\-]{8,})/,
      /Your SECRET is:?\s+([A-Za-z0-9+/=_\-]{8,})/i,
      /reconnect[^\n]{0,120}SECRET=([A-Za-z0-9+/=_\-]{8,})/i
    ];
    for (let i = 0; i < pats.length; i++) {
      const m = s.match(pats[i]);
      if (m && m[1]) { storeSecret(m[1]); return m[1]; }
    }
    return "";
  }

  let wasmReady = null;
  let SSHClientRef = null;
  let ModRef = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (typeof document === "undefined") return reject(new Error("no document"));
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error("script " + src)); };
      document.head.appendChild(s);
    });
  }

  async function ensureGoSshWasm() {
    if (ModRef && SSHClientRef) return SSHClientRef;
    if (wasmReady) return wasmReady;
    wasmReady = (async function () {
      const url = WASM_MOD || "./assets/sshclient/index.esm.js";
      const mod = await import(url);
      ModRef = mod;
      const Client = mod.SSHClient || mod.default;
      if (!Client || typeof Client.initialize !== "function") throw new Error("sshclient-wasm module has no SSHClient");
      await Client.initialize({ wasmPath: WASM_SSH, wasmExecPath: WASM_EXEC, autoDetect: false, timeout: 25000, cacheBusting: false });
      SSHClientRef = Client;
      try { global.GOAR_SSH_ENGINE = "go-wasm"; } catch (_) {}
      log("sshclient-wasm ready", true);
      return Client;
    })().catch(function (e) { wasmReady = null; throw e; });
    return wasmReady;
  }

  /**
   * Bridge a GOAR WISP/epoxy socket into sshclient-wasm CustomTransport.
   *
   * SSHClient.connect() order is: createTransport (assigns onData) THEN
   * transport.connect(). Banner bytes often already sit in sock._hold.
   * Buffer until onData exists, then flush — never decode as UTF-8.
   */
  function wispTransport(sock) {
    const pending = [];
    let sink = null;

    function deliver(chunk) {
      const u8 = chunk instanceof Uint8Array ? chunk.slice() : enc(chunk);
      if (!u8.length) return;
      if (typeof sink === "function") sink(u8);
      else pending.push(u8);
    }

    function attachSink(fn) {
      sink = fn;
      while (pending.length && sink) sink(pending.shift());
    }

    const prevData = sock.ondata;
    sock.ondata = function (chunk) {
      try { if (typeof prevData === "function") prevData(chunk); } catch (_) {}
      deliver(chunk);
    };

    const Custom = ModRef && ModRef.CustomTransport;
    const id = "wisp-" + Math.random().toString(36).slice(2, 8);

    function bindOnData(t) {
      attachSink(function (u8) {
        try {
          if (typeof t.onData === "function") t.onData(u8);
          else if (typeof t.injectData === "function") t.injectData(u8);
          else pending.push(u8);
        } catch (e) {
          log("inject", e && e.message ? e.message : e);
        }
      });
    }

    if (typeof Custom === "function") {
      const t = new Custom(
        id,
        async function () { bindOnData(t); },
        async function () { try { sock.close(); } catch (_) {} },
        async function (data) {
          const d = data instanceof Uint8Array ? data.slice() : enc(data);
          const r = sock.write(d);
          if (r && typeof r.then === "function") await r;
        }
      );
      let _onData = t.onData;
      try {
        Object.defineProperty(t, "onData", {
          configurable: true,
          enumerable: true,
          get: function () { return _onData; },
          set: function (fn) {
            _onData = fn;
            bindOnData(t);
          }
        });
      } catch (_) {}
      const prevClose = sock.onclose;
      sock.onclose = function () {
        try { if (typeof prevClose === "function") prevClose(); } catch (_) {}
        try { if (typeof t.onClose === "function") t.onClose(); } catch (_) {}
      };
      return t;
    }

    const transport = {
      id: id,
      connect: async function () { bindOnData(transport); },
      disconnect: async function () { try { sock.close(); } catch (_) {} },
      send: async function (data) {
        const d = data instanceof Uint8Array ? data.slice() : enc(data);
        const r = sock.write(d);
        if (r && typeof r.then === "function") await r;
      },
      injectData: function (data) { deliver(data); },
      onData: null
    };
    let _od = null;
    try {
      Object.defineProperty(transport, "onData", {
        configurable: true,
        enumerable: true,
        get: function () { return _od; },
        set: function (fn) { _od = fn; bindOnData(transport); }
      });
    } catch (_) {}
    const prevClose = sock.onclose;
    sock.onclose = function () {
      try { if (typeof prevClose === "function") prevClose(); } catch (_) {}
      try { if (typeof transport.onClose === "function") transport.onClose(); } catch (_) {}
    };
    return transport;
  }

  function mostlyPrintable(t) {
    if (!t) return false;
    let ok = 0;
    const n = Math.min(t.length, 400);
    for (let i = 0; i < n; i++) {
      const c = t.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 160) ok++;
    }
    return ok / n >= 0.78;
  }

  function printableRuns(t) {
    let out = "";
    let run = "";
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || c === 0x1b || (c >= 32 && c < 127)) run += t.charAt(i);
      else {
        if (run.length >= 3) out += run;
        run = "";
      }
    }
    if (run.length >= 3) out += run;
    return out;
  }

  function packetText(data, meta) {
    let u8 = null;
    if (data instanceof Uint8Array) u8 = data;
    else if (data && data.buffer) u8 = new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length || 0);
    else if (data && data.payload) u8 = data.payload instanceof Uint8Array ? data.payload : null;
    if (!u8 || !u8.length) return "";
    const kind = String((meta && (meta.packetType || meta.type)) || "");
    const t = dec(u8);
    /* StartShell stdout/stderr is tagged type:"data". Interceptor packets
       have no type — they are raw SSH (kex, encrypted CHANNEL_DATA). */
    const pty = kind === "data";
    if (pty) {
      if (t.indexOf("SSH-") === 0 && t.length < 96) return "";
      return t;
    }
    if (/kex|newkeys|ident|service|userauth|ignore|debug|unimplemented/i.test(kind)) return "";
    if (t.indexOf("SSH-") === 0) return "";
    if (/diffie-hellman-group|ecdsa-sha2-nistp|curve25519-sha256|rsa-sha2-256|ssh-ed25519/.test(t) &&
        !/Continuing in|Press any key/.test(t)) return "";
    if (/Continuing in|Press any key to continue|SECRET=|__GOAR_SSH_HELLO__|Creating Server|DISCLAIMER|SetEnv SECRET/.test(t)) {
      const runs = printableRuns(t);
      return runs.length > 8 ? runs : t;
    }
    return "";
  }

  async function driveSsh(ctx) {
    ctx = ctx || {};
    const sock = ctx.sock;
    if (!sock || typeof sock.write !== "function") throw new Error("ssh-go-wasm: no socket");
    const user = ctx.user || DEFAULT_USER;
    const pass = ctx.password || DEFAULT_PASS;
    const secret = ctx.secret || readSecret();
    const host = ctx.host || "segfault.net";
    const port = Number(ctx.port) || 443;

    let plain = "";
    function feed(s) {
      if (!s) return;
      plain += s;
      if (plain.length > 240000) plain = plain.slice(-160000);
      captureSecret(s);
      if (!ctx.quiet) {
        try {
          if (global.SSH) {
            global.SSH.buf = (global.SSH.buf || "") + s;
            if (global.SSH.buf.length > 240000) global.SSH.buf = global.SSH.buf.slice(-160000);
          }
        } catch (_) {}
      }
      try { if (!ctx.quiet && typeof term !== "undefined" && term && term.write) term.write(s.replace(/\n/g, "\r\n")); } catch (_) {}
    }

    const api = await ensureGoSshWasm();
    const transport = wispTransport(sock);
    let session = null;
    if (api && typeof api.connect !== "function") {
      throw new Error("sshclient-wasm SSHClient.connect not exported yet");
    }
    log("connect", host, port, user, secret ? "secret" : "new");
    const opts = { host: host, port: port, user: user, password: pass, timeout: 90000 };
    if (secret) opts.env = { SECRET: secret };
    let pktN = 0;
    session = await api.connect(
      opts,
      transport,
      {
        onStateChange: function (st) { log("state", st); },
        onPacketReceive: function (data, meta) {
          const t = packetText(data, meta);
          if (pktN < 16) {
            pktN += 1;
            const kind = meta && (meta.type || meta.packetType) || "";
            log("pkt", pktN, kind || "raw", data && data.length, (t || "").slice(0, 72).replace(/\r/g, "\\r"));
          }
          if (t) feed(t);
        }
      }
    );

    function writePlain(s) {
      const u = typeof s === "string" ? enc(s) : s;
      if (session && typeof session.send === "function") return session.send(u);
      sock.write(u);
      return Promise.resolve();
    }

    function dump() {
      return plain + ((global.SSH && global.SSH.buf) || "");
    }
    function sleep(ms) {
      return new Promise(function (r) { setTimeout(r, ms); });
    }
    const CONFIRM_RE = /Press any key to continue|you have 10 seconds/i;
    const COUNTDOWN_RE = /Continuing in\s+\d+\s+sec/i;
    const DEAD_RE = /Could not get lock|destructor/i;
    const SHELL_RE = /(?:__GOAR_SSH_HELLO__|(?:^|\n)(?:root@|segfault|lsd-)[^\n]*[#$]|\bGOAR#)/;
    const CREATED_RE = /Creating Server|Your SECRET|SetEnv SECRET/i;
    const PROMPT_RE = /(?:^|\n)(?:root@|lsd-|segfault)[^\n]*[#$]/;
    const HELLO_RE = /(?:^|\r|\n)__GOAR_SSH_HELLO__(?:\r|\n|$)/;

    function tail(n) {
      const s = dump();
      return s.slice(-(n || 1600));
    }
    function markConfirm(extra) {
      try {
        global.__GOAR_SSH_CONFIRM = Object.assign({
          keyed: keyed,
          sawCountdown: sawCountdown,
          elapsed: Date.now() - tLogin,
          n: plain.length,
          tail: tail(240).replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".")
        }, extra || {});
      } catch (_) {}
    }

    /* sshclient-wasm only RequestPty+Shell on the first session.send.
       Empty write starts the PTY without typing into the MOTD. */
    log("start PTY");
    try { await writePlain(new Uint8Array(0)); } catch (e) {
      log("start PTY", e && e.message ? e.message : e);
    }
    try {
      if (session && typeof session.resizeTerminal === "function") {
        await session.resizeTerminal(120, 36);
      }
    } catch (_) {}
    await sleep(200);

    /* Segfault free tier: MOTD, then "Continuing in N sec...", then
       "Press any key to continue (you have 10 seconds)."
       Countdown starts AFTER the banner, not at TCP connect.
       Do not type anything until that 10s prompt. */
    const tLogin = Date.now();
    let keyed = false;
    let sawCountdown = false;
    let overlaySeen = false;
    const hadSecret = !!secret;
    const setup =
      "stty -echo 2>/dev/null; export HISTCONTROL=ignorespace; unset PROMPT_COMMAND; " +
      "mkdir -p /sec/workspace /root/.scratch /workspace/.scratch 2>/dev/null; " +
      "ln -sfn /sec/workspace /workspace 2>/dev/null || true; " +
      "export PS1='GOAR# '; echo __GOAR_SSH_HELLO__\n";
    let hello = false;
    let helloSentAt = 0;
    let helloFirstSent = 0;
    let encfsAt = 0;
    function lastIdx(re, s) {
      let last = -1, m;
      const r = new RegExp(re.source, "gi");
      while ((m = r.exec(s))) last = m.index;
      return last;
    }
    markConfirm({ phase: "wait-motd" });
    while (Date.now() - tLogin < 150000 && !hello) {
      const t = tail(4000);
      const tip = tail(280);
      captureSecret(dump());
      const elapsed = Date.now() - tLogin;
      const iEnc = lastIdx(/Can't reach EncFSD/i, t);
      const iCount = lastIdx(COUNTDOWN_RE, t);
      const iConf = lastIdx(CONFIRM_RE, t);
      const iCreate = lastIdx(/Creating Server/i, t);
      const pastMotd = (iEnc >= 0 && iEnc >= iCount && iEnc >= iConf) ||
        (iCreate >= 0 && iCreate >= iCount && iCreate >= iConf && iEnc < 0);
      if (DEAD_RE.test(t)) {
        markConfirm({ phase: "dead", elapsed: elapsed });
        throw new Error("segfault confirm missed (destructor/lock) after " + elapsed + "ms");
      }
      if (!pastMotd && CONFIRM_RE.test(tip) && !keyed) {
        keyed = true;
        log("confirm prompt @", elapsed, "ms — key within 10s");
        markConfirm({ phase: "key", elapsed: elapsed });
        try { await writePlain(" "); } catch (_) {}
        await sleep(180);
        continue;
      }
      if (!pastMotd && COUNTDOWN_RE.test(tip) && !keyed) {
        if (!sawCountdown) log("countdown", elapsed, "ms");
        sawCountdown = true;
        markConfirm({ phase: "countdown", elapsed: elapsed });
        await sleep(80);
        continue;
      }
      if (iEnc >= 0 && iEnc >= iCount && iEnc >= iConf) {
        if (!encfsAt) {
          encfsAt = Date.now();
          overlaySeen = true;
          keyed = true;
          markConfirm({ phase: "encfs-wait", elapsed: elapsed });
        }
        if (Date.now() - encfsAt < 5000 && iCount > iEnc) {
          keyed = false;
          encfsAt = 0;
          markConfirm({ phase: "countdown", elapsed: elapsed });
          await sleep(80);
          continue;
        }
      }
      if (iCreate >= 0) overlaySeen = true;
      if (HELLO_RE.test(dump())) {
        hello = true;
        break;
      }
      const quiet = pastMotd || (!COUNTDOWN_RE.test(tip) && !CONFIRM_RE.test(tip));
      const havePrompt = /lsd-|root@|GOAR#|Your SECRET|SetEnv SECRET/.test(t);
      if (quiet && keyed && (havePrompt || overlaySeen || pastMotd) && elapsed > 4000) {
        if (!helloSentAt || Date.now() - helloSentAt > 8000) {
          helloSentAt = Date.now();
          if (!helloFirstSent) helloFirstSent = helloSentAt;
          markConfirm({ phase: "hello", elapsed: elapsed });
          const liveSecret0 = readSecret() || (global.SSH && global.SSH.secret) || secret;
          if (liveSecret0) {
            try { await writePlain("export SECRET=" + JSON.stringify(liveSecret0) + "\n"); } catch (_) {}
          }
          try { await writePlain(setup); } catch (_) {}
        }
      }
      if (pastMotd && helloFirstSent && Date.now() - helloFirstSent > 9000 && Date.now() - helloFirstSent < 11000) {
        try { await writePlain("\x03\n \n"); } catch (_) {}
      }
      if (pastMotd && helloFirstSent && Date.now() - helloFirstSent > 18000 && !HELLO_RE.test(dump())) {
        markConfirm({ phase: "encfs-dead", elapsed: elapsed });
        throw new Error("segfault EncFSD/no shell after setup — reconnecting");
      }
      if (!sawCountdown && !COUNTDOWN_RE.test(tip) && SHELL_RE.test(t) && elapsed > 10000) {
        log("shell without confirm", { elapsed: elapsed });
        markConfirm({ phase: "shell-no-confirm", elapsed: elapsed });
        keyed = true;
        overlaySeen = true;
      }
      await sleep(100);
    }
    if (!hello) {
      markConfirm({ phase: "no-hello", elapsed: Date.now() - tLogin });
      throw new Error("SSH session up but no PTY hello from " + host + ":" + port);
    }
    markConfirm({ phase: "confirmed", elapsed: Date.now() - tLogin });
    captureSecret(plain);
    log("pty ready", { hello: hello, secret: !!(global.SSH && global.SSH.secret), n: plain.length });
    try { if (global.SSH) global.SSH.hello = true; } catch (_) {}
    const liveSecret = readSecret() || (global.SSH && global.SSH.secret) || secret;
    if (liveSecret) {
      try { await writePlain("export SECRET=" + JSON.stringify(liveSecret) + "\n"); } catch (_) {}
    }

    try {
      global.GOAR_SSH_KEYGEN = global.GOAR_SSH_KEYGEN || {
        generate: async function (type) {
          type = type || "ed25519";
          if (typeof global.generatePrivateKey === "function") return global.generatePrivateKey(type);
          try { await loadScript(KEYGEN_WRAP); } catch (_) {}
          if (typeof global.generatePrivateKey === "function") return global.generatePrivateKey(type);
          return "";
        }
      };
    } catch (_) {}

    return {
      ready: true,
      engine: "go-wasm",
      write: function (s) { writePlain(s).catch(function (e) { log("write", e && e.message ? e.message : e); }); },
      incoming: function () { return enc(plain); },
      sock: sock,
      session: session,
      close: function () {
        try { if (session && session.disconnect) session.disconnect(); } catch (_) {}
        try { sock.close(); } catch (_) {}
      }
    };
  }

  try {
    global.__GOAR_SSH_DRIVE = driveSsh;
    global.GOAR_SSH_GOWASM = { drive: driveSsh, ensure: ensureGoSshWasm, captureSecret: captureSecret };
    global.GOAR_SSH_ENGINE = global.GOAR_SSH_ENGINE || "go-wasm";
  } catch (_) {}

  ensureGoSshWasm().catch(function (e) {
    log("preload", e && e.message ? e.message : e);
  });
})(typeof window !== "undefined" ? window : globalThis);
