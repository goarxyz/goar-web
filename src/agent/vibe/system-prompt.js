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
  let kali = false;
  try {
    kali = typeof sshReady === "function" ? sshReady() : !!(typeof SSH !== "undefined" && SSH && SSH.ready);
  } catch (_) {}
  lines.push("Workspace is the live Kali Linux SSH instance on segfault.net. You are root on that VM. bash, read_file, write_file, edit, and python_exec run on the Kali PTY. Durable files: /sec/workspace (also /workspace). Scratch: /root/.scratch. Pyodide/pysec are not the workspace. Do not list tools. Do not recap the environment. Do the work.");
  if (!kali) {
    lines.push("Kali SSH is still connecting this browser session. Call bash/write/read/python anyway — tools bring the VM up. Do not fall back to describing a local sandbox.");
  }
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
