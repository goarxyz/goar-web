/**
 * GOAR SSH engine — Go WASM, not hand-rolled JS kex.
 *
 *   sshclient-wasm  (VerdigrisTech / npm 0.1.5)
 *     golang.org/x/crypto/ssh compiled to WASM, transport-agnostic
 *   ssh-keygen-wasm (quexten)
 *     client-side RSA / ECDSA / Ed25519
 *   sshterm         (c2FmZQ) — same stack: Go SSH + PTY + SFTP in the browser
 *
 * Transport is the live WISP TCP socket from ssh-plane (cors.manus.space).
 * After login the existing sshExec GOS/GOE framer writes into the PTY.
 */
(function (global) {
  "use strict";

  const SSH_LS_SECRET = "goar_segfault_secret";
  const DEFAULT_USER = "root";
  const DEFAULT_PASS = "segfault";
  const WASM_SSH = "https://cdn.jsdelivr.net/npm/sshclient-wasm@0.1.5/dist/sshclient.wasm";
  const WASM_EXEC = "https://cdn.jsdelivr.net/npm/sshclient-wasm@0.1.5/dist/wasm_exec.js";
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
    if (SSHClientRef) return SSHClientRef;
    if (wasmReady) return wasmReady;
    wasmReady = (async function () {
      if (typeof global.Go !== "function") await loadScript(WASM_EXEC);
      if (typeof global.Go !== "function") throw new Error("wasm_exec.js missing Go()");
      const go = new global.Go();
      const res = await fetch(WASM_SSH, { cache: "force-cache" });
      if (!res.ok) throw new Error("sshclient.wasm " + res.status);
      const buf = await res.arrayBuffer();
      const result = await WebAssembly.instantiate(buf, go.importObject);
      go.run(result.instance);
      const api = global.SSHClient || (global.sshclient && global.sshclient.SSHClient) || global.__SSHCLIENT || null;
      SSHClientRef = api;
      try { global.GOAR_SSH_ENGINE = "go-wasm"; } catch (_) {}
      log("sshclient-wasm ready", !!(api && (api.connect || api.initialize)));
      return api;
    })().catch(function (e) { wasmReady = null; throw e; });
    return wasmReady;
  }

  function wispTransport(sock) {
    const transport = {
      id: "wisp-" + Math.random().toString(36).slice(2, 8),
      connect: async function () {},
      disconnect: async function () { try { sock.close(); } catch (_) {} },
      send: async function (data) {
        sock.write(data instanceof Uint8Array ? data : enc(data));
      },
      handleIncoming: function (data) {
        if (typeof this.injectData === "function") this.injectData(data);
        else if (typeof this.onData === "function") this.onData(data);
      },
      injectData: function (data) {
        if (typeof this.onData === "function") this.onData(data);
      }
    };
    const prevData = sock.ondata;
    const prevClose = sock.onclose;
    sock.ondata = function (chunk) {
      const u8 = chunk instanceof Uint8Array ? chunk : enc(chunk);
      try { if (typeof prevData === "function") prevData(u8); } catch (_) {}
      if (typeof transport.onData === "function") transport.onData(u8);
      if (typeof transport.handleIncoming === "function") transport.handleIncoming(u8);
    };
    sock.onclose = function () {
      try { if (typeof prevClose === "function") prevClose(); } catch (_) {}
      if (typeof transport.onClose === "function") transport.onClose();
    };
    return transport;
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
    const prevOnData = sock.ondata;
    sock.ondata = function (chunk) {
      const u8 = chunk instanceof Uint8Array ? chunk : enc(chunk);
      feed(dec(u8));
      try { if (typeof prevOnData === "function") prevOnData(u8); } catch (_) {}
    };

    const api = await ensureGoSshWasm();
    let session = null;
    if (api && typeof api.initialize === "function") {
      try {
        await api.initialize({ wasmPath: WASM_SSH, wasmExecPath: WASM_EXEC, autoDetect: false, timeout: 20000 });
      } catch (e) { log("initialize", e && e.message ? e.message : e); }
    }
    if (api && typeof api.connect === "function") {
      session = await api.connect(
        { host: host, port: port, user: user, password: pass, timeout: 45000 },
        wispTransport(sock)
      );
    } else if (typeof global.goSshConnect === "function") {
      session = await global.goSshConnect({ sock: sock, host: host, port: port, user: user, password: pass, secret: secret });
    } else {
      throw new Error("sshclient-wasm SSHClient.connect not exported yet");
    }

    function writePlain(s) {
      const u = typeof s === "string" ? enc(s) : s;
      if (session && typeof session.send === "function") return session.send(u);
      sock.write(u);
      return Promise.resolve();
    }
    if (secret) {
      try { await writePlain("export SECRET=" + JSON.stringify(secret) + "\n"); } catch (_) {}
    }
    const setup =
      "stty -echo 2>/dev/null; export HISTCONTROL=ignorespace; unset PROMPT_COMMAND; " +
      "mkdir -p /sec/workspace /root/.scratch /workspace/.scratch 2>/dev/null; " +
      "ln -sfn /sec/workspace /workspace 2>/dev/null || true; " +
      "export PS1='GOAR# '; echo __GOAR_SSH_HELLO__\n";
    await writePlain(setup);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      if (/__GOAR_SSH_HELLO__/.test(plain) || (global.SSH && /__GOAR_SSH_HELLO__/.test(global.SSH.buf || ""))) break;
      await new Promise(function (r) { setTimeout(r, 120); });
    }
    captureSecret(plain);
    log("pty ready", { hello: /__GOAR_SSH_HELLO__/.test(plain), secret: !!(global.SSH && global.SSH.secret) });

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
      session: session
    };
  }

  try {
    global.__GOAR_SSH_DRIVE = driveSsh;
    global.GOAR_SSH_GOWASM = { drive: driveSsh, ensure: ensureGoSshWasm, captureSecret: captureSecret };
    global.GOAR_SSH_ENGINE = global.GOAR_SSH_ENGINE || "go-wasm";
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
