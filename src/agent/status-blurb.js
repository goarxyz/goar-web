function sandboxStatusBlurb() {
  try {
    const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
    let kali = false;
    let kaliErr = "";
    try {
      kali = typeof sshReady === "function" ? sshReady() : !!(typeof SSH !== "undefined" && SSH && SSH.ready);
      if (!kali && typeof sshStatus === "function") kaliErr = String((sshStatus() || {}).lastError || "");
    } catch (_) {}
    const ready = kali || !!(typeof envReady !== "undefined" && envReady) || !!window.__GOAR_ENV_READY;
    return [
      "kali:" + (kali ? "ready" : (kaliErr ? "connecting" : "boot")),
      "env:" + (ready ? "ready" : "booting"),
      "model:" + (s.apiModel || ""),
      "mission:" + (typeof agentState !== "undefined" && agentState.mission ? String(agentState.mission).slice(0, 160) : "-"),
    ].join(" ");
  } catch (e) {
    return "";
  }
}

async function toolEnvInfo() {
  const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
  let kali = false;
  let st = {};
  try {
    kali = typeof sshReady === "function" ? sshReady() : !!(typeof SSH !== "undefined" && SSH && SSH.ready);
    if (typeof sshStatus === "function") st = sshStatus() || {};
  } catch (_) {}
  const head = [
    "kali=" + kali,
    "ssh_host=" + (st.host || ""),
    "ssh_user=" + (st.user || ""),
    "ssh_port=" + (st.port || ""),
    "ssh_err=" + (st.lastError || ""),
    "env=" + !!(typeof envReady !== "undefined" && envReady),
    "model=" + (s.apiModel || ""),
    "workspace=/sec/workspace",
  ].join(" ");
  if (!kali || typeof sshExec !== "function") return head;
  try {
    const r = await sshExec(
      "echo HOST=$(hostname); uname -a; id; pwd; echo ---bins---; " +
        "for b in python3 pip3 git curl wget nmap node npm gcc g++ make cargo rustc go ruby perl php docker; do " +
        "command -v $b 2>/dev/null; done; echo ---ws---; ls -la /sec/workspace 2>/dev/null | head -40; ls -la /workspace 2>/dev/null | head -20",
      25000
    );
    return head + "\n" + String((r && r.output) || "");
  } catch (e) {
    return head + "\n" + String(e && e.message ? e.message : e);
  }
}
