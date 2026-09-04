function renderAttachChips() {
  const host = document.getElementById("chat-attach-chips");
  const list = window.__GOAR_ATTACHMENTS || [];
  if (!host) return;
  if (!list.length) {
    host.innerHTML = "";
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.innerHTML = list.map((a, i) =>
    '<span class="attach-chip" data-i="' + i + '">' +
    String(a.name || "file").replace(/[<>&]/g, "") +
    ' <button type="button" data-rm="' + i + '" aria-label="Remove">×</button></span>'
  ).join("");
  host.querySelectorAll("[data-rm]").forEach((b) => {
    b.addEventListener("click", () => {
      const i = Number(b.getAttribute("data-rm"));
      (window.__GOAR_ATTACHMENTS || []).splice(i, 1);
      renderAttachChips();
    });
  });
}

function consumeAttachments() {
  const list = window.__GOAR_ATTACHMENTS || [];
  window.__GOAR_ATTACHMENTS = [];
  renderAttachChips();
  if (!list.length) return "";
  return list.map((a) =>
    "\n\n--- attached: " + a.name + " (" + a.size + " B) ---\n" + (a.text || "") + "\n--- end ---"
  ).join("");
}

function showTurnAck() {
  try {
    const w = document.getElementById("welcome");
    if (w) {
      w.classList.add("hide");
      w.classList.remove("show", "on");
    }
  } catch (_) {}
  try {
    const es = document.getElementById("emptyState");
    if (es) es.classList.remove("on");
  } catch (_) {}
  let ref = null;
  try {
    if (typeof beginStreamMsg === "function") ref = beginStreamMsg("thought");
  } catch (_) {}
  if (ref && ref.el) {
    ref.el.classList.add("ack", "streaming");
    if (ref.el._fold) {
      ref.el._fold.innerHTML = 'Thinking<span class="ack-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    }
  }
  window.__GOAR_ACK = ref;
  try {
    if (typeof setRunningUI === "function") setRunningUI(true, "thinking");
    if (typeof setStatusFooter === "function") setStatusFooter("thinking…");
  } catch (_) {}
  return ref;
}

async function sendCommand() {
  let msg = (agentEl.input?.value || "").trim();
  const extra = consumeAttachments();
  if (extra) msg = (msg || "Review the attached files.") + extra;
  if (agentBusy && !msg) {
    requestAgentStop();
    return;
  }
  if (!msg) return;
  if (msg === "/stop" || msg === "/abort") {
    agentEl.input.value = "";
    requestAgentStop();
    if (typeof paintComposerMode === "function") paintComposerMode();
    return;
  }
  // Mid-run: inject additional context into the same job (do not start a new turn)
  if (agentBusy) {
    try {
      if (typeof queueSteer === "function") queueSteer(msg);
      else {
        window.__GOAR_STEER = window.__GOAR_STEER || [];
        window.__GOAR_STEER.push(msg);
      }
      agentEl.input.value = "";
      agentEl.input.style.height = "auto";
      appendMsg(msg, "user");
      if (typeof paintLiveWork === "function") paintLiveWork({ text: "Context added — applying next" });
      if (typeof setStatusFooter === "function") setStatusFooter("context added");
      if (typeof paintComposerMode === "function") paintComposerMode();
    } catch (_) {}
    return;
  }
  agentEl.input.value = "";
  agentEl.input.style.height = "auto";
  if (msg.startsWith("/")) {
    appendMsg(msg, "user");
    await handleSlash(msg);
    try { persistAgentChat(); } catch (_) {}
    return;
  }
  appendMsg(msg, "user");
  showTurnAck();
  await agentTurn(msg);
}
