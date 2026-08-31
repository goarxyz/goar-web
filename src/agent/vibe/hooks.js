/**
 * Agent loop hooks.
 * pre_tool / post_tool / post_agent — JS callbacks, not host subprocesses.
 */
const vibeHooks = { pre_tool: [], post_tool: [], post_agent: [] };

function registerVibeHook(kind, fn) {
  if (!vibeHooks[kind] || typeof fn !== "function") return;
  vibeHooks[kind].push(fn);
}

async function runVibePreTool(name, args) {
  let nextArgs = args;
  for (const fn of vibeHooks.pre_tool) {
    try {
      const r = await fn({ name: name, args: nextArgs });
      if (r && r.deny) {
        return { deny: true, reason: r.reason || "denied", args: nextArgs };
      }
      if (r && r.args && typeof r.args === "object") nextArgs = r.args;
    } catch (e) {
      console.warn("[goar] pre_tool", e);
    }
  }
  return { deny: false, args: nextArgs };
}

async function runVibePostTool(name, args, out) {
  let text = String(out == null ? "" : out);
  for (const fn of vibeHooks.post_tool) {
    try {
      const r = await fn({ name: name, args: args, output: text });
      if (r && typeof r.output === "string") text = r.output;
    } catch (e) {
      console.warn("[goar] post_tool", e);
    }
  }
  return text;
}

async function runVibePostAgent(ctx) {
  const injections = [];
  for (const fn of vibeHooks.post_agent) {
    try {
      const r = await fn(ctx || {});
      if (r && r.retryMessage) injections.push(String(r.retryMessage));
    } catch (e) {
      console.warn("[goar] post_agent", e);
    }
  }
  return injections.join("\n");
}
