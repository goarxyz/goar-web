function buildVibeSystemPrompt() {
  let core = "";
  try {
    if (typeof VIBE_PROMPTS !== "undefined" && VIBE_PROMPTS && VIBE_PROMPTS.cli) core = VIBE_PROMPTS.cli;
  } catch (_) {}
  if (!core && typeof OPERATOR_CORE === "string") core = OPERATOR_CORE;
  core = String(core || "").trim();
  const iso = new Date().toISOString().slice(0, 10);
  core = core.replace(/\$current_date/g, iso);
  core = core.replace(/^You are Mistral Vibe, a CLI coding agent built by Mistral AI\./, "You are GOAR, a coding agent.");
  const lines = [core];
  lines.push("Scratchpad directory: /workspace/.scratch (session-local temp). Write drafts and probes there. Product files go in /workspace.");
  lines.push("Start the task immediately. You pick tools; the user never names them. Do not list tools. Do not recap categories. Do the work.");
  lines.push("Workspace is /workspace. Python: python_exec. Firefox: browse / browser. Security is five categories — pysec_crypto, pysec_http, pysec_recon, pysec_vuln, pysec_analyze. Pick the category that fits and pass url/data/token/path. Optional tool id from that category. Never dump the catalog.");
  try {
    if (typeof agentState !== "undefined" && agentState && agentState.mission) {
      const m = String(agentState.mission).trim();
      if (m && m.length > 2 && !/^(hi|hey|hello|thanks|ok|okay|yo)\b/i.test(m)) {
        lines.push("MISSION: " + m.slice(0, 240));
      }
    }
  } catch (_) {}
  return lines.filter(Boolean).join("\n\n");
}