/**
 * In-browser chat via Transformers.js (ONNX).
 * WebGPU when the tab has it, WASM otherwise. No API key.
 * Same OpenAI chat/tool shape as the cloud providers.
 */
(function (global) {
  "use strict";

  const LOCAL_MODELS = [
    {
      id: "qwen2.5-0.5b",
      hf: "onnx-community/Qwen2.5-0.5B-Instruct",
      label: "Qwen2.5 0.5B (fast)",
      ctx: 2048,
      maxNew: 384
    },
    {
      id: "smollm2-360m",
      hf: "onnx-community/SmolLM2-360M-Instruct",
      label: "SmolLM2 360M (smallest)",
      ctx: 2048,
      maxNew: 320
    },
    {
      id: "qwen2.5-1.5b",
      hf: "onnx-community/Qwen2.5-1.5B-Instruct",
      label: "Qwen2.5 1.5B (better tools)",
      ctx: 4096,
      maxNew: 512
    }
  ];

  const STATE = {
    worker: null,
    ready: false,
    loading: null,
    model: "",
    device: "",
    seq: 0,
    pending: new Map(),
    lastError: ""
  };

  function isLocalProvider(id, base) {
    const s = String(id || "") + " " + String(base || "");
    return /transformers|browser-llm|local-llm|browser:\/\/|transformers\.js/i.test(s);
  }

  function workerSrc() {
    return `
import { pipeline, env, TextStreamer } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";

env.allowLocalModels = false;
env.useBrowserCache = true;
try { env.backends.onnx.wasm.proxy = false; } catch (_) {}

let gen = null;
let loaded = "";
let device = "wasm";

async function pickDevice() {
  try {
    if (navigator.gpu) {
      const a = await navigator.gpu.requestAdapter();
      if (a) return "webgpu";
    }
  } catch (_) {}
  return "wasm";
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type === "load") {
      device = await pickDevice();
      const model = msg.model;
      self.postMessage({ id, type: "progress", status: "loading " + model + " on " + device });
      try {
        gen = await pipeline("text-generation", model, {
          dtype: device === "webgpu" ? "q4f16" : "q4",
          device,
          progress_callback: (p) => {
            const st = (p && p.status) || "download";
            const file = (p && (p.file || p.name)) || "";
            self.postMessage({ id, type: "progress", status: st + (file ? " " + String(file).split("/").pop() : "") });
          }
        });
      } catch (e1) {
        device = "wasm";
        self.postMessage({ id, type: "progress", status: "webgpu failed, using wasm" });
        gen = await pipeline("text-generation", model, {
          dtype: "q4",
          device: "wasm",
          progress_callback: (p) => {
            const st = (p && p.status) || "download";
            const file = (p && (p.file || p.name)) || "";
            self.postMessage({ id, type: "progress", status: st + (file ? " " + String(file).split("/").pop() : "") });
          }
        });
      }
      loaded = model;
      self.postMessage({ id, type: "ok", result: { model, device } });
      return;
    }
    if (msg.type === "chat") {
      if (!gen) throw new Error("model not loaded");
      const messages = msg.messages || [];
      const maxNew = Math.max(32, Math.min(1024, Number(msg.max_new_tokens) || 384));
      let acc = "";
      const streamer = new TextStreamer(gen.tokenizer, {
        skip_prompt: true,
        callback_function: (t) => {
          acc += t;
          self.postMessage({ id, type: "delta", text: t });
        }
      });
      const out = await gen(messages, {
        max_new_tokens: maxNew,
        do_sample: false,
        streamer
      });
      let text = acc;
      if (!text) {
        const g = Array.isArray(out) ? out[0] : out;
        const genText = g && (g.generated_text || g);
        if (typeof genText === "string") text = genText;
        else if (Array.isArray(genText)) {
          const last = genText[genText.length - 1];
          text = last && last.content != null ? String(last.content) : "";
        }
      }
      self.postMessage({ id, type: "ok", result: { text: String(text || ""), device, model: loaded } });
      return;
    }
    throw new Error("unknown op");
  } catch (e) {
    self.postMessage({ id, type: "err", error: String(e && e.message ? e.message : e) });
  }
};
`;
  }

  function ensureWorker() {
    if (STATE.worker) return STATE.worker;
    const blob = new Blob([workerSrc()], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url, { type: "module" });
    w.onmessage = function (ev) {
      const msg = ev.data || {};
      const p = STATE.pending.get(msg.id);
      if (msg.type === "progress") {
        try {
          if (typeof paintLiveWork === "function") paintLiveWork({ text: "Local model · " + (msg.status || "") });
        } catch (_) {}
        return;
      }
      if (msg.type === "delta") {
        if (p && p.onDelta) p.onDelta(msg.text || "");
        return;
      }
      if (!p) return;
      STATE.pending.delete(msg.id);
      if (msg.type === "ok") p.resolve(msg.result);
      else p.reject(new Error(msg.error || "local model failed"));
    };
    w.onerror = function (e) {
      STATE.lastError = String(e && e.message ? e.message : e);
      STATE.pending.forEach(function (p) { p.reject(new Error(STATE.lastError)); });
      STATE.pending.clear();
    };
    STATE.worker = w;
    return w;
  }

  function rpc(type, data, onDelta) {
    ensureWorker();
    const id = ++STATE.seq;
    return new Promise(function (resolve, reject) {
      STATE.pending.set(id, { resolve, reject, onDelta });
      STATE.worker.postMessage(Object.assign({ type, id }, data || {}));
    });
  }

  function resolveHf(modelId) {
    const id = String(modelId || "").trim();
    const hit = LOCAL_MODELS.find(function (m) { return m.id === id || m.hf === id; });
    return hit || LOCAL_MODELS[0];
  }

  async function ensureLocalModel(modelId) {
    const spec = resolveHf(modelId);
    if (STATE.ready && STATE.model === spec.hf) return spec;
    if (STATE.loading) {
      await STATE.loading;
      if (STATE.model === spec.hf) return spec;
    }
    STATE.loading = (async function () {
      try {
        if (typeof paintLiveWork === "function") paintLiveWork({ text: "Loading " + spec.label + " in this tab" });
      } catch (_) {}
      const r = await rpc("load", { model: spec.hf });
      STATE.ready = true;
      STATE.model = spec.hf;
      STATE.device = (r && r.device) || "";
      global.__GOAR_LOCAL_LLM = { model: spec.id, hf: spec.hf, device: STATE.device };
      return spec;
    })();
    try {
      return await STATE.loading;
    } finally {
      STATE.loading = null;
    }
  }

  function slimMessages(messages, spec) {
    const list = (messages || []).map(function (m) {
      const role = m.role === "tool" ? "user" : (m.role || "user");
      let content = m.content;
      if (content == null && m.tool_calls) {
        content = m.tool_calls.map(function (t) {
          const fn = t.function || t;
          return "called " + (fn.name || "") + " " + (fn.arguments || "");
        }).join("\n");
      }
      if (Array.isArray(content)) {
        content = content.map(function (p) { return p && p.text ? p.text : ""; }).join("\n");
      }
      return { role: role === "system" || role === "assistant" || role === "user" ? role : "user", content: String(content || "") };
    }).filter(function (m) { return m.content; });
    const sys = list.filter(function (m) { return m.role === "system"; }).slice(0, 1);
    const rest = list.filter(function (m) { return m.role !== "system"; }).slice(-6);
    if (sys[0]) sys[0].content = String(sys[0].content).slice(0, 1800);
    rest.forEach(function (m) { m.content = String(m.content).slice(0, 1200); });
    return sys.concat(rest);
  }

  function toolHint(tools) {
    if (!tools || !tools.length) return "";
    const lines = tools.slice(0, 16).map(function (t) {
      const fn = (t && t.function) || t || {};
      return "- " + (fn.name || "") + ": " + String(fn.description || "").slice(0, 80);
    });
    return (
      "You can call tools. Emit exactly:\n" +
      "<tool name=\"NAME\">{\"arg\":\"value\"}</tool>\n" +
      "Then stop. Tools:\n" + lines.join("\n")
    );
  }

  function parseTools(text) {
    const calls = [];
    const re = /<tool\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/gi;
    let m;
    while ((m = re.exec(text))) {
      let args = (m[2] || "").trim() || "{}";
      try { JSON.parse(args); } catch (_) { args = JSON.stringify({ input: args }); }
      calls.push({
        id: "local_" + Math.random().toString(36).slice(2, 8),
        type: "function",
        function: { name: m[1], arguments: args }
      });
    }
    return calls;
  }

  async function localChat({ messages, tools, onTextDelta }) {
    const s = typeof settingsSnapshot === "function" ? settingsSnapshot() : {};
    const spec = await ensureLocalModel(s.apiModel);
    const packed = slimMessages(messages, spec);
    if (packed[0] && packed[0].role === "system") {
      packed[0].content = packed[0].content + "\n\n" + toolHint(tools);
    } else {
      packed.unshift({ role: "system", content: toolHint(tools) || "You are GOAR running locally in this browser." });
    }
    let streamed = "";
    const r = await rpc("chat", {
      messages: packed,
      max_new_tokens: spec.maxNew
    }, function (t) {
      streamed += t;
      if (onTextDelta) onTextDelta(t, streamed);
    });
    const text = String((r && r.text) || streamed || "");
    const toolCalls = parseTools(text);
    const visible = text.replace(/<tool\s+name=["'][^"']+["']\s*>[\s\S]*?<\/tool>/gi, "").trim();
    if (visible && onTextDelta && !streamed) onTextDelta(visible, visible);
    return {
      text: visible,
      thinking: "",
      toolCalls,
      finish_reason: toolCalls.length ? "tool_calls" : "stop",
      usage: null,
      raw: { object: "chat.completion", model: spec.id, choices: [{ message: { role: "assistant", content: visible, tool_calls: toolCalls } }] }
    };
  }

  function localModelsJson() {
    return {
      object: "list",
      data: LOCAL_MODELS.map(function (m) {
        return { id: m.id, object: "model", owned_by: "browser", hf: m.hf, label: m.label };
      })
    };
  }

  global.GOAR_LOCAL_MODELS = LOCAL_MODELS;
  global.isLocalLlmProvider = isLocalProvider;
  global.ensureLocalModel = ensureLocalModel;
  global.localLlmChat = localChat;
  global.localLlmModels = localModelsJson;
  global.localLlmStatus = function () {
    return { ready: STATE.ready, model: STATE.model, device: STATE.device, error: STATE.lastError };
  };
})(typeof window !== "undefined" ? window : globalThis);
