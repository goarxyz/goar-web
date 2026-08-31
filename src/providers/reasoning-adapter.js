/**
 * Reasoning adapter — split thinking from text, echo it back.
 * thinking is never a tool. Chat text is the only user-facing reply.
 */
function parseContentBlocks(content) {
  if (content == null) return { text: "", thinking: "" };
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };
  const textParts = [];
  const thinkParts = [];
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (typeof block === "string") {
      textParts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const t = String(block.type || "");
    if (t === "thinking" || t === "reasoning") {
      const inner = block.thinking != null ? block.thinking : (block.reasoning != null ? block.reasoning : block.content);
      if (typeof inner === "string") thinkParts.push(inner);
      else if (Array.isArray(inner)) {
        for (let j = 0; j < inner.length; j++) {
          const it = inner[j];
          if (typeof it === "string") thinkParts.push(it);
          else if (it && typeof it.text === "string") thinkParts.push(it.text);
        }
      } else if (typeof block.text === "string") thinkParts.push(block.text);
    } else if (t === "text" || typeof block.text === "string") {
      textParts.push(block.text || "");
    }
  }
  return { text: textParts.join(""), thinking: thinkParts.join("") };
}

function extractReasoningFromDelta(delta) {
  if (!delta || typeof delta !== "object") return { text: "", thinking: "" };
  let text = "";
  let thinking = "";
  if (typeof delta.content === "string") text = delta.content;
  else if (Array.isArray(delta.content)) {
    const parsed = parseContentBlocks(delta.content);
    text = parsed.text;
    thinking = parsed.thinking;
  }
  if (!thinking) {
    const keys = ["reasoning_content", "thinking", "reasoning", "reasoning_text"];
    for (let i = 0; i < keys.length; i++) {
      let v = delta[keys[i]];
      if (v && typeof v === "object") {
        v = typeof v.content === "string" ? v.content : (typeof v.text === "string" ? v.text : "");
      }
      if (typeof v === "string" && v) {
        thinking = v;
        break;
      }
    }
  }
  if (!thinking && Array.isArray(delta.reasoning_details)) {
    thinking = delta.reasoning_details.map(function (rd) {
      return (rd && (rd.text || rd.content || rd.summary)) || "";
    }).join("");
  }
  return { text: text || "", thinking: thinking || "" };
}

function providerAllowsThinkingBlocks(s) {
  const p = String((s && (s.provider || s.apiBase)) || "");
  if (/groq/i.test(p)) return false;
  return true;
}

function convertAssistantForApi(msg, allowBlocks) {
  const out = { role: "assistant" };
  const text = msg.content == null ? "" : String(msg.content);
  const reason = msg.reasoning_content ? String(msg.reasoning_content) : "";
  if (allowBlocks && reason) {
    const blocks = [
      { type: "thinking", thinking: [{ type: "text", text: reason }] },
    ];
    if (text) blocks.push({ type: "text", text: text });
    out.content = blocks;
  } else {
    out.content = text;
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) out.tool_calls = msg.tool_calls;
  return out;
}

try {
  if (typeof window !== "undefined") {
    window.parseContentBlocks = parseContentBlocks;
    window.extractReasoningFromDelta = extractReasoningFromDelta;
    window.convertAssistantForApi = convertAssistantForApi;
    window.providerAllowsThinkingBlocks = providerAllowsThinkingBlocks;
  }
} catch (_) {}
