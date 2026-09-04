/**
 * ADK-inspired context compaction for GOAR (browser).
 *
 * Ported concepts from google/adk-python:
 *  - EventsCompactionConfig (token_threshold + event_retention_size)
 *  - Sliding-window overlap so consecutive summaries share context
 *  - Rolling summary seed (prior compaction feeds the next)
 *  - LlmEventSummarizer prompt: reiterate user request, decisions, tools, open tasks
 *  - Prompt packing projects full session → model context without hard "reset"
 *
 * Does NOT block tools. Compaction only shrinks what is sent to the model.
 *
 * Refs:
 *  - src/google/adk/apps/compaction.py
 *  - src/google/adk/apps/llm_event_summarizer.py
 *  - src/google/adk/flows/llm_flows/contents.py (_process_compaction_events)
 */

const GOAR_COMPACTION = {
  /** ~ADK token_threshold — when prompt est. exceeds this, compact older events */
  tokenThreshold: 3600,
  /** Keep last N non-system messages raw after a compaction */
  eventRetentionSize: 10,
  /** ADK overlap_size: re-include this many trailing events from the compacted range */
  overlapSize: 4,
  /** Cap each tool payload in summaries (ADK _MAX_TOOL_CONTENT_CHARS = 2000) */
  maxToolContentChars: 800,
  /** Soft cap for a single tool message stored in agentHistory for the model */
  maxToolResultChars: 1200,
  /** Multi-wave continuity: steps per wave / max waves (seamless, no history wipe) */
  stepsPerWave: 24,
  maxWaves: 240,
};

/**
 * ADK uses ~4 chars/token for estimates when usage_metadata is missing.
 * @param {unknown} messages
 * @returns {number}
 */
function estimatePromptTokens(messages) {
  try {
    const s = typeof messages === "string" ? messages : JSON.stringify(messages || []);
    if (!s) return 0;
    return Math.max(1, Math.floor(s.length / 4));
  } catch (_) {
    return 0;
  }
}

/**
 * @param {string} text
 * @param {number} [limit]
 */
function compactTruncate(text, limit) {
  const lim = limit != null ? limit : GOAR_COMPACTION.maxToolContentChars;
  const t = String(text == null ? "" : text);
  if (t.length <= lim) return t;
  return t.slice(0, lim) + "… [truncated " + (t.length - lim) + " chars]";
}

/**
 * Shrink tool results stored in history (model side). UI can still show more.
 * Accepts (raw) or legacy (name, raw) from status-blurb-era callers.
 * @param {unknown} nameOrRaw
 * @param {unknown} [raw]
 * @returns {string}
 */
function compactToolResult(nameOrRaw, raw) {
  const text = raw != null ? raw : nameOrRaw;
  return compactTruncate(String(text == null ? "" : text), GOAR_COMPACTION.maxToolResultChars);
}

/**
 * Pin the original user request for the whole job (session state, not dropped by trim).
 * @param {string} userText
 * @param {{ force?: boolean }} [opts]
 */
function pinMission(userText, opts) {
  if (typeof agentState === "undefined") return;
  const t = String(userText || "").trim();
  if (!t) return;
  if (opts && opts.force) {
    agentState.mission = t;
    return;
  }
  if (!agentState.mission || agentState.missionClosed) {
    agentState.mission = t;
    agentState.missionClosed = false;
  }
}

function clearMission() {
  if (typeof agentState === "undefined") return;
  agentState.mission = "";
  agentState.missionClosed = false;
  agentState.compactionSummary = "";
  agentState.compactionRange = null;
  agentState.wave = 0;
}

/**
 * Format history for summarization — mirrors ADK LlmEventSummarizer._format_events_for_prompt.
 * @param {Array} events
 * @returns {string}
 */
