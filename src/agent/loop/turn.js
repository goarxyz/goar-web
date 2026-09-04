/**
 * Agent turn — ADK-inspired seamless multi-wave loop.
 *
 * Continuity model (google/adk-python):
 *  - Session state holds sticky mission + rolling compaction summary
 *  - Token pressure → compact older events (do NOT wipe / do NOT block tools)
 *  - Wave boundaries auto-continue same mission without context reset
 */
async function agentTurn(userText) {
  if (agentBusy) {
    try {
      window.__GOAR_PENDING_TURN = String(userText || "");
      if (typeof appendMsg === "function") appendMsg("Queued — will run when the current step finishes.", "sys");
    } catch (_) {}
    return;
  }
  agentBusy = true;
  agentAbort = false;
  agentAbortController = new AbortController();
  try { window.__GOAR_LAST_SHOWN_TOOL = ""; window.__GOAR_LAST_SHOWN_OUT = ""; } catch (_) {}
  // Fingerprints are telemetry only (never used to ban tools)
  recentToolFingerprints = [];
  pathActionCounts = Object.create(null);
  agentTurn._loopSteps = 0;
  if (typeof paintComposerMode === "function") paintComposerMode();
  const t0 = performance.now();
  let toolCount = 0;
  let step = 0;
  let lastUsage = null;
  let waves = 0;
  const stepsPerWave = (typeof VIBE_RUNTIME !== "undefined" && VIBE_RUNTIME.stepsPerWave)
    || (typeof GOAR_COMPACTION !== "undefined" && GOAR_COMPACTION.stepsPerWave) || 24;
  const maxWaves = (typeof VIBE_RUNTIME !== "undefined" && VIBE_RUNTIME.maxWaves)
    || (typeof GOAR_COMPACTION !== "undefined" && GOAR_COMPACTION.maxWaves) || 240;
  let stepBudget = stepsPerWave;
  let quietStops = 0;

  setRunningUI(true, "thinking...");
  if (typeof setStatusFooter === "function") setStatusFooter("working...");
  if (typeof agentSetPill === "function") agentSetPill("working...");
  try {
    // Sticky original request — ADK session state, not dropped by compaction
    if (typeof pinMission === "function") pinMission(userText);
    if (typeof agentState !== "undefined") agentState.wave = 0;

    try { refreshAgentTools(); } catch (_) {}

    const hasFullCatalog =
      !!(agentHistory[0] && agentHistory[0].role === "system" &&
        typeof agentHistory[0].content === "string" &&
        agentHistory[0].content.indexOf("### CATALOG n=") !== -1);

    const buildSysCore = () => {
      if (typeof buildVibeSystemPrompt === "function") return buildVibeSystemPrompt();
      if (typeof buildIntegratedSystemCore === "function") return buildIntegratedSystemCore();
      const stateCtx = typeof getStateContext === "function" ? getStateContext() : "";
      const missionExtra = typeof missionContextBlock === "function" ? missionContextBlock() : "";
      return (
        OPERATOR_CORE + "\n\n" +
        (typeof systemPlaneBlurb === "function" ? systemPlaneBlurb() + "\n\n" : "") +
        (typeof sandboxStatusBlurb === "function" ? sandboxStatusBlurb() : "") +
        (stateCtx ? "\n\n## SESSION STATE\n" + stateCtx : "") +
        missionExtra +
        "Finish the task. Prove it works. Same mission after compact.\n"
      );
    };

    const refreshSystem = () => {
      const sysCore = buildSysCore();
      if (!agentHistory.length) {
        agentHistory.push({ role: "system", content: sysCore });
      } else if (agentHistory[0] && agentHistory[0].role === "system") {
        agentHistory[0].content = sysCore;
      } else {
        agentHistory.unshift({ role: "system", content: sysCore });
      }
    };

    try { if (typeof ensureScratchpad === "function") await ensureScratchpad(); } catch (_) {}
    refreshSystem();
    agentHistory.push({ role: "user", content: userText });
    if (typeof maybeCompactAgentHistoryAsync === "function") await maybeCompactAgentHistoryAsync({ force: false });
    else if (typeof maybeCompactAgentHistory === "function") maybeCompactAgentHistory({ force: false });
    else if (typeof trimAgentHistory === "function") trimAgentHistory();

    let finishedClean = false;

    if (typeof goarSdkRun === "function" && window.GOAR_SDK_RUNNER !== false) {
      setRunningUI(true, "thinking");
      try { if (typeof setStatusFooter === "function") setStatusFooter("working..."); } catch (_) {}
      const sdk = await goarSdkRun({
        userText: userText,
        signal: agentAbortController.signal,
        refreshSystem: refreshSystem,
        onUsage: function (u) { lastUsage = u; },
        onTool: function () { toolCount++; },
        onStep: function (n) { step = n; },
      });
      if (sdk) {
        toolCount = sdk.toolCount || toolCount;
        step = sdk.turns || step;
        lastUsage = sdk.usage || lastUsage;
        finishedClean = !sdk.aborted;
      }
    } else {
    step = -1;
    while (!agentAbort || (typeof drainSteers === "function" && (window.__GOAR_STEER || []).length)) {
      step++;
      if (step >= stepBudget && waves + 1 >= maxWaves) break;

      // Apply mid-run user context before the next model call
      try {
        const steers = typeof drainSteers === "function" ? drainSteers() : [];
        if (steers.length) {
          const block = typeof formatSteer === "function" ? formatSteer(steers) : steers.join("\n\n");
          agentHistory.push({ role: "user", content: block });
          if (typeof paintLiveWork === "function") paintLiveWork({ text: "Applying your note" });
          agentAbort = false;
          if (!agentAbortController || agentAbortController.signal.aborted) {
            agentAbortController = new AbortController();
          }
        }
      } catch (_) {}

      if (agentAbort) {
        appendMsg("Stopped.", "sys");
        break;
      }

      if (typeof runVibeBeforeTurn === "function") {
        const mw = await runVibeBeforeTurn();
        if (mw && mw.action === "stop") {
          appendMsg("Stopped.", "sys");
          break;
        }
        if (mw && mw.action === "compact") {
          if (typeof maybeCompactAgentHistory === "function") {
            maybeCompactAgentHistory({ force: true, lastUsage });
          }
          refreshSystem();
        }
        if (mw && mw.action === "inject" && mw.message) {
          agentHistory.push({ role: "user", content: mw.message });
        }
      }

      // Before each model call: extractive compact only (never wait on an extra LLM)
      if (typeof maybeCompactAgentHistory === "function") {
        const c = maybeCompactAgentHistory({ lastUsage });
        if (c && c.compacted) refreshSystem();
      }

      setRunningUI(true, step === 0 && waves === 0 ? "thinking" : ("step " + (step + 1) + (waves ? " · wave " + (waves + 1) : "")));
      try {
        syncIndicators({
          phase: step === 0 && waves === 0 ? "thinking" : "tool",
          tool: step ? ("step " + (step + 1)) : "",
          detail: waves ? ("wave " + (waves + 1)) : "",
        });
      } catch (_) {}
      if (typeof setStatusFooter === "function") {
        setStatusFooter(
          step === 0 && waves === 0
            ? "thinking..."
            : ("step " + (step + 1) + (waves ? " · wave " + (waves + 1) : ""))
        );
      }

      let thinkRef = null;
      window.__GOAR_ACK = null;
      let aiRef = null;
      let thinkingFull = "";
      let textFull = "";

      let result;
      try {
        const call = () => openaiChatStream({
        messages: (agentHistory[0] && agentHistory[0].role === "system" ? [agentHistory[0]] : []).concat(agentHistory.filter((m) => m && m.role !== "system").slice(-(Number(typeof GOAR_HISTORY_WINDOW !== "undefined" ? GOAR_HISTORY_WINDOW : 64) || 64))),
        tools: getAgentTools(),
        includeTools: true,
        signal: agentAbortController.signal,
        onThinkingDelta: (piece, full) => {
          thinkingFull = collapseDoubledWords(full);
          if (!thinkRef || !thinkRef.el || !thinkRef.el.isConnected) {
            thinkRef = beginStreamMsg("thought");
          }
          window.__GOAR_ACK = null;
          streamDelta(thinkRef, thinkingFull);
          try { syncIndicators({ phase: "thinking" }); } catch (_) {}
        },
        onTextDelta: (piece, full) => {
          textFull = collapseDoubledWords(full);
          if (thinkRef && !(thinkingFull || "").trim()) {
            try { endStreamMsg(thinkRef); } catch (_) {}
            thinkRef = null;
          }
          window.__GOAR_ACK = null;
          if (!aiRef) aiRef = beginStreamMsg("ai");
          streamDelta(aiRef, textFull);
          try { syncIndicators({ phase: "streaming" }); } catch (_) {}
        },
      });
        result = typeof vibeCallModel === "function" ? await vibeCallModel(call, { lastUsage }) : await call();
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (agentAbort || (e && e.name === "AbortError")) {
          const steers = typeof drainSteers === "function" ? drainSteers() : [];
          if (steers.length) {
            agentAbort = false;
            agentAbortController = new AbortController();
            const block = typeof formatSteer === "function" ? formatSteer(steers) : steers.join("\n\n");
            agentHistory.push({ role: "user", content: block });
            if (typeof paintLiveWork === "function") paintLiveWork({ text: "Applying your note" });
            continue;
          }
          appendMsg("Stopped.", "sys");
          break;
        }
        if (/model is restarting|please resend|temporarily unavailable|overloaded|try again in a few/i.test(msg)) {
          if (typeof paintLiveWork === "function") paintLiveWork({ text: "Model restarting — retrying" });
          if (typeof setStatusFooter === "function") setStatusFooter("model restarting · retrying");
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        if (/context.?too.?long|maximum context|prompt is too long|reduce the length/i.test(msg)) {
          if (typeof maybeCompactAgentHistoryAsync === "function") {
            await maybeCompactAgentHistoryAsync({ force: true, lastUsage });
          } else if (typeof maybeCompactAgentHistory === "function") {
            maybeCompactAgentHistory({ force: true });
          }
          refreshSystem();
          continue;
        }
        throw e;
      }

      endStreamMsg(thinkRef);
      endStreamMsg(aiRef);
      window.__GOAR_ACK = null;

      if (agentAbort) {
        const steers = typeof drainSteers === "function" ? drainSteers() : [];
        if (steers.length) {
          agentAbort = false;
          agentAbortController = new AbortController();
          const block = typeof formatSteer === "function" ? formatSteer(steers) : steers.join("\n\n");
          agentHistory.push({ role: "user", content: block });
          if (typeof paintLiveWork === "function") paintLiveWork({ text: "Applying your note" });
          continue;
        }
        appendMsg("Stopped.", "sys");
        break;
      }

      const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
      const finish = result.finish_reason || "";
      const content = collapseDoubledWords(result.text || textFull || "");
      const thinking = collapseDoubledWords(result.thinking || thinkingFull || "");
      if (!toolCalls.length && /model is restarting|please resend in a few seconds/i.test(content || thinking)) {
        if (typeof paintLiveWork === "function") paintLiveWork({ text: "Model restarting — retrying" });
        if (typeof setStatusFooter === "function") setStatusFooter("model restarting · retrying");
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (result.usage) {
        lastUsage = result.usage;
        accumulateUsage(result.usage);
      }

      if (thinking && thinking.trim() && !thinkRef) {
        try { if (typeof agentState !== "undefined") agentState.lastThinking = thinking.slice(0, 4000); } catch (_) {}
      }

      if (toolCalls.length || finish === "tool_calls") {
        if (thinkRef && thinkRef.el) {
          try { thinkRef.el.remove(); } catch (_) {}
          thinkRef = null;
        }

        agentHistory.push({
          role: "assistant",
          content: content || null,
          reasoning_content: thinking || undefined,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type || "function",
            function: {
              name: tc.function?.name || "",
              arguments: typeof tc.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || {}),
            },
          })),
        });
        try {
          if (thinking && typeof agentState !== "undefined") {
            agentState.lastThinking = thinking.slice(0, 4000);
          }
        } catch (_) {}

        const names = toolCalls.map((tc) => tc.function?.name || "");
        const allSafe = names.every((n) =>
          /^(read_file|list_dir|glob|grep|env_info|think|todo|recall_memory|web_search|web_fetch|kit_status|workspace_tree|py_check|net_diag|set_phase|proxy\.status|hash\.|codec\.|password\.|jwt\.inspect)$/.test(n)
        );

        const runOne = async (tc) => {
          if (agentAbort) return { tc, name: "", result: "aborted" };
          const name = tc.function?.name || "";
          if (!name) return { tc, name: "", result: "error: empty tool name" };
          let args = {};
          try {
            const rawArgs = tc.function?.arguments;
            args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : (rawArgs || {});
          } catch (_) { args = {}; }

          // Telemetry only — never block tool execution
          try {
            const loopInfo = typeof detectToolLoop === "function" ? detectToolLoop(name, args) : null;
            if (loopInfo && loopInfo.warn && !runOne._warned) {
              runOne._warned = true;
              // soft note only; tools still run
            }
          } catch (_) {}

          let summary = name;
          if (name === "bash") summary = "bash  " + String(args.command || "").slice(0, 88);
          else if (name === "write_file") summary = "write  " + (args.path || "");
          else if (name === "read_file") summary = "read  " + (args.path || "");
          else if (name === "edit_file") summary = "edit  " + (args.path || "");
          else if (name === "python_exec") summary = "python  " + String(args.path || "inline").slice(0, 72);
          else if (name === "grep") summary = "grep  " + String(args.pattern || "").slice(0, 72);
          else if (name === "browse") summary = "browse  " + String(args.url || "").slice(0, 72);
          else if (name === "audit") summary = "audit  " + String(args.url || args.target || "").slice(0, 72);
          else if (name === "playbook") summary = String(args.playbook || "playbook") + "  " + String(args.url || args.token || args.path || "").slice(0, 56);
          else if (name === "browser") summary = "browser  " + String(args.action || "") + (args.url ? "  " + args.url : "");
          else if (name === "web_fetch") summary = "fetch  " + String(args.url || "").slice(0, 72);
          else if (name === "todo") summary = "todo  " + (args.action || "list");
          else if (name === "complete_task") summary = "done";
          else if (name === "micropip_install") summary = "pip  " + String(args.package || "");
          else if (name === "create_tool") summary = "create_tool  " + String(args.name || "");
          else if (String(name).indexOf("pysec") === 0) {
            const t = String(args.tool || args.tool_id || args.action || "").slice(0, 64);
            summary = name.replace(/^pysec_/, "") + (t ? "  " + t : "");
          }

          const silent = name === "think" || name === "set_phase";
          const shownKey = silent ? "" : (summary + "\n" + JSON.stringify(args || {}).slice(0, 400));
          if (!silent && window.__GOAR_LAST_SHOWN_TOOL !== shownKey) {
            appendMsg(summary, "tool-run");
            window.__GOAR_LAST_SHOWN_TOOL = shownKey;
          }
          toolCount++;
          try { window.__GOAR_LAST_TOOL_LABEL = summary; } catch (_) {}
          try { syncIndicators({ phase: "tool", tool: summary }); } catch (_) {}
          if (typeof paintLiveWork === "function") paintLiveWork({ text: summary });
          if (typeof agentState !== "undefined") agentState.lastTool = name;
          if (typeof setStatusFooter === "function") setStatusFooter(summary);
          setRunningUI(true, summary);

          let out = "";
          try {
            if (typeof applyInferredPhase === "function") applyInferredPhase(name, args);
            let runArgs = args;
            if (typeof runVibePreTool === "function") {
              const pre = await runVibePreTool(name, args);
              if (pre && pre.deny) {
                out = "hook deny: " + (pre.reason || "denied");
              } else if (pre && pre.args) {
                runArgs = pre.args;
              }
            }
            if (!out) out = String(await runAgentTool(name, runArgs));
            if (typeof runVibePostTool === "function") out = await runVibePostTool(name, runArgs, out);
            if (typeof enrichToolResult === "function") out = enrichToolResult(name, runArgs, out);
          } catch (e) {
            out = "tool error: " + e.message;
            if (typeof enrichToolResult === "function") out = enrichToolResult(name, args, out);
          }

          const preview = out.split("\n").slice(0, 120).join("\n").slice(0, 50000);
          if (!silent && preview.trim() && window.__GOAR_LAST_SHOWN_OUT !== preview.trim()) {
            appendMsg(preview, "tool-out");
            window.__GOAR_LAST_SHOWN_OUT = preview.trim();
          }
          try { if (typeof paintToolPreview === "function") paintToolPreview(name, args, out); } catch (_) {}
          // Store compact form in model history (ADK caps tool content in context)
          const forModel = typeof compactToolResult === "function" ? compactToolResult(out) : out;
          return { tc, name, result: forModel };
        };

        let results;
        if (allSafe && toolCalls.length > 1) {
          results = await Promise.all(toolCalls.map(runOne));
        } else {
          results = [];
          for (const tc of toolCalls) results.push(await runOne(tc));
        }

        let completed = false;
        for (const row of results) {
          const { tc, name, result: toolResult } = row;
          agentHistory.push({
            role: "tool",
            tool_call_id: tc.id,
            name: name,
            content: String(toolResult == null ? "" : toolResult),
          });
          if (name === "complete_task") completed = true;
        }
        quietStops = 0;
        if (completed) {
          if (typeof agentState !== "undefined") agentState.missionClosed = true;
          appendMsg("Task closed.", "sys");
          finishedClean = true;
          break;
        }

        // Compact after tool fan-in if prompt grew — extractive only, never pause for an LLM summary
        if (typeof maybeCompactAgentHistory === "function") {
          const c2 = maybeCompactAgentHistory({ lastUsage });
          if (c2 && c2.compacted) refreshSystem();
        } else if (typeof trimAgentHistory === "function") {
          trimAgentHistory();
        }
        try { persistAgentChat(); } catch (_) {}

        // Seamless multi-wave: extend budget. No extra user turn. No chat note.
        if (step >= stepBudget - 1 && waves + 1 < maxWaves) {
          waves++;
          if (typeof agentState !== "undefined") agentState.wave = waves;
          stepBudget += stepsPerWave;
          if (typeof maybeCompactAgentHistory === "function") {
            maybeCompactAgentHistory({ force: true, lastUsage });
          }
          refreshSystem();
        }
        continue;
      }

      // Vibe: last message is assistant with no tool_calls → break
      if (content && content.trim()) {
        if (!aiRef) appendMsg(content, "ai");
        agentHistory.push({ role: "assistant", content, reasoning_content: thinking || undefined });
      }
      finishedClean = true;
      break;
    }
    } // else: legacy vibe loop

    // Hit max waves with tools still open: one text wrap-up that keeps mission, not a hard amnesia
    if (!finishedClean && !agentAbort) {
      try {
        if (typeof maybeCompactAgentHistoryAsync === "function") {
          await maybeCompactAgentHistoryAsync({ force: true, lastUsage, useLlm: true });
          refreshSystem();
        } else if (typeof maybeCompactAgentHistory === "function") {
          maybeCompactAgentHistory({ force: true, lastUsage });
          refreshSystem();
        }
        agentHistory.push({
          role: "user",
          content:
            "[continuity] Step budget reached for this session slice. " +
            "Using ROLLING CONTEXT + MISSION, give the best current status and what remains. " +
            "Tools will be available again on the next user message — do not invent a reset.",
        });
        let stopRef = null;
        const last = await openaiChatStream({
          messages: (agentHistory[0] && agentHistory[0].role === "system" ? [agentHistory[0]] : []).concat(agentHistory.filter((m) => m && m.role !== "system").slice(-(Number(typeof GOAR_HISTORY_WINDOW !== "undefined" ? GOAR_HISTORY_WINDOW : 64) || 64))),
          tools: [],
          includeTools: false,
          signal: agentAbortController.signal,
          onTextDelta: (piece, full) => {
            if (!stopRef) stopRef = beginStreamMsg("ai");
            streamDelta(stopRef, collapseDoubledWords(full));
          },
        });
        endStreamMsg(stopRef);
        const finalText = collapseDoubledWords((last && last.text) || "");
        if (finalText.trim()) {
          if (!stopRef) appendMsg(finalText, "ai");
          agentHistory.push({ role: "assistant", content: finalText });
        }
      } catch (_) {}
    }
  } catch (e) {
    if (agentAbort || (e && e.name === "AbortError")) {
      appendMsg("Stopped.", "sys");
    } else {
      appendMsg(String(e.message || e), "err");
    }
  } finally {
    agentBusy = false;
    agentAbort = false;
    agentAbortController = null;
    if (typeof paintComposerMode === "function") paintComposerMode();
    agentEl.input?.focus();
    setRunningUI(false, "");
    const ms = Math.round(performance.now() - t0);
    if (typeof agentState !== "undefined") agentState.turnMs = ms;
    let foot = "turn " + (ms / 1000).toFixed(1) + "s";
    if (toolCount) foot += "  |  " + toolCount + " tool" + (toolCount === 1 ? "" : "s");
    if (step) foot += "  |  " + (step + 1) + " step" + ((step + 1) === 1 ? "" : "s");
    if (waves) foot += "  |  " + (waves + 1) + " wave" + ((waves + 1) === 1 ? "" : "s");
    if (lastUsage) {
      const pt = lastUsage.prompt_tokens || lastUsage.promptTokens || 0;
      const ct = lastUsage.completion_tokens || lastUsage.completionTokens || 0;
      const tt = lastUsage.total_tokens || lastUsage.totalTokens || (pt + ct);
      if (tt || pt || ct) foot += "  |  tokens " + (tt || (pt + ct));
    }
    if (typeof agentState !== "undefined" && agentState.todos && agentState.todos.length) {
      foot += "  |  todo " + agentState.todos.filter((x) => x.done).length + "/" + agentState.todos.length;
    }
    appendMsg(foot, "turn-foot");
    if (typeof setStatusFooter === "function") setStatusFooter(foot);
    if (typeof refreshAgentPill === "function") refreshAgentPill();
    try { persistAgentChat(); } catch (_) {}
    // Drain leftover steer as a follow-up turn only if the run fully ended
    try {
      const leftover = typeof drainSteers === "function" ? drainSteers() : [];
      const pending = leftover.length
        ? leftover.join("\n\n")
        : (window.__GOAR_PENDING_TURN || "");
      window.__GOAR_PENDING_TURN = "";
      if (pending && String(pending).trim()) {
        setTimeout(() => {
          try { agentTurn(String(pending)); } catch (_) {}
        }, 40);
      }
    } catch (_) {}
  }
}
