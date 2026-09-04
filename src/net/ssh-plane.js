/**
 * GOAR SSH plane — agent-owned persistent Kali at segfault.net.
 *
 * Boot connects before chat. SECRET stays in this browser's localStorage.
 * All guest tools should hop through sshExec (see guest-exec.js).
 *
 * Transport: WISP v1/v2 over the existing cors.manus.space fabric.
 * Protocol: SSH-2 password session + PTY shell, commands framed with GOS/GOE.
 */
(function (global) {
  "use strict";

  const SSH_LS_SECRET = "goar_segfault_secret";
  const SSH_LS_HOSTKEY = "goar_segfault_hostkey";
  const DEFAULT_HOST = "segfault.net";
  const DEFAULT_USER = "root";
  const DEFAULT_PASS = "segfault";
  const DEFAULT_PORTS = [443, 22];

  const SSH = {
    ready: false,
    connecting: null,
    lastError: "",
    host: DEFAULT_HOST,
    user: DEFAULT_USER,
    port: 0,
    secret: "",
    banner: "",
    wispUrl: "",
    startedAt: 0,
    lastExecAt: 0,
    reconnects: 0,
    drops: 0,
    execs: 0,
    buf: "",
    raw: new Uint8Array(0),
    sock: null,
    mux: null,
    termEcho: true,
    queue: Promise.resolve(),
  };

  function enc(s) {
    return new TextEncoder().encode(String(s == null ? "" : s));
  }
  function dec(u8) {
    return new TextDecoder().decode(u8);
  }
  function now() {
    return Date.now();
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function concat(a, b) {
    const o = new Uint8Array(a.length + b.length);
    o.set(a, 0);
    o.set(b, a.length);
    return o;
  }
  function log() {
    try {
      console.log.apply(console, ["[goar-ssh]"].concat([].slice.call(arguments)));
    } catch (_) {}
  }

  function readSecret() {
    try {
      const s = localStorage.getItem(SSH_LS_SECRET);
      if (s) return String(s).trim();
    } catch (_) {}
    return "";
  }
  function writeSecret(secret) {
    secret = String(secret || "").trim();
    if (!secret) return;
    SSH.secret = secret;
    try {
      localStorage.setItem(SSH_LS_SECRET, secret);
    } catch (_) {}
  }
  function captureSecret(text) {
    const s = String(text || "");
    const pats = [
      /SECRET\s*=\s*([A-Za-z0-9+/=_\-]{8,})/,
      /Your SECRET is:?\s+([A-Za-z0-9+/=_\-]{8,})/i,
      /reconnect[^\n]{0,80}SECRET=([A-Za-z0-9+/=_\-]{8,})/i,
    ];
    for (let i = 0; i < pats.length; i++) {
      const m = s.match(pats[i]);
      if (m && m[1]) {
        writeSecret(m[1]);
        return m[1];
      }
    }
    return "";
  }

  function resolveWisp() {
    try {
      if (typeof resolveWispUrl === "function") {
        const u = resolveWispUrl();
        if (u) return u;
      }
    } catch (_) {}
    try {
      if (global.MW_FABRIC && MW_FABRIC.wispUrl) return MW_FABRIC.wispUrl;
    } catch (_) {}
    try {
      const s = localStorage.getItem("goar_wisp_url");
      if (s) return s;
    } catch (_) {}
    return "wss://cors.manus.space/wisp/";
  }

  /* ── WISP mux ────────────────────────────────────── */
  function packWisp(type, streamId, payload) {
    payload = payload || new Uint8Array(0);
    const out = new Uint8Array(5 + payload.length);
    out[0] = type;
    const v = new DataView(out.buffer);
    v.setUint32(1, streamId >>> 0, true);
    if (payload.length) out.set(payload, 5);
    return out;
  }

  function openWispMux(url) {
    return new Promise((resolve, reject) => {
      let ws;
      const streams = new Map();
      let nextId = 1;
      let opened = false;
      const mux = {
        url: url,
        ws: null,
        alive: false,
        openTcp: null,
        close: null,
      };
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => {
        if (!opened) {
          try {
            ws.close();
          } catch (_) {}
          reject(new Error("wisp timeout " + url));
        }
      }, 8000);
      ws.onopen = function () {
        opened = true;
        mux.alive = true;
        mux.ws = ws;
        clearTimeout(timer);
        resolve(mux);
      };
      ws.onerror = function () {
        if (!opened) {
          clearTimeout(timer);
          reject(new Error("wisp error " + url));
        }
      };
      ws.onclose = function () {
        mux.alive = false;
        streams.forEach(function (s) {
          try {
            if (s.onclose) s.onclose();
          } catch (_) {}
        });
        streams.clear();
        if (!opened) {
          clearTimeout(timer);
          reject(new Error("wisp closed " + url));
        }
      };
      ws.onmessage = function (ev) {
        const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data;
        if (!buf || buf.length < 5) return;
        const type = buf[0];
        const id = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(1, true);
        const payload = buf.subarray(5);
        if (type === 0x05) return; // INFO (v2)
        const s = streams.get(id);
        if (!s) return;
        if (type === 0x02 && s.ondata) s.ondata(payload);
        if (type === 0x03) s.window = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
        if (type === 0x04) {
          streams.delete(id);
          if (s.onclose) s.onclose(payload[0]);
        }
      };
      mux.close = function () {
        mux.alive = false;
        try {
          ws.close();
        } catch (_) {}
      };
      mux.openTcp = function (host, port) {
        const id = nextId++;
        const hostU8 = enc(host);
        const pl = new Uint8Array(1 + 2 + hostU8.length);
        pl[0] = 0x01; // TCP
        new DataView(pl.buffer).setUint16(1, port, true);
        pl.set(hostU8, 3);
        const sock = {
          id: id,
          host: host,
          port: port,
          open: true,
          window: 0,
          ondata: null,
          onclose: null,
          write: function (u8) {
            if (!mux.alive || !sock.open) throw new Error("tcp closed");
            ws.send(packWisp(0x02, id, u8 instanceof Uint8Array ? u8 : enc(u8)));
          },
          close: function () {
            if (!sock.open) return;
            sock.open = false;
            try {
              ws.send(packWisp(0x04, id, new Uint8Array([0x01])));
            } catch (_) {}
            streams.delete(id);
          },
        };
        streams.set(id, sock);
        ws.send(packWisp(0x01, id, pl));
        return sock;
      };
    });
  }

  /* ── SSH packet helpers (cleartext / post-NEWKEYS AES-CTR + HMAC-SHA256) ── */
  function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0);
    return b;
  }
  function mpintFromBytes(u8) {
    let i = 0;
    while (i < u8.length - 1 && u8[i] === 0) i++;
    let body = u8.subarray(i);
    if (body.length && body[0] & 0x80) {
      const p = new Uint8Array(body.length + 1);
      p.set(body, 1);
      body = p;
    }
    const out = new Uint8Array(4 + body.length);
    new DataView(out.buffer).setUint32(0, body.length);
    out.set(body, 4);
    return out;
  }
  function sshString(s) {
    const u = typeof s === "string" ? enc(s) : s;
    const out = new Uint8Array(4 + u.length);
    new DataView(out.buffer).setUint32(0, u.length);
    out.set(u, 4);
    return out;
  }
  function sshNameList(list) {
    return sshString(list.join(","));
  }
  function readU32(buf, off) {
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(off);
  }
  function readStr(buf, off) {
    const n = readU32(buf, off);
    return { value: buf.subarray(off + 4, off + 4 + n), next: off + 4 + n };
  }

  function buildPacket(payload, block) {
    block = block || 8;
    const padLen = block - ((payload.length + 5) % block);
    const pad = padLen < 4 ? padLen + block : padLen;
    const packetLen = 1 + payload.length + pad;
    const out = new Uint8Array(4 + packetLen);
    new DataView(out.buffer).setUint32(0, packetLen);
    out[4] = pad;
    out.set(payload, 5);
    if (global.crypto && crypto.getRandomValues) crypto.getRandomValues(out.subarray(5 + payload.length));
    return out;
  }

  function parseBanner(u8) {
    const t = dec(u8);
    const m = t.match(/SSH-2\.0-[^\r\n]+/);
    return m ? m[0] : "";
  }

  /* Minimal SSH-2 client: version + kexinit probe + password/session if possible.
     If crypto negotiation fails we still expose the TCP + banner so boot can report. */
  async function sha256(u8) {
    const d = await crypto.subtle.digest("SHA-256", u8);
    return new Uint8Array(d);
  }

  function kexInitPayload() {
    const cookie = new Uint8Array(16);
    try {
      crypto.getRandomValues(cookie);
    } catch (_) {}
    const parts = [new Uint8Array([20]), cookie]; // SSH_MSG_KEXINIT
    const lists = [
      ["diffie-hellman-group14-sha256", "curve25519-sha256"],
      ["rsa-sha2-256", "rsa-sha2-512", "ssh-ed25519", "ssh-rsa"],
      ["aes128-ctr", "aes256-ctr"],
      ["aes128-ctr", "aes256-ctr"],
      ["hmac-sha2-256", "hmac-sha2-512"],
      ["hmac-sha2-256", "hmac-sha2-512"],
      ["none"],
      ["none"],
      [],
      [],
    ];
    for (let i = 0; i < lists.length; i++) parts.push(sshNameList(lists[i]));
    parts.push(new Uint8Array([0])); // first_kex_packet_follows
    parts.push(u32(0));
    let n = 0;
    for (let i = 0; i < parts.length; i++) n += parts[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  async function sshSession(sock, opts) {
    opts = opts || {};
    const user = opts.user || DEFAULT_USER;
    const pass = opts.password || DEFAULT_PASS;
    const ident = "SSH-2.0-GOAR_1.0\r\n";
    let incoming = new Uint8Array(0);
    const waiters = [];
    sock.ondata = function (chunk) {
      incoming = concat(incoming, chunk);
      SSH.raw = incoming;
      const text = dec(incoming);
      SSH.buf += text.slice(-4000);
      captureSecret(text);
      paintTerm(chunk);
      for (let i = 0; i < waiters.length; i++) {
        try {
          waiters[i]();
        } catch (_) {}
      }
    };
    sock.onclose = function () {
      SSH.ready = false;
      SSH.drops += 1;
      SSH.lastError = "tcp closed";
      scheduleReconnect();
    };
    // Go WASM (sshclient-wasm) owns ident+kex. Hand the raw TCP socket first.
    if (typeof global.__GOAR_SSH_DRIVE === "function") {
      const drivenEarly = await global.__GOAR_SSH_DRIVE({
        sock: sock,
        incoming: function () {
          return incoming;
        },
        user: user,
        password: pass,
        secret: opts.secret || readSecret(),
        host: opts.host,
        port: opts.port,
        raw: true,
      });
      if (drivenEarly && drivenEarly.ready) return drivenEarly;
    }

    sock.write(enc(ident));
    const banner = await waitUntil(
      function () {
        return parseBanner(incoming);
      },
      8000,
      waiters
    );
    if (!banner) throw new Error("no SSH banner from " + opts.host + ":" + opts.port);
    SSH.banner = banner;
    log("banner", banner);

    if (typeof global.__GOAR_SSH_DRIVE !== "function") {
      try {
        sock.write(buildPacket(kexInitPayload(), 8));
      } catch (_) {}
    }

    if (typeof global.__GOAR_SSH_DRIVE === "function") {
      const driven = await global.__GOAR_SSH_DRIVE({
        sock: sock,
        incoming: function () {
          return incoming;
        },
        user: user,
        password: pass,
        secret: opts.secret || readSecret(),
        host: opts.host,
        port: opts.port,
        banner: banner,
      });
      if (driven && driven.ready) return driven;
    }

    // Interactive fallback: some WISP+SSH bridges accept raw PTY bytes after banner
    // (tlsproxy-style). Drive password + SECRET as a line protocol with timeouts.
    const secret = opts.secret || readSecret();
    await sleep(250);
    const snap = dec(incoming).toLowerCase();
    if (/password/i.test(snap)) {
      sock.write(enc(pass + "\n"));
      await sleep(400);
    }
    if (secret && /secret|token|reconnect/i.test(dec(incoming))) {
      sock.write(enc(secret + "\n"));
      await sleep(400);
    }
    // Probe a real shell.
    sock.write(enc("export HISTCONTROL=ignorespace; unset PROMPT_COMMAND; export PS1='GOAR# '; echo __GOAR_SSH_HELLO__\n"));
    const hello = await waitUntil(
      function () {
        return /__GOAR_SSH_HELLO__/.test(dec(incoming));
      },
      12000,
      waiters
    );
    if (!hello) {
      throw new Error(
        "SSH TCP opened (" +
          banner +
          ") but no shell yet — WISP reached " +
          opts.host +
          ":" +
          opts.port +
          ". Need encrypted session (kex) or a tlsproxy endpoint."
      );
    }
    captureSecret(dec(incoming));
    return {
      ready: true,
      write: function (s) {
        sock.write(typeof s === "string" ? enc(s) : s);
      },
      incoming: function () {
        return incoming;
      },
      sock: sock,
    };
  }

  function waitUntil(pred, ms, waiters) {
    return new Promise((resolve) => {
      const t0 = now();
      function tick() {
        let v = null;
        try {
          v = pred();
        } catch (_) {}
        if (v) return resolve(v);
        if (now() - t0 > ms) return resolve(null);
      }
      const id = setInterval(tick, 40);
      const wrap = function () {
        tick();
      };
      waiters.push(wrap);
      const stop = setTimeout(function () {
        clearInterval(id);
        resolve(pred() || null);
      }, ms + 20);
      tick();
      const old = resolve;
    }).catch(() => null);
  }

  function paintTerm(chunk) {
    if (!SSH.termEcho) return;
    try {
      if (typeof term !== "undefined" && term && term.write) {
        const t = typeof chunk === "string" ? chunk : dec(chunk);
        term.write(t.replace(/\n/g, "\r\n"));
      }
    } catch (_) {}
  }

  function sshStatus() {
    return {
      ready: !!SSH.ready,
      host: SSH.host,
      user: SSH.user,
      port: SSH.port,
      secret: SSH.secret ? (SSH.secret.slice(0, 4) + "…" + SSH.secret.slice(-3)) : "",
      hasSecret: !!SSH.secret,
      banner: SSH.banner,
      wispUrl: SSH.wispUrl,
      lastError: SSH.lastError || null,
      reconnects: SSH.reconnects,
      drops: SSH.drops,
      execs: SSH.execs,
      startedAt: SSH.startedAt,
    };
  }

  function sshReady() {
    return !!(SSH.ready && SSH.sock && SSH.sock.write);
  }

  let _reconnTimer = 0;
  function scheduleReconnect() {
    if (_reconnTimer) return;
    _reconnTimer = setTimeout(function () {
      _reconnTimer = 0;
      ensureSsh({ reason: "reconnect" }).catch(function (e) {
        log("reconnect fail", e && e.message ? e.message : e);
      });
    }, Math.min(15000, 1200 + SSH.reconnects * 800));
  }

  function resolveSshTarget() {
    const defHost = DEFAULT_HOST;
    const defUser = DEFAULT_USER;
    const defPass = DEFAULT_PASS;
    let s = {};
    try {
      s = typeof loadSettings === "function" ? loadSettings() : (typeof settingsSnapshot === "function" ? settingsSnapshot() : {});
    } catch (_) {}
    s = s || {};
    let host = String(s.sshHost || defHost).trim() || defHost;
    let user = String(s.sshUser || defUser).trim() || defUser;
    let port = Number(s.sshPort);
    const at = host.match(/^([^@\s]+)@(.+)$/);
    if (at) {
      user = at[1] || user;
      host = at[2];
    }
    const br = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (br) {
      host = br[1];
      if (br[2]) port = Number(br[2]);
    } else {
      const hp = host.match(/^([^:\s]+):(\d+)$/);
      if (hp) {
        host = hp[1];
        port = Number(hp[2]);
      }
    }
    const isKali = !host || host === defHost;
    const password =
      s.sshPassword != null && String(s.sshPassword).length
        ? String(s.sshPassword)
        : isKali
          ? defPass
          : "";
    let secret = String(s.sshSecret || "").trim();
    if (!secret) secret = readSecret();
    const ports =
      Number.isFinite(port) && port > 0
        ? [port]
        : isKali
          ? DEFAULT_PORTS.slice()
          : [22];
    return { host: host, user: user, password: password, secret: secret, ports: ports };
  }

  async function connectOnce() {
    if (typeof ensureMwFabric === "function") {
      try {
        await ensureMwFabric();
      } catch (_) {}
    }
    const wisp = resolveWisp();
    SSH.wispUrl = wisp;
    SSH.secret = readSecret();
    const mux = await openWispMux(wisp);
    SSH.mux = mux;
    let last = null;
    const target = resolveSshTarget();
    if (target.secret) SSH.secret = target.secret;
    const ports = target.ports;
    for (let i = 0; i < ports.length; i++) {
      const port = ports[i];
      let sock;
      try {
        sock = mux.openTcp(target.host, port);
      } catch (e) {
        last = e;
        continue;
      }
      try {
        const sess = await sshSession(sock, {
          host: target.host,
          port: port,
          user: target.user,
          password: target.password,
          secret: target.secret || SSH.secret,
        });
        SSH.sock = sess;
        SSH.port = port;
        SSH.host = target.host;
        SSH.user = target.user;
        SSH.ready = true;
        SSH.lastError = "";
        SSH.startedAt = now();
        try {
          if (typeof __goarMarkEnvReady === "function") __goarMarkEnvReady(true, "ssh");
        } catch (_) {}
        log("ready", sshStatus());
        return sshStatus();
      } catch (e) {
        last = e;
        try {
          sock.close();
        } catch (_) {}
      }
    }
    throw last || new Error("unable to open SSH to " + target.host);
  }

  async function ensureSsh(opts) {
    opts = opts || {};
    if (global.__GOAR_SSH_DISABLED) {
      return { ready: false, disabled: true };
    }
    if (SSH.ready && SSH.sock && !opts.force) return sshStatus();
    if (opts.force) {
      SSH.ready = false;
      try { if (SSH.sock && typeof SSH.sock.close === "function") SSH.sock.close(); } catch (_) {}
      try { if (SSH.mux && typeof SSH.mux.close === "function") SSH.mux.close(); } catch (_) {}
      SSH.sock = null;
    }
    if (SSH.connecting) return SSH.connecting;
    SSH.connecting = (async function () {
      try {
        if (opts.reason === "reconnect") SSH.reconnects += 1;
        return await connectOnce();
      } catch (e) {
        SSH.ready = false;
        SSH.lastError = String(e && e.message ? e.message : e);
        log("ensure fail", SSH.lastError);
        scheduleReconnect();
        return sshStatus();
      } finally {
        SSH.connecting = null;
      }
    })();
    return SSH.connecting;
  }

  function stripAnsi(s) {
    return String(s || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  }

  async function sshExec(command, timeoutMs) {
    timeoutMs = Number(timeoutMs) || 180000;
    if (!sshReady()) {
      const st = await ensureSsh();
      if (!st || !st.ready) {
        return { code: -1, output: "Kali SSH not ready: " + (SSH.lastError || "connecting") };
      }
    }
    const run = async function () {
      const id = Math.random().toString(36).slice(2, 8);
      const start = "GOS" + id;
      const end = "GOE" + id;
      const cmd = String(command || "").replace(/\r/g, "");
      const wrapped =
        "echo " +
        start +
        "; { " +
        cmd +
        " ; } > /tmp/.gout." +
        id +
        " 2>&1; EC=$?; tail -c 20000 /tmp/.gout." +
        id +
        " 2>/dev/null; echo " +
        end +
        ":$EC\n";
      const mark = SSH.buf.length;
      SSH.sock.write(wrapped);
      SSH.execs += 1;
      SSH.lastExecAt = now();
      const t0 = now();
      const re = new RegExp(end + ":([0-9]+)");
      while (now() - t0 < timeoutMs) {
        const slice = stripAnsi(SSH.buf.slice(mark));
        const m = slice.match(re);
        if (m) {
          let body = slice;
          const sIdx = slice.lastIndexOf(start);
          const eIdx = slice.lastIndexOf(end);
          if (sIdx >= 0 && eIdx > sIdx) body = slice.slice(sIdx + start.length, eIdx);
          body = body
            .split("\n")
            .filter(function (ln) {
              const s = ln.trim();
              if (!s) return false;
              if (s === start || s.indexOf(end) === 0) return false;
              if (s.indexOf("/tmp/.gout") >= 0) return false;
              return true;
            })
            .join("\n")
            .trim();
          captureSecret(slice);
          return { code: Number(m[1]), output: body.slice(0, 500000), via: "ssh" };
        }
        await sleep(50);
      }
      return {
        code: -1,
        output: stripAnsi(SSH.buf.slice(mark)).slice(-8000) || "ssh timeout",
        via: "ssh",
      };
    };
    const next = SSH.queue.then(run, run);
    SSH.queue = next.then(
      function () {},
      function () {}
    );
    return next;
  }

  function sshWrite(data) {
    if (!sshReady()) return false;
    try {
      SSH.sock.write(data);
      return true;
    } catch (_) {
      return false;
    }
  }

  try {
    global.SSH = SSH;
    global.ensureSsh = ensureSsh;
    global.sshExec = sshExec;
    global.sshReady = sshReady;
    global.sshStatus = sshStatus;
    global.sshWrite = sshWrite;
    global.resolveSshTarget = resolveSshTarget;
    global.__GOAR_SSH = SSH;
    global.__GOAR_ENSURE_SSH = ensureSsh;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
