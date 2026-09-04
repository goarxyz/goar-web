/**
 * Bind @openai/agents-core (in-page) to GOAR Chat Completions + Kali tools.
 * Browser only. No Node. No OpenAI-hosted interpreter.
 */
(function (global) {
  "use strict";

  function sdk() {
    return global.OpenAIAgents || null;
  }

  function textOfContent(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return String(content);
    return content
      .map(function (c) {
        if (!c) return "";
        if (typeof c === "string") return c;
        if (c.text) return c.text;
        if (c.type === "input_text" || c.type === "output_text") return c.text || "";
        if (c.type === "text" && c.text) return c.text;
        return "";
      })
      .join("");
  }

  function itemsToMessages(systemInstructions, input) {
    const msgs = [];
    if (systemInstructions) msgs.push({ role: "system", content: String(systemInstructions) });
    const items = typeof input === "string" ? [{ type: "message", role: "user", content: input }] : input || [];
    let pending = [];
    function flushCalls() {
      if (!pending.length) return;
      msgs.push({
        role: "assistant",
        content: null,
        tool_calls: pending.map(function (p) {
          return {
            id: p.callId,
            type: "function",
            function: { name: p.name, arguments: typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.arguments || {}) },
          };
        }),
      });
      pending = [];
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      if (it.type === "function_call") {
        pending.push(it);
        continue;
      }
      flushCalls();
      if (it.type === "function_call_result") {
        let out = it.output;
        if (out && typeof out === "object" && !Array.isArray(out)) out = out.text != null ? out.text : JSON.stringify(out);
        msgs.push({
          role: "tool",
          tool_call_id: it.callId,
          name: it.name || "",
          content: String(out == null ? "" : out),
        });
        continue;
      }
      const role = it.role || (it.type === "message" ? "user" : "");
      if (role === "user" || role === "assistant" || role === "system") {
        const text = textOfContent(it.content);
        if (role === "assistant") msgs.push({ role: "assistant", content: text || null });
        else msgs.push({ role: role, content: text });
      }
    }
    flushCalls();
    return msgs;
  }

  function toolsToOpenAI(tools) {
    const out = [];
    (tools || []).forEach(function (t) {
      if (!t) return;
      if (t.type && t.type !== "function") return;
      const name = t.name;
      if (!name) return;
      out.push({
        type: "function",
        function: {
          name: name,
          description: t.description || "",
          parameters: t.parameters || { type: "object", properties: {} },
        },
      });
    });
    return out;
  }

  function historyToInput(history) {
    const items = [];
    const list = Array.isArray(history) ? history : [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || m.role === "system") continue;
      if (m.role === "user") {
        items.push({ type: "message", role: "user", content: String(m.content || "") });
        continue;
      }
      if (m.role === "assistant") {
        const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
        for (let c = 0; c < calls.length; c++) {
          const tc = calls[c] || {};
          const fn = tc.function || {};
          items.push({
            type: "function_call",
            callId: String(tc.id || "call_" + i + "_" + c),
            name: String(fn.name || ""),
            arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}),
          });
        }
        const text = textOfContent(m.content);
        if (text) items.push({ type: "message", role: "assistant", content: text });
        continue;
      }
      if (m.role === "tool") {
        items.push({
          type: "function_call_result",
          callId: String(m.tool_call_id || m.callId || ""),
          name: String(m.name || ""),
          output: String(m.content || ""),
        });
      }
    }
    return items;
  }

  function GoarChatModel() {}
  GoarChatModel.prototype.getResponse = async function (request) {
    const S = sdk();
    const messages = itemsToMessages(request.systemInstructions, request.input);
    const tools = toolsToOpenAI(request.tools);
    let result;
    if (typeof openaiChatStream === "function") {
      result = await openaiChatStream({
        messages: messages,
        tools: tools,
        includeTools: tools.length > 0,
        signal: request.signal,
      });
    } else if (typeof openaiChat === "function") {
      const data = await openaiChat({
        messages: messages,
        tools: tools,
        includeTools: tools.length > 0,
        signal: request.signal,
      });
      result =
        typeof normalizeChatResultFromJson === "function"
          ? normalizeChatResultFromJson(data)
          : {
              text: (((data || {}).choices || [])[0] || {}).message
                ? data.choices[0].message.content || ""
                : "",
              thinking: "",
              toolCalls: ((((data || {}).choices || [])[0] || {}).message || {}).tool_calls || [],
              usage: (data || {}).usage,
            };
    } else {
      throw new Error("No Chat Completions client in this page");
    }
    const output = [];
    const thinking = String(result.thinking || "").trim();
    if (thinking) {
      output.push({
        type: "reasoning",
        content: [{ type: "reasoning_text", text: thinking }],
      });
    }
    const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i] || {};
      const fn = tc.function || {};
      output.push({
        type: "function_call",
        callId: String(tc.id || "call_" + i),
        name: String(fn.name || ""),
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}),
        status: "completed",
      });
    }
    const text = String(result.text || "").trim();
    if (text) {
      output.push({
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: text }],
      });
    }
    const u = result.usage || {};
    const pt = Number(u.prompt_tokens || u.promptTokens || u.inputTokens || 0) || 0;
    const ct = Number(u.completion_tokens || u.completionTokens || u.outputTokens || 0) || 0;
    const tt = Number(u.total_tokens || u.totalTokens || pt + ct) || pt + ct;
    const usage = S && S.Usage ? new S.Usage({ inputTokens: pt, outputTokens: ct, totalTokens: tt }) : { inputTokens: pt, outputTokens: ct, totalTokens: tt, requests: 1 };
    return { usage: usage, output: output, responseId: "goar-chat" };
  };
  GoarChatModel.prototype.getStreamedResponse = async function* (request) {
    yield { type: "response_started" };
    const resp = await this.getResponse(request);
    for (let i = 0; i < (resp.output || []).length; i++) {
      const item = resp.output[i];
      if (item && item.type === "message" && item.role === "assistant") {
        const t = textOfContent(item.content);
        if (t) yield { type: "output_text_delta", delta: t };
      }
    }
    const u = resp.usage || {};
    yield {
      type: "response_done",
      response: {
        id: resp.responseId || "goar-chat",
        usage: {
          inputTokens: Number(u.inputTokens || 0) || 0,
          outputTokens: Number(u.outputTokens || 0) || 0,
          totalTokens: Number(u.totalTokens || 0) || 0,
        },
        output: resp.output || [],
      },
    };
  };

  function catalogTools() {
    const S = sdk();
    if (!S || typeof S.tool !== "function") return [];
    const defs = typeof getAgentTools === "function" ? getAgentTools() : [];
    return defs
      .map(function (d) {
        const fn = d && d.function ? d.function : d;
        if (!fn || !fn.name) return null;
        const name = fn.name;
        try {
        return S.tool({
          name: name,
          description: fn.description || name,
          parameters: fn.parameters || { type: "object", properties: {} },
          strict: false,
          execute: async function (args) {
            args = args && typeof args === "object" ? args : {};
            let summary = name;
            if (name === "bash") summary = "bash  " + String(args.command || "").slice(0, 88);
            else if (name === "write_file") summary = "write  " + (args.path || args.file_path || "");
            else if (name === "read_file") summary = "read  " + (args.path || args.file_path || "");
            else if (name === "edit_file" || name === "edit") summary = "edit  " + (args.path || args.file_path || "");
            else if (name === "python_exec") summary = "python  " + String(args.path || "inline").slice(0, 72);
            try {
              if (typeof appendMsg === "function") appendMsg(summary, "tool-run");
              if (typeof setStatusFooter === "function") setStatusFooter(summary);
              if (typeof paintLiveWork === "function") paintLiveWork({ text: summary });
            } catch (_) {}
            let out = "";
            try {
              out = String(await runAgentTool(name, args));
            } catch (e) {
              out = "tool error: " + (e && e.message ? e.message : e);
            }
            const preview = String(out).split("\n").slice(0, 120).join("\n").slice(0, 50000);
            try {
              if (preview.trim() && typeof appendMsg === "function") appendMsg(preview, "tool-out");
            } catch (_) {}
            try {
              if (typeof goarSdkRun._onTool === "function") goarSdkRun._onTool(name);
            } catch (_) {}
            return out;
          },
        });
        } catch (e) {
          try { console.warn("[goar] sdk tool skip", name, e && e.message ? e.message : e); } catch (_) {}
          return null;
        }
      })
      .filter(Boolean);
  }

  async function goarSdkRun(opts) {
    opts = opts || {};
    const S = sdk();
    if (!S || typeof S.Agent !== "function" || typeof S.run !== "function") {
      throw new Error("OpenAI Agents core not loaded");
    }
    const userText = String(opts.userText || "");
    try { if (typeof opts.refreshSystem === "function") opts.refreshSystem(); } catch (_) {}
    const instructions =
      (typeof buildVibeSystemPrompt === "function" && buildVibeSystemPrompt()) ||
      (typeof OPERATOR_CORE === "string" && OPERATOR_CORE) ||
      "You are GOAR. Workspace is the live Kali Linux SSH instance. Do the work.";
    if (typeof S.setDefaultModelProvider === "function") {
      S.setDefaultModelProvider({
        getModel: function () {
          return new GoarChatModel();
        },
      });
    }
    try {
      if (typeof refreshAgentTools === "function") refreshAgentTools();
    } catch (_) {}
    const tools = catalogTools();
    const agent = new S.Agent({
      name: "GOAR",
      instructions: instructions,
      tools: tools,
      model: new GoarChatModel(),
    });
    const maxTurns =
      (typeof VIBE_RUNTIME !== "undefined" && VIBE_RUNTIME.maxWaves) ||
      Number(global.GOAR_MAX_TURNS) ||
      2000;
    const runner = new S.Runner({
      tracingDisabled: true,
      modelProvider: {
        getModel: function () {
          return new GoarChatModel();
        },
      },
    });
    goarSdkRun._onTool = opts.onTool || null;
    let toolCount = 0;
    const prevOn = goarSdkRun._onTool;
    goarSdkRun._onTool = function (name) {
      toolCount++;
      if (typeof prevOn === "function") prevOn(name);
      if (typeof opts.onStep === "function") opts.onStep(toolCount);
    };
    const result = await runner.run(agent, (function () {
      let input = [];
      try {
        input = historyToInput(typeof agentHistory !== "undefined" ? agentHistory : []);
      } catch (_) { input = []; }
      if (!input.length && userText) return userText;
      return input.length ? input : userText;
    })(), {
      maxTurns: maxTurns,
      signal: opts.signal,
      stream: false,
    });
    const finalText = String((result && result.finalOutput) || "").trim();
    if (finalText && typeof appendMsg === "function") appendMsg(finalText, "ai");
    try {
      if (typeof agentHistory !== "undefined" && Array.isArray(agentHistory) && finalText) {
        agentHistory.push({ role: "assistant", content: finalText });
      }
    } catch (_) {}
    const usage = result && result.state && result.state.usage ? result.state.usage : null;
    if (usage && typeof opts.onUsage === "function") opts.onUsage(usage);
    return {
      finalOutput: finalText,
      toolCount: toolCount,
      turns: toolCount,
      usage: usage,
      aborted: !!(opts.signal && opts.signal.aborted),
      result: result,
    };
  }

  try {
    global.GoarChatModel = GoarChatModel;
    global.goarSdkRun = goarSdkRun;
    global.GOAR_SDK_RUNNER = global.GOAR_SDK_RUNNER === true;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
