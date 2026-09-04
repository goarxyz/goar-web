function buildVibeSystemPrompt() {
  let core = "";
  try {
    if (typeof OPERATOR_CORE === "string") core = OPERATOR_CORE;
  } catch (_) {}
  core = String(core || "").trim();
  const iso = new Date().toISOString().slice(0, 10);
  core = core.replace(/\$current_date/g, iso);
  const lines = [core];
  let kali = false;
  let host = "segfault.net";
  try {
    kali = typeof sshReady === "function" ? sshReady() : !!(typeof SSH !== "undefined" && SSH && SSH.ready);
    if (typeof resolveSshTarget === "function") host = (resolveSshTarget() || {}).host || host;
  } catch (_) {}
  lines.push(
    "Workspace is the live Kali Linux SSH box (" + host + "), root. Same PTY — cwd and env persist. " +
    "The whole userland is yours: python3, git, curl, compilers, pip, apt, nmap, whatever is installed. " +
    "Discover with which / type / apt-cache / pip show. Install what you need. " +
    "Durable files: /sec/workspace (also /workspace). Scratch: /root/.scratch. " +
    "Pysec and playbooks are gone — use bash and the file tools instead. " +
    "Do the work. Do not list tools. Do not recap the environment. Read before you edit. Prove it works."
  );
  if (!kali) {
    lines.push("Kali SSH is still connecting. Call bash/write/read/python anyway — tools bring the VM up. Do not invent a local sandbox.");
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
