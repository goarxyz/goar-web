/**
 * Conversation middleware (before_turn).
 * Actions: continue | stop | compact | inject
 */
const MiddlewareAction = {
  CONTINUE: "continue",
  STOP: "stop",
  COMPACT: "compact",
  INJECT: "inject",
};

const vibeMiddleware = [];

function registerVibeMiddleware(mw) {
  if (mw && typeof mw.beforeTurn === "function") vibeMiddleware.push(mw);
  return mw;
}

function vibeConversationContext() {
  return {
    messages: typeof agentHistory !== "undefined" ? agentHistory : [],
    tokens: typeof estimatePromptTokens === "function"
      ? estimatePromptTokens(typeof agentHistory !== "undefined" ? agentHistory : [])
      : 0,
    abort: typeof agentAbort !== "undefined" && !!agentAbort,
    mission: typeof agentState !== "undefined" ? agentState.mission : "",
  };
}

async function runVibeBeforeTurn() {
  const ctx = vibeConversationContext();
  const injections = [];
  for (const mw of vibeMiddleware) {
    let result;
    try {
      result = await mw.beforeTurn(ctx);
    } catch (e) {
      console.warn("[goar] vibe middleware", e);
      continue;
    }
    if (!result || !result.action) continue;
    if (result.action === MiddlewareAction.STOP) return result;
    if (result.action === MiddlewareAction.COMPACT) return result;
    if (result.action === MiddlewareAction.INJECT && result.message) {
      injections.push(String(result.message));
    }
  }
  if (injections.length) {
    return { action: MiddlewareAction.INJECT, message: injections.join("\n") };
  }
  return { action: MiddlewareAction.CONTINUE };
}

registerVibeMiddleware({
  name: "abort",
  async beforeTurn(ctx) {
    if (ctx.abort && !(window.__GOAR_STEER || []).length) {
      return { action: MiddlewareAction.STOP, reason: "abort" };
    }
    return { action: MiddlewareAction.CONTINUE };
  },
});

registerVibeMiddleware({
  name: "token-pressure",
  async beforeTurn(ctx) {
    const cap = (typeof GOAR_COMPACTION !== "undefined" && GOAR_COMPACTION.tokenThreshold) || 22000;
    if (ctx.tokens > cap) return { action: MiddlewareAction.COMPACT, reason: "token-pressure" };
    return { action: MiddlewareAction.CONTINUE };
  },
});
