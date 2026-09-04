/**
 * Kali Desktop window — THC segfault startxvnc, tunneled like ssh -L5900:0:5900.
 * Free default: same WISP mux + a second SSH session, noVNC in-page.
 * Docs: https://www.thc.org/segfault/  (startxvnc)  FAQ: ssh -L5900:0:5900 then VNC :5900
 */
(function (global) {
  "use strict";

  const STATE = {
    ready: false,
    loading: null,
    lastError: "",
    rfb: null,
    aux: null,
    sock: null,
    ws: null,
  };

  const PIPE_PY =
    "import socket,sys,os,select\n" +
    "s=socket.create_connection(('127.0.0.1',5900),20)\n" +
    "sin,sout=sys.stdin.buffer,sys.stdout.buffer\n" +
    "try:\n" +
    "  while True:\n" +
    "    r,_,_=select.select([s,sin],[],[],60)\n" +
    "    if not r: continue\n" +
    "    if sin in r:\n" +
    "      b=os.read(sin.fileno(),65536)\n" +
    "      if not b: break\n" +
    "      s.sendall(b)\n" +
    "    if s in r:\n" +
    "      b=s.recv(65536)\n" +
    "      if not b: break\n" +
    "      os.write(sout.fileno(),b)\n" +
    "finally:\n" +
    "  try: s.close()\n" +
    "  except Exception: pass\n";

  function setStatus(t) {
    STATE.lastError = t && /fail|error|not /i.test(t) ? t : STATE.lastError;
    const el = document.getElementById("vnc-status");
    if (el) el.textContent = t || "";
  }

  function enc(s) {
    return new TextEncoder().encode(String(s == null ? "" : s));
  }
  function dec(u8) {
    return new TextDecoder("utf-8", { fatal: false }).decode(u8 instanceof Uint8Array ? u8 : new Uint8Array(0));
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function bootXvnc() {
    if (typeof ensureSsh === "function") await ensureSsh({ reason: "vnc" });
    if (typeof sshExec !== "function") throw new Error("Kali SSH not ready");
    setStatus("starting Xvnc…");
    await sshExec(
      "mkdir -p /tmp; cat > /tmp/.goar_vnc_pipe.py << 'PY'\n" + PIPE_PY + "PY\n",
      20000
    );
    const r = await sshExec(
      "if ss -lnt 2>/dev/null | grep -q ':5900' || netstat -lnt 2>/dev/null | grep -q ':5900'; then echo VNC_UP; " +
        "else (command -v startxvnc >/dev/null && nohup startxvnc >/tmp/.goar-xvnc.log 2>&1 &); " +
        "sleep 2; " +
        "if ss -lnt 2>/dev/null | grep -q ':5900' || netstat -lnt 2>/dev/null | grep -q ':5900'; then echo VNC_UP; " +
        "else echo VNC_WAIT; tail -20 /tmp/.goar-xvnc.log 2>/dev/null; fi; fi",
      25000
    );
    const out = String((r && r.output) || "");
    if (out.indexOf("VNC_UP") >= 0) return true;
    await sleep(2500);
    const r2 = await sshExec(
      "ss -lnt 2>/dev/null | grep 5900 || netstat -lnt 2>/dev/null | grep 5900 || echo VNC_DOWN; command -v startxvnc; command -v Xvnc; command -v Xtigervnc",
      15000
    );
    const o2 = String((r2 && r2.output) || "");
    if (/5900/.test(o2) && !/VNC_DOWN/.test(o2)) return true;
    throw new Error("startxvnc did not bind display :0 — " + (o2 || out).slice(0, 240));
  }

  function makeWs(onSend, onClose) {
    const listeners = { open: [], message: [], close: [], error: [] };
    const ws = {
      binaryType: "arraybuffer",
      protocol: "binary",
      readyState: 0,
      bufferedAmount: 0,
      extensions: "",
      url: "ws://goar-vnc/rfb",
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      addEventListener: function (t, fn) {
        (listeners[t] || (listeners[t] = [])).push(fn);
      },
      removeEventListener: function (t, fn) {
        const a = listeners[t] || [];
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      },
      send: function (data) {
        let u8;
        if (typeof data === "string") u8 = enc(data);
        else if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
        else u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        onSend(u8);
      },
      close: function () {
        if (ws.readyState === 3) return;
        ws.readyState = 3;
        try { onClose(); } catch (_) {}
        fire("close", { code: 1000, reason: "" });
      },
    };
    function fire(t, ev) {
      (listeners[t] || []).forEach(function (fn) {
        try { fn(ev); } catch (_) {}
      });
      const h = ws["on" + t];
      if (typeof h === "function") try { h(ev); } catch (_) {}
    }
    ws._fire = fire;
    ws._open = function () {
      ws.readyState = 1;
      fire("open", {});
    };
    ws._data = function (u8) {
      const copy = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
      const buf = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
      fire("message", { data: buf });
    };
    return ws;
  }

  async function loadRfb() {
    if (global.RFB) return global.RFB;
    const urls = [
      "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/+esm",
      "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/+esm",
    ];
    let last = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const mod = await import(urls[i]);
        const RFB = mod.default || mod.RFB;
        if (RFB) {
          global.RFB = RFB;
          return RFB;
        }
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error("noVNC RFB failed to load");
  }

  async function openPipe() {
    const target = typeof resolveSshTarget === "function" ? resolveSshTarget() : { host: "segfault.net", user: "root", password: "segfault", ports: [443, 22] };
    if (typeof sshOpenTcp !== "function") throw new Error("sshOpenTcp missing");
    const port = (typeof SSH !== "undefined" && SSH.port) || target.ports[0] || 443;
    const sock = sshOpenTcp(target.host, port);
    STATE.sock = sock;
    if (typeof __GOAR_SSH_DRIVE !== "function") throw new Error("SSH engine missing");
    const driven = await __GOAR_SSH_DRIVE({
      sock: sock,
      host: target.host,
      port: port,
      user: target.user,
      password: target.password,
      secret: target.secret,
      quiet: true,
    });
    STATE.aux = driven;
    let mode = "boot";
    let hold = new Uint8Array(0);
    const prev = sock.ondata;
    sock.ondata = function (chunk) {
      const u8 = chunk instanceof Uint8Array ? chunk : enc(chunk);
      try { if (typeof prev === "function") prev(u8); } catch (_) {}
      if (mode === "rfb") {
        if (STATE.ws) STATE.ws._data(u8);
        return;
      }
      const n = new Uint8Array(hold.length + u8.length);
      n.set(hold, 0);
      n.set(u8, hold.length);
      hold = n;
      const t = dec(hold);
      const idx = t.indexOf("RFB ");
      if (idx >= 0) {
        mode = "rfb";
        const start = enc(t.slice(0, idx)).length;
        const rest = hold.subarray(start);
        hold = new Uint8Array(0);
        if (STATE.ws) {
          STATE.ws._open();
          if (rest.length) STATE.ws._data(rest);
        }
      }
      if (hold.length > 200000) hold = hold.subarray(hold.length - 80000);
    };
    driven.write("stty raw -echo -onlcr 2>/dev/null; python3 -u /tmp/.goar_vnc_pipe.py\n");
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && mode !== "rfb") await sleep(80);
    if (mode !== "rfb") {
      driven.write("exec socat STDIO TCP:127.0.0.1:5900,retry=8,interval=0.4\n");
      const t1 = Date.now();
      while (Date.now() - t1 < 8000 && mode !== "rfb") await sleep(80);
    }
    if (mode !== "rfb") throw new Error("VNC handshake did not start (display :0)");
    return driven;
  }

  function attachRfb(RFB, ws) {
    const host = document.getElementById("vnc-screen");
    if (!host) throw new Error("vnc-screen missing");
    host.innerHTML = "";
    if (STATE.rfb) {
      try { STATE.rfb.disconnect(); } catch (_) {}
      STATE.rfb = null;
    }
    const rfb = new RFB(host, ws, {
      credentials: { password: "" },
      wsProtocols: ["binary"],
    });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.background = "#0a0a0a";
    rfb.addEventListener("connect", function () { setStatus("live"); STATE.ready = true; });
    rfb.addEventListener("disconnect", function (ev) {
      STATE.ready = false;
      setStatus((ev && ev.detail && ev.detail.clean) ? "disconnected" : "dropped");
    });
    rfb.addEventListener("credentialsrequired", function () {
      const pw = (typeof SSH !== "undefined" && SSH.secret) ? "" : "segfault";
      try { rfb.sendCredentials({ password: pw || "segfault" }); } catch (_) {}
    });
    STATE.rfb = rfb;
    return rfb;
  }

  async function ensureVnc(opts) {
    opts = opts || {};
    if (STATE.ready && STATE.rfb && !opts.force) return { ready: true };
    if (STATE.loading) return STATE.loading;
    STATE.loading = (async function () {
      try {
        setStatus("connecting…");
        await bootXvnc();
        setStatus("tunnel…");
        const RFB = await loadRfb();
        const ws = makeWs(
          function (u8) {
            try {
              if (STATE.aux && STATE.aux.write) STATE.aux.write(u8);
              else if (STATE.sock && STATE.sock.write) STATE.sock.write(u8);
            } catch (_) {}
          },
          function () {
            try { if (STATE.sock) STATE.sock.close(); } catch (_) {}
          }
        );
        STATE.ws = ws;
        await openPipe();
        if (ws.readyState !== 1) ws._open();
        attachRfb(RFB, ws);
        setStatus("live");
        STATE.ready = true;
        return { ready: true };
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        STATE.lastError = msg;
        setStatus(msg.slice(0, 80));
        throw e;
      } finally {
        STATE.loading = null;
      }
    })();
    return STATE.loading;
  }

  function vncHide() {
    try { if (STATE.rfb) STATE.rfb.disconnect(); } catch (_) {}
    try { if (STATE.sock) STATE.sock.close(); } catch (_) {}
    STATE.ready = false;
    STATE.rfb = null;
    STATE.aux = null;
    STATE.sock = null;
    STATE.ws = null;
    setStatus("idle");
  }

  try {
    global.ensureVnc = ensureVnc;
    global.vncHide = vncHide;
    global.vncStatus = function () {
      return { ready: STATE.ready, lastError: STATE.lastError };
    };
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