function formatEventsForCompaction(events) {
  const lines = [];
  for (const ev of events || []) {
    if (!ev || !ev.role) continue;
    if (ev.role === "system") continue;
    if (ev._compaction) {
      lines.push("model (prior compacted history): " + compactTruncate(String(ev.content || ""), 4000));
      continue;
    }
    if (ev.role === "user") {
      lines.push("user: " + compactTruncate(String(ev.content || ""), 1500));
      continue;
    }
    if (ev.role === "assistant") {
      if (ev.content) lines.push("model: " + compactTruncate(String(ev.content), 1500));
      if (Array.isArray(ev.tool_calls)) {
        for (const tc of ev.tool_calls) {
          const n = tc.function?.name || tc.name || "tool";
          const a = tc.function?.arguments != null ? tc.function.arguments : tc.arguments;
          lines.push("model called tool: " + n + "(" + compactTruncate(String(a), 400) + ")");
        }
      }
      continue;
    }
    if (ev.role === "tool") {
      const n = ev.name || "tool";
      lines.push("Tool response from " + n + ": " + compactTruncate(String(ev.content || ""), GOAR_COMPACTION.maxToolContentChars));
    }
  }
  return lines.join("\n");
}

/**
 * Extractive rolling summary (no extra LLM call).
 * Mirrors ADK default summarizer goals:
 *  - reiterate user request
 *  - key decisions / information obtained
 *  - tools used (grounding)
 *  - unresolved tasks
 * @param {Array} events
 * @param {string} mission
 * @param {string} [priorSummary]
 * @returns {string}
 */
function extractiveCompactionSummary(events, mission, priorSummary) {
  const tools = [];
  const paths = new Set();
  const notes = [];
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.role === "assistant" && Array.isArray(ev.tool_calls)) {
      for (const tc of ev.tool_calls) {
        const n = tc.function?.name || "";
        if (n && tools[tools.length - 1] !== n) tools.push(n);
        try {
          const a = typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments || "{}")
            : (tc.function?.arguments || {});
          const p = a.path || a.dest || a.src;
          if (p) paths.add(String(p));
        } catch (_) {}
      }
    }
    if (ev.role === "tool") {
      const n = ev.name || "tool";
      const body = String(ev.content || "").replace(/\s+/g, " ").trim();
      if (body) notes.push(n + " → " + body.slice(0, 220));
    }
    if (ev.role === "assistant" && ev.content && String(ev.content).trim()) {
      notes.push("said: " + String(ev.content).replace(/\s+/g, " ").trim().slice(0, 200));
    }
  }

  const uniqTools = [...new Set(tools)].slice(-24);
  const pathList = [...paths].slice(-20);
  const recentNotes = notes.slice(-14);

  let ledgerBits = "";
  try {
    if (typeof getStateContext === "function") {
      const sc = getStateContext();
      if (sc) ledgerBits = sc.slice(0, 1200);
    }
  } catch (_) {}

  const parts = [
    "## COMPACTED HISTORY (ADK-style rolling summary — continue the same job)",
    "PRIMARY USER REQUEST (do not abandon): " + String(mission || "(unknown)"),
  ];
  if (priorSummary) {
    parts.push("Prior compaction seed:\n" + compactTruncate(priorSummary, 2500));
  }
  if (uniqTools.length) parts.push("Tools used: " + uniqTools.join(", "));
  if (pathList.length) parts.push("Paths touched: " + pathList.join(", "));
  if (ledgerBits) parts.push("Session state:\n" + ledgerBits);
  if (recentNotes.length) {
    parts.push("Recent evidence:");
    for (const n of recentNotes) parts.push("- " + n);
  }
  parts.push(
    "INSTRUCTION: Continue from this state toward the PRIMARY USER REQUEST. " +
    "Do not restart discovery from zero. Tools remain fully available."
  );
  return parts.join("\n");
}

/**
 * System suffix that always carries mission + latest rolling summary.
 * @returns {string}
 */

/**
 * Optional LLM compaction (ADK LlmEventSummarizer).
 * Uses the configured provider when extractive summary is large / force+llm.
 * Falls back silently to extractive on any failure — never blocks the agent.
 * @param {Array} events
 * @param {string} mission
 * @param {string} [priorSummary]
 * @returns {Promise<string>}
 */
