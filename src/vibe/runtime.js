/**
 * Mistral Vibe agent runtime — port of vibe/core/agent_loop/_loop.py
 * + middleware.py + compaction + tools/manager + scratchpad + system_prompt.
 */
(function (G) {
  "use strict";

  const Role = { system: "system", user: "user", assistant: "assistant", tool: "tool" };
  const MiddlewareAction = { CONTINUE: "continue", STOP: "stop", COMPACT: "compact", INJECT: "inject" };

  function vibeDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function interpolate(s) {
    return String(s || "").replace(/\$current_date/g, vibeDate());
  }

  function getCliPrompt() {
    const P = G.VIBE_PROMPTS || {};
    let base = P.cli || (typeof OPERATOR_CORE === "string" ? OPERATOR_CORE : "");
    base = interpolate(base);
    base = base.replace(/^You are Mistral Vibe, a CLI coding agent built by Mistral AI\./, "You are GOAR, a coding agent.");
    const extra = [
      "",
      "## GOAR workspace",
      "Working directory: /workspace. Scratchpad: /workspace/.scratch (session-local temp).",
      "Python: python_exec. pip is micropip.",
      "Security is five categories: pysec_crypto, pysec_http, pysec_recon, pysec_vuln, pysec_analyze. Pick the category and pass url/data/token/path. Optional tool id from that category. Do not list the catalog.",
      "Firefox: browse / browser. web_fetch for bytes.",
      "Do not list tools. Do not recap the toolkit. Do not probe. Do the task.",
    ].join("\n");
    return base + extra;
  }

  function fn(name, description, properties, required) {
    return {
      type: "function",
      function: {
        name: name,
        description: String(description || "").trim(),
        parameters: { type: "object", properties: properties || {}, required: required || [] },
      },
    };
  }

  function vibeBuiltinTools() {
    const D = G.VIBE_TOOL_PROMPTS || {};
    return [
      fn("bash", D.bash, {
        command: { type: "string", description: "The shell command to execute" },
        timeout: { type: "number", description: "Override the default command timeout." },
      }, ["command"]),
      fn("read_file", D.read_file, {
        file_path: { type: "string", description: "The absolute path to the file to read" },
        offset: { type: "number", description: "The line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "The maximum number of lines to read" },
      }, ["file_path"]),
      fn("write_file", D.write_file, {
        file_path: { type: "string", description: "The absolute path to the file to write (must be absolute, not relative)" },
        content: { type: "string", description: "The content to write to the file" },
      }, ["file_path", "content"]),
      fn("edit", D.edit, {
        file_path: { type: "string", description: "The absolute path to the file to modify" },
        old_string: { type: "string", description: "The text to replace" },
        new_string: { type: "string", description: "The text to replace it with (must be different from old_string)" },
        replace_all: { type: "boolean", description: "Replace all occurrences of old_string (default false)" },
      }, ["file_path", "old_string", "new_string"]),
      fn("grep", D.grep, {
        pattern: { type: "string", description: "The regex pattern to search for in file contents" },
        path: { type: "string", description: "The file or directory to search in. Defaults to the current working directory." },
        max_matches: { type: "number", description: "Override the default maximum number of matches." },
      }, ["pattern"]),
      fn("web_fetch", D.web_fetch, {
        url: { type: "string", description: "The URL to fetch content from" },
        timeout: { type: "number", description: "Optional timeout in seconds (max 120)" },
      }, ["url"]),
      fn("web_search", D.web_search, {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number" },
      }, ["query"]),
      fn("todo", D.todo, {
        action: { type: "string", description: "read or write" },
        todos: { type: "array", description: "Full list when action=write" },
      }, ["action"]),
      fn("skill", D.skill, {
        name: { type: "string", description: "Skill name to load" },
      }, ["name"]),
      fn("task", D.task, {
        description: { type: "string", description: "What the subagent should do" },
        prompt: { type: "string" },
        instructions: { type: "string" },
        name: { type: "string" },
      }, ["description"]),
      fn("handoff", "Triage a request to specialist agents (wasm-agents port).", {
        prompt: { type: "string" },
        agents: { type: "array" },
      }, ["prompt"]),
      fn("ask_user_question", D.ask_user_question, {
        questions: { type: "array", description: "1-4 questions with header, question, options" },
      }, ["questions"]),
      fn("exit_plan_mode", D.exit_plan_mode, {
        plan: { type: "string", description: "The plan to present" },
      }, []),
    ];
  }

  function goarPlaneTools() {
    return [
      fn("python_exec", "Run Python. code or path. Last expression prints.", {
        code: { type: "string" }, path: { type: "string" }, file_path: { type: "string" }, args: { type: "string" },
      }, []),
      fn("workspace_tree", "List a directory tree under path.", {
        path: { type: "string" }, depth: { type: "number" },
      }, []),
      fn("browse", "Open URL in the shared Firefox and fetch.", { url: { type: "string" } }, ["url"]),
      fn("browser", "Drive Firefox. action=goto|click|type|eval|find|shot|url|title|content|wait|back|reload.", {
        action: { type: "string" }, url: { type: "string" }, selector: { type: "string" },
        text: { type: "string" }, js: { type: "string" }, x: { type: "number" }, y: { type: "number" }, ms: { type: "number" },
      }, ["action"]),
      fn("pysec_crypto", "Crypto category. Pass data/token. Optional tool id.", {
        tool: { type: "string" }, data: { type: "string" }, text: { type: "string" }, algorithm: { type: "string" }, token: { type: "string" },
      }, []),
      fn("pysec_http", "HTTP category. Pass url. Optional tool id.", {
        tool: { type: "string" }, url: { type: "string" }, method: { type: "string" }, body: { type: "string" },
      }, []),
      fn("pysec_recon", "Recon category. Pass domain or url. Optional tool id.", {
        tool: { type: "string" }, url: { type: "string" }, domain: { type: "string" }, host: { type: "string" },
      }, []),
      fn("pysec_vuln", "Vuln category. Pass url. Optional tool id.", {
        tool: { type: "string" }, url: { type: "string" }, target: { type: "string" },
      }, []),
      fn("pysec_analyze", "Analyze category. Pass path, data, or url. Optional tool id.", {
        tool: { type: "string" }, path: { type: "string" }, data: { type: "string" }, text: { type: "string" },
      }, []),
    ];
  }

  function ToolManager() {
    this.available = {};
    vibeBuiltinTools().concat(goarPlaneTools()).forEach((t) => {
      this.available[t.function.name] = t;
    });
  }
  ToolManager.prototype.list = function () {
    return Object.keys(this.available).map((k) => this.available[k]);
  };
  ToolManager.prototype.get = function (name) {
    if (!this.available[name]) throw new Error("NoSuchToolError: " + name);
    return this.available[name];
  };

  const stats = { steps: 0, tool_calls_agreed: 0, tool_calls_succeeded: 0, tool_calls_failed: 0, session_cost: 0 };
  const toolManager = new ToolManager();

  function MessageList() {
    this.items = [];
  }
  MessageList.prototype.push = function (m) { this.items.push(m); };
  MessageList.prototype.update_system_prompt = function (text) {
    if (this.items[0] && this.items[0].role === Role.system) this.items[0].content = text;
    else this.items.unshift({ role: Role.system, content: text });
  };
  MessageList.prototype.last = function () { return this.items[this.items.length - 1]; };
  MessageList.prototype.forApi = function () {
    const sys = this.items[0] && this.items[0].role === Role.system ? [this.items[0]] : [];
    const rest = this.items.filter((m) => m && m.role !== Role.system);
    return sys.concat(rest);
  };

  const messages = new MessageList();
  G.__VIBE_MESSAGES = messages;
  G.__VIBE_STATS = stats;
  G.__VIBE_TOOLS = toolManager;

  function TurnLimitMiddleware(max) {
    this.max_turns = max || 240;
  }
  TurnLimitMiddleware.prototype.before_turn = async function (ctx) {
    if (ctx.stats.steps >= this.max_turns) {
      return { action: MiddlewareAction.STOP, reason: "Turn limit of " + this.max_turns + " reached" };
    }
    return { action: MiddlewareAction.CONTINUE };
  };

  function TokenLimitMiddleware(maxTok) {
    this.max = maxTok || 120000;
  }
  TokenLimitMiddleware.prototype.before_turn = async function (ctx) {
    const n = JSON.stringify(ctx.messages.items || []).length / 4;
    if (n > this.max) return { action: MiddlewareAction.COMPACT, reason: "token pressure" };
    return { action: MiddlewareAction.CONTINUE };
  };

  function AutoCompactMiddleware() {}
  AutoCompactMiddleware.prototype.before_turn = async function (ctx) {
    const n = JSON.stringify(ctx.messages.items || []).length / 4;
    if (n > 8000 && ctx.messages.items.length > 24) return { action: MiddlewareAction.COMPACT };
    return { action: MiddlewareAction.CONTINUE };
  };

  const pipeline = [new TurnLimitMiddleware(240), new TokenLimitMiddleware(120000), new AutoCompactMiddleware()];

  async function runMiddleware() {
    const ctx = { messages: messages, stats: stats, config: {} };
    for (let i = 0; i < pipeline.length; i++) {
      const r = await pipeline[i].before_turn(ctx);
      if (r.action === MiddlewareAction.STOP) return r;
      if (r.action === MiddlewareAction.COMPACT) {
        if (typeof maybeCompactAgentHistory === "function") maybeCompactAgentHistory({ force: true });
      }
      if (r.action === MiddlewareAction.INJECT && r.message) {
        messages.push({ role: Role.user, content: r.message, injected: true });
      }
    }
    return { action: MiddlewareAction.CONTINUE };
  }

  async function invokeTool(name, args) {
    args = args && typeof args === "object" ? args : {};
    if (name === "web_search" && typeof toolWebSearch === "function") return toolWebSearch(args);
    if (name === "skill") {
      const n = String(args.name || "").trim();
      if (!n) return "error: skill name required";
      try {
        if (typeof unixRead === "function") {
          const body = unixRead("/workspace/.skills/" + n + ".md", false);
          return "skill " + n + "\n" + String(body).slice(0, 12000);
        }
      } catch (_) {}
      return "error: skill not found: " + n;
    }
    if (name === "task") {
      return JSON.stringify({ ok: true, note: "subagent ran inline", description: args.description || args.prompt || "" });
    }
    if (name === "ask_user_question") {
      const q = args.questions || args.question || args.header || "Need a decision";
      try { if (typeof appendMsg === "function") appendMsg(typeof q === "string" ? q : JSON.stringify(q), "sys"); } catch (_) {}
      return JSON.stringify({ ok: true, asked: q, note: "waiting for next user message" });
    }
    if (name === "exit_plan_mode") {
      try { if (typeof appendMsg === "function") appendMsg(String(args.plan || "Plan ready."), "ai"); } catch (_) {}
      return JSON.stringify({ ok: true, plan: args.plan || "" });
    }
    if (typeof runAgentTool === "function") return runAgentTool(name, args);
    return "error: no dispatcher for " + name;
  }

  async function vibeRun(userText) {
    if (G.agentBusy) {
      G.__GOAR_PENDING_TURN = String(userText || "");
      if (typeof appendMsg === "function") appendMsg("Queued — will run when the current step finishes.", "sys");
      return;
    }
    G.agentBusy = true;
    G.agentAbort = false;
    G.agentAbortController = new AbortController();
    if (typeof setRunningUI === "function") setRunningUI(true, "thinking...");
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    let toolCount = 0;
    try {
      if (typeof pinMission === "function") pinMission(userText);
      if (typeof ensureScratchpad === "function") await ensureScratchpad();
      messages.update_system_prompt(getCliPrompt());
      if (typeof agentState !== "undefined" && agentState && agentState.mission) {
        const m = String(agentState.mission).trim();
        if (m && m.length > 2 && !/^(hi|hey|hello|thanks|ok|okay|yo)\b/i.test(m)) {
          messages.update_system_prompt(getCliPrompt() + "\n\nMISSION: " + m.slice(0, 240));
        }
      }
      messages.push({ role: Role.user, content: String(userText || "") });
      G.agentHistory = messages.items;

      let should_break_loop = false;
      while (!should_break_loop && !G.agentAbort) {
        const mw = await runMiddleware();
        if (mw.action === MiddlewareAction.STOP) break;

        const steers = typeof drainSteers === "function" ? drainSteers() : [];
        if (steers.length) {
          const block = typeof formatSteer === "function" ? formatSteer(steers) : steers.join("\n\n");
          messages.push({ role: Role.user, content: block });
        }

        let thinkRef = null;
        let aiRef = null;
        let thinkingFull = "";
        let textFull = "";
        const result = await openaiChatStream({
          messages: messages.forApi(),
          tools: toolManager.list(),
          includeTools: true,
          signal: G.agentAbortController.signal,
          onThinkingDelta: (piece, full) => {
            thinkingFull = full;
            if (!thinkRef && typeof beginStreamMsg === "function") thinkRef = beginStreamMsg("thought");
            if (thinkRef && typeof streamDelta === "function") streamDelta(thinkRef, full);
          },
          onTextDelta: (piece, full) => {
            textFull = full;
            if (thinkRef && typeof endStreamMsg === "function" && !(thinkingFull || "").trim()) {
              try { endStreamMsg(thinkRef); } catch (_) {}
              thinkRef = null;
            }
            if (!aiRef && typeof beginStreamMsg === "function") aiRef = beginStreamMsg("ai");
            if (aiRef && typeof streamDelta === "function") streamDelta(aiRef, full);
          },
        });
        if (thinkRef && typeof endStreamMsg === "function") try { endStreamMsg(thinkRef); } catch (_) {}
        if (aiRef && typeof endStreamMsg === "function") try { endStreamMsg(aiRef); } catch (_) {}

        const content = String((result && result.text) || textFull || "").trim();
        const calls = (result && result.tool_calls) || [];
        stats.steps += 1;

        if (calls.length) {
          messages.push({
            role: Role.assistant,
            content: content || "",
            tool_calls: calls,
          });
          for (let i = 0; i < calls.length; i++) {
            const c = calls[i];
            const name = (c.function && c.function.name) || c.name || "";
            let args = {};
            try { args = JSON.parse((c.function && c.function.arguments) || c.arguments || "{}"); } catch (_) {}
            toolCount++;
            stats.tool_calls_agreed++;
            try { if (typeof paintToolCall === "function") paintToolCall(name, args); } catch (_) {}
            let out = "";
            try {
              out = await invokeTool(name, args);
              stats.tool_calls_succeeded++;
            } catch (e) {
              out = "error: " + (e && e.message ? e.message : e);
              stats.tool_calls_failed++;
            }
            messages.push({
              role: Role.tool,
              tool_call_id: c.id || ("call_" + i),
              name: name,
              content: typeof out === "string" ? out : JSON.stringify(out),
            });
            try { if (typeof paintToolResult === "function") paintToolResult(name, out); } catch (_) {}
          }
          G.agentHistory = messages.items;
          should_break_loop = false;
          continue;
        }

        if (content) {
          if (!aiRef && typeof appendMsg === "function") appendMsg(content, "ai");
          messages.push({ role: Role.assistant, content: content });
        }
        G.agentHistory = messages.items;
        should_break_loop = true;
      }
    } catch (e) {
      try { if (typeof appendMsg === "function") appendMsg("error: " + (e && e.message ? e.message : e), "sys"); } catch (_) {}
    } finally {
      G.agentBusy = false;
      if (typeof setRunningUI === "function") setRunningUI(false);
      const ms = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - t0;
      try {
        if (typeof appendMsg === "function") {
          appendMsg("turn " + (ms / 1000).toFixed(1) + "s" + (toolCount ? " | " + toolCount + " tools" : "") + " | " + stats.steps + " steps", "turn-foot");
        }
      } catch (_) {}
      try { if (typeof persistAgentChat === "function") persistAgentChat(); } catch (_) {}
    }
  }

  function install() {
    try {
      G.vibeRun = vibeRun;
      G.buildVibeSystemPrompt = typeof buildVibeSystemPrompt === "function" ? buildVibeSystemPrompt : getCliPrompt;
      // Do not replace agentTurn or AGENT_TOOLS — one loop, one registry.
    } catch (_) {}
  }
  install();
  G.vibeInstall = install;
})(typeof window !== "undefined" ? window : globalThis);
