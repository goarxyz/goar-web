class WebSocketTransport {
  constructor(t, n, l) {
    this.ws = null, this.callbacks = {}, this.id = t, this.url = n, this.protocols = l;
  }
  async connect() {
    return new Promise((t, n) => {
      try {
        this.ws = new WebSocket(this.url, this.protocols), this.ws.binaryType = "arraybuffer", this.ws.onopen = () => {
          t();
        }, this.ws.onerror = (l) => {
          const r = new Error("WebSocket error");
          this.onError && this.onError(r), n(r);
        }, this.ws.onmessage = (l) => {
          if (l.data instanceof ArrayBuffer) {
            const r = new Uint8Array(l.data);
            this.onData && this.onData(r);
          }
        }, this.ws.onclose = () => {
          this.onClose && this.onClose();
        };
      } catch (l) {
        n(l);
      }
    });
  }
  async disconnect() {
    this.ws && (this.ws.close(), this.ws = null);
  }
  async send(t) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      throw new Error("WebSocket is not connected");
    this.ws.send(t.buffer);
  }
  setCallbacks(t) {
    this.callbacks = t;
  }
}
class CustomTransport {
  constructor(t, n, l, r) {
    this.isConnected = !1, this.id = t, this.connectImpl = n, this.disconnectImpl = l, this.sendImpl = r;
  }
  async connect() {
    this.connectImpl && await this.connectImpl(), this.isConnected = !0;
  }
  async disconnect() {
    this.disconnectImpl && await this.disconnectImpl(), this.isConnected = !1, this.onClose && this.onClose();
  }
  async send(t) {
    if (!this.isConnected)
      throw new Error("Transport is not connected");
    this.sendImpl && await this.sendImpl(t);
  }
  // Method to inject received data
  injectData(t) {
    this.onData && this.onData(t);
  }
}
class TransportManager {
  constructor() {
    this.transports = /* @__PURE__ */ new Map();
  }
  static getInstance() {
    return TransportManager.instance || (TransportManager.instance = new TransportManager()), TransportManager.instance;
  }
  setWasmInstance(t) {
    this.wasmInstance = t;
  }
  async createTransport(t) {
    if (!this.wasmInstance)
      throw new Error("WASM instance not set");
    console.log("Creating transport with ID:", t.id), console.log("WASM instance available:", !!this.wasmInstance), console.log(
      "WASM createTransport function:",
      typeof this.wasmInstance.createTransport
    );
    const n = {
      onWrite: (l) => {
        t.send(l).catch((r) => {
          t.onError && t.onError(r);
        });
      },
      onClose: () => {
        t.disconnect().catch(console.error);
      }
    };
    try {
      const l = this.wasmInstance.createTransport(t.id, n);
      console.log("WASM createTransport result:", l);
    } catch (l) {
      throw console.error("Error calling WASM createTransport:", l), l;
    }
    t.onData = (l) => {
      this.wasmInstance.injectTransportData(t.id, l);
    }, this.transports.set(t.id, t);
  }
  async closeTransport(t) {
    const n = this.transports.get(t);
    n && (await n.disconnect(), this.wasmInstance && this.wasmInstance.closeTransport(t), this.transports.delete(t));
  }
  getTransport(t) {
    return this.transports.get(t);
  }
}
var commonjsGlobal = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {}, indexMinimal = {}, minimal$1 = {}, aspromise = asPromise;
function asPromise(o, t) {
  for (var n = new Array(arguments.length - 1), l = 0, r = 2, a = !0; r < arguments.length; )
    n[l++] = arguments[r++];
  return new Promise(function(i, s) {
    n[l] = function(u) {
      if (a)
        if (a = !1, u)
          s(u);
        else {
          for (var f = new Array(arguments.length - 1), d = 0; d < f.length; )
            f[d++] = arguments[d];
          i.apply(null, f);
        }
    };
    try {
      o.apply(t || null, n);
    } catch (c) {
      a && (a = !1, s(c));
    }
  });
}
var base64$1 = {};
(function(o) {
  var t = o;
  t.length = function(i) {
    var s = i.length;
    if (!s)
      return 0;
    for (var c = 0; --s % 4 > 1 && i.charAt(s) === "="; )
      ++c;
    return Math.ceil(i.length * 3) / 4 - c;
  };
  for (var n = new Array(64), l = new Array(123), r = 0; r < 64; )
    l[n[r] = r < 26 ? r + 65 : r < 52 ? r + 71 : r < 62 ? r - 4 : r - 59 | 43] = r++;
  t.encode = function(i, s, c) {
    for (var u = null, f = [], d = 0, p = 0, h; s < c; ) {
      var y = i[s++];
      switch (p) {
        case 0:
          f[d++] = n[y >> 2], h = (y & 3) << 4, p = 1;
          break;
        case 1:
          f[d++] = n[h | y >> 4], h = (y & 15) << 2, p = 2;
          break;
        case 2:
          f[d++] = n[h | y >> 6], f[d++] = n[y & 63], p = 0;
          break;
      }
      d > 8191 && ((u || (u = [])).push(String.fromCharCode.apply(String, f)), d = 0);
    }
    return p && (f[d++] = n[h], f[d++] = 61, p === 1 && (f[d++] = 61)), u ? (d && u.push(String.fromCharCode.apply(String, f.slice(0, d))), u.join("")) : String.fromCharCode.apply(String, f.slice(0, d));
  };
  var a = "invalid encoding";
  t.decode = function(i, s, c) {
    for (var u = c, f = 0, d, p = 0; p < i.length; ) {
      var h = i.charCodeAt(p++);
      if (h === 61 && f > 1)
        break;
      if ((h = l[h]) === void 0)
        throw Error(a);
      switch (f) {
        case 0:
          d = h, f = 1;
          break;
        case 1:
          s[c++] = d << 2 | (h & 48) >> 4, d = h, f = 2;
          break;
        case 2:
          s[c++] = (d & 15) << 4 | (h & 60) >> 2, d = h, f = 3;
          break;
        case 3:
          s[c++] = (d & 3) << 6 | h, f = 0;
          break;
      }
    }
    if (f === 1)
      throw Error(a);
    return c - u;
  }, t.test = function(i) {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(i);
  };
})(base64$1);
var eventemitter = EventEmitter;
function EventEmitter() {
  this._listeners = {};
}
EventEmitter.prototype.on = function(t, n, l) {
  return (this._listeners[t] || (this._listeners[t] = [])).push({
    fn: n,
    ctx: l || this
  }), this;
};
EventEmitter.prototype.off = function(t, n) {
  if (t === void 0)
    this._listeners = {};
  else if (n === void 0)
    this._listeners[t] = [];
  else
    for (var l = this._listeners[t], r = 0; r < l.length; )
      l[r].fn === n ? l.splice(r, 1) : ++r;
  return this;
};
EventEmitter.prototype.emit = function(t) {
  var n = this._listeners[t];
  if (n) {
    for (var l = [], r = 1; r < arguments.length; )
      l.push(arguments[r++]);
    for (r = 0; r < n.length; )
      n[r].fn.apply(n[r++].ctx, l);
  }
  return this;
};
var float = factory(factory);
function factory(o) {
  return typeof Float32Array < "u" ? (function() {
    var t = new Float32Array([-0]), n = new Uint8Array(t.buffer), l = n[3] === 128;
    function r(s, c, u) {
      t[0] = s, c[u] = n[0], c[u + 1] = n[1], c[u + 2] = n[2], c[u + 3] = n[3];
    }
    function a(s, c, u) {
      t[0] = s, c[u] = n[3], c[u + 1] = n[2], c[u + 2] = n[1], c[u + 3] = n[0];
    }
    o.writeFloatLE = l ? r : a, o.writeFloatBE = l ? a : r;
    function e(s, c) {
      return n[0] = s[c], n[1] = s[c + 1], n[2] = s[c + 2], n[3] = s[c + 3], t[0];
    }
    function i(s, c) {
      return n[3] = s[c], n[2] = s[c + 1], n[1] = s[c + 2], n[0] = s[c + 3], t[0];
    }
    o.readFloatLE = l ? e : i, o.readFloatBE = l ? i : e;
  })() : (function() {
    function t(l, r, a, e) {
      var i = r < 0 ? 1 : 0;
      if (i && (r = -r), r === 0)
        l(1 / r > 0 ? (
          /* positive */
          0
        ) : (
          /* negative 0 */
          2147483648
        ), a, e);
      else if (isNaN(r))
        l(2143289344, a, e);
      else if (r > 34028234663852886e22)
        l((i << 31 | 2139095040) >>> 0, a, e);
      else if (r < 11754943508222875e-54)
        l((i << 31 | Math.round(r / 1401298464324817e-60)) >>> 0, a, e);
      else {
        var s = Math.floor(Math.log(r) / Math.LN2), c = Math.round(r * Math.pow(2, -s) * 8388608) & 8388607;
        l((i << 31 | s + 127 << 23 | c) >>> 0, a, e);
      }
    }
    o.writeFloatLE = t.bind(null, writeUintLE), o.writeFloatBE = t.bind(null, writeUintBE);
    function n(l, r, a) {
      var e = l(r, a), i = (e >> 31) * 2 + 1, s = e >>> 23 & 255, c = e & 8388607;
      return s === 255 ? c ? NaN : i * (1 / 0) : s === 0 ? i * 1401298464324817e-60 * c : i * Math.pow(2, s - 150) * (c + 8388608);
    }
    o.readFloatLE = n.bind(null, readUintLE), o.readFloatBE = n.bind(null, readUintBE);
  })(), typeof Float64Array < "u" ? (function() {
    var t = new Float64Array([-0]), n = new Uint8Array(t.buffer), l = n[7] === 128;
    function r(s, c, u) {
      t[0] = s, c[u] = n[0], c[u + 1] = n[1], c[u + 2] = n[2], c[u + 3] = n[3], c[u + 4] = n[4], c[u + 5] = n[5], c[u + 6] = n[6], c[u + 7] = n[7];
    }
    function a(s, c, u) {
      t[0] = s, c[u] = n[7], c[u + 1] = n[6], c[u + 2] = n[5], c[u + 3] = n[4], c[u + 4] = n[3], c[u + 5] = n[2], c[u + 6] = n[1], c[u + 7] = n[0];
    }
    o.writeDoubleLE = l ? r : a, o.writeDoubleBE = l ? a : r;
    function e(s, c) {
      return n[0] = s[c], n[1] = s[c + 1], n[2] = s[c + 2], n[3] = s[c + 3], n[4] = s[c + 4], n[5] = s[c + 5], n[6] = s[c + 6], n[7] = s[c + 7], t[0];
    }
    function i(s, c) {
      return n[7] = s[c], n[6] = s[c + 1], n[5] = s[c + 2], n[4] = s[c + 3], n[3] = s[c + 4], n[2] = s[c + 5], n[1] = s[c + 6], n[0] = s[c + 7], t[0];
    }
    o.readDoubleLE = l ? e : i, o.readDoubleBE = l ? i : e;
  })() : (function() {
    function t(l, r, a, e, i, s) {
      var c = e < 0 ? 1 : 0;
      if (c && (e = -e), e === 0)
        l(0, i, s + r), l(1 / e > 0 ? (
          /* positive */
          0
        ) : (
          /* negative 0 */
          2147483648
        ), i, s + a);
      else if (isNaN(e))
        l(0, i, s + r), l(2146959360, i, s + a);
      else if (e > 17976931348623157e292)
        l(0, i, s + r), l((c << 31 | 2146435072) >>> 0, i, s + a);
      else {
        var u;
        if (e < 22250738585072014e-324)
          u = e / 5e-324, l(u >>> 0, i, s + r), l((c << 31 | u / 4294967296) >>> 0, i, s + a);
        else {
          var f = Math.floor(Math.log(e) / Math.LN2);
          f === 1024 && (f = 1023), u = e * Math.pow(2, -f), l(u * 4503599627370496 >>> 0, i, s + r), l((c << 31 | f + 1023 << 20 | u * 1048576 & 1048575) >>> 0, i, s + a);
        }
      }
    }
    o.writeDoubleLE = t.bind(null, writeUintLE, 0, 4), o.writeDoubleBE = t.bind(null, writeUintBE, 4, 0);
    function n(l, r, a, e, i) {
      var s = l(e, i + r), c = l(e, i + a), u = (c >> 31) * 2 + 1, f = c >>> 20 & 2047, d = 4294967296 * (c & 1048575) + s;
      return f === 2047 ? d ? NaN : u * (1 / 0) : f === 0 ? u * 5e-324 * d : u * Math.pow(2, f - 1075) * (d + 4503599627370496);
    }
    o.readDoubleLE = n.bind(null, readUintLE, 0, 4), o.readDoubleBE = n.bind(null, readUintBE, 4, 0);
  })(), o;
}
function writeUintLE(o, t, n) {
  t[n] = o & 255, t[n + 1] = o >>> 8 & 255, t[n + 2] = o >>> 16 & 255, t[n + 3] = o >>> 24;
}
function writeUintBE(o, t, n) {
  t[n] = o >>> 24, t[n + 1] = o >>> 16 & 255, t[n + 2] = o >>> 8 & 255, t[n + 3] = o & 255;
}
function readUintLE(o, t) {
  return (o[t] | o[t + 1] << 8 | o[t + 2] << 16 | o[t + 3] << 24) >>> 0;
}
function readUintBE(o, t) {
  return (o[t] << 24 | o[t + 1] << 16 | o[t + 2] << 8 | o[t + 3]) >>> 0;
}
var inquire_1 = inquire;
function inquire(moduleName) {
  try {
    var mod = eval("quire".replace(/^/, "re"))(moduleName);
    if (mod && (mod.length || Object.keys(mod).length))
      return mod;
  } catch (o) {
  }
  return null;
}
var utf8$2 = {};
(function(o) {
  var t = o;
  t.length = function(l) {
    for (var r = 0, a = 0, e = 0; e < l.length; ++e)
      a = l.charCodeAt(e), a < 128 ? r += 1 : a < 2048 ? r += 2 : (a & 64512) === 55296 && (l.charCodeAt(e + 1) & 64512) === 56320 ? (++e, r += 4) : r += 3;
    return r;
  }, t.read = function(l, r, a) {
    var e = a - r;
    if (e < 1)
      return "";
    for (var i = null, s = [], c = 0, u; r < a; )
      u = l[r++], u < 128 ? s[c++] = u : u > 191 && u < 224 ? s[c++] = (u & 31) << 6 | l[r++] & 63 : u > 239 && u < 365 ? (u = ((u & 7) << 18 | (l[r++] & 63) << 12 | (l[r++] & 63) << 6 | l[r++] & 63) - 65536, s[c++] = 55296 + (u >> 10), s[c++] = 56320 + (u & 1023)) : s[c++] = (u & 15) << 12 | (l[r++] & 63) << 6 | l[r++] & 63, c > 8191 && ((i || (i = [])).push(String.fromCharCode.apply(String, s)), c = 0);
    return i ? (c && i.push(String.fromCharCode.apply(String, s.slice(0, c))), i.join("")) : String.fromCharCode.apply(String, s.slice(0, c));
  }, t.write = function(l, r, a) {
    for (var e = a, i, s, c = 0; c < l.length; ++c)
      i = l.charCodeAt(c), i < 128 ? r[a++] = i : i < 2048 ? (r[a++] = i >> 6 | 192, r[a++] = i & 63 | 128) : (i & 64512) === 55296 && ((s = l.charCodeAt(c + 1)) & 64512) === 56320 ? (i = 65536 + ((i & 1023) << 10) + (s & 1023), ++c, r[a++] = i >> 18 | 240, r[a++] = i >> 12 & 63 | 128, r[a++] = i >> 6 & 63 | 128, r[a++] = i & 63 | 128) : (r[a++] = i >> 12 | 224, r[a++] = i >> 6 & 63 | 128, r[a++] = i & 63 | 128);
    return a - e;
  };
})(utf8$2);
var pool_1 = pool;
function pool(o, t, n) {
  var l = n || 8192, r = l >>> 1, a = null, e = l;
  return function(s) {
    if (s < 1 || s > r)
      return o(s);
    e + s > l && (a = o(l), e = 0);
    var c = t.call(a, e, e += s);
    return e & 7 && (e = (e | 7) + 1), c;
  };
}
var longbits, hasRequiredLongbits;
function requireLongbits() {
  if (hasRequiredLongbits) return longbits;
  hasRequiredLongbits = 1, longbits = t;
  var o = requireMinimal();
  function t(a, e) {
    this.lo = a >>> 0, this.hi = e >>> 0;
  }
  var n = t.zero = new t(0, 0);
  n.toNumber = function() {
    return 0;
  }, n.zzEncode = n.zzDecode = function() {
    return this;
  }, n.length = function() {
    return 1;
  };
  var l = t.zeroHash = "\0\0\0\0\0\0\0\0";
  t.fromNumber = function(e) {
    if (e === 0)
      return n;
    var i = e < 0;
    i && (e = -e);
    var s = e >>> 0, c = (e - s) / 4294967296 >>> 0;
    return i && (c = ~c >>> 0, s = ~s >>> 0, ++s > 4294967295 && (s = 0, ++c > 4294967295 && (c = 0))), new t(s, c);
  }, t.from = function(e) {
    if (typeof e == "number")
      return t.fromNumber(e);
    if (o.isString(e))
      if (o.Long)
        e = o.Long.fromString(e);
      else
        return t.fromNumber(parseInt(e, 10));
    return e.low || e.high ? new t(e.low >>> 0, e.high >>> 0) : n;
  }, t.prototype.toNumber = function(e) {
    if (!e && this.hi >>> 31) {
      var i = ~this.lo + 1 >>> 0, s = ~this.hi >>> 0;
      return i || (s = s + 1 >>> 0), -(i + s * 4294967296);
    }
    return this.lo + this.hi * 4294967296;
  }, t.prototype.toLong = function(e) {
    return o.Long ? new o.Long(this.lo | 0, this.hi | 0, !!e) : { low: this.lo | 0, high: this.hi | 0, unsigned: !!e };
  };
  var r = String.prototype.charCodeAt;
  return t.fromHash = function(e) {
    return e === l ? n : new t(
      (r.call(e, 0) | r.call(e, 1) << 8 | r.call(e, 2) << 16 | r.call(e, 3) << 24) >>> 0,
      (r.call(e, 4) | r.call(e, 5) << 8 | r.call(e, 6) << 16 | r.call(e, 7) << 24) >>> 0
    );
  }, t.prototype.toHash = function() {
    return String.fromCharCode(
      this.lo & 255,
      this.lo >>> 8 & 255,
      this.lo >>> 16 & 255,
      this.lo >>> 24,
      this.hi & 255,
      this.hi >>> 8 & 255,
      this.hi >>> 16 & 255,
      this.hi >>> 24
    );
  }, t.prototype.zzEncode = function() {
    var e = this.hi >> 31;
    return this.hi = ((this.hi << 1 | this.lo >>> 31) ^ e) >>> 0, this.lo = (this.lo << 1 ^ e) >>> 0, this;
  }, t.prototype.zzDecode = function() {
    var e = -(this.lo & 1);
    return this.lo = ((this.lo >>> 1 | this.hi << 31) ^ e) >>> 0, this.hi = (this.hi >>> 1 ^ e) >>> 0, this;
  }, t.prototype.length = function() {
    var e = this.lo, i = (this.lo >>> 28 | this.hi << 4) >>> 0, s = this.hi >>> 24;
    return s === 0 ? i === 0 ? e < 16384 ? e < 128 ? 1 : 2 : e < 2097152 ? 3 : 4 : i < 16384 ? i < 128 ? 5 : 6 : i < 2097152 ? 7 : 8 : s < 128 ? 9 : 10;
  }, longbits;
}
var hasRequiredMinimal;
function requireMinimal() {
  return hasRequiredMinimal || (hasRequiredMinimal = 1, (function(o) {
    var t = o;
    t.asPromise = aspromise, t.base64 = base64$1, t.EventEmitter = eventemitter, t.float = float, t.inquire = inquire_1, t.utf8 = utf8$2, t.pool = pool_1, t.LongBits = requireLongbits(), t.isNode = !!(typeof commonjsGlobal < "u" && commonjsGlobal && commonjsGlobal.process && commonjsGlobal.process.versions && commonjsGlobal.process.versions.node), t.global = t.isNode && commonjsGlobal || typeof window < "u" && window || typeof self < "u" && self || commonjsGlobal, t.emptyArray = Object.freeze ? Object.freeze([]) : (
      /* istanbul ignore next */
      []
    ), t.emptyObject = Object.freeze ? Object.freeze({}) : (
      /* istanbul ignore next */
      {}
    ), t.isInteger = Number.isInteger || /* istanbul ignore next */
    function(a) {
      return typeof a == "number" && isFinite(a) && Math.floor(a) === a;
    }, t.isString = function(a) {
      return typeof a == "string" || a instanceof String;
    }, t.isObject = function(a) {
      return a && typeof a == "object";
    }, t.isset = /**
     * Checks if a property on a message is considered to be present.
     * @param {Object} obj Plain object or message instance
     * @param {string} prop Property name
     * @returns {boolean} `true` if considered to be present, otherwise `false`
     */
    t.isSet = function(a, e) {
      var i = a[e];
      return i != null && a.hasOwnProperty(e) ? typeof i != "object" || (Array.isArray(i) ? i.length : Object.keys(i).length) > 0 : !1;
    }, t.Buffer = (function() {
      try {
        var r = t.inquire("buffer").Buffer;
        return r.prototype.utf8Write ? r : (
          /* istanbul ignore next */
          null
        );
      } catch {
        return null;
      }
    })(), t._Buffer_from = null, t._Buffer_allocUnsafe = null, t.newBuffer = function(a) {
      return typeof a == "number" ? t.Buffer ? t._Buffer_allocUnsafe(a) : new t.Array(a) : t.Buffer ? t._Buffer_from(a) : typeof Uint8Array > "u" ? a : new Uint8Array(a);
    }, t.Array = typeof Uint8Array < "u" ? Uint8Array : Array, t.Long = /* istanbul ignore next */
    t.global.dcodeIO && /* istanbul ignore next */
    t.global.dcodeIO.Long || /* istanbul ignore next */
    t.global.Long || t.inquire("long"), t.key2Re = /^true|false|0|1$/, t.key32Re = /^-?(?:0|[1-9][0-9]*)$/, t.key64Re = /^(?:[\\x00-\\xff]{8}|-?(?:0|[1-9][0-9]*))$/, t.longToHash = function(a) {
      return a ? t.LongBits.from(a).toHash() : t.LongBits.zeroHash;
    }, t.longFromHash = function(a, e) {
      var i = t.LongBits.fromHash(a);
      return t.Long ? t.Long.fromBits(i.lo, i.hi, e) : i.toNumber(!!e);
    };
    function n(r, a, e) {
      for (var i = Object.keys(a), s = 0; s < i.length; ++s)
        (r[i[s]] === void 0 || !e) && (r[i[s]] = a[i[s]]);
      return r;
    }
    t.merge = n, t.lcFirst = function(a) {
      return a.charAt(0).toLowerCase() + a.substring(1);
    };
    function l(r) {
      function a(e, i) {
        if (!(this instanceof a))
          return new a(e, i);
        Object.defineProperty(this, "message", { get: function() {
          return e;
        } }), Error.captureStackTrace ? Error.captureStackTrace(this, a) : Object.defineProperty(this, "stack", { value: new Error().stack || "" }), i && n(this, i);
      }
      return a.prototype = Object.create(Error.prototype, {
        constructor: {
          value: a,
          writable: !0,
          enumerable: !1,
          configurable: !0
        },
        name: {
          get: function() {
            return r;
          },
          set: void 0,
          enumerable: !1,
          // configurable: false would accurately preserve the behavior of
          // the original, but I'm guessing that was not intentional.
          // For an actual error subclass, this property would
          // be configurable.
          configurable: !0
        },
        toString: {
          value: function() {
            return this.name + ": " + this.message;
          },
          writable: !0,
          enumerable: !1,
          configurable: !0
        }
      }), a;
    }
    t.newError = l, t.ProtocolError = l("ProtocolError"), t.oneOfGetter = function(a) {
      for (var e = {}, i = 0; i < a.length; ++i)
        e[a[i]] = 1;
      return function() {
        for (var s = Object.keys(this), c = s.length - 1; c > -1; --c)
          if (e[s[c]] === 1 && this[s[c]] !== void 0 && this[s[c]] !== null)
            return s[c];
      };
    }, t.oneOfSetter = function(a) {
      return function(e) {
        for (var i = 0; i < a.length; ++i)
          a[i] !== e && delete this[a[i]];
      };
    }, t.toJSONOptions = {
      longs: String,
      enums: String,
      bytes: String,
      json: !0
    }, t._configure = function() {
      var r = t.Buffer;
      if (!r) {
        t._Buffer_from = t._Buffer_allocUnsafe = null;
        return;
      }
      t._Buffer_from = r.from !== Uint8Array.from && r.from || /* istanbul ignore next */
      function(e, i) {
        return new r(e, i);
      }, t._Buffer_allocUnsafe = r.allocUnsafe || /* istanbul ignore next */
      function(e) {
        return new r(e);
      };
    };
  })(minimal$1)), minimal$1;
}
var writer = Writer$1, util$4 = requireMinimal(), BufferWriter$1, LongBits$1 = util$4.LongBits, base64 = util$4.base64, utf8$1 = util$4.utf8;
function Op(o, t, n) {
  this.fn = o, this.len = t, this.next = void 0, this.val = n;
}
function noop() {
}
function State(o) {
  this.head = o.head, this.tail = o.tail, this.len = o.len, this.next = o.states;
}
function Writer$1() {
  this.len = 0, this.head = new Op(noop, 0, 0), this.tail = this.head, this.states = null;
}
var create$1 = function o() {
  return util$4.Buffer ? function() {
    return (Writer$1.create = function() {
      return new BufferWriter$1();
    })();
  } : function() {
    return new Writer$1();
  };
};
Writer$1.create = create$1();
Writer$1.alloc = function o(t) {
  return new util$4.Array(t);
};
util$4.Array !== Array && (Writer$1.alloc = util$4.pool(Writer$1.alloc, util$4.Array.prototype.subarray));
Writer$1.prototype._push = function o(t, n, l) {
  return this.tail = this.tail.next = new Op(t, n, l), this.len += n, this;
};
function writeByte(o, t, n) {
  t[n] = o & 255;
}
function writeVarint32(o, t, n) {
  for (; o > 127; )
    t[n++] = o & 127 | 128, o >>>= 7;
  t[n] = o;
}
function VarintOp(o, t) {
  this.len = o, this.next = void 0, this.val = t;
}
VarintOp.prototype = Object.create(Op.prototype);
VarintOp.prototype.fn = writeVarint32;
Writer$1.prototype.uint32 = function o(t) {
  return this.len += (this.tail = this.tail.next = new VarintOp(
    (t = t >>> 0) < 128 ? 1 : t < 16384 ? 2 : t < 2097152 ? 3 : t < 268435456 ? 4 : 5,
    t
  )).len, this;
};
Writer$1.prototype.int32 = function o(t) {
  return t < 0 ? this._push(writeVarint64, 10, LongBits$1.fromNumber(t)) : this.uint32(t);
};
Writer$1.prototype.sint32 = function o(t) {
  return this.uint32((t << 1 ^ t >> 31) >>> 0);
};
function writeVarint64(o, t, n) {
  for (; o.hi; )
    t[n++] = o.lo & 127 | 128, o.lo = (o.lo >>> 7 | o.hi << 25) >>> 0, o.hi >>>= 7;
  for (; o.lo > 127; )
    t[n++] = o.lo & 127 | 128, o.lo = o.lo >>> 7;
  t[n++] = o.lo;
}
Writer$1.prototype.uint64 = function o(t) {
  var n = LongBits$1.from(t);
  return this._push(writeVarint64, n.length(), n);
};
Writer$1.prototype.int64 = Writer$1.prototype.uint64;
Writer$1.prototype.sint64 = function o(t) {
  var n = LongBits$1.from(t).zzEncode();
  return this._push(writeVarint64, n.length(), n);
};
Writer$1.prototype.bool = function o(t) {
  return this._push(writeByte, 1, t ? 1 : 0);
};
function writeFixed32(o, t, n) {
  t[n] = o & 255, t[n + 1] = o >>> 8 & 255, t[n + 2] = o >>> 16 & 255, t[n + 3] = o >>> 24;
}
Writer$1.prototype.fixed32 = function o(t) {
  return this._push(writeFixed32, 4, t >>> 0);
};
Writer$1.prototype.sfixed32 = Writer$1.prototype.fixed32;
Writer$1.prototype.fixed64 = function o(t) {
  var n = LongBits$1.from(t);
  return this._push(writeFixed32, 4, n.lo)._push(writeFixed32, 4, n.hi);
};
Writer$1.prototype.sfixed64 = Writer$1.prototype.fixed64;
Writer$1.prototype.float = function o(t) {
  return this._push(util$4.float.writeFloatLE, 4, t);
};
Writer$1.prototype.double = function o(t) {
  return this._push(util$4.float.writeDoubleLE, 8, t);
};
var writeBytes = util$4.Array.prototype.set ? function o(t, n, l) {
  n.set(t, l);
} : function o(t, n, l) {
  for (var r = 0; r < t.length; ++r)
    n[l + r] = t[r];
};
Writer$1.prototype.bytes = function o(t) {
  var n = t.length >>> 0;
  if (!n)
    return this._push(writeByte, 1, 0);
  if (util$4.isString(t)) {
    var l = Writer$1.alloc(n = base64.length(t));
    base64.decode(t, l, 0), t = l;
  }
  return this.uint32(n)._push(writeBytes, n, t);
};
Writer$1.prototype.string = function o(t) {
  var n = utf8$1.length(t);
  return n ? this.uint32(n)._push(utf8$1.write, n, t) : this._push(writeByte, 1, 0);
};
Writer$1.prototype.fork = function o() {
  return this.states = new State(this), this.head = this.tail = new Op(noop, 0, 0), this.len = 0, this;
};
Writer$1.prototype.reset = function o() {
  return this.states ? (this.head = this.states.head, this.tail = this.states.tail, this.len = this.states.len, this.states = this.states.next) : (this.head = this.tail = new Op(noop, 0, 0), this.len = 0), this;
};
Writer$1.prototype.ldelim = function o() {
  var t = this.head, n = this.tail, l = this.len;
  return this.reset().uint32(l), l && (this.tail.next = t.next, this.tail = n, this.len += l), this;
};
Writer$1.prototype.finish = function o() {
  for (var t = this.head.next, n = this.constructor.alloc(this.len), l = 0; t; )
    t.fn(t.val, n, l), l += t.len, t = t.next;
  return n;
};
Writer$1._configure = function(o) {
  BufferWriter$1 = o, Writer$1.create = create$1(), BufferWriter$1._configure();
};
var writer_buffer = BufferWriter, Writer = writer;
(BufferWriter.prototype = Object.create(Writer.prototype)).constructor = BufferWriter;
var util$3 = requireMinimal();
function BufferWriter() {
  Writer.call(this);
}
BufferWriter._configure = function() {
  BufferWriter.alloc = util$3._Buffer_allocUnsafe, BufferWriter.writeBytesBuffer = util$3.Buffer && util$3.Buffer.prototype instanceof Uint8Array && util$3.Buffer.prototype.set.name === "set" ? function(t, n, l) {
    n.set(t, l);
  } : function(t, n, l) {
    if (t.copy)
      t.copy(n, l, 0, t.length);
    else for (var r = 0; r < t.length; )
      n[l++] = t[r++];
  };
};
BufferWriter.prototype.bytes = function o(t) {
  util$3.isString(t) && (t = util$3._Buffer_from(t, "base64"));
  var n = t.length >>> 0;
  return this.uint32(n), n && this._push(BufferWriter.writeBytesBuffer, n, t), this;
};
function writeStringBuffer(o, t, n) {
  o.length < 40 ? util$3.utf8.write(o, t, n) : t.utf8Write ? t.utf8Write(o, n) : t.write(o, n);
}
BufferWriter.prototype.string = function o(t) {
  var n = util$3.Buffer.byteLength(t);
  return this.uint32(n), n && this._push(writeStringBuffer, n, t), this;
};
BufferWriter._configure();
var reader = Reader$1, util$2 = requireMinimal(), BufferReader$1, LongBits = util$2.LongBits, utf8 = util$2.utf8;
function indexOutOfRange(o, t) {
  return RangeError("index out of range: " + o.pos + " + " + (t || 1) + " > " + o.len);
}
function Reader$1(o) {
  this.buf = o, this.pos = 0, this.len = o.length;
}
var create_array = typeof Uint8Array < "u" ? function o(t) {
  if (t instanceof Uint8Array || Array.isArray(t))
    return new Reader$1(t);
  throw Error("illegal buffer");
} : function o(t) {
  if (Array.isArray(t))
    return new Reader$1(t);
  throw Error("illegal buffer");
}, create = function o() {
  return util$2.Buffer ? function(n) {
    return (Reader$1.create = function(r) {
      return util$2.Buffer.isBuffer(r) ? new BufferReader$1(r) : create_array(r);
    })(n);
  } : create_array;
};
Reader$1.create = create();
Reader$1.prototype._slice = util$2.Array.prototype.subarray || /* istanbul ignore next */
util$2.Array.prototype.slice;
Reader$1.prototype.uint32 = /* @__PURE__ */ (function o() {
  var t = 4294967295;
  return function() {
    if (t = (this.buf[this.pos] & 127) >>> 0, this.buf[this.pos++] < 128 || (t = (t | (this.buf[this.pos] & 127) << 7) >>> 0, this.buf[this.pos++] < 128) || (t = (t | (this.buf[this.pos] & 127) << 14) >>> 0, this.buf[this.pos++] < 128) || (t = (t | (this.buf[this.pos] & 127) << 21) >>> 0, this.buf[this.pos++] < 128) || (t = (t | (this.buf[this.pos] & 15) << 28) >>> 0, this.buf[this.pos++] < 128)) return t;
    if ((this.pos += 5) > this.len)
      throw this.pos = this.len, indexOutOfRange(this, 10);
    return t;
  };
})();
Reader$1.prototype.int32 = function o() {
  return this.uint32() | 0;
};
Reader$1.prototype.sint32 = function o() {
  var t = this.uint32();
  return t >>> 1 ^ -(t & 1) | 0;
};
function readLongVarint() {
  var o = new LongBits(0, 0), t = 0;
  if (this.len - this.pos > 4) {
    for (; t < 4; ++t)
      if (o.lo = (o.lo | (this.buf[this.pos] & 127) << t * 7) >>> 0, this.buf[this.pos++] < 128)
        return o;
    if (o.lo = (o.lo | (this.buf[this.pos] & 127) << 28) >>> 0, o.hi = (o.hi | (this.buf[this.pos] & 127) >> 4) >>> 0, this.buf[this.pos++] < 128)
      return o;
    t = 0;
  } else {
    for (; t < 3; ++t) {
      if (this.pos >= this.len)
        throw indexOutOfRange(this);
      if (o.lo = (o.lo | (this.buf[this.pos] & 127) << t * 7) >>> 0, this.buf[this.pos++] < 128)
        return o;
    }
    return o.lo = (o.lo | (this.buf[this.pos++] & 127) << t * 7) >>> 0, o;
  }
  if (this.len - this.pos > 4) {
    for (; t < 5; ++t)
      if (o.hi = (o.hi | (this.buf[this.pos] & 127) << t * 7 + 3) >>> 0, this.buf[this.pos++] < 128)
        return o;
  } else
    for (; t < 5; ++t) {
      if (this.pos >= this.len)
        throw indexOutOfRange(this);
      if (o.hi = (o.hi | (this.buf[this.pos] & 127) << t * 7 + 3) >>> 0, this.buf[this.pos++] < 128)
        return o;
    }
  throw Error("invalid varint encoding");
}
Reader$1.prototype.bool = function o() {
  return this.uint32() !== 0;
};
function readFixed32_end(o, t) {
  return (o[t - 4] | o[t - 3] << 8 | o[t - 2] << 16 | o[t - 1] << 24) >>> 0;
}
Reader$1.prototype.fixed32 = function o() {
  if (this.pos + 4 > this.len)
    throw indexOutOfRange(this, 4);
  return readFixed32_end(this.buf, this.pos += 4);
};
Reader$1.prototype.sfixed32 = function o() {
  if (this.pos + 4 > this.len)
    throw indexOutOfRange(this, 4);
  return readFixed32_end(this.buf, this.pos += 4) | 0;
};
function readFixed64() {
  if (this.pos + 8 > this.len)
    throw indexOutOfRange(this, 8);
  return new LongBits(readFixed32_end(this.buf, this.pos += 4), readFixed32_end(this.buf, this.pos += 4));
}
Reader$1.prototype.float = function o() {
  if (this.pos + 4 > this.len)
    throw indexOutOfRange(this, 4);
  var t = util$2.float.readFloatLE(this.buf, this.pos);
  return this.pos += 4, t;
};
Reader$1.prototype.double = function o() {
  if (this.pos + 8 > this.len)
    throw indexOutOfRange(this, 4);
  var t = util$2.float.readDoubleLE(this.buf, this.pos);
  return this.pos += 8, t;
};
Reader$1.prototype.bytes = function o() {
  var t = this.uint32(), n = this.pos, l = this.pos + t;
  if (l > this.len)
    throw indexOutOfRange(this, t);
  if (this.pos += t, Array.isArray(this.buf))
    return this.buf.slice(n, l);
  if (n === l) {
    var r = util$2.Buffer;
    return r ? r.alloc(0) : new this.buf.constructor(0);
  }
  return this._slice.call(this.buf, n, l);
};
Reader$1.prototype.string = function o() {
  var t = this.bytes();
  return utf8.read(t, 0, t.length);
};
Reader$1.prototype.skip = function o(t) {
  if (typeof t == "number") {
    if (this.pos + t > this.len)
      throw indexOutOfRange(this, t);
    this.pos += t;
  } else
    do
      if (this.pos >= this.len)
        throw indexOutOfRange(this);
    while (this.buf[this.pos++] & 128);
  return this;
};
Reader$1.prototype.skipType = function(o) {
  switch (o) {
    case 0:
      this.skip();
      break;
    case 1:
      this.skip(8);
      break;
    case 2:
      this.skip(this.uint32());
      break;
    case 3:
      for (; (o = this.uint32() & 7) !== 4; )
        this.skipType(o);
      break;
    case 5:
      this.skip(4);
      break;
    /* istanbul ignore next */
    default:
      throw Error("invalid wire type " + o + " at offset " + this.pos);
  }
  return this;
};
Reader$1._configure = function(o) {
  BufferReader$1 = o, Reader$1.create = create(), BufferReader$1._configure();
  var t = util$2.Long ? "toLong" : (
    /* istanbul ignore next */
    "toNumber"
  );
  util$2.merge(Reader$1.prototype, {
    int64: function() {
      return readLongVarint.call(this)[t](!1);
    },
    uint64: function() {
      return readLongVarint.call(this)[t](!0);
    },
    sint64: function() {
      return readLongVarint.call(this).zzDecode()[t](!1);
    },
    fixed64: function() {
      return readFixed64.call(this)[t](!0);
    },
    sfixed64: function() {
      return readFixed64.call(this)[t](!1);
    }
  });
};
var reader_buffer = BufferReader, Reader = reader;
(BufferReader.prototype = Object.create(Reader.prototype)).constructor = BufferReader;
var util$1 = requireMinimal();
function BufferReader(o) {
  Reader.call(this, o);
}
BufferReader._configure = function() {
  util$1.Buffer && (BufferReader.prototype._slice = util$1.Buffer.prototype.slice);
};
BufferReader.prototype.string = function o() {
  var t = this.uint32();
  return this.buf.utf8Slice ? this.buf.utf8Slice(this.pos, this.pos = Math.min(this.pos + t, this.len)) : this.buf.toString("utf-8", this.pos, this.pos = Math.min(this.pos + t, this.len));
};
BufferReader._configure();
var rpc = {}, service = Service, util = requireMinimal();
(Service.prototype = Object.create(util.EventEmitter.prototype)).constructor = Service;
function Service(o, t, n) {
  if (typeof o != "function")
    throw TypeError("rpcImpl must be a function");
  util.EventEmitter.call(this), this.rpcImpl = o, this.requestDelimited = !!t, this.responseDelimited = !!n;
}
Service.prototype.rpcCall = function o(t, n, l, r, a) {
  if (!r)
    throw TypeError("request must be specified");
  var e = this;
  if (!a)
    return util.asPromise(o, e, t, n, l, r);
  if (!e.rpcImpl) {
    setTimeout(function() {
      a(Error("already ended"));
    }, 0);
    return;
  }
  try {
    return e.rpcImpl(
      t,
      n[e.requestDelimited ? "encodeDelimited" : "encode"](r).finish(),
      function(s, c) {
        if (s)
          return e.emit("error", s, t), a(s);
        if (c === null) {
          e.end(
            /* endedByRPC */
            !0
          );
          return;
        }
        if (!(c instanceof l))
          try {
            c = l[e.responseDelimited ? "decodeDelimited" : "decode"](c);
          } catch (u) {
            return e.emit("error", u, t), a(u);
          }
        return e.emit("data", c, t), a(null, c);
      }
    );
  } catch (i) {
    e.emit("error", i, t), setTimeout(function() {
      a(i);
    }, 0);
    return;
  }
};
Service.prototype.end = function o(t) {
  return this.rpcImpl && (t || this.rpcImpl(null, null, null), this.rpcImpl = null, this.emit("end").off()), this;
};
(function(o) {
  var t = o;
  t.Service = service;
})(rpc);
var roots = {};
(function(o) {
  var t = o;
  t.build = "minimal", t.Writer = writer, t.BufferWriter = writer_buffer, t.Reader = reader, t.BufferReader = reader_buffer, t.util = requireMinimal(), t.rpc = rpc, t.roots = roots, t.configure = n;
  function n() {
    t.util._configure(), t.Writer._configure(t.BufferWriter), t.Reader._configure(t.BufferReader);
  }
  n();
})(indexMinimal);
var minimal = indexMinimal;
const $Reader = minimal.Reader, $Writer = minimal.Writer, $util = minimal.util, $root = minimal.roots.default || (minimal.roots.default = {}), com = $root.com = (() => {
  const o = {};
  return o.amazonaws = (function() {
    const t = {};
    return t.iot = (function() {
      const n = {};
      return n.securedtunneling = (function() {
        const l = {};
        return l.ProtocolV1Message = (function() {
          function r(a) {
            if (a)
              for (let e = Object.keys(a), i = 0; i < e.length; ++i)
                a[e[i]] != null && (this[e[i]] = a[e[i]]);
          }
          return r.prototype.type = 0, r.prototype.streamId = 0, r.prototype.ignorable = !1, r.prototype.payload = $util.newBuffer([]), r.create = function(e) {
            return new r(e);
          }, r.encode = function(e, i) {
            return i || (i = $Writer.create()), e.type != null && Object.hasOwnProperty.call(e, "type") && i.uint32(
              /* id 1, wireType 0 =*/
              8
            ).int32(e.type), e.streamId != null && Object.hasOwnProperty.call(e, "streamId") && i.uint32(
              /* id 2, wireType 0 =*/
              16
            ).int32(e.streamId), e.ignorable != null && Object.hasOwnProperty.call(e, "ignorable") && i.uint32(
              /* id 3, wireType 0 =*/
              24
            ).bool(e.ignorable), e.payload != null && Object.hasOwnProperty.call(e, "payload") && i.uint32(
              /* id 4, wireType 2 =*/
              34
            ).bytes(e.payload), i;
          }, r.encodeDelimited = function(e, i) {
            return this.encode(e, i).ldelim();
          }, r.decode = function(e, i, s) {
            e instanceof $Reader || (e = $Reader.create(e));
            let c = i === void 0 ? e.len : e.pos + i, u = new $root.com.amazonaws.iot.securedtunneling.ProtocolV1Message();
            for (; e.pos < c; ) {
              let f = e.uint32();
              if (f === s)
                break;
              switch (f >>> 3) {
                case 1: {
                  u.type = e.int32();
                  break;
                }
                case 2: {
                  u.streamId = e.int32();
                  break;
                }
                case 3: {
                  u.ignorable = e.bool();
                  break;
                }
                case 4: {
                  u.payload = e.bytes();
                  break;
                }
                default:
                  e.skipType(f & 7);
                  break;
              }
            }
            return u;
          }, r.decodeDelimited = function(e) {
            return e instanceof $Reader || (e = new $Reader(e)), this.decode(e, e.uint32());
          }, r.verify = function(e) {
            if (typeof e != "object" || e === null)
              return "object expected";
            if (e.type != null && e.hasOwnProperty("type"))
              switch (e.type) {
                default:
                  return "type: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                  break;
              }
            return e.streamId != null && e.hasOwnProperty("streamId") && !$util.isInteger(e.streamId) ? "streamId: integer expected" : e.ignorable != null && e.hasOwnProperty("ignorable") && typeof e.ignorable != "boolean" ? "ignorable: boolean expected" : e.payload != null && e.hasOwnProperty("payload") && !(e.payload && typeof e.payload.length == "number" || $util.isString(e.payload)) ? "payload: buffer expected" : null;
          }, r.fromObject = function(e) {
            if (e instanceof $root.com.amazonaws.iot.securedtunneling.ProtocolV1Message)
              return e;
            let i = new $root.com.amazonaws.iot.securedtunneling.ProtocolV1Message();
            switch (e.type) {
              default:
                if (typeof e.type == "number") {
                  i.type = e.type;
                  break;
                }
                break;
              case "UNKNOWN":
              case 0:
                i.type = 0;
                break;
              case "DATA":
              case 1:
                i.type = 1;
                break;
              case "STREAM_START":
              case 2:
                i.type = 2;
                break;
              case "STREAM_END":
              case 3:
                i.type = 3;
                break;
            }
            return e.streamId != null && (i.streamId = e.streamId | 0), e.ignorable != null && (i.ignorable = !!e.ignorable), e.payload != null && (typeof e.payload == "string" ? $util.base64.decode(e.payload, i.payload = $util.newBuffer($util.base64.length(e.payload)), 0) : e.payload.length >= 0 && (i.payload = e.payload)), i;
          }, r.toObject = function(e, i) {
            i || (i = {});
            let s = {};
            return i.defaults && (s.type = i.enums === String ? "UNKNOWN" : 0, s.streamId = 0, s.ignorable = !1, i.bytes === String ? s.payload = "" : (s.payload = [], i.bytes !== Array && (s.payload = $util.newBuffer(s.payload)))), e.type != null && e.hasOwnProperty("type") && (s.type = i.enums === String ? $root.com.amazonaws.iot.securedtunneling.ProtocolV1Message.Type[e.type] === void 0 ? e.type : $root.com.amazonaws.iot.securedtunneling.ProtocolV1Message.Type[e.type] : e.type), e.streamId != null && e.hasOwnProperty("streamId") && (s.streamId = e.streamId), e.ignorable != null && e.hasOwnProperty("ignorable") && (s.ignorable = e.ignorable), e.payload != null && e.hasOwnProperty("payload") && (s.payload = i.bytes === String ? $util.base64.encode(e.payload, 0, e.payload.length) : i.bytes === Array ? Array.prototype.slice.call(e.payload) : e.payload), s;
          }, r.prototype.toJSON = function() {
            return this.constructor.toObject(this, minimal.util.toJSONOptions);
          }, r.getTypeUrl = function(e) {
            return e === void 0 && (e = "type.googleapis.com"), e + "/com.amazonaws.iot.securedtunneling.ProtocolV1Message";
          }, r.Type = (function() {
            const a = {}, e = Object.create(a);
            return e[a[0] = "UNKNOWN"] = 0, e[a[1] = "DATA"] = 1, e[a[2] = "STREAM_START"] = 2, e[a[3] = "STREAM_END"] = 3, e;
          })(), r;
        })(), l.ProtocolV2Message = (function() {
          function r(a) {
            if (this.availableServiceIds = [], a)
              for (let e = Object.keys(a), i = 0; i < e.length; ++i)
                a[e[i]] != null && (this[e[i]] = a[e[i]]);
          }
          return r.prototype.type = 0, r.prototype.streamId = 0, r.prototype.ignorable = !1, r.prototype.payload = $util.newBuffer([]), r.prototype.serviceId = "", r.prototype.availableServiceIds = $util.emptyArray, r.create = function(e) {
            return new r(e);
          }, r.encode = function(e, i) {
            if (i || (i = $Writer.create()), e.type != null && Object.hasOwnProperty.call(e, "type") && i.uint32(
              /* id 1, wireType 0 =*/
              8
            ).int32(e.type), e.streamId != null && Object.hasOwnProperty.call(e, "streamId") && i.uint32(
              /* id 2, wireType 0 =*/
              16
            ).int32(e.streamId), e.ignorable != null && Object.hasOwnProperty.call(e, "ignorable") && i.uint32(
              /* id 3, wireType 0 =*/
              24
            ).bool(e.ignorable), e.payload != null && Object.hasOwnProperty.call(e, "payload") && i.uint32(
              /* id 4, wireType 2 =*/
              34
            ).bytes(e.payload), e.serviceId != null && Object.hasOwnProperty.call(e, "serviceId") && i.uint32(
              /* id 5, wireType 2 =*/
              42
            ).string(e.serviceId), e.availableServiceIds != null && e.availableServiceIds.length)
              for (let s = 0; s < e.availableServiceIds.length; ++s)
                i.uint32(
                  /* id 6, wireType 2 =*/
                  50
                ).string(e.availableServiceIds[s]);
            return i;
          }, r.encodeDelimited = function(e, i) {
            return this.encode(e, i).ldelim();
          }, r.decode = function(e, i, s) {
            e instanceof $Reader || (e = $Reader.create(e));
            let c = i === void 0 ? e.len : e.pos + i, u = new $root.com.amazonaws.iot.securedtunneling.ProtocolV2Message();
            for (; e.pos < c; ) {
              let f = e.uint32();
              if (f === s)
                break;
              switch (f >>> 3) {
                case 1: {
                  u.type = e.int32();
                  break;
                }
                case 2: {
                  u.streamId = e.int32();
                  break;
                }
                case 3: {
                  u.ignorable = e.bool();
                  break;
                }
                case 4: {
                  u.payload = e.bytes();
                  break;
                }
                case 5: {
                  u.serviceId = e.string();
                  break;
                }
                case 6: {
                  u.availableServiceIds && u.availableServiceIds.length || (u.availableServiceIds = []), u.availableServiceIds.push(e.string());
                  break;
                }
                default:
                  e.skipType(f & 7);
                  break;
              }
            }
            return u;
          }, r.decodeDelimited = function(e) {
            return e instanceof $Reader || (e = new $Reader(e)), this.decode(e, e.uint32());
          }, r.verify = function(e) {
            if (typeof e != "object" || e === null)
              return "object expected";
            if (e.type != null && e.hasOwnProperty("type"))
              switch (e.type) {
                default:
                  return "type: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                  break;
              }
            if (e.streamId != null && e.hasOwnProperty("streamId") && !$util.isInteger(e.streamId))
              return "streamId: integer expected";
            if (e.ignorable != null && e.hasOwnProperty("ignorable") && typeof e.ignorable != "boolean")
              return "ignorable: boolean expected";
            if (e.payload != null && e.hasOwnProperty("payload") && !(e.payload && typeof e.payload.length == "number" || $util.isString(e.payload)))
              return "payload: buffer expected";
            if (e.serviceId != null && e.hasOwnProperty("serviceId") && !$util.isString(e.serviceId))
              return "serviceId: string expected";
            if (e.availableServiceIds != null && e.hasOwnProperty("availableServiceIds")) {
              if (!Array.isArray(e.availableServiceIds))
                return "availableServiceIds: array expected";
              for (let i = 0; i < e.availableServiceIds.length; ++i)
                if (!$util.isString(e.availableServiceIds[i]))
                  return "availableServiceIds: string[] expected";
            }
            return null;
          }, r.fromObject = function(e) {
            if (e instanceof $root.com.amazonaws.iot.securedtunneling.ProtocolV2Message)
              return e;
            let i = new $root.com.amazonaws.iot.securedtunneling.ProtocolV2Message();
            switch (e.type) {
              default:
                if (typeof e.type == "number") {
                  i.type = e.type;
                  break;
                }
                break;
              case "UNKNOWN":
              case 0:
                i.type = 0;
                break;
              case "DATA":
              case 1:
                i.type = 1;
                break;
              case "STREAM_START":
              case 2:
                i.type = 2;
                break;
              case "STREAM_RESET":
              case 3:
                i.type = 3;
                break;
              case "SESSION_RESET":
              case 4:
                i.type = 4;
                break;
              case "SERVICE_IDS":
              case 5:
                i.type = 5;
                break;
            }
            if (e.streamId != null && (i.streamId = e.streamId | 0), e.ignorable != null && (i.ignorable = !!e.ignorable), e.payload != null && (typeof e.payload == "string" ? $util.base64.decode(e.payload, i.payload = $util.newBuffer($util.base64.length(e.payload)), 0) : e.payload.length >= 0 && (i.payload = e.payload)), e.serviceId != null && (i.serviceId = String(e.serviceId)), e.availableServiceIds) {
              if (!Array.isArray(e.availableServiceIds))
                throw TypeError(".com.amazonaws.iot.securedtunneling.ProtocolV2Message.availableServiceIds: array expected");
              i.availableServiceIds = [];
              for (let s = 0; s < e.availableServiceIds.length; ++s)
                i.availableServiceIds[s] = String(e.availableServiceIds[s]);
            }
            return i;
          }, r.toObject = function(e, i) {
            i || (i = {});
            let s = {};
            if ((i.arrays || i.defaults) && (s.availableServiceIds = []), i.defaults && (s.type = i.enums === String ? "UNKNOWN" : 0, s.streamId = 0, s.ignorable = !1, i.bytes === String ? s.payload = "" : (s.payload = [], i.bytes !== Array && (s.payload = $util.newBuffer(s.payload))), s.serviceId = ""), e.type != null && e.hasOwnProperty("type") && (s.type = i.enums === String ? $root.com.amazonaws.iot.securedtunneling.ProtocolV2Message.Type[e.type] === void 0 ? e.type : $root.com.amazonaws.iot.securedtunneling.ProtocolV2Message.Type[e.type] : e.type), e.streamId != null && e.hasOwnProperty("streamId") && (s.streamId = e.streamId), e.ignorable != null && e.hasOwnProperty("ignorable") && (s.ignorable = e.ignorable), e.payload != null && e.hasOwnProperty("payload") && (s.payload = i.bytes === String ? $util.base64.encode(e.payload, 0, e.payload.length) : i.bytes === Array ? Array.prototype.slice.call(e.payload) : e.payload), e.serviceId != null && e.hasOwnProperty("serviceId") && (s.serviceId = e.serviceId), e.availableServiceIds && e.availableServiceIds.length) {
              s.availableServiceIds = [];
              for (let c = 0; c < e.availableServiceIds.length; ++c)
                s.availableServiceIds[c] = e.availableServiceIds[c];
            }
            return s;
          }, r.prototype.toJSON = function() {
            return this.constructor.toObject(this, minimal.util.toJSONOptions);
          }, r.getTypeUrl = function(e) {
            return e === void 0 && (e = "type.googleapis.com"), e + "/com.amazonaws.iot.securedtunneling.ProtocolV2Message";
          }, r.Type = (function() {
            const a = {}, e = Object.create(a);
            return e[a[0] = "UNKNOWN"] = 0, e[a[1] = "DATA"] = 1, e[a[2] = "STREAM_START"] = 2, e[a[3] = "STREAM_RESET"] = 3, e[a[4] = "SESSION_RESET"] = 4, e[a[5] = "SERVICE_IDS"] = 5, e;
          })(), r;
        })(), l.ProtocolV3Message = (function() {
          function r(a) {
            if (this.availableServiceIds = [], a)
              for (let e = Object.keys(a), i = 0; i < e.length; ++i)
                a[e[i]] != null && (this[e[i]] = a[e[i]]);
          }
          return r.prototype.type = 0, r.prototype.streamId = 0, r.prototype.ignorable = !1, r.prototype.payload = $util.newBuffer([]), r.prototype.serviceId = "", r.prototype.availableServiceIds = $util.emptyArray, r.prototype.connectionId = 0, r.create = function(e) {
            return new r(e);
          }, r.encode = function(e, i) {
            if (i || (i = $Writer.create()), e.type != null && Object.hasOwnProperty.call(e, "type") && i.uint32(
              /* id 1, wireType 0 =*/
              8
            ).int32(e.type), e.streamId != null && Object.hasOwnProperty.call(e, "streamId") && i.uint32(
              /* id 2, wireType 0 =*/
              16
            ).int32(e.streamId), e.ignorable != null && Object.hasOwnProperty.call(e, "ignorable") && i.uint32(
              /* id 3, wireType 0 =*/
              24
            ).bool(e.ignorable), e.payload != null && Object.hasOwnProperty.call(e, "payload") && i.uint32(
              /* id 4, wireType 2 =*/
              34
            ).bytes(e.payload), e.serviceId != null && Object.hasOwnProperty.call(e, "serviceId") && i.uint32(
              /* id 5, wireType 2 =*/
              42
            ).string(e.serviceId), e.availableServiceIds != null && e.availableServiceIds.length)
              for (let s = 0; s < e.availableServiceIds.length; ++s)
                i.uint32(
                  /* id 6, wireType 2 =*/
                  50
                ).string(e.availableServiceIds[s]);
            return e.connectionId != null && Object.hasOwnProperty.call(e, "connectionId") && i.uint32(
              /* id 7, wireType 0 =*/
              56
            ).uint32(e.connectionId), i;
          }, r.encodeDelimited = function(e, i) {
            return this.encode(e, i).ldelim();
          }, r.decode = function(e, i, s) {
            e instanceof $Reader || (e = $Reader.create(e));
            let c = i === void 0 ? e.len : e.pos + i, u = new $root.com.amazonaws.iot.securedtunneling.ProtocolV3Message();
            for (; e.pos < c; ) {
              let f = e.uint32();
              if (f === s)
                break;
              switch (f >>> 3) {
                case 1: {
                  u.type = e.int32();
                  break;
                }
                case 2: {
                  u.streamId = e.int32();
                  break;
                }
                case 3: {
                  u.ignorable = e.bool();
                  break;
                }
                case 4: {
                  u.payload = e.bytes();
                  break;
                }
                case 5: {
                  u.serviceId = e.string();
                  break;
                }
                case 6: {
                  u.availableServiceIds && u.availableServiceIds.length || (u.availableServiceIds = []), u.availableServiceIds.push(e.string());
                  break;
                }
                case 7: {
                  u.connectionId = e.uint32();
                  break;
                }
                default:
                  e.skipType(f & 7);
                  break;
              }
            }
            return u;
          }, r.decodeDelimited = function(e) {
            return e instanceof $Reader || (e = new $Reader(e)), this.decode(e, e.uint32());
          }, r.verify = function(e) {
            if (typeof e != "object" || e === null)
              return "object expected";
            if (e.type != null && e.hasOwnProperty("type"))
              switch (e.type) {
                default:
                  return "type: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                  break;
              }
            if (e.streamId != null && e.hasOwnProperty("streamId") && !$util.isInteger(e.streamId))
              return "streamId: integer expected";
            if (e.ignorable != null && e.hasOwnProperty("ignorable") && typeof e.ignorable != "boolean")
              return "ignorable: boolean expected";
            if (e.payload != null && e.hasOwnProperty("payload") && !(e.payload && typeof e.payload.length == "number" || $util.isString(e.payload)))
              return "payload: buffer expected";
            if (e.serviceId != null && e.hasOwnProperty("serviceId") && !$util.isString(e.serviceId))
              return "serviceId: string expected";
            if (e.availableServiceIds != null && e.hasOwnProperty("availableServiceIds")) {
              if (!Array.isArray(e.availableServiceIds))
                return "availableServiceIds: array expected";
              for (let i = 0; i < e.availableServiceIds.length; ++i)
                if (!$util.isString(e.availableServiceIds[i]))
                  return "availableServiceIds: string[] expected";
            }
            return e.connectionId != null && e.hasOwnProperty("connectionId") && !$util.isInteger(e.connectionId) ? "connectionId: integer expected" : null;
          }, r.fromObject = function(e) {
            if (e instanceof $root.com.amazonaws.iot.securedtunneling.ProtocolV3Message)
              return e;
            let i = new $root.com.amazonaws.iot.securedtunneling.ProtocolV3Message();
            switch (e.type) {
              default:
                if (typeof e.type == "number") {
                  i.type = e.type;
                  break;
                }
                break;
              case "UNKNOWN":
              case 0:
                i.type = 0;
                break;
              case "DATA":
              case 1:
                i.type = 1;
                break;
              case "STREAM_START":
              case 2:
                i.type = 2;
                break;
              case "STREAM_RESET":
              case 3:
                i.type = 3;
                break;
              case "SESSION_RESET":
              case 4:
                i.type = 4;
                break;
              case "SERVICE_IDS":
              case 5:
                i.type = 5;
                break;
              case "CONNECTION_START":
              case 6:
                i.type = 6;
                break;
              case "CONNECTION_RESET":
              case 7:
                i.type = 7;
                break;
            }
            if (e.streamId != null && (i.streamId = e.streamId | 0), e.ignorable != null && (i.ignorable = !!e.ignorable), e.payload != null && (typeof e.payload == "string" ? $util.base64.decode(e.payload, i.payload = $util.newBuffer($util.base64.length(e.payload)), 0) : e.payload.length >= 0 && (i.payload = e.payload)), e.serviceId != null && (i.serviceId = String(e.serviceId)), e.availableServiceIds) {
              if (!Array.isArray(e.availableServiceIds))
                throw TypeError(".com.amazonaws.iot.securedtunneling.ProtocolV3Message.availableServiceIds: array expected");
              i.availableServiceIds = [];
              for (let s = 0; s < e.availableServiceIds.length; ++s)
                i.availableServiceIds[s] = String(e.availableServiceIds[s]);
            }
            return e.connectionId != null && (i.connectionId = e.connectionId >>> 0), i;
          }, r.toObject = function(e, i) {
            i || (i = {});
            let s = {};
            if ((i.arrays || i.defaults) && (s.availableServiceIds = []), i.defaults && (s.type = i.enums === String ? "UNKNOWN" : 0, s.streamId = 0, s.ignorable = !1, i.bytes === String ? s.payload = "" : (s.payload = [], i.bytes !== Array && (s.payload = $util.newBuffer(s.payload))), s.serviceId = "", s.connectionId = 0), e.type != null && e.hasOwnProperty("type") && (s.type = i.enums === String ? $root.com.amazonaws.iot.securedtunneling.ProtocolV3Message.Type[e.type] === void 0 ? e.type : $root.com.amazonaws.iot.securedtunneling.ProtocolV3Message.Type[e.type] : e.type), e.streamId != null && e.hasOwnProperty("streamId") && (s.streamId = e.streamId), e.ignorable != null && e.hasOwnProperty("ignorable") && (s.ignorable = e.ignorable), e.payload != null && e.hasOwnProperty("payload") && (s.payload = i.bytes === String ? $util.base64.encode(e.payload, 0, e.payload.length) : i.bytes === Array ? Array.prototype.slice.call(e.payload) : e.payload), e.serviceId != null && e.hasOwnProperty("serviceId") && (s.serviceId = e.serviceId), e.availableServiceIds && e.availableServiceIds.length) {
              s.availableServiceIds = [];
              for (let c = 0; c < e.availableServiceIds.length; ++c)
                s.availableServiceIds[c] = e.availableServiceIds[c];
            }
            return e.connectionId != null && e.hasOwnProperty("connectionId") && (s.connectionId = e.connectionId), s;
          }, r.prototype.toJSON = function() {
            return this.constructor.toObject(this, minimal.util.toJSONOptions);
          }, r.getTypeUrl = function(e) {
            return e === void 0 && (e = "type.googleapis.com"), e + "/com.amazonaws.iot.securedtunneling.ProtocolV3Message";
          }, r.Type = (function() {
            const a = {}, e = Object.create(a);
            return e[a[0] = "UNKNOWN"] = 0, e[a[1] = "DATA"] = 1, e[a[2] = "STREAM_START"] = 2, e[a[3] = "STREAM_RESET"] = 3, e[a[4] = "SESSION_RESET"] = 4, e[a[5] = "SERVICE_IDS"] = 5, e[a[6] = "CONNECTION_START"] = 6, e[a[7] = "CONNECTION_RESET"] = 7, e;
          })(), r;
        })(), l;
      })(), n;
    })(), t;
  })(), o;
})(), ProtocolV1Message = com.amazonaws.iot.securedtunneling.ProtocolV1Message, ProtocolV2Message = com.amazonaws.iot.securedtunneling.ProtocolV2Message, ProtocolV3Message = com.amazonaws.iot.securedtunneling.ProtocolV3Message, TunnelMessageType = {
  UNKNOWN: 0,
  DATA: 1,
  STREAM_START: 2,
  STREAM_RESET: 3,
  SESSION_RESET: 4,
  SERVICE_IDS: 5,
  CONNECTION_START: 6,
  CONNECTION_RESET: 7
};
class SecureTunnelTransport {
  constructor(t, n) {
    switch (this.ws = null, this.streamId = 1, this.connectionId = 1, this.isConnected = !1, this.tunnelReady = !1, this.messageQueue = [], this.receiveBuffer = new Uint8Array(0), this.id = t, this.config = {
      protocol: "V2",
      ...n
    }, this.config.protocol) {
      case "V1":
        this.messageClass = ProtocolV1Message;
        break;
      case "V2":
        this.messageClass = ProtocolV2Message;
        break;
      case "V3":
        this.messageClass = ProtocolV3Message;
        break;
      default:
        this.messageClass = ProtocolV2Message;
    }
  }
  /**
   * Connect to AWS IoT Secure Tunnel WebSocket endpoint
   */
  async connect() {
    const t = this.buildWebSocketUrl(), r = `aws.iot.securetunneling-${(this.config.protocol || "V2").replace("V", "")}.0`;
    return console.log(`Connecting with WebSocket subprotocol: ${r}`), new Promise((a, e) => {
      try {
        this.ws = new WebSocket(t, r), this.ws.binaryType = "arraybuffer", this.ws.onopen = () => {
          console.log("AWS IoT Secure Tunnel WebSocket connected"), this.isConnected = !0, this.config.clientMode === "destination" ? this.config.serviceId && (console.log(
            "Sending SERVICE_IDS message with serviceId:",
            this.config.serviceId
          ), this.sendControlMessage(TunnelMessageType.SERVICE_IDS, {
            availableServiceIds: [this.config.serviceId]
          })) : (console.log(
            "Source mode: Sending STREAM_START with streamId:",
            this.streamId
          ), this.sendControlMessage(TunnelMessageType.STREAM_START, {
            streamId: this.streamId,
            serviceId: this.config.serviceId
          })), console.log("Waiting for tunnel handshake to complete..."), a();
        }, this.ws.onerror = (i) => {
          const s = new Error(
            "WebSocket error connecting to AWS IoT Secure Tunnel"
          );
          this.onError && this.onError(s), e(s);
        }, this.ws.onmessage = (i) => {
          i.data instanceof ArrayBuffer && this.handleIncomingData(new Uint8Array(i.data));
        }, this.ws.onclose = (i) => {
          console.log("AWS IoT Secure Tunnel WebSocket closed", {
            code: i.code,
            reason: i.reason,
            wasClean: i.wasClean
          }), this.isConnected = !1, this.tunnelReady = !1, this.onClose && this.onClose();
        };
      } catch (i) {
        e(i);
      }
    });
  }
  /**
   * Disconnect from the tunnel
   */
  async disconnect() {
    this.ws && (this.sendControlMessage(TunnelMessageType.STREAM_RESET, {
      streamId: this.streamId
    }), this.ws.close(), this.ws = null), this.isConnected = !1, this.tunnelReady = !1;
  }
  /**
   * Send data through the tunnel
   */
  async send(t) {
    if (!this.isConnected || !this.ws || !this.tunnelReady) {
      console.log(
        "Queueing message, tunnel not ready. Connected:",
        this.isConnected,
        "Ready:",
        this.tunnelReady
      ), this.messageQueue.push(t);
      return;
    }
    this.sendDataFrame(t);
  }
  /**
   * Process queued messages once tunnel is ready
   */
  processQueuedMessages() {
    for (console.log(`Processing ${this.messageQueue.length} queued messages`); this.messageQueue.length > 0; ) {
      const t = this.messageQueue.shift();
      t && this.sendDataFrame(t);
    }
  }
  /**
   * Build the WebSocket URL for AWS IoT Secure Tunneling
   */
  buildWebSocketUrl() {
    const t = `wss://data.tunneling.iot.${this.config.region}.amazonaws.com/tunnel`;
    if (!this.config.accessToken)
      throw console.error("AWS IoT Secure Tunnel: Access token is missing or empty"), new Error(
        "Access token is required for AWS IoT Secure Tunnel connection"
      );
    const n = encodeURIComponent(this.config.accessToken), l = `${t}?local-proxy-mode=${this.config.clientMode}&access-token=${n}`;
    return console.log("AWS IoT Secure Tunnel URL:", l.substring(0, 100) + "..."), console.log("Protocol version:", this.config.protocol || "V2"), l;
  }
  /**
   * Send a control message through the tunnel
   */
  sendControlMessage(t, n = {}) {
    const l = {
      type: t,
      ...n
    };
    console.log("Sending control message:", {
      type: this.getMessageTypeName(t),
      ...n
    });
    const r = this.encodeMessage(l);
    console.log(
      "Encoded message bytes:",
      Array.from(r).map((a) => a.toString(16).padStart(2, "0")).join(" ")
    ), this.sendFrame(r);
  }
  /**
   * Send a data frame through the tunnel
   */
  sendDataFrame(t) {
    for (let l = 0; l < t.length; l += 64512) {
      const r = t.slice(l, Math.min(l + 64512, t.length)), a = {
        type: TunnelMessageType.DATA,
        streamId: this.streamId,
        payload: r
      };
      this.config.serviceId && this.config.protocol !== "V1" && (a.serviceId = this.config.serviceId), this.config.protocol === "V3" && (a.connectionId = this.connectionId), console.log("Sending DATA message with:", {
        type: "DATA",
        streamId: this.streamId,
        serviceId: this.config.serviceId,
        connectionId: this.config.protocol === "V3" ? this.connectionId : void 0,
        payloadSize: r.length
      });
      const e = this.encodeMessage(a);
      this.sendFrame(e);
    }
  }
  /**
   * Send a frame with length prefix
   */
  sendFrame(t) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send frame: WebSocket not open");
      return;
    }
    const n = new Uint8Array(2 + t.length);
    new DataView(n.buffer).setUint16(0, t.length, !1), n.set(t, 2), console.log(
      "Sending frame with length:",
      t.length,
      "Total frame size:",
      n.length
    ), console.log(
      "Frame bytes (first 20):",
      Array.from(n.slice(0, Math.min(20, n.length))).map((r) => r.toString(16).padStart(2, "0")).join(" ")
    ), this.ws.send(n.buffer);
  }
  /**
   * Handle incoming WebSocket data
   */
  handleIncomingData(t) {
    const n = new Uint8Array(this.receiveBuffer.length + t.length);
    for (n.set(this.receiveBuffer), n.set(t, this.receiveBuffer.length), this.receiveBuffer = n; this.receiveBuffer.length >= 2; ) {
      const r = new DataView(
        this.receiveBuffer.buffer,
        this.receiveBuffer.byteOffset
      ).getUint16(0, !1);
      if (this.receiveBuffer.length < 2 + r)
        break;
      const a = this.receiveBuffer.slice(2, 2 + r);
      this.receiveBuffer = this.receiveBuffer.slice(2 + r), console.log(
        "Received frame bytes:",
        Array.from(a).map((e) => e.toString(16).padStart(2, "0")).join(" ")
      );
      try {
        const e = this.decodeMessage(a);
        this.handleMessage(e);
      } catch (e) {
        console.error("Error decoding message:", e), this.onError && this.onError(e);
      }
    }
  }
  /**
   * Handle a decoded tunnel message
   */
  handleMessage(t) {
    var n;
    switch (console.log("Received message:", {
      type: this.getMessageTypeName(t.type),
      streamId: t.streamId,
      connectionId: t.connectionId,
      serviceId: t.serviceId,
      availableServiceIds: t.availableServiceIds,
      payloadSize: (n = t.payload) == null ? void 0 : n.length
    }), t.type) {
      case TunnelMessageType.DATA:
        t.payload && this.onData && this.onData(t.payload);
        break;
      case TunnelMessageType.STREAM_START:
        console.log("Stream started:", t.streamId), this.config.clientMode === "destination" && t.streamId !== void 0 && t.streamId !== null && (this.streamId = t.streamId, console.log("Destination mode: Updated streamId to", this.streamId), this.tunnelReady = !0, this.processQueuedMessages());
        break;
      case TunnelMessageType.STREAM_RESET:
        console.log("Stream reset:", t.streamId), this.onClose && this.onClose();
        break;
      case TunnelMessageType.SESSION_RESET:
        console.log("Session reset"), this.disconnect();
        break;
      case TunnelMessageType.SERVICE_IDS:
        console.log("Available service IDs:", t.availableServiceIds), this.config.clientMode === "source" && (console.log("Source mode: Tunnel ready after receiving SERVICE_IDS"), this.tunnelReady = !0, this.processQueuedMessages());
        break;
      case TunnelMessageType.CONNECTION_START:
        console.log("Connection started:", t.connectionId);
        break;
      case TunnelMessageType.CONNECTION_RESET:
        console.log("Connection reset:", t.connectionId);
        break;
    }
  }
  /**
   * Encode a message using protobufjs
   */
  encodeMessage(t) {
    const n = this.messageClass.create(t);
    return this.messageClass.encode(n).finish();
  }
  /**
   * Decode a message using protobufjs
   */
  decodeMessage(t) {
    return this.messageClass.decode(t);
  }
  /**
   * Get message type name for logging
   */
  getMessageTypeName(t) {
    return {
      0: "UNKNOWN",
      1: "DATA",
      2: "STREAM_START",
      3: this.config.protocol === "V1" ? "STREAM_END" : "STREAM_RESET",
      4: "SESSION_RESET",
      5: "SERVICE_IDS",
      6: "CONNECTION_START",
      7: "CONNECTION_RESET"
    }[t] || `UNKNOWN_${t}`;
  }
}
function detectFramework() {
  return typeof window > "u" ? "generic" : window.__NEXT_DATA__ || window.next ? "nextjs" : window.__vite_plugin_react_preamble_installed__ ? "vite" : window.__webpack_require__ ? "webpack" : "generic";
}
function getAssetPaths(o) {
  const t = detectFramework(), n = o.publicDir || "/";
  if (o.wasmPath && o.wasmExecPath)
    return {
      wasmPath: o.wasmPath,
      wasmExecPath: o.wasmExecPath
    };
  switch (t) {
    case "nextjs":
      return {
        wasmPath: o.wasmPath || `${n}sshclient.wasm`,
        wasmExecPath: o.wasmExecPath || `${n}wasm_exec.js`
      };
    case "vite":
      return {
        wasmPath: o.wasmPath || `${n}sshclient.wasm`,
        wasmExecPath: o.wasmExecPath || `${n}wasm_exec.js`
      };
    default:
      return {
        wasmPath: o.wasmPath || `${n}sshclient.wasm`,
        wasmExecPath: o.wasmExecPath || `${n}wasm_exec.js`
      };
  }
}
async function loadWasmExecutor(o, t = 1e4) {
  if (!(typeof window > "u") && !window.Go)
    return new Promise((n, l) => {
      const r = document.createElement("script");
      r.src = o, r.onload = () => n(), r.onerror = () => l(new Error(`Failed to load wasm_exec.js from ${o}`));
      const a = setTimeout(() => {
        l(new Error(`Timeout loading wasm_exec.js from ${o}`));
      }, t);
      r.onload = () => {
        clearTimeout(a), n();
      }, document.head.appendChild(r);
    });
}
async function testAssetAvailability(o, t) {
  const n = async (a) => {
    try {
      return (await fetch(a, { method: "HEAD" })).ok;
    } catch {
      return !1;
    }
  }, [l, r] = await Promise.all([
    n(o),
    n(t)
  ]);
  return { wasmAvailable: l, wasmExecAvailable: r };
}
const w = class w {
  static async initialize(t = {}) {
    var l;
    if (this.initialized)
      return;
    const n = typeof t == "string" ? { wasmPath: t, autoDetect: !1 } : { autoDetect: !0, cacheBusting: !0, timeout: 1e4, ...t };
    try {
      const { wasmPath: r, wasmExecPath: a } = getAssetPaths(n);
      if (n.autoDetect) {
        const { wasmAvailable: d, wasmExecAvailable: p } = await testAssetAvailability(r, a);
        if (!d)
          throw new Error(`WASM file not found at ${r}. Please ensure sshclient.wasm is in your public directory.`);
        if (!p)
          throw new Error(`wasm_exec.js not found at ${a}. Please ensure wasm_exec.js is in your public directory.`);
      }
      if (await loadWasmExecutor(a, n.timeout), typeof window.Go > "u")
        throw new Error(
          `Go runtime not loaded. Failed to load wasm_exec.js from ${a}.`
        );
      const e = new window.Go();
      let i = r;
      if (n.cacheBusting) {
        const d = `?v=${Date.now()}&t=${(/* @__PURE__ */ new Date()).getTime()}`;
        i += d;
      }
      const s = n.cacheBusting ? {
        cache: "no-cache",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        }
      } : {}, c = await fetch(i, s);
      if (!c.ok)
        throw new Error(`Failed to fetch WASM file: ${c.status} ${c.statusText}`);
      const u = await c.arrayBuffer(), f = await WebAssembly.instantiate(u, e.importObject);
      if (e.run(f.instance), await new Promise((d) => setTimeout(d, 100)), this.wasmInstance = window.SSHClient, !this.wasmInstance)
        throw new Error(
          "Failed to initialize WASM module - SSHClient not found on window. The WASM module may not have loaded correctly."
        );
      this.transportManager.setWasmInstance(this.wasmInstance), this.initialized = !0, typeof process < "u" && ((l = process.env) == null ? void 0 : l.NODE_ENV) === "development" && (console.log("SSHClient WASM initialized successfully"), this.wasmInstance.version && console.log(`Version: ${this.wasmInstance.version()}`));
    } catch (r) {
      throw this.initialized = !1, r instanceof Error ? new Error(`SSHClient initialization failed: ${r.message}`) : new Error("SSHClient initialization failed with unknown error");
    }
  }
  static async connect(t, n, l) {
    if (!this.initialized)
      throw new Error("SSHClient not initialized. Call initialize() first.");
    await this.transportManager.createTransport(n), await n.connect();
    const r = l ? {
      onPacketSend: (e, i) => {
        l.onPacketSend && l.onPacketSend(e, i);
      },
      onPacketReceive: (e, i) => {
        l.onPacketReceive && l.onPacketReceive(e, i);
      },
      onStateChange: l.onStateChange
    } : void 0, a = await this.wasmInstance.connect(
      t,
      n.id,
      r
    );
    return {
      sessionId: a.sessionId,
      send: async (e) => {
        await a.send(e);
      },
      disconnect: async () => {
        await a.disconnect(), await this.transportManager.closeTransport(n.id);
      },
      resizeTerminal: async (e, i) => {
        await a.resizeTerminal(e, i);
      }
    };
  }
  static async disconnect(t) {
    if (!this.initialized)
      throw new Error("SSHClient not initialized");
    await this.wasmInstance.disconnect(t);
  }
  static async send(t, n) {
    if (!this.initialized)
      throw new Error("SSHClient not initialized");
    await this.wasmInstance.send(t, n);
  }
  static getVersion() {
    if (!this.initialized)
      throw new Error("SSHClient not initialized");
    return this.wasmInstance.version();
  }
};
w.initialized = !1, w.transportManager = TransportManager.getInstance();
let SSHClient = w;
class PacketTransformer {
  static toProtobuf(t, n) {
    return t;
  }
  static fromProtobuf(t, n) {
    return t;
  }
  static toBase64(t) {
    return btoa(String.fromCharCode(...t));
  }
  static fromBase64(t) {
    const n = atob(t), l = new Uint8Array(n.length);
    for (let r = 0; r < n.length; r++)
      l[r] = n.charCodeAt(r);
    return l;
  }
}
const SSHClientHelpers = {
  /**
   * Get recommended asset paths for the detected framework
   */
  getAssetPaths: (o = "/") => getAssetPaths({ publicDir: o }),
  /**
   * Detect the current framework
   */
  detectFramework,
  /**
   * Test if WASM assets are available at the given paths
   */
  testAssetAvailability,
  /**
   * Next.js specific initialization helper
   */
  initializeForNextJS: async (o = {}) => SSHClient.initialize({
    publicDir: "/",
    autoDetect: !0,
    cacheBusting: process.env.NODE_ENV === "development",
    ...o
  }),
  /**
   * Vite specific initialization helper
   */
  initializeForVite: async (o = {}) => {
    var n, l, r;
    let t = !1;
    try {
      t = ((r = (l = (n = globalThis.import) == null ? void 0 : n.meta) == null ? void 0 : l.env) == null ? void 0 : r.DEV) === !0;
    } catch {
      t = !1;
    }
    return SSHClient.initialize({
      publicDir: "/",
      autoDetect: !0,
      cacheBusting: t,
      ...o
    });
  },
  /**
   * Generic initialization with sensible defaults
   */
  initializeWithDefaults: async (o = {}) => {
    const t = {
      autoDetect: !0,
      cacheBusting: !0,
      timeout: 1e4,
      publicDir: "/"
    };
    return SSHClient.initialize({ ...t, ...o });
  }
};
export {
  CustomTransport,
  PacketTransformer,
  SSHClient,
  SSHClientHelpers,
  SecureTunnelTransport,
  TunnelMessageType,
  WebSocketTransport,
  SSHClient as default
};
//# sourceMappingURL=index.esm.js.map
