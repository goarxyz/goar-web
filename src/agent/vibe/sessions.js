(function (global) {
  "use strict";

  const KEY = "goar.sessions.v1";
  const CUR = "goar.sessions.current";

  function uid() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function loadStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (raw && Array.isArray(raw.items)) return raw;
    } catch (_) {}
    return { items: [] };
  }

  function saveStore(store) {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) {}
  }

  function currentId() {
    try { return localStorage.getItem(CUR) || ""; } catch (_) { return ""; }
  }

  function setCurrentId(id) {
    try { localStorage.setItem(CUR, id || ""); } catch (_) {}
  }

  function titleFromHistory(history) {
    const u = (history || []).find((m) => m && m.role === "user" && m.content && !m._vibe && !m._compaction);
    const t = String(u && u.content ? u.content : "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 72) : "New chat";
  }

  function snapshotNow() {
    const history = (typeof agentHistory !== "undefined" ? agentHistory : []).filter((m) => m && m.role !== "system");
    let state = {};
    try {
      if (typeof agentState !== "undefined") {
        state = {
          todos: agentState.todos,
          plan: agentState.plan,
          ledger: agentState.ledger,
          memories: agentState.memories,
          mission: agentState.mission,
          missionClosed: !!agentState.missionClosed,
          compactionSummary: agentState.compactionSummary || "",
          wave: agentState.wave || 0,
        };
      }
    } catch (_) {}
    return { history: history.slice(-80), state, title: titleFromHistory(history) };
  }

  function saveCurrentSession(opts) {
    opts = opts || {};
    const snap = snapshotNow();
    if (!snap.history.length && !opts.force) return currentId();
    const store = loadStore();
    let id = currentId();
    let item = store.items.find((x) => x.id === id);
    if (!item) {
      id = uid();
      item = { id: id, title: snap.title, created: Date.now(), updated: Date.now(), checkpoints: [] };
      store.items.unshift(item);
      setCurrentId(id);
    }
    item.title = snap.title || item.title;
    item.updated = Date.now();
    item.history = snap.history;
    item.state = snap.state;
    if (opts.checkpoint) {
      item.checkpoints = (item.checkpoints || []).slice(-11);
      item.checkpoints.push({
        ts: Date.now(),
        label: opts.label || ("step " + ((snap.state && snap.state.wave) || 0)),
        history: snap.history,
        state: snap.state,
      });
    }
    saveStore(store);
    return id;
  }

  function listSessions() {
    return loadStore().items.slice(0, 40);
  }

  function applySnapshot(pack) {
    if (!pack) return;
    try {
      if (typeof agentHistory !== "undefined") {
        const sys = agentHistory[0] && agentHistory[0].role === "system" ? [agentHistory[0]] : [];
        agentHistory.length = 0;
        sys.forEach((m) => agentHistory.push(m));
        (pack.history || []).forEach((m) => agentHistory.push(m));
      }
      if (pack.state && typeof agentState !== "undefined") {
        if (Array.isArray(pack.state.todos)) agentState.todos = pack.state.todos;
        if (pack.state.plan) agentState.plan = pack.state.plan;
        if (pack.state.ledger) agentState.ledger = Object.assign({}, agentState.ledger || {}, pack.state.ledger);
        agentState.mission = pack.state.mission || "";
        agentState.missionClosed = !!pack.state.missionClosed;
        agentState.compactionSummary = pack.state.compactionSummary || "";
        agentState.wave = pack.state.wave || 0;
      }
    } catch (_) {}
    const inner = document.getElementById("chat-inner");
    if (inner) {
      [...inner.children].forEach((n) => { if (n.id !== "welcome") n.remove(); });
    }
    const w = document.getElementById("welcome");
    const msgs = (pack.history || []).filter((m) => m.role === "user" || m.role === "assistant");
    if (w) {
      if (msgs.length) {
        w.classList.add("hide");
        w.classList.remove("show", "on");
      } else {
        w.classList.remove("hide");
        w.classList.add("show", "on");
      }
    }
    if (typeof appendMsg === "function") {
      for (const m of pack.history || []) {
        if (!m) continue;
        if (m.role === "user") appendMsg(String(m.content || ""), "user");
        else if (m.role === "assistant" && m.content) appendMsg(String(m.content), "ai");
        else if (m.role === "tool") appendMsg(String(m.content || "").slice(0, 2000), "tool-out");
      }
    }
    try { if (typeof persistAgentChat === "function") persistAgentChat(); } catch (_) {}
  }

  function resumeSession(id) {
    saveCurrentSession();
    const item = loadStore().items.find((x) => x.id === id);
    if (!item) return false;
    setCurrentId(id);
    applySnapshot(item);
    return true;
  }

  function rewindSession(id, index) {
    const item = loadStore().items.find((x) => x.id === id);
    if (!item) return false;
    const cps = item.checkpoints || [];
    const cp = index == null ? cps[cps.length - 1] : cps[index];
    if (!cp) {
      applySnapshot(item);
      return true;
    }
    setCurrentId(id);
    applySnapshot(cp);
    return true;
  }

  function deleteSession(id) {
    const store = loadStore();
    store.items = store.items.filter((x) => x.id !== id);
    saveStore(store);
    if (currentId() === id) setCurrentId("");
  }

  function clearAllSessions() {
    saveStore({ items: [] });
    setCurrentId("");
  }

  function startNewSession() {
    saveCurrentSession();
    setCurrentId("");
    try {
      if (typeof clearMission === "function") clearMission();
      if (typeof agentHistory !== "undefined") {
        const sys = agentHistory[0] && agentHistory[0].role === "system" ? agentHistory[0] : null;
        agentHistory.length = 0;
        if (sys) agentHistory.push(sys);
      }
      localStorage.removeItem("goar.agent.chat.v1");
    } catch (_) {}
    const inner = document.getElementById("chat-inner");
    if (inner) [...inner.children].forEach((n) => { if (n.id !== "welcome") n.remove(); });
    const w = document.getElementById("welcome");
    if (w) {
      w.classList.remove("hide");
      w.style.display = "";
      w.classList.add("show", "on");
    }
    if (typeof goarShowView === "function") goarShowView("chat");
  }

  global.saveCurrentSession = saveCurrentSession;
  global.listSessions = listSessions;
  global.resumeSession = resumeSession;
  global.rewindSession = rewindSession;
  global.deleteSession = deleteSession;
  global.clearAllSessions = clearAllSessions;
  global.startNewSession = startNewSession;
  global.currentSessionId = currentId;
})(typeof window !== "undefined" ? window : globalThis);
