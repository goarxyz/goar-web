function sandboxStatusBlurb() {
  try {
    const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
    const ready = !!(envReady || window.envReady || window.__GOAR_ENV_READY);
    const ssh = !!(window.__GOAR_SSH && window.__GOAR_SSH.ready);
    return [
      "env:" + (ready ? "ready" : "booting"),
      "kali:" + (ssh ? "up" : "down"),
      "model:" + (s.apiModel || ""),
      "mission:" + (typeof agentState !== "undefined" && agentState.mission ? String(agentState.mission).slice(0, 120) : "-"),
    ].join(" ");
  } catch (e) {
    return "";
  }
}

async function toolEnvInfo() {
  const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
  const ssh = !!(window.__GOAR_SSH && window.__GOAR_SSH.ready);
  return "env=" + !!(typeof envReady !== "undefined" && envReady) + " kali=" + ssh + " model=" + (s.apiModel || "");
}
