(function (global) {
  "use strict";

  const VIBE_RUNTIME = {
    stepsPerWave: 24,
    maxWaves: 240,
    maxQuiet: 2,
    apiRetries: 4,
  };

  function vibeIsSmallTalk(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t || t.length > 80) return false;
    return /^(hi|hey|hello|howdy|yo|sup|hiya|thanks|thank you|ok|okay|gm|good (morning|evening|afternoon)|how are you|what('?s| is) up|who are you|what can you do)[\s!.?,]*$/i.test(t);
  }

  function vibeMissionOpen() {
    try {
      if (typeof agentState === "undefined") return false;
      if (agentState.missionClosed) return false;
      if (agentState.todos && agentState.todos.some((t) => t && !t.done)) return true;
      const m = String(agentState.mission || "").toLowerCase();
      if (!m) return false;
      if (vibeIsSmallTalk(m) || (/^(hi|hey|hello|thanks|ok|okay|yo)\b/.test(m) && m.length < 24)) return false;
      return /\b(explor|build|fix|implement|review|write|create|scan|test|refactor|ship|assess|audit|deploy|debug|analy|open|fetch|code|file|workspace)\b/.test(m);
    } catch (_) {
      return false;
    }
  }

  function vibeLooksFinished(content) {
    const t = String(content || "").trim();
    if (t.length < 40) return false;
    return /\b(done|delivered|complete|finished|here'?s (what|the) (i found|result|tree|report))\b/i.test(t);
  }

  function vibeShouldKeepGoing(ctx) {
    ctx = ctx || {};
    if (typeof agentAbort !== "undefined" && agentAbort) return false;
    if (!vibeMissionOpen()) return false;
    if (vibeLooksFinished(ctx.content) && !(ctx.toolCount > 0 && ctx.quiet < 1)) return false;
    const quiet = ctx.quiet || 0;
    if (quiet >= VIBE_RUNTIME.maxQuiet) return false;
    if ((ctx.toolCount || 0) > 0) return true;
    return vibeMissionOpen() && quiet < 1;
  }

  function vibeContinueMessage(ctx) {
    ctx = ctx || {};
    let todos = "";
    try {
      if (typeof agentState !== "undefined" && agentState.todos) {
        const open = agentState.todos.filter((t) => t && !t.done).map((t) => t.text || t.title || "").filter(Boolean);
        if (open.length) todos = " Open: " + open.slice(0, 6).join(" · ") + ".";
      }
    } catch (_) {}
    return (
      "Continue the same mission. Use tools. Do not recap and do not stop." + todos
    );
  }

  function vibeSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function vibeRetryable(err) {
    const m = String(err && err.message ? err.message : err || "");
    if (/AbortError|Stopped|aborted/i.test(m)) return false;
    if (/Auth failed|401|403|No API key|No model/i.test(m)) return false;
    return /429|500|502|503|504|timeout|network|fetch|stream|temporar|overload|rate.?limit|context.?too.?long|ECONNRESET/i.test(m);
  }

  async function vibeCallModel(fn, opts) {
    let last;
    const n = VIBE_RUNTIME.apiRetries;
    for (let i = 0; i < n; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (!vibeRetryable(e) || i === n - 1) throw e;
        const msg = String(e && e.message ? e.message : e);
        if (/context.?too.?long|maximum context|prompt is too long/i.test(msg)) {
          try {
            if (typeof maybeCompactAgentHistoryAsync === "function") {
              await maybeCompactAgentHistoryAsync({ force: true, lastUsage: opts && opts.lastUsage, useLlm: true });
            } else if (typeof maybeCompactAgentHistory === "function") {
              maybeCompactAgentHistory({ force: true });
            }
          } catch (_) {}
        }
        await vibeSleep(800 * Math.pow(2, i));
      }
    }
    throw last;
  }

  try {
    if (typeof GOAR_COMPACTION !== "undefined") {
      GOAR_COMPACTION.stepsPerWave = VIBE_RUNTIME.stepsPerWave;
      GOAR_COMPACTION.maxWaves = VIBE_RUNTIME.maxWaves;
      GOAR_COMPACTION.tokenThreshold = GOAR_COMPACTION.tokenThreshold || 22000;
    }
  } catch (_) {}

  if (typeof registerVibeHook === "function") {
    registerVibeHook("post_agent", function (ctx) {
      try {
        if (typeof agentState !== "undefined" && agentState.todos && agentState.todos.some((t) => t && !t.done)) {
          return { retryMessage: vibeContinueMessage(ctx) };
        }
      } catch (_) {}
      return null;
    });
  }

  global.VIBE_RUNTIME = VIBE_RUNTIME;
  global.vibeIsSmallTalk = vibeIsSmallTalk;
  global.vibeMissionOpen = vibeMissionOpen;
  global.vibeShouldKeepGoing = vibeShouldKeepGoing;
  global.vibeContinueMessage = vibeContinueMessage;
  global.vibeCallModel = vibeCallModel;
  global.vibeRetryable = vibeRetryable;
})(typeof window !== "undefined" ? window : globalThis);
