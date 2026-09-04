/**
 * Duck.ai (DuckDuckGo) — free, no key.
 * Browser solves the VQD hash, then chats via duckchat/v1.
 * Native OpenAI tools are not on this API; we emit TOOL: JSON for the agent loop.
 */
(function (global) {
  "use strict";

  const STATUS = "https://duckduckgo.com/duckchat/v1/status";
  const CHAT = "https://duckduckgo.com/duckchat/v1/chat";
  const MODELS = "https://duckduckgo.com/duckchat/v1/models";
  const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  const FREE_MODELS = [
    "gpt-5.4-mini",
    "gpt-5.6-luna",
    "claude-haiku-4-5",
    "mistral-small-2603",
    "tinfoil/gpt-oss-120b",
    "tinfoil/gemma4-31b",
  ];

  let session = { vqd: "", hash: "", at: 0 };

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
    return "gpt-5.4-mini";
  }

  async function duckFetch(url, init) {
    init = init || {};
    const headers = Object.assign({ "User-Agent": UA }, init.headers || {});
    const next = Object.assign({}, init, { headers: headers, credentials: "omit" });
    try {
      const r = await fetch(url, next);
      if (r.status !== 0) return r;
    } catch (_) {}
    if (typeof buildManusProxyUrl === "function") {
      const hop = buildManusProxyUrl(url, {
        method: (init.method || "GET").toUpperCase(),
        reqHeaders: headers,
        resHeaders: ["x-vqd-4", "x-vqd-hash-1", "x-vqd-hash-4"],
      });
      const key = typeof readManusKey === "function" ? readManusKey() : "";
      const h = Object.assign({}, headers);
      if (key) h["x-api-key"] = key;
      return fetch(hop, Object.assign({}, next, { headers: h }));
    }
    throw new Error("Duck.ai blocked by CORS");
  }

  function header(res, name) {
    try {
      return res.headers.get(name) || res.headers.get(name.toLowerCase()) || "";
    } catch (_) {
      return "";
    }
  }

  async function solveHash(b64) {
    if (!b64) return "";
    let src = "";
    try {
      src = atob(String(b64).replace(/\s+/g, ""));
    } catch (_) {
      return b64;
    }
    if (!/function|async/.test(src)) return b64;
    try {
      const out = await (0, eval)(src);
      if (out && typeof out === "object") return btoa(JSON.stringify(out));
      if (typeof out === "string") return out;
    } catch (_) {}
    return "";
  }

  async function ensureVqd(force) {
    if (!force && session.vqd && Date.now() - session.at < 240000) return session;
    const res = await duckFetch(STATUS, {
      method: "GET",
      headers: { "x-vqd-4": "1", "x-vqd-accept": "1", Accept: "application/json" },
    });
    const vqd = header(res, "x-vqd-4") || header(res, "x-vqd-hash-4");
    const rawHash = header(res, "x-vqd-hash-1");
    const solved = await solveHash(rawHash);
    session = { vqd: vqd || "1", hash: solved || rawHash, at: Date.now() };
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
      .filter(function (m) { return String(m.content || "").trim(); });
  }

  function systemText(messages, tools) {
    const sys = (messages || [])
      .filter(function (m) { return m && m.role === "system"; })
      .map(function (m) { return String(m.content || ""); })
      .join("\n\n");
    const names = (tools || []).map(function (t) {
      const fn = (t && t.function) || t || {};
      return fn.name;
    }).filter(Boolean);
    let extra = "";
    if (names.length) {
      extra =
        "\n\nYou can call tools. When you need one, output exactly one line and nothing else:\n" +
        "TOOL: {\"name\":\"<one of " + names.slice(0, 24).join(", ") + ">\",\"arguments\":{...}}\n" +
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

  async function duckaiChat({ messages, tools, includeTools, onTextDelta, signal }) {
    const s = typeof settingsSnapshot === "function" ? settingsSnapshot() : {};
    const model = mapModel(s.apiModel);
    const sys = systemText(messages, includeTools === false ? [] : tools);
    const msgs = flattenMessages(messages);
    if (sys) msgs.unshift({ role: "user", content: sys });
    await ensureVqd(false);
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-vqd-4": session.vqd || "1",
      "User-Agent": UA,
    };
    if (session.hash) headers["x-vqd-hash-1"] = session.hash;
    const body = {
      model: model,
      messages: msgs,
      metadata: { toolChoice: { WebSearch: true, NewsSearch: false, VideosSearch: false, LocalSearch: false } },
      canUseTools: true,
    };
    let res = await duckFetch(CHAT, { method: "POST", headers: headers, body: JSON.stringify(body), signal: signal });
    if (res.status === 418 || res.status === 429 || res.status === 401) {
      await ensureVqd(true);
      headers["x-vqd-4"] = session.vqd || "1";
      if (session.hash) headers["x-vqd-hash-1"] = session.hash;
      res = await duckFetch(CHAT, { method: "POST", headers: headers, body: JSON.stringify(body), signal: signal });
    }
    if (!res.ok) {
      const err = await res.text().catch(function () { return ""; });
      throw new Error("Duck.ai " + res.status + ": " + String(err).slice(0, 220));
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let raw = "";
    if (res.body && res.body.getReader && /event-stream|octet|text\//.test(ct)) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        acc += dec.decode(chunk.value, { stream: true });
        const lines = acc.split("\n");
        acc = lines.pop() || "";
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i].trim();
          if (!line || line === "data: [DONE]" || line === "[DONE]") continue;
          if (line.indexOf("data:") === 0) line = line.slice(5).trim();
          try {
            const obj = JSON.parse(line);
            const piece = obj.message || obj.content || (obj.delta && obj.delta.content) || "";
            if (piece && typeof piece === "string") {
              if (onTextDelta) onTextDelta(piece, raw + piece);
              raw += piece;
            }
          } catch (_) {}
        }
      }
    } else {
      const t = await res.text();
      t.split("\n").forEach(function (line) {
        line = line.trim();
        if (!line || line === "[DONE]") return;
        if (line.indexOf("data:") === 0) line = line.slice(5).trim();
        try {
          const obj = JSON.parse(line);
          const piece = obj.message || obj.content || "";
          if (piece) raw += piece;
        } catch (_) {
          raw += line;
        }
      });
      if (onTextDelta && raw) onTextDelta(raw, raw);
    }
    const parsed = parseToolLine(raw);
    return {
      content: parsed.text,
      text: parsed.text,
      tool_calls: parsed.tool_calls,
      finish_reason: parsed.tool_calls.length ? "tool_calls" : "stop",
      model: model,
      via: "duckai",
    };
  }

  try {
    global.duckaiChat = duckaiChat;
    global.isDuckProvider = isDuckProvider;
    global.DUCKAI_MODELS = FREE_MODELS;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
