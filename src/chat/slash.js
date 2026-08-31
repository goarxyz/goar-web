async function handleSlash(raw) {
  const line = raw.trim();
  const sp = line.slice(1).split(/\s+/);
  const c = (sp[0] || "").toLowerCase();
  const arg = sp.slice(1).join(" ").trim();

  if (c === "help" || c === "h" || c === "?") {
    appendMsg(
      "Commands\n" +
      "  /help\n" +
      "  /settings\n" +
      "  /models          free tool-capable models\n" +
      "  /model <id>\n" +
      "  /key <token>\n" +
      "  /base <url>\n" +
      "  /provider openrouter|groq|...\n" +
      "  /save            snapshot session\n" +
      "  /load            reload + resume\n" +
      "  /export          download session\n" +
      "  /clearsession    wipe session cache\n" +
      "  /clearcache      wipe asset cache\n" +
      "  /clear           clear chat\n" +
      "  /todo · /plan · /stop · /reset\n" +
      "  /pysec-init      preload security toolkit\n" +
      "  /tools           tool map\n" +
      "  /status  /term  /bash  /py",
      "sys",
    );
    return;
  }
  if (c === "tools" || c === "toolmap" || c === "categories") {
    const blurb = typeof categoryKitBlurb === "function" ? categoryKitBlurb() : "";
    appendMsg(
      "Tools\n" +
      blurb +
      "\nKit: micropip, create_tool, list session tools\n" +
      "Workspace: guest bash, python_exec, write_file",
      "sys",
    );
    return;
  }
  if (c === "todo") {
    appendMsg(toolTodo({ action: "list" }), "sys");
    return;
  }
  if (c === "plan") {
    if (!agentState.plan) { appendMsg("No active plan.", "sys"); return; }
    const pl = agentState.plan;
    appendMsg("PLAN: " + pl.goal + "\n" + pl.steps.map((s, i) => (i + 1) + ". [" + s.status + "] " + s.name).join("\n"), "sys");
    return;
  }
  if (c === "kit" || c === "kit-status") {
    appendMsg("Running kit_status...", "sys");
    try { appendMsg(await toolKitStatus(), "sys"); }
    catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "pysec-init") {
    appendMsg("Loading Pyodide security toolkit...", "sys");
    try {
      await ensurePysecWorker();
      appendMsg("pyodide_security ready — agent uses pysec automatically.", "sys");
    } catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "sqlmap-setup" /* deprecated */ || c === "security-setup") {
    appendMsg("Installing sqlmap in guest (pip/offline)...", "sys");
    try {
      const r = await ensureSqlmap();
      appendMsg(JSON.stringify(r, null, 2), "sys");
    } catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "stop" || c === "abort") {
    requestAgentStop();
    appendMsg("Stop requested.", "sys");
    return;
  }
  if (c === "reset" || c === "new") {
    agentHistory = [];
    try { if (typeof clearMission === "function") clearMission(); } catch (_) {};
    recentToolFingerprints = [];
    agentState.todos = [];
    agentState.plan = null;
    agentState.ledger = { goal: "", currentStep: "", facts: [], decisions: [], deadEnds: [] };
    try { localStorage.removeItem(AGENT_CHAT_KEY); localStorage.removeItem(AGENT_STATE_KEY); } catch (_) {}
    if (agentEl.chat) agentEl.chat.innerHTML = "";
    appendMsg("Session reset. Fresh agent context.", "sys");
    const es = document.getElementById("emptyState") || document.getElementById("welcome");
    if (es) es.classList.add("on");
    return;
  }
  if (c === "models") {
    appendMsg("Querying provider /models...", "sys");
    try {
      const ids = await loadModelsFromApi({});
      const free = ids.filter((x) => /:free\b|\/free$/i.test(x));
      const show = (free.length ? free : ids).slice(0, 40);
      appendMsg(
        "Models (" + ids.length + " total" + (free.length ? ", " + free.length + " free-tagged" : "") + ")\n" +
        show.map((x) => "  " + x).join("\n") +
        (ids.length > 40 ? "\n  ... +" + (ids.length - 40) + " more — open Settings" : "") +
        "\nUse: /model <id>",
        "sys",
      );
    } catch (e) {
      appendMsg("Models API error: " + (e.message || e), "err");
    }
    return;
  }
  if (c === "settings" || c === "config") {
    const s = settingsSnapshot();
    appendMsg(
      "provider  " + (s.provider || "?") + "\n" +
      "base      " + (s.apiBase || "") + "\n" +
      "model     " + (s.apiModel || "") + "\n" +
      "key       " + (s.apiKey ? s.apiKey.slice(0, 8) + "..." + s.apiKey.slice(-4) : "(empty)") + "\n" +
      "env       " + (envReady ? "ready" : "booting"),
      "sys",
    );
    refreshAgentPill();
    return;
  }
  if (c === "key") {
    if (!arg) return appendMsg("usage: /key <token>", "sys");
    saveSettings({ apiKey: arg });
    appendMsg("API key saved.", "sys");
    refreshAgentPill();
    return;
  }
  if (c === "base") {
    if (!arg) return appendMsg("usage: /base https://api.example.com/v1", "sys");
    const provider = (typeof detectProvider === "function") ? detectProvider(arg) : "custom";
    saveSettings({ apiBase: arg.replace(/\/+$/, ""), provider });
    appendMsg("Base URL saved.", "sys");
    refreshAgentPill();
    return;
  }
  if (c === "model") {
    if (!arg) return appendMsg("usage: /model <model-id>", "sys");
    saveSettings({ apiModel: arg });
    appendMsg("Model set to " + arg, "sys");
    refreshAgentPill();
    return;
  }
  if (c === "provider") {
    const id = (arg || "").toLowerCase();
    if (!getProvider(id) && id !== "list") {
      return appendMsg("providers: " + SERVICE_PROVIDERS.map((p) => p.id).join(", "), "sys");
    }
    if (id === "list") return appendMsg(SERVICE_PROVIDERS.map((p) => p.id + " — " + p.displayName).join("\n"), "sys");
    const s = settingsSnapshot();
    const pr = getProvider(id);
    saveSettings({ provider: pr.id, apiBase: pr.apiBase || s.apiBase, apiModel: pr.defaultModel || s.apiModel, apiKey: s.apiKey });
    applyProviderPreset(pr.id);
    appendMsg("Provider " + pr.displayName + " · " + (pr.apiBase || "(custom base)") + " · " + (pr.defaultModel || ""), "sys");
    refreshAgentPill();
    return;
  }
  if (c === "clear") {
    agentEl.chat.innerHTML = "";
    appendMsg("Chat cleared. /reset wipes memory.", "sys");
    return;
  }
  if (c === "reset") {
    agentHistory = [];
    agentEl.chat.innerHTML = "";
    appendMsg("Agent memory reset.", "sys");
    return;
  }
  if (c === "term") {
    agentEl.app?.classList.toggle("show-term");
    appendMsg(agentEl.app?.classList.contains("show-term") ? "Terminal shown." : "Terminal hidden.", "sys");
    try { fitAddon?.fit?.(); } catch (_) {}
    return;
  }
  if (c === "bash" || c === "sh") {
    if (!envReady) return appendMsg("Environment still booting...", "sys");
    if (!arg) return appendMsg("usage: /bash <command>", "sys");
    appendMsg(arg, "user");
    try {
      const r = await guestExec(arg, 60000);
      appendMsg("exit " + r.code + "\n" + r.output, "tool");
    } catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "py" || c === "python") {
    if (!envReady) return appendMsg("Environment still booting...", "sys");
    if (!arg) return appendMsg("usage: /py <python code>", "sys");
    appendMsg(arg, "user");
    try {
      const r = typeof toolPython === "function"
        ? await toolPython({ code: arg, timeout_ms: 60000 })
        : await guestExec("python3 -c " + JSON.stringify(arg), 60000);
      appendMsg(typeof r === "string" ? r : ("exit " + r.code + "\n" + r.output), "tool");
    } catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "status") {
    const s = settingsSnapshot();
    appendMsg("env=" + (envReady ? "ready" : "booting") + " emulator=" + (!!window.__emulator) + " model=" + s.apiModel + " base=" + s.apiBase, "sys");
    return;
  }
  
  if (c === "save" || c === "save-session") {
    try { appendMsg("Saving session...", "sys"); await window.saveGoarSession?.("manual"); appendMsg("Session saved.", "sys"); }
    catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "load" || c === "resume") { appendMsg("Reloading...", "sys"); location.reload(); return; }
  if (c === "export" || c === "download-session") {
    try { await window.downloadGoarSession?.(); appendMsg("Export started.", "sys"); }
    catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "clearcache" || c === "clear-cache") {
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      appendMsg("Asset cache cleared.", "sys");
    } catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  if (c === "clearsession" || c === "clear-session") {
    try { await window.clearGoarSession?.(); appendMsg("Session cache cleared.", "sys"); }
    catch (e) { appendMsg(String(e.message || e), "err"); }
    return;
  }
  appendMsg("Unknown command. /help", "sys");
}

