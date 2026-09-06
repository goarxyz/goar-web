function sandboxStatusBlurb() {
  try {
    const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
    const ready = !!(envReady || window.envReady || window.__GOAR_ENV_READY);
    const ssh = !!(window.__GOAR_SSH && window.__GOAR_SSH.ready);
    return [
      "env:" + (ready ? "ready" : "booting"),
      "kali:" + (ssh ? "up" : "down"),
      "model:" + ((typeof isHiddenApiProvider === "function" && isHiddenApiProvider(s.provider, s.apiBase)) ? "GOAR" : (s.apiModel || "GOAR")),
      "mission:" + (typeof agentState !== "undefined" && agentState.mission ? String(agentState.mission).slice(0, 120) : "-"),
    ].join(" ");
  } catch (e) {
    return "";
  }
}

async function toolEnvInfo() {
  const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
  const ssh = !!(window.__GOAR_SSH && window.__GOAR_SSH.ready);
  return "env=" + !!(typeof envReady !== "undefined" && envReady) + " kali=" + ssh + " model=" + ((typeof isHiddenApiProvider === "function" && isHiddenApiProvider(s.provider, s.apiBase)) ? "GOAR" : (s.apiModel || "GOAR"));
}