async function llmCompactionSummary(events, mission, priorSummary) {
  const extractive = extractiveCompactionSummary(events, mission, priorSummary);
  try {
    if (typeof openaiChat !== "function") return extractive;
    const s = typeof settingsSnapshot === "function" ? settingsSnapshot() : null;
    if (!s || (!(s.apiKey || "").trim() && !(typeof getProvider === "function" && getProvider(s.provider)?.supportsOptionalApiKey))) {
      return extractive;
    }
    const historyText = formatEventsForCompaction(events);
    const prompt =
      "The following is a conversation history between a user and an AI agent. " +
      "It may start from a compacted history. Identify and reiterate the user request, " +
      "summarize context so far (key decisions, information obtained, unresolved tasks). " +
      "If tools were called, list exact tool names. Be concise.\\n\\n" +
      "PRIMARY USER REQUEST: " + String(mission || "") + "\\n\\n" +
      (priorSummary ? ("PRIOR COMPACTION:\\n" + compactTruncate(priorSummary, 2000) + "\\n\\n") : "") +
      "CONVERSATION:\\n" + compactTruncate(historyText, 12000) + "\\n\\n" +
      "Write the compaction summary only.";
    const data = await openaiChat({
      messages: [
        { role: "system", content: "You compress agent session history. Preserve the mission. No tools." },
        { role: "user", content: prompt },
      ],
      tools: [],
      includeTools: false,
      stream: false,
    });
    const text = (data && (data.choices?.[0]?.message?.content || data.text || "")).toString().trim();
    if (!text || text.length < 40) return extractive;
    return (
      "## COMPACTED HISTORY (ADK LLM summary — continue the same job)\\n" +
      "PRIMARY USER REQUEST (do not abandon): " + String(mission || "(unknown)") + "\\n\\n" +
      text +
      "\\n\\nINSTRUCTION: Continue toward the PRIMARY USER REQUEST. Tools remain fully available."
    );
  } catch (_) {
    return extractive;
  }
}

