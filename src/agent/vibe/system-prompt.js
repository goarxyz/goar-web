/**
 * Compact system prompt: operator core + skills index + live status.
 * Tools are in the API tools array — never listed here.
 */
function buildVibeSystemPrompt() {
  const lines = [];
  if (typeof OPERATOR_CORE === "string") lines.push(OPERATOR_CORE.trim());
  try {
    if (typeof goarSkillIndex === "function") {
      const idx = goarSkillIndex();
      if (idx) lines.push(idx);
    } else if (typeof goarSkillBlurb === "function") {
      const b = goarSkillBlurb();
      if (b) lines.push(b);
    }
  } catch (_) {}
  let live = "";
  try {
    const s = typeof loadSettings === "function" ? loadSettings() : {};
    if (s && !isHiddenApiProvider(s.provider, s.apiBase) && s.apiModel) live = "model=" + s.apiModel;
  } catch (_) {}
  try {
    if (typeof agentState !== "undefined" && agentState && agentState.mission) {
      const m = String(agentState.mission).trim();
      if (m && m.length > 2 && !/^(hi|hey|hello|thanks|ok|okay)\b/i.test(m)) {
        live += (live ? "\n" : "") + "MISSION: " + m.slice(0, 240);
      }
    }
  } catch (_) {}
  try {
    if (typeof getStateContext === "function") {
      const st = getStateContext();
      if (st) live += (live ? "\n" : "") + st;
    }
  } catch (_) {}
  if (live) lines.push(live);
  return lines.filter(Boolean).join("\n\n");
}
