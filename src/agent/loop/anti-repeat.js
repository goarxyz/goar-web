function fingerprintTool(name, args) {
  try {
    const a = args || {};
    // Include action-specific payload so different edits/writes are NOT false loops
    const payload = {
      n: name,
      c: String(a.command || a.cmd || "").slice(0, 160),
      p: String(a.path || a.src || a.dest || "").slice(0, 120),
      p2: String(a.dest || "").slice(0, 80),
      q: String(a.query || a.url || a.pattern || "").slice(0, 120),
      act: String(a.action || a.tool_id || a.toolId || "").slice(0, 40),
      code: String(a.code || a.content || "").slice(0, 120),
      old: String(a.old_string || a.oldString || "").slice(0, 80),
      neu: String(a.new_string || a.newString || "").slice(0, 80),
      idx: a.index != null ? a.index : (a.step != null ? a.step : ""),
    };
    return (name + "|" + JSON.stringify(payload)).slice(0, 320);
  } catch (_) {
    return String(name || "tool");
  }
}

function detectToolLoop(name, args) {
  // Telemetry only — NEVER block tools (user requirement).
  // "Repetition" is fixed via ADK-style context compaction + mission pin, not tool bans.
  const fp = fingerprintTool(name, args);
  recentToolFingerprints.push(fp);
  if (recentToolFingerprints.length > 64) recentToolFingerprints = recentToolFingerprints.slice(-64);

  const path = String((args && (args.path || args.dest || args.src)) || "").trim();
  const mutates = /^(write_file|edit_file|python_exec|bash)$/.test(name);
  if (mutates && path) {
    if (name === "bash") {
      const cmd = String(args.command || args.cmd || "");
      if (/python|pip|cat |tee |sed |>>| >/.test(cmd)) {
        pathActionCounts[path] = (pathActionCounts[path] || 0) + 1;
      }
    } else {
      pathActionCounts[path] = (pathActionCounts[path] || 0) + 1;
    }
  }
  const pathHits = path ? (pathActionCounts[path] || 0) : 0;
  let consecutive = 0;
  for (let i = recentToolFingerprints.length - 1; i >= 0; i--) {
    if (recentToolFingerprints[i] === fp) consecutive++;
    else break;
  }
  const window = recentToolFingerprints.slice(-16);
  const windowHits = window.filter((x) => x === fp).length;
  return {
    loop: false,
    warn: consecutive >= 6 || windowHits >= 8,
    consecutive,
    fp,
    windowHits,
    pathHits,
    path,
  };
}


function persistAgentChat() {
  try {
    const rows = [];
    const chat = agentEl.chat;
    if (chat) {
      for (const el of chat.querySelectorAll(".msg")) {
        if (el.classList.contains("preview")) continue;
        const kind = (el.className || "").replace(/\bmsg\b/g, "").replace(/\bstreaming\b/g, "").trim().split(/\s+/)[0] || "ai";
        const body = el.querySelector(".body");
        rows.push({ kind, text: body ? body.textContent : el.textContent });
      }
    }
    localStorage.setItem(AGENT_CHAT_KEY, JSON.stringify(rows.slice(-160)));
    localStorage.setItem(AGENT_STATE_KEY, JSON.stringify({
      todos: agentState.todos,
      plan: agentState.plan,
      ledger: agentState.ledger,
      memories: agentState.memories,
      lastThinking: agentState.lastThinking || "",
      lastTool: agentState.lastTool || "",
      mission: agentState.mission || "",
      missionClosed: !!agentState.missionClosed,
      compactionSummary: agentState.compactionSummary || "",
      wave: agentState.wave || 0,
    }));
    // Integrated conversation for the model (same turns user sees), sans system prompt
    try {
      const hist = (agentHistory || []).filter((m) => {
        if (!m || !m.role || m.role === "system" || m.role === "tool") return false;
        if (m.tool_calls) return false;
        return true;
      }).slice(-8).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 2000) }));
      localStorage.setItem(AGENT_HISTORY_KEY, JSON.stringify(hist));
    } catch (_) {}
    try { if (typeof saveCurrentSession === "function") saveCurrentSession({ checkpoint: true }); } catch (_) {}
  } catch (_) {}
}

