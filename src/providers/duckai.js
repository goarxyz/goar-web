/**
 * Duck.ai — duckchat/v1.
 *
 * Status returns x-vqd-hash-1 (obfuscated async JS). Eval it in this page
 * (needs document/navigator), POST the solved JSON as x-vqd-hash-1.
 * Chat replies mint x-vqd-4 for the next turn.
 *
 * Transport: libcurl+WISP for GET (status/models). POST often 418 on
 * shared WISP IPs — Kali curl (segfault.net) is the production hop.
 */
(function (global) {
  "use strict";

  const ORIGIN = "https://duckduckgo.com";
  const STATUS = ORIGIN + "/duckchat/v1/status";
  const CHAT = ORIGIN + "/duckchat/v1/chat";
  const MODELS = ORIGIN + "/duckchat/v1/models";
  const FREE_MODELS = [
    "gpt-5.4-mini",
    "gpt-5.6-luna",
    "claude-haiku-4-5",
    "mistral-small-2603",
    "tinfoil/gpt-oss-120b",
    "tinfoil/gemma4-31b",
  ];

  let session = { vqd: "", hash: "", at: 0, via: "" };

  function isDuckProvider(provider, base) {
    const p = String(provider || "").toLowerCase();
    const b = String(base || "").toLowerCase();
    return p === "duckai" || p === "duckduckgo" || /duckduckgo\.com|duck\.ai/.test(b);
  }

  function mapModel(id) {
    const s = String(id || "").trim();
    if (!s || s === "qwen7b" || s === "qwen-coder") return "gpt-5.4-mini";
    if (FREE_MODELS.indexOf(s) >= 0) return s;
    const low = s.toLowerCase();
    if (/haiku/.test(low)) return "claude-haiku-4-5";
    if (/mistral/.test(low)) return "mistral-small-2603";
    if (/gemma/.test(low)) return "tinfoil/gemma4-31b";
    if (/oss|gpt-oss/.test(low)) return "tinfoil/gpt-oss-120b";
    if (/luna/.test(low)) return "gpt-5.6-luna";
    if (/mini/.test(low)) return "gpt-5.4-mini";
    return s;
  }

  function header(res, name) {
    const n = String(name || "").toLowerCase();
    try {
      if (res.headers && typeof res.headers.get === "function") {
        return res.headers.get(name) || res.headers.get(n) || res.headers.get(name.toUpperCase()) || "";
      }
    } catch (_) {}
    try {
      const h = res.headers || {};
      const k = Object.keys(h).find(function (x) { return String(x).toLowerCase() === n; });
      return k ? h[k] : "";
    } catch (_) {
      return "";
    }
  }

  function duckHeaders(extra) {
    const url = CHAT;
    const dyn = typeof goarMergeHeaders === "function"
      ? goarMergeHeaders(url, {
          Accept: "text/event-stream, application/json",
          "x-vqd-accept": "1",
          "x-fe-version": typeof goarFeVersion === "function" ? goarFeVersion() : ("serp_" + Date.now()),
        })
      : {
          "User-Agent": typeof navigator !== "undefined" ? navigator.userAgent : "Mozilla/5.0",
          Accept: "text/event-stream, application/json",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: pickDuckOrigin() + "/",
          Origin: pickDuckOrigin(),
          "x-vqd-accept": "1",
        };
    return Object.assign({}, dyn, extra || {});
  }

  function pickDuckOrigin() {
    return Math.random() < 0.5 ? "https://duckduckgo.com" : "https://duck.ai";
  }

  function asResponse(status, headersObj, body, via) {
    const h = new Headers();
    Object.keys(headersObj || {}).forEach(function (k) {
      try { h.set(k, headersObj[k]); } catch (_) {}
    });
    const r = new Response(body == null ? "" : body, { status: status || 200, headers: h });
    try { r.__goarVia = via; } catch (_) {}
    try { r.__goarBody = body == null ? "" : String(body); } catch (_) {}
    return r;
  }

  function shQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function parseHttpMessage(raw, via) {
    raw = String(raw || "");
    let idx = -1;
    let search = 0;
    while (search < raw.length) {
      const m = raw.slice(search).search(/^HTTP\/\d/m);
      if (m < 0) break;
      idx = search + m;
      search = idx + 5;
    }
    if (idx < 0) return null;
    raw = raw.slice(idx);
    const split = raw.search(/\r?\n\r?\n/);
    const head = split >= 0 ? raw.slice(0, split) : raw;
    const body = split >= 0 ? raw.slice(split).replace(/^\r?\n\r?\n/, "") : "";
    const lines = head.split(/\r?\n/);
    const st = /HTTP\/\S+\s+(\d+)/.exec(lines[0] || "");
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].indexOf(":");
      if (c > 0) headers[lines[i].slice(0, c).trim()] = lines[i].slice(c + 1).trim();
    }
    return asResponse(st ? Number(st[1]) : 200, headers, body, via || "http");
  }

  function withTimeout(p, ms, label) {
    return Promise.race([
      p,
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error("timeout " + (label || "") + " " + ms)); }, ms);
      }),
    ]);
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function note(kind, msg) {
    try { if (typeof imLog === "function") imLog(kind, "duck " + msg); } catch (_) {}
  }

  function duckWispPool() {
    const pool = ["wss://wisp.mercurywork.shop/", "wss://cors.manus.space/wisp/"];
    try {
      const s = typeof loadSettings === "function" ? loadSettings() : {};
      if (s && s.wispUrl) pool.unshift(String(s.wispUrl));
    } catch (_) {}
    const out = [];
    pool.forEach(function (u) {
      if (u && out.indexOf(u) < 0) out.push(u);
    });
    return out;
  }

  function sshUp() {
    try {
      if (typeof sshShellReady === "function") return sshShellReady();
      return typeof sshReady === "function" && sshReady();
    } catch (_) { return false; }
  }

  async function waitSsh(ms) {
    if (sshUp()) return true;
    const t0 = Date.now();
    const limit = ms || 110000;
    let kicked = 0;
    while (Date.now() - t0 < limit) {
      if (sshUp()) return true;
      if (Date.now() - kicked > 2500) {
        kicked = Date.now();
        try {
          if (typeof ensureSsh === "function") ensureSsh({ reason: "duck" }).catch(function () {});
        } catch (_) {}
      }
      await sleep(350);
    }
    return sshUp();
  }

  async function readResBody(res, ms) {
    if (!res) return "";
    if (res.__goarBody != null && res.__goarBody !== "") return String(res.__goarBody);
    if (typeof res.text !== "function") return res.body != null ? String(res.body) : "";
    try { return await withTimeout(res.text(), ms || 8000, "body"); } catch (_) { return ""; }
  }

  async function libcurlDuckFetch(url, init, wisp) {
    try {
      if (typeof ensureMwFabric === "function" && !(global.MW_FABRIC && global.MW_FABRIC.libcurl)) {
        await Promise.race([
          ensureMwFabric(),
          new Promise(function (r) { setTimeout(r, 4000); }),
        ]);
      }
    } catch (_) {}
    const lc = global.MW_FABRIC && global.MW_FABRIC.libcurl;
    if (!lc || typeof lc.fetch !== "function") return null;
    wisp = wisp || duckWispPool()[0];
    try {
      if (typeof lc.set_websocket === "function" && lc.__goarDuckWisp !== wisp) {
        lc.set_websocket(wisp);
        lc.__goarDuckWisp = wisp;
      }
    } catch (_) {}
    const method = (init && init.method) || "GET";
    const headers = (init && init.headers) || {};
    const body = (init && init.body) || null;
    const isPost = String(method).toUpperCase() !== "GET" && String(method).toUpperCase() !== "HEAD";
    const req = { method: method, headers: headers };
    if (body != null && isPost) req.body = body;
    const res = await withTimeout(lc.fetch(url, req), isPost ? 10000 : 8000, "libcurl");
    if (!res) return null;
    const hdrs = {};
    try {
      if (res.headers && typeof res.headers.forEach === "function") {
        res.headers.forEach(function (v, k) { hdrs[k] = v; });
      } else if (res.headers && typeof res.headers === "object") {
        Object.assign(hdrs, res.headers);
      }
    } catch (_) {}
    const t = await readResBody(res, isPost ? 12000 : 6000);
    const st = res.status || 200;
    if (isPost && (st === 200 || st === 201) && !String(t).trim()) {
      return asResponse(0, hdrs, "", "libcurl-empty");
    }
    return asResponse(st, hdrs, t, "libcurl");
  }

  async function kaliDuckFetch(url, init) {
    if (!sshUp()) return null;
    if (typeof sshExec !== "function") return null;
    const method = ((init && init.method) || "GET").toUpperCase();
    const headers = (init && init.headers) || {};
    const id = "dk" + Date.now().toString(36);
    let prefix = "";
    if (init && init.body != null && method !== "GET" && method !== "HEAD") {
      const b64 = btoa(unescape(encodeURIComponent(String(init.body))));
      const staged = "/tmp/." + id + ".in";
      if (b64.length > 60000) {
        const parts = [];
        for (let i = 0; i < b64.length; i += 24000) parts.push(b64.slice(i, i + 24000));
        prefix = "rm -f " + staged + ".b64 " + staged + "; ";
        parts.forEach(function (p) {
          prefix += "printf %s " + shQuote(p) + " >> " + staged + ".b64; ";
        });
        prefix += "base64 -d " + staged + ".b64 > " + staged + " && ";
      } else {
        prefix =
          "python3 -c 'import base64,sys;open(\"" + staged + "\",\"wb\").write(base64.b64decode(sys.argv[1]))' " +
          shQuote(b64) + " && ";
      }
    }
    let cmd = prefix + "curl -sS --http1.1 --max-time 25 -D - -o /tmp/." + id + ".out -X " + method;
    Object.keys(headers).forEach(function (k) {
      if (/^content-length$/i.test(k)) return;
      cmd += " -H " + shQuote(k + ": " + headers[k]);
    });
    if (prefix) cmd += " --data-binary @/tmp/." + id + ".in";
    cmd += " " + shQuote(url) + " && printf '\\n\\n' && cat /tmp/." + id + ".out";
    const r = await sshExec(cmd, 35000);
    if (!r || !r.output) return null;
    return parseHttpMessage(r.output, "kali");
  }

  async function manusDuckFetch(url, init) {
    if (typeof buildManusProxyUrl !== "function") return null;
    let key = "";
    try {
      if (typeof mintManusKey === "function") key = await withTimeout(mintManusKey(), 6000, "manus-key");
      else if (typeof readManusKey === "function") key = readManusKey() || "";
    } catch (_) {}
    const method = ((init && init.method) || "GET").toUpperCase();
    const headers = (init && init.headers) || {};
    const hop = buildManusProxyUrl(url, {
      method: method !== "GET" && method !== "HEAD" ? method : "",
      reqHeaders: headers,
      resHeaders: ["x-vqd-4", "x-vqd-hash-1", "x-vqd-hash-4", "x-vqd-accept", "content-type"],
    });
    const h = Object.assign({}, headers);
    if (key) h["x-api-key"] = key;
    const req = { method: method, headers: h };
    if (init && init.body != null && method !== "GET" && method !== "HEAD") req.body = init.body;
    const res = await withTimeout(fetch(hop, req), 14000, "manus");
    if (!res) return null;
    const hdrs = {};
    try {
      if (res.headers && typeof res.headers.forEach === "function") {
        res.headers.forEach(function (v, k) { hdrs[k] = v; });
      }
    } catch (_) {}
    const t = await readResBody(res, 12000);
    return asResponse(res.status || 200, hdrs, t, "manus");
  }

  async function duckFetch(url, init) {
    init = init || {};
    const headers = duckHeaders(init.headers);
    const next = Object.assign({}, init, { headers: headers, credentials: "omit" });
    const method = String(init.method || "GET").toUpperCase();
    const isPost = method !== "GET" && method !== "HEAD";
    const hops = [];
    const wisps = duckWispPool();
    if (sshUp()) hops.push(["kali", function () { return kaliDuckFetch(url, next); }]);
    wisps.forEach(function (w, i) {
      hops.push(["libcurl" + (i ? "-" + i : ""), function () { return libcurlDuckFetch(url, next, w); }]);
    });
    hops.push(["manus", function () { return manusDuckFetch(url, next); }]);
    let last = null;
    for (let i = 0; i < hops.length; i++) {
      const name = hops[i][0];
      try {
        const r = await hops[i][1]();
        if (r && r.status && r.status !== 0) {
          last = r;
          try { r.__goarVia = name; } catch (_) {}
          if (r.status === 418 || r.status === 429 || r.status === 403) {
            note("ok", name + "-skip " + r.status);
            if (isPost) return r;
            continue;
          }
          note("ok", name + " " + r.status);
          return r;
        }
      } catch (e) {
        note("err", name + " " + (e && e.message ? e.message : e));
      }
    }
    if (last) return last;
    throw new Error("Duck.ai unreachable from this browser");
  }

  function b64json(obj) {
    const s = JSON.stringify(obj);
    try { return btoa(s); } catch (_) {
      return btoa(unescape(encodeURIComponent(s)));
    }
  }

  function encodeSolved(out) {
    if (out == null) return "";
    if (typeof out === "string") {
      const t = out.trim();
      if (!t) return "";
      if (t[0] === "{") {
        try { return b64json(JSON.parse(t)); } catch (_) { return t; }
      }
      return t;
    }
    if (typeof out === "object") return b64json(out);
    return "";
  }

  async function solveHash(b64) {
    if (!b64) return "";
    let src = "";
    try { src = atob(String(b64).replace(/\s+/g, "")); } catch (_) { return b64; }
    if (!/function|async|=>/.test(src)) return b64;
    const run = async function () {
      try {
        const out = await (0, eval)(src);
        const enc = encodeSolved(out);
        if (enc) return enc;
      } catch (_) {}
      try {
        const fn = new Function("return (" + src + ")");
        const out = await fn();
        const enc = encodeSolved(out);
        if (enc) return enc;
      } catch (_) {}
      return "";
    };
    const enc = await Promise.race([
      run(),
      new Promise(function (r) { setTimeout(function () { r(""); }, 8000); }),
    ]);
    return enc || b64;
  }

  function remember(res) {
    if (!res) return;
    const vqd = header(res, "x-vqd-4") || header(res, "x-vqd-hash-4");
    const rawHash = header(res, "x-vqd-hash-1");
    if (vqd && vqd !== "1") session.vqd = vqd;
    if (rawHash && !/function|async/.test((function () { try { return atob(String(rawHash).replace(/\s+/g, "")); } catch (_) { return ""; } })())) {
      session.hash = rawHash;
    }
    session.at = Date.now();
    if (res.__goarVia) session.via = res.__goarVia;
  }

  async function ensureVqd(force) {
    if (!force && session.hash && Date.now() - session.at < 180000) return session;
    const res = await duckFetch(STATUS, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    remember(res);
    const rawHash = header(res, "x-vqd-hash-1") || session.hash;
    const vqd = header(res, "x-vqd-4") || session.vqd;
    const solved = await solveHash(rawHash);
    session = {
      vqd: (vqd && vqd !== "1") ? vqd : (session.vqd || ""),
      hash: solved || rawHash || session.hash,
      at: Date.now(),
      via: res.__goarVia || session.via || "http",
    };
    return session;
  }

  function flattenMessages(messages) {
    return (messages || [])
      .filter(function (m) { return m && m.role && m.role !== "system"; })
      .map(function (m) {
        let content = m.content;
        if (Array.isArray(content)) {
          content = content.map(function (c) { return typeof c === "string" ? c : (c && c.text) || ""; }).join("\n");
        }
        if (m.role === "tool") {
          return { role: "user", content: "TOOL_RESULT (" + (m.name || "") + "):\n" + String(content || "") };
        }
        if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
          const calls = m.tool_calls.map(function (tc) {
            const fn = tc.function || {};
            return "TOOL: " + JSON.stringify({ name: fn.name, arguments: fn.arguments || {} });
          });
          return { role: "assistant", content: (content ? String(content) + "\n" : "") + calls.join("\n") };
        }
        const role = m.role === "assistant" ? "assistant" : "user";
        return { role: role, content: String(content == null ? "" : content) };
      })
      .filter(function (m) { return String(m.content || "").trim(); })
      .slice(-10);
  }

  function systemText(messages, tools) {
    const sys = (messages || [])
      .filter(function (m) { return m && m.role === "system"; })
      .map(function (m) { return String(m.content || ""); })
      .join("\n\n")
      .slice(0, 2400);
    const names = (tools || []).map(function (t) {
      const fn = (t && t.function) || t || {};
      return fn.name;
    }).filter(Boolean);
    let extra = "";
    if (names.length) {
      extra =
        "\n\nYou can call tools. When you need one, output exactly one line and nothing else:\n" +
        "TOOL: {\"name\":\"<one of " + names.slice(0, 20).join(", ") + ">\",\"arguments\":{...}}\n" +
        "Wait for TOOL_RESULT before the final answer.";
    }
    return (sys + extra).trim();
  }

  function parseToolLine(text) {
    const s = String(text || "");
    const m = s.match(/TOOL:\s*(\{[\s\S]*\})/);
    if (!m) return { text: s, tool_calls: [] };
    try {
      const obj = JSON.parse(m[1]);
      const name = obj.name || (obj.function && obj.function.name);
      if (!name) return { text: s.replace(m[0], "").trim(), tool_calls: [] };
      let args = obj.arguments != null ? obj.arguments : obj.args || {};
      if (typeof args !== "string") args = JSON.stringify(args);
      return {
        text: s.replace(m[0], "").trim(),
        tool_calls: [{ id: "call_duck_0", type: "function", function: { name: name, arguments: args } }],
      };
    } catch (_) {
      return { text: s, tool_calls: [] };
    }
  }

  function pieceOf(obj) {
    if (!obj || typeof obj !== "object") return "";
    if (obj.action === "error") return "";
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.content === "string") return obj.content;
    if (obj.delta && typeof obj.delta.content === "string") return obj.delta.content;
    if (typeof obj.text === "string") return obj.text;
    return "";
  }

  async function readSse(res, onTextDelta) {
    let raw = "";
    let err = "";
    async function eatLine(line) {
      line = String(line || "").trim();
      if (!line || line === "data: [DONE]" || line === "[DONE]") return;
      if (line.indexOf("data:") === 0) line = line.slice(5).trim();
      try {
        const obj = JSON.parse(line);
        if (obj && obj.action === "error") {
          err = String(obj.type || obj.message || obj.status || "error");
          return;
        }
        const piece = pieceOf(obj);
        if (piece) {
          if (onTextDelta) onTextDelta(piece, raw + piece);
          raw += piece;
        }
      } catch (_) {}
    }
    let t = "";
    if (res && res.__goarBody != null) t = String(res.__goarBody);
    else t = await readResBody(res, 20000);
    const lines = String(t || "").split("\n");
    for (let i = 0; i < lines.length; i++) await eatLine(lines[i]);
    if (!raw && t && t[0] !== "{" && t.indexOf("data:") < 0) raw = t;
    if (!raw && err) throw new Error("Duck.ai " + err);
    return raw;
  }

  function busyStatus(res, err) {
    const st = res && res.status;
    return st === 418 || st === 429 || st === 403 || /ERR_BN_LIMIT|rate.?limit/i.test(String(err || ""));
  }

  async function pollinationsChat(msgs, onTextDelta) {
    const url = "https://text.pollinations.ai/openai";
    const body = JSON.stringify({
      model: "openai",
      messages: (msgs || []).slice(-8),
    });
    let t = "";
    try {
      const res = await withTimeout(fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body,
      }), 25000, "pollinations");
      t = await readResBody(res, 20000);
    } catch (e) {
      note("err", "pollinations " + (e && e.message ? e.message : e));
      const r = await libcurlDuckFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: body,
      });
      t = r ? await readResBody(r, 12000) : "";
    }
    let text = "";
    try {
      const obj = JSON.parse(t);
      const ch = obj && obj.choices && obj.choices[0];
      text = (ch && ch.message && ch.message.content) || (obj && obj.content) || "";
    } catch (_) {
      text = String(t || "").trim();
    }
    if (!text) throw new Error("Pollinations empty");
    if (onTextDelta) onTextDelta(text, text);
    return text;
  }

  async function postChat(msgs, model, signal) {
    await ensureVqd(false);
    const headers = duckHeaders({ "Content-Type": "application/json" });
    if (session.vqd) headers["x-vqd-4"] = session.vqd;
    if (session.hash) headers["x-vqd-hash-1"] = session.hash;
    const body = {
      model: model,
      messages: msgs,
      metadata: { toolChoice: { WebSearch: true, NewsSearch: false, VideosSearch: false, LocalSearch: false } },
      canUseTools: true,
      canUseApproxLocation: false,
    };
    const res = await duckFetch(CHAT, { method: "POST", headers: headers, body: JSON.stringify(body), signal: signal });
    remember(res);
    return res;
  }

  async function duckaiChat({ messages, tools, includeTools, onTextDelta, signal }) {
    const s = typeof settingsSnapshot === "function" ? settingsSnapshot() : {};
    const model = mapModel(s.apiModel);
    const sys = systemText(messages, includeTools === false ? [] : tools);
    const msgs = flattenMessages(messages);
    if (sys) msgs.unshift({ role: "user", content: sys });
    let res = null;
    try {
      if (sshUp()) session.at = 0;
      res = await postChat(msgs, model, signal);
      if (busyStatus(res) && sshUp()) {
        note("ok", "kali retry after " + res.status);
        session.at = 0;
        res = await postChat(msgs, model, signal);
      }
      if (res && res.status === 401) {
        session.at = 0;
        res = await postChat(msgs, model, signal);
      }
    } catch (e) {
      note("err", "post " + (e && e.message ? e.message : e));
    }
    if (res && res.ok) {
      const raw = await readSse(res, onTextDelta);
      const parsed = parseToolLine(raw);
      return {
        content: parsed.text,
        text: parsed.text,
        tool_calls: parsed.tool_calls,
        finish_reason: parsed.tool_calls.length ? "tool_calls" : "stop",
        model: model,
        via: res.__goarVia || session.via || "duckai",
      };
    }
    note("ok", "pollinations fallback");
    try { if (typeof setStatusFooter === "function") setStatusFooter("Duck.ai busy — Pollinations"); } catch (_) {}
    const text = await pollinationsChat(msgs, onTextDelta);
    const parsed = parseToolLine(text);
    return {
      content: parsed.text,
      text: parsed.text,
      tool_calls: parsed.tool_calls,
      finish_reason: parsed.tool_calls.length ? "tool_calls" : "stop",
      model: "pollinations",
      via: "pollinations",
    };
  }

  async function duckaiModels() {
    try {
      const res = await duckFetch(MODELS, { method: "GET", headers: { Accept: "application/json" } });
      const t = await readResBody(res, 6000);
      const obj = JSON.parse(t);
      const list = obj.models || obj.data || [];
      const ids = list
        .filter(function (m) { return !m || m.entityHasAccess !== false; })
        .map(function (m) { return (m && (m.model || m.id)) || m; })
        .filter(Boolean);
      if (ids.length) return ids;
    } catch (_) {}
    return FREE_MODELS.slice();
  }

  async function duckaiPing() {
    const t0 = Date.now();
    const r = await duckaiChat({
      messages: [{ role: "user", content: "Reply with exactly the word PONG and nothing else." }],
      tools: [],
      includeTools: false,
    });
    return {
      ok: !!(r && String(r.content || r.text || "").trim()),
      text: String((r && (r.content || r.text)) || "").slice(0, 240),
      model: r && r.model,
      via: r && r.via,
      ms: Date.now() - t0,
      sess: session,
    };
  }

  try {
    global.duckaiChat = duckaiChat;
    global.duckaiModels = duckaiModels;
    global.duckaiPing = duckaiPing;
    global.isDuckProvider = isDuckProvider;
    global.DUCKAI_MODELS = FREE_MODELS;
    global.__goarDuckSession = function () { return session; };
    global.__goarDuckPing = duckaiPing;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
