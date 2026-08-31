/**
 * Gecko WISP v1 → Epoxy TCP.
 * Epoxy talks Wisp; Gecko only sees a fake WebSocket and v1 frames.
 */
(function (global) {
  "use strict";

  const NativeWS = global.WebSocket;
  const STATS = { fake: 0, send: 0, connect: 0, dataIn: 0, open: 0, tcpOk: 0, tcpErr: 0 };
  global.__GOAR_WISP_STATS = STATS;
  global.__GOAR_NATIVE_WS = NativeWS;

  let epoxyReady = null;
  let epoxyClient = null;

  function epoxyUrl() {
    if (typeof goarAssetUrl === "function") return goarAssetUrl("assets/net/epoxy/epoxy-bundled.js");
    if (typeof GOAR_REMOTE === "string" && GOAR_REMOTE) return GOAR_REMOTE + "assets/net/epoxy/epoxy-bundled.js";
    return new URL("./assets/net/epoxy/epoxy-bundled.js", document.baseURI || location.href).href;
  }

  function tunnelUrl() {
    try {
      if (typeof pickWispUrl === "function") {
        const u = String(pickWispUrl && "" || "");
      }
    } catch (_) {}
    if (global.__GOAR_EPOXY_WISP) return String(global.__GOAR_EPOXY_WISP);
    try {
      const s = typeof mwFabricStatus === "function" ? mwFabricStatus() : {};
      if (s && /cors\.manus\.space/.test(s.wispUrl || "") && global.__GOAR_MANUS_TCP_OK) return s.wispUrl;
    } catch (_) {}
    return "wss://wisp.mercurywork.shop/";
  }

  async function ensureEpoxy() {
    if (epoxyClient) return epoxyClient;
    if (epoxyReady) return epoxyReady;
    epoxyReady = (async () => {
      const mod = await import(/* webpackIgnore: true */ epoxyUrl());
      await (mod.default || mod.__wbg_init)();
      const opts = new mod.EpoxyClientOptions();
      opts.wisp_v2 = false;
      opts.udp_extension_required = false;
      const url = tunnelUrl();
      epoxyClient = new mod.EpoxyClient(url, opts);
      global.__GOAR_EPOXY = epoxyClient;
      global.__GOAR_EPOXY_WISP = url;
      return epoxyClient;
    })();
    return epoxyReady;
  }

  function FakeWS(url) {
    this.url = url;
    this.binaryType = "arraybuffer";
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._streams = new Map();
    STATS.fake += 1;
    const self = this;
    ensureEpoxy().then(() => {
      self.readyState = 1;
      STATS.open += 1;
      if (self.onopen) self.onopen(new Event("open"));
    }).catch((e) => {
      self.readyState = 3;
      if (self.onerror) self.onerror(e);
      if (self.onclose) self.onclose(new CloseEvent("close"));
    });
  }
  FakeWS.prototype.addEventListener = function (type, fn) {
    if (type === "open") this.onopen = fn;
    else if (type === "message") this.onmessage = fn;
    else if (type === "close") this.onclose = fn;
    else if (type === "error") this.onerror = fn;
  };
  FakeWS.prototype._emit = function (type, id, payload) {
    const n = payload ? payload.length : 0;
    const out = new Uint8Array(5 + n);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, type);
    dv.setUint32(1, id >>> 0, true);
    if (n) out.set(payload, 5);
    if (this.onmessage) this.onmessage({ data: out.buffer });
  };
  FakeWS.prototype.send = function (buf) {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
    if (u8.length < 5) return;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const type = dv.getUint8(0);
    const id = dv.getUint32(1, true);
    const payload = u8.subarray(5);
    STATS.send += 1;
    if (type === 1) {
      STATS.connect += 1;
      const pview = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const kind = payload[0];
      const port = pview.getUint16(1, true);
      const host = new TextDecoder().decode(payload.subarray(3)).replace(/\0/g, "");
      const self = this;
      const target = (kind === 2 ? "udp://" : "tcp://") + host + ":" + port;
      ensureEpoxy().then((c) => (kind === 2 ? c.connect_udp(target) : c.connect_tcp(target))).then(async (stream) => {
        STATS.tcpOk += 1;
        const reader = stream.read.getReader();
        const writer = stream.write.getWriter();
        self._streams.set(id, { reader, writer, stream });
        try {
          for (;;) {
            const step = await reader.read();
            if (step.done) break;
            const chunk = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
            STATS.dataIn += 1;
            self._emit(2, id, chunk);
          }
        } catch (_) {}
        self._emit(4, id, new Uint8Array([0]));
        self._streams.delete(id);
      }).catch((e) => {
        STATS.tcpErr += 1;
        console.warn("[gecko] epoxy tcp", target, e);
        self._emit(4, id, new Uint8Array([3]));
      });
    } else if (type === 2) {
      const rec = this._streams.get(id);
      if (rec && rec.writer) rec.writer.write(payload).catch(() => {});
    } else if (type === 4) {
      const rec = this._streams.get(id);
      if (rec) {
        try { rec.writer.close(); } catch (_) {}
        this._streams.delete(id);
      }
    }
  };
  FakeWS.prototype.close = function () {
    this.readyState = 3;
    if (this.onclose) this.onclose(new CloseEvent("close"));
  };

  function shouldBridge(url) {
    const u = String(url || "");
    return /goar\.local\/wisp|__goar_gecko_wisp/i.test(u);
  }

  function installGeckoWispBridge(preferred) {
    if (preferred) global.__GOAR_EPOXY_WISP = preferred;
    if (global.__GOAR_WISP_BRIDGE) return ensureEpoxy().then(() => true);
    return ensureEpoxy().then(() => {
      if (global.__GOAR_WISP_BRIDGE) return true;
      global.WebSocket = function (url, proto) {
        if (shouldBridge(url)) return new FakeWS(String(url));
        return proto !== undefined ? new NativeWS(url, proto) : new NativeWS(url);
      };
      global.WebSocket.CONNECTING = NativeWS.CONNECTING;
      global.WebSocket.OPEN = NativeWS.OPEN;
      global.WebSocket.CLOSING = NativeWS.CLOSING;
      global.WebSocket.CLOSED = NativeWS.CLOSED;
      global.__GOAR_WISP_BRIDGE = true;
      return true;
    });
  }

  global.installGeckoWispBridge = installGeckoWispBridge;
  global.ensureGoarEpoxy = ensureEpoxy;
  global.ensureEpoxy = ensureEpoxy;
})(typeof window !== "undefined" ? window : globalThis);