function restoreAgentChat() {
  try {
    const raw = localStorage.getItem(AGENT_CHAT_KEY);
    if (!raw) return;
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) return;
    const hasChat = (rows || []).some((r) => r && (String(r.kind||"").includes("user") || String(r.kind||"").includes("ai")));
    const w = document.getElementById("welcome");
    if (w && hasChat) { w.classList.add("hide"); w.classList.remove("show", "on"); }
    for (const r of rows.slice(-80)) {
      if (!r || r.text == null) continue;
      let kind = r.kind || "sys";
      // DOM class may be "tool-run streaming" etc.
      if (kind.includes("tool-run") || kind === "tool") kind = "tool-run";
      else if (kind.includes("tool-out")) kind = "tool-out";
      else if (kind.includes("thought")) kind = "thought";
      else if (kind.includes("turn-foot")) kind = "turn-foot";
      else if (kind.includes("user")) kind = "user";
      else if (kind.includes("err")) kind = "err";
      else if (kind.includes("ai")) kind = "ai";
      if ((kind === "ai" || kind === "thought") && typeof isStagingProse === "function" && isStagingProse(r.text)) continue;
      appendMsg(String(r.text), kind);
    }
  } catch (_) {}
  try {
    const st = JSON.parse(localStorage.getItem(AGENT_STATE_KEY) || "null");
    if (st && typeof st === "object") {
      if (Array.isArray(st.todos)) agentState.todos = st.todos;
      if (st.plan) agentState.plan = st.plan;
      if (st.ledger) agentState.ledger = { ...agentState.ledger, ...st.ledger };
      if (Array.isArray(st.memories)) agentState.memories = st.memories;
      if (st.lastThinking) agentState.lastThinking = st.lastThinking;
      if (st.lastTool) agentState.lastTool = st.lastTool;
      if (st.mission) agentState.mission = st.mission;
      if (st.missionClosed != null) agentState.missionClosed = !!st.missionClosed;
      if (st.compactionSummary) agentState.compactionSummary = st.compactionSummary;
      if (st.wave != null) agentState.wave = st.wave || 0;
    }
  } catch (_) {}
  try {
    const hr = JSON.parse(localStorage.getItem(AGENT_HISTORY_KEY) || "null");
    if (Array.isArray(hr) && hr.length) {
      agentHistory = hr.filter((m) => m && (m.role === "user" || m.role === "assistant") && !m.tool_calls)
        .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 2000) }))
        .slice(-8);
    }
  } catch (_) {}
}

const ICON_SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>';
const ICON_STOP = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.2"/></svg>';

function queueSteer(text) {
  const t = String(text || "").trim();
  if (!t) return;
  if (!window.__GOAR_STEER) window.__GOAR_STEER = [];
  window.__GOAR_STEER.push(t);
}

function drainSteers() {
  const list = (window.__GOAR_STEER || []).map((s) => String(s || "").trim()).filter(Boolean);
  window.__GOAR_STEER = [];
  return list;
}

function formatSteer(list) {
  const rows = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!rows.length) return "";
  return "[additional context from the user — apply this now. Do not restart the mission.]\n" + rows.join("\n\n");
}

function paintLiveWork(patch) {
  const el = document.getElementById("live-work");
  const text = document.getElementById("live-work-text");
  const running = typeof agentBusy !== "undefined" && !!agentBusy;
  if (el) el.hidden = !running;
  if (!text) return;
  let label = "";
  if (patch && patch.text) label = String(patch.text);
  else {
    const phase = (typeof __ind !== "undefined" && __ind.phase) || "";
    const tool = (typeof __ind !== "undefined" && __ind.tool) || "";
    if (phase === "thinking") label = "Thinking";
    else if (phase === "streaming") label = "Writing";
    else if (phase === "tool" && tool) label = tool;
    else if (/stop/i.test(phase)) label = "Stopping";
    else if (running) label = "Working";
  }
  if (label) text.textContent = label;
}

function paintComposerMode() {
  const running = typeof agentBusy !== "undefined" && !!agentBusy;
  const box = document.querySelector("#input-wrap .input-box");
  const send = document.getElementById("send-btn");
  const input = document.getElementById("msg-input");
  const live = document.getElementById("live-work");
  if (box) box.classList.toggle("running", running);
  if (live) live.hidden = !running;
  try { document.body.classList.toggle("agent-running", running); } catch (_) {}
  const hasText = !!(input && String(input.value || "").trim());
  if (send) {
    const stopMode = running && !hasText;
    send.classList.toggle("is-stop", stopMode);
    send.innerHTML = stopMode ? ICON_STOP : ICON_SEND;
    send.disabled = false;
    send.setAttribute("aria-label", stopMode ? "Stop" : (running ? "Add context" : "Send"));
    send.title = stopMode ? "Stop" : (running ? "Add to the run" : "Send");
  }
  if (input) {
    input.placeholder = running ? "Add context — or stop" : "Request Anything";
  }
  paintLiveWork();
}

/**
 * @param {boolean} on
 * @param {string} [text]
 */
function setRunningUI(on, text) {
  const ab = document.getElementById("abortBtn");
  if (ab) {
    ab.style.display = on ? "inline-block" : "none";
    ab.classList.toggle("on", !!on);
  }
  if (!on) {
    syncIndicators({ phase: "idle", tool: "", detail: "" });
  } else {
    const s = String(text || "thinking").replace(/\.\.\./g, "");
    if (/think/i.test(s)) syncIndicators({ phase: "thinking", tool: "" });
    else if (/^(stream|streaming|writing)$/i.test(s)) syncIndicators({ phase: "streaming", tool: "" });
    else if (/^stopp/i.test(s)) syncIndicators({ phase: "tool", tool: "Stopping" });
    else syncIndicators({ phase: "tool", tool: s.slice(0, 64) });
  }
  paintLiveWork(on ? { text: String(text || "Thinking").replace(/\.\.\./g, "") } : null);
  paintComposerMode();
}

function requestAgentStop() {
  agentAbort = true;
  try { agentAbortController?.abort(); } catch (_) {}
  setStatusFooter("stopping...");
  setRunningUI(true, "stopping...");
  paintLiveWork({ text: "Stopping" });
}


/**
 * OpenAI-compatible SSE stream — mirrors GoarClient.chatStream / executeChatStream.
 * Collects content, reasoning/thinking, and streamed tool_calls; falls back to non-stream.
 */
/** @returns {Promise<ChatStreamResult>} */
