/**
 * Peak provider overrides. Flags set GOAR_MAX_TOKENS / GOAR_HISTORY_WINDOW /
 * GOAR_PARALLEL_TOOLS. This file rebinds resolveMaxTokens + resolveChatBody
 * after openai-chat.js so the 1536/2048/2800 caps cannot starve Kali sessions.
 */
(function (g) {
  "use strict";
  g.GOAR_MAX_TOKENS = Number(g.GOAR_MAX_TOKENS) > 0 ? Number(g.GOAR_MAX_TOKENS) : 8192;
  g.GOAR_HISTORY_WINDOW = Number(g.GOAR_HISTORY_WINDOW) > 0 ? Number(g.GOAR_HISTORY_WINDOW) : 64;
  g.GOAR_PARALLEL_TOOLS = g.GOAR_PARALLEL_TOOLS !== false;

  g.resolveMaxTokens = function resolveMaxTokens(s) {
    const floor = Number(g.GOAR_MAX_TOKENS) || 8192;
    const saved = Number(s && s.maxTokens);
    if (saved > 0) return Math.max(256, Math.min(saved, 32768));
    return floor;
  };

  const prevBody = typeof g.resolveChatBody === "function" ? g.resolveChatBody : null;
  g.resolveChatBody = function resolveChatBody(s, messages, tools, stream, includeTools) {
    let body;
    if (prevBody) {
      body = prevBody(s, messages, tools, stream, includeTools);
    } else {
      body = {
        model: (s && s.apiModel || "").trim(),
        messages: typeof sanitizeMessagesForApi === "function" ? sanitizeMessagesForApi(messages) : messages,
        temperature: 0.2,
        max_tokens: g.resolveMaxTokens(s),
        stream: !!stream,
      };
    }
    if (!body || typeof body !== "object") return body;
    body.max_tokens = g.resolveMaxTokens(s);
    if (includeTools && body.tools && body.tools.length && g.GOAR_PARALLEL_TOOLS) {
      body.parallel_tool_calls = true;
    }
    return body;
  };

  if (typeof DEFAULTS === "object" && DEFAULTS) {
    try { DEFAULTS.maxTokens = Number(g.GOAR_MAX_TOKENS) || 8192; } catch (_) {}
  }
  try { console.log("[goar] peak tokens", g.GOAR_MAX_TOKENS, "window", g.GOAR_HISTORY_WINDOW); } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
