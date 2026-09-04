/**
 * Compact system prompt: operator core + live status line.
 * Tools are in the API tools array — never listed here.
 */
function buildVibeSystemPrompt() {
  const lines = [];
  if (typeof OPERATOR_CORE === "string") lines.push(OPERATOR_CORE.trim());
  let live = "";
  try {
    const s = typeof loadSettings === "function" ? loadSettings() : {};
    if (s && s.apiModel) live = "model=" + s.apiModel;
  } catch (_) {}
  try {
    if (typeof agentState !== "undefined" && agentState && agentState.mission) {
      const m = String(agentState.mission).trim();
      if (m && m.length > 2 && !/^(hi|hey|hello|thanks|ok|okay)\b/i.test(m)) {
        live += (live ? "\n" : "") + "MISSION: " + m.slice(0, 240);
      }
    }
  } catch (_) {}
  if (live) lines.push(live);
  return lines.filter(Boolean).join("\n\n");
}