function missionContextBlock() {
  if (typeof agentState === "undefined") return "";
  const parts = [];
  if (agentState.mission) {
    parts.push("## MISSION (sticky — original request)\n" + agentState.mission);
  }
  if (agentState.compactionSummary) {
    parts.push(
      "## ROLLING CONTEXT (compacted older steps; not a new task)\n" +
      agentState.compactionSummary
    );
  }
  if (agentState.wave > 0) {
    parts.push(
      "## CONTINUITY\nSame job, wave " + (agentState.wave + 1) +
      ". Keep going from ROLLING CONTEXT. Do not recap. Do not restart."
    );
  }
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

/**
 * ADK token-threshold compaction against agentHistory.
 * Rewrites history as: [system] + [compaction message] + [last eventRetentionSize raw]
 * Prior compaction summary is seeded into the next summary (rolling).
 *
 * @param {{ force?: boolean, lastUsage?: object|null }} [opts]
 * @returns {{ compacted: boolean, tokensBefore: number, tokensAfter: number }}
 */
function maybeCompactAgentHistory(opts) {
  opts = opts || {};
  if (!Array.isArray(agentHistory) || agentHistory.length < 8) {
    return { compacted: false, tokensBefore: 0, tokensAfter: 0 };
  }

  const tokensFromUsage = opts.lastUsage && (
    opts.lastUsage.prompt_tokens ||
    opts.lastUsage.promptTokens ||
    0
  );
  const tokensBefore = tokensFromUsage > 0
    ? tokensFromUsage
    : estimatePromptTokens(agentHistory);

  const retention = GOAR_COMPACTION.eventRetentionSize;
  const threshold = GOAR_COMPACTION.tokenThreshold;
  const overTokens = tokensBefore >= threshold;
  const overCount = agentHistory.length > retention + 6;
  if (!opts.force && !overTokens && !overCount) {
    return { compacted: false, tokensBefore, tokensAfter: tokensBefore };
  }

  const sys = agentHistory[0] && agentHistory[0].role === "system" ? agentHistory[0] : null;
  const rest = sys ? agentHistory.slice(1) : agentHistory.slice();
  if (rest.length <= retention) {
    return { compacted: false, tokensBefore, tokensAfter: tokensBefore };
  }

  const split = Math.max(0, rest.length - retention);
  const toCompact = rest.slice(0, split);
  const keep = rest.slice(split);

  const mission = (typeof agentState !== "undefined" && agentState.mission) || "";
  const prior = (typeof agentState !== "undefined" && agentState.compactionSummary) || "";
  const summary = extractiveCompactionSummary(toCompact, mission, prior);

  if (typeof agentState !== "undefined") {
    agentState.compactionSummary = summary;
    agentState.compactionRange = {
      compactedCount: toCompact.length,
      keptCount: keep.length,
      tokensBefore,
      at: Date.now(),
    };
  }

  const compactMsg = {
    role: "user",
    content: summary,
  };

  agentHistory = sys ? [sys, compactMsg].concat(keep) : [compactMsg].concat(keep);

  const tokensAfter = estimatePromptTokens(agentHistory);
  try {
    /* compact is silent — do not change the live strip */
  } catch (_) {}
  if (typeof paintTokenMeter === "function") {
    try {
      if (typeof __sessionTokens !== "undefined") __sessionTokens.context = tokensAfter;
      paintTokenMeter();
    } catch (_) {}
  }
  return { compacted: true, tokensBefore, tokensAfter };
}

/**
 * Drop-in replacement for naive trim: compact instead of hard-slice reset.
 */
function trimAgentHistory() {
  maybeCompactAgentHistory({ force: false });
}


/**
 * Async compaction entry — prefers extractive; uses LLM when force or tokens very high.
 * @param {{ force?: boolean, lastUsage?: object|null, useLlm?: boolean }} [opts]
 */
async function maybeCompactAgentHistoryAsync(opts) {
  opts = opts || {};
  const base = maybeCompactAgentHistory({ force: false, lastUsage: opts.lastUsage });
  // If not forced and under pressure not met, base already no-op
  const tokensFromUsage = opts.lastUsage && (opts.lastUsage.prompt_tokens || opts.lastUsage.promptTokens || 0);
  const tokens = tokensFromUsage || estimatePromptTokens(agentHistory);
  const wantLlm = !!(opts.useLlm || opts.force || tokens >= GOAR_COMPACTION.tokenThreshold * 1.15);
  if (!wantLlm) {
    if (opts.force) return maybeCompactAgentHistory({ force: true, lastUsage: opts.lastUsage });
    return base;
  }
  // Run full compact with LLM summary generation for the prefix
  if (!Array.isArray(agentHistory) || agentHistory.length < 8) {
    return { compacted: false, tokensBefore: tokens, tokensAfter: tokens };
  }
  const retention = GOAR_COMPACTION.eventRetentionSize;
  const sys = agentHistory[0] && agentHistory[0].role === "system" ? agentHistory[0] : null;
  const rest = sys ? agentHistory.slice(1) : agentHistory.slice();
  if (rest.length <= retention && !opts.force) {
    return { compacted: false, tokensBefore: tokens, tokensAfter: tokens };
  }
  if (rest.length <= retention) {
    return { compacted: false, tokensBefore: tokens, tokensAfter: tokens };
  }
  const split = Math.max(0, rest.length - retention);
  const toCompact = rest.slice(0, split);
  const keep = rest.slice(split);
  const mission = (typeof agentState !== "undefined" && agentState.mission) || "";
  const prior = (typeof agentState !== "undefined" && agentState.compactionSummary) || "";
  const summary = await llmCompactionSummary(toCompact, mission, prior);
  if (typeof agentState !== "undefined") {
    agentState.compactionSummary = summary;
    agentState.compactionRange = { compactedCount: toCompact.length, keptCount: keep.length, tokensBefore: tokens, at: Date.now(), llm: true };
  }
  const compactMsg = { role: "user", content: summary };
  agentHistory = sys ? [sys, compactMsg].concat(keep) : [compactMsg].concat(keep);
  const tokensAfter = estimatePromptTokens(agentHistory);
  try {
    /* compact is silent — do not change the live strip */
  } catch (_) {}
  if (typeof paintTokenMeter === "function") {
    try {
      if (typeof __sessionTokens !== "undefined") __sessionTokens.context = tokensAfter;
      paintTokenMeter();
    } catch (_) {}
  }
  return { compacted: true, tokensBefore: tokens, tokensAfter };
}

