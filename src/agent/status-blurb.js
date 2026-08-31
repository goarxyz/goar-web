function sandboxStatusBlurb() {
  try {
    const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
    const ready = !!(envReady || window.envReady || window.__GOAR_ENV_READY);
    return [
      "env:" + (ready ? "ready" : "booting"),
      "model:" + (s.apiModel || ""),
      "mission:" + (typeof agentState !== "undefined" && agentState.mission ? String(agentState.mission).slice(0, 120) : "-"),
    ].join(" ");
  } catch (e) {
    return "";
  }
}

async function toolEnvInfo() {
  const s = (typeof settingsSnapshot === "function") ? settingsSnapshot() : {};
  return "env=" + !!(typeof envReady !== "undefined" && envReady) + " model=" + (s.apiModel || "");
}
