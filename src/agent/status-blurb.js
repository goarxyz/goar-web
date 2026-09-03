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
  return [
    "kali=" + kali,
    "ssh_port=" + (st.port || ""),
    "ssh_err=" + (st.lastError || ""),
    "env=" + !!(typeof envReady !== "undefined" && envReady),
    "model=" + (s.apiModel || ""),
    "workspace=/sec/workspace",
  ].join(" ");
}
