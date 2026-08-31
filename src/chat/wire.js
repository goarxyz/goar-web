function wireAgentUi() {
  enableAgentMode();
  refreshAgentPill();
  if (wireAgentUi._wired) return;
  wireAgentUi._wired = true;
  agentEl.send?.addEventListener("click", () => sendCommand());
  agentEl.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCommand(); }
    if (e.key === "Escape") { e.preventDefault(); requestAgentStop(); }
  });
  agentEl.input?.addEventListener("input", () => {
    const el = agentEl.input;
    el.style.height = "auto";
    el.style.height = Math.min(140, el.scrollHeight) + "px";
    if (typeof paintComposerMode === "function") paintComposerMode();
  });
  document.getElementById("abortBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    requestAgentStop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && agentBusy) requestAgentStop();
  });
  // restore prior chat if any (hide empty state)
  try {
    if (localStorage.getItem(AGENT_CHAT_KEY)) {
      restoreAgentChat();
    } else {
      /* empty state shows Ready — no wall of system text */
      updateStatusBar({});
    }
  } catch (_) {
    updateStatusBar({});
  }
  agentBoot(""); updateStatusBar({ status: "starting" });
  if (typeof paintComposerMode === "function") paintComposerMode();
  setTimeout(() => { try { agentEl.input?.focus(); } catch (_) {} }, 200);
}