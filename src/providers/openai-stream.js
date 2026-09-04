async function openaiChatStream({
  messages,
  tools,
  includeTools = true,
  signal = null,
  onTextDelta = null,
  onThinkingDelta = null,
}) {
  const s = settingsSnapshot();
  const provider = s.provider || detectProvider(s.apiBase);
  if (typeof isDuckProvider === "function" && isDuckProvider(provider, s.apiBase)) {
    return duckaiChat({ messages: messages, tools: tools, includeTools: includeTools, onTextDelta: onTextDelta, signal: signal });
  }
  if (typeof isLocalLlmProvider === "function" && isLocalLlmProvider(provider, s.apiBase)) {
    return localLlmChat({ messages, tools, includeTools, onTextDelta, onThinkingDelta });
  }
  const base = normalizeApiBase(s.apiBase || DEFAULTS.apiBase, provider);
  const url = chatCompletionsUrl(base, provider);
  const model = (s.apiModel || DEFAULTS.apiModel || "").trim();
  if (!model) throw new Error("No model configured — open Settings and pick a model.");
  if ((getProvider(provider)?.requiresApiKey) && !(s.apiKey || "").trim() && !getProvider(provider)?.supportsOptionalApiKey) {
    throw new Error("No API key — open Settings and paste your key.");
  }
  const body = (typeof resolveChatBody === "function")
    ? resolveChatBody(s, messages, tools, true, includeTools)
    : {
        model,
        messages: (typeof sanitizeMessagesForApi === "function" ? sanitizeMessagesForApi(messages) : messages),
        temperature: Number(s.temperature != null ? s.temperature : DEFAULTS.temperature) || 0.2,
        max_tokens: (typeof resolveMaxTokens === "function" ? resolveMaxTokens(s) : 1536),
        stream: true,
      };
  if (body && includeTools && tools && tools.length && !body.tools && typeof slimToolsForApi === "function") {
    body.tools = slimToolsForApi(tools);
    body.tool_choice = "auto";
  }
  const headers = authHeaders(s.apiKey, base, provider);
  headers["Accept"] = "text/event-stream";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  const onParentAbort = () => { try { ctrl.abort(); } catch (_) {} };
  if (signal) signal.addEventListener("abort", onParentAbort, { once: true });

  let resp;
  try {
    resp = await (typeof goarApiFetch === "function" ? goarApiFetch : fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
    // fallback non-stream
    const data = await openaiChat({ messages, tools, stream: false, includeTools, signal });
    return normalizeChatResultFromJson(data, onTextDelta, onThinkingDelta);
  }

  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (!resp.ok || (!ct.includes("text/event-stream") && !ct.includes("json"))) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
    // try parse error then fallback
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401 || resp.status === 403) {
        throw new Error("Auth failed (" + resp.status + "): " + errText.slice(0, 200));
      }
      if (/model is restarting|please resend|temporarily unavailable|overloaded/i.test(errText) || resp.status === 503) {
        await new Promise((r) => setTimeout(r, 1800));
        const data = await openaiChat({ messages, tools, stream: false, includeTools, signal });
        return normalizeChatResultFromJson(data, onTextDelta, onThinkingDelta);
      }
    }
    try {
      const data = await openaiChat({ messages, tools, stream: false, includeTools, signal });
      return normalizeChatResultFromJson(data, onTextDelta, onThinkingDelta);
    } catch (e2) {
      throw e2;
    }
  }

  // If provider returned full JSON despite stream:true
  if (ct.includes("application/json") && !ct.includes("event-stream")) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
    const data = await resp.json();
    return normalizeChatResultFromJson(data, onTextDelta, onThinkingDelta);
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let thinking = "";
  const toolAcc = new Map(); // index -> { id, name, arguments }
  let finish = "";
  let usage = null;

  try {
    while (true) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        let obj;
        try { obj = JSON.parse(payload); } catch (_) { continue; }
        if (obj.usage) usage = obj.usage;
        const choice = obj.choices && obj.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        // Some providers put full message mid-stream
        const delta = choice.delta || choice.message || {};
        const parsed = typeof extractReasoningFromDelta === "function"
          ? extractReasoningFromDelta(delta)
          : { text: typeof delta.content === "string" ? delta.content : "", thinking: "" };
        let piece = parsed.text;
        if (!piece && typeof choice.text === "string") piece = choice.text;
        if (piece) {
          if (text && piece.startsWith(text) && piece.length > text.length) {
            text = piece;
          } else if (text && text.startsWith(piece) && piece.length < text.length) {
            // ignore snapshot shrink
          } else {
            text += piece;
          }
          text = collapseDoubledWords(text);
          if (onTextDelta) onTextDelta(piece, text);
        }
        if (parsed.thinking) {
          const th = parsed.thinking;
          if (thinking && th.startsWith(thinking)) {
            thinking = th;
          } else if (thinking && thinking.startsWith(th)) {
            // ignore
          } else {
            thinking += th;
          }
          thinking = collapseDoubledWords(thinking);
          if (onThinkingDelta) onThinkingDelta(th, thinking);
        }
        // tool_calls streamed
        const tcs = delta.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx = tc.index != null ? tc.index : 0;
            let acc = toolAcc.get(idx);
            if (!acc) {
              acc = { id: tc.id || ("call_" + idx), name: "", arguments: "" };
              toolAcc.set(idx, acc);
            }
            if (tc.id) acc.id = tc.id;
            const fn = tc.function || {};
            if (fn.name) acc.name = fn.name;
            if (typeof fn.arguments === "string") acc.arguments += fn.arguments;
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);
    try { reader.releaseLock(); } catch (_) {}
  }

  const toolCalls = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id,
      type: "function",
      function: { name: v.name, arguments: v.arguments || "{}" },
    }))
    .filter((tc) => tc.function.name);

  return {
    text,
    thinking,
    toolCalls,
    finish_reason: finish || (toolCalls.length ? "tool_calls" : "stop"),
    usage,
    raw: null,
  };
}

function normalizeChatResultFromJson(data, onTextDelta, onThinkingDelta) {
  const msg = data?.choices?.[0]?.message || {};
  let text = "";
  let thinking = "";
  if (typeof parseContentBlocks === "function") {
    const parsed = parseContentBlocks(msg.content);
    text = parsed.text || (typeof msg.content === "string" ? msg.content : "");
    thinking = parsed.thinking || "";
  } else {
    text = typeof msg.content === "string" ? msg.content : "";
  }
  if (!thinking) {
    thinking =
      msg.reasoning_content ||
      msg.thinking ||
      (typeof msg.reasoning === "string" ? msg.reasoning : "") ||
      (msg.reasoning && msg.reasoning.content) ||
      "";
  }
  if (thinking && onThinkingDelta) onThinkingDelta(thinking, thinking);
  if (text && onTextDelta) onTextDelta(text, text);
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  return {
    text,
    thinking: thinking || "",
    toolCalls,
    finish_reason: data?.choices?.[0]?.finish_reason || (toolCalls.length ? "tool_calls" : "stop"),
    usage: data?.usage || null,
    raw: data,
  };
}


