function sanitizeMessagesForApi(messages) {
  const s = typeof settingsSnapshot === "function" ? settingsSnapshot() : {};
  const allow = typeof providerAllowsThinkingBlocks === "function" ? providerAllowsThinkingBlocks(s) : true;
  return (messages || []).map(function (m) {
    if (!m || typeof m !== "object") return { role: "user", content: String(m || "") };
    if (m.role === "assistant" && typeof convertAssistantForApi === "function") {
      return convertAssistantForApi(m, allow);
    }
    const out = { role: m.role || "user" };
    if (m.content != null) out.content = m.content;
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) out.tool_calls = m.tool_calls;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.name && m.role === "tool") out.name = m.name;
    return out;
  }).filter(function (m) {
    return m.role && (m.content != null || m.tool_calls || m.tool_call_id);
  });
}

function slimToolsForApi(tools) {
  return (tools || []).map(function (t) {
    const fn = (t && t.function) || {};
    const params = fn.parameters || {};
    const props = params.properties || {};
    const slim = {};
    Object.keys(props).forEach(function (k) {
      const p = props[k] || {};
      slim[k] = { type: p.type || "string" };
      if (p.enum) slim[k].enum = p.enum;
    });
    return {
      type: "function",
      function: {
        name: fn.name,
        description: String(fn.description || "").slice(0, 160),
        parameters: { type: "object", properties: slim, required: params.required || [] },
      },
    };
  });
}

function resolveMaxTokens(s) {
  const provider = String((s && s.provider) || detectProvider((s && s.apiBase) || "") || "");
  const base = String((s && s.apiBase) || "");
  const groq = /groq/i.test(provider + base);
  const saved = Number(s && s.maxTokens);
  const cap = groq ? 1536 : 2048;
  if (saved > 0 && saved <= cap) return saved;
  return cap;
}

function resolveChatBody(s, messages, tools, stream, includeTools) {
  const body = {
    model: (s.apiModel || "").trim(),
    messages: sanitizeMessagesForApi(messages),
    temperature: Number(s.temperature != null ? s.temperature : DEFAULTS.temperature) || 0.2,
    max_tokens: resolveMaxTokens(s),
    stream: !!stream,
  };
  if (includeTools && tools && tools.length) {
    body.tools = slimToolsForApi(tools);
    body.tool_choice = "auto";
    const provider = s.provider || detectProvider(s.apiBase);
    const base = normalizeApiBase(s.apiBase || DEFAULTS.apiBase, provider);
    if (/openrouter|openai|groq|nvidia|together|deepseek|fireworks|deepinfra/i.test(base + provider) && !/free\.ai|freeai/i.test(base + provider)) {
      body.parallel_tool_calls = false;
    }
  }
  try {
    const est = Math.max(1, Math.floor(JSON.stringify(body).length / 4));
    window.__GOAR_LAST_PAYLOAD = { tokens: est, tools: (body.tools || []).length, messages: (body.messages || []).length };
    if (est > 2800 && Array.isArray(body.messages) && body.messages.length > 4) {
      const sys = body.messages[0] && body.messages[0].role === "system" ? [body.messages[0]] : [];
      const rest = body.messages.filter((m) => m && m.role !== "system").slice(-6);
      body.messages = sys.concat(rest);
    }
  } catch (_) {}
  return body;
}

async function openaiChat({ messages, tools, stream = false, includeTools = true, signal = null }) {
  const s = settingsSnapshot();
  const provider = s.provider || detectProvider(s.apiBase);
  if (typeof isLocalLlmProvider === "function" && isLocalLlmProvider(provider, s.apiBase)) {
    const r = await localLlmChat({ messages, tools, includeTools });
    return r.raw;
  }
  const base = normalizeApiBase(s.apiBase || DEFAULTS.apiBase, provider);
  const url = chatCompletionsUrl(base, provider);
  const model = (s.apiModel || "").trim();
  if (!model) throw new Error("No model configured — paste your key so /models can load, then pick one.");
  if ((getProvider(provider)?.requiresApiKey) && !(s.apiKey || "").trim() && !getProvider(provider)?.supportsOptionalApiKey) {
    throw new Error("No API key — open Settings and paste your key.");
  }
  const body = resolveChatBody(s, messages, tools, stream, includeTools);
  const headers = authHeaders(s.apiKey, base, provider);
  const maxRetries = 3;
  let lastErr = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180000);
    const onParentAbort = () => { try { ctrl.abort(); } catch (_) {} };
    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    try {
      const resp = await (typeof goarApiFetch === "function" ? goarApiFetch : fetch)(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) return resp.json();
      const errText = await resp.text().catch(() => "");
      lastErr = "API " + resp.status + ": " + errText.slice(0, 400);
      if (resp.status === 401 || resp.status === 403) {
        throw new Error("Auth failed (" + resp.status + ") — check /key or Settings. " + errText.slice(0, 160));
      }
      if (resp.status === 404) {
        throw new Error("Endpoint/model not found — check /base and /model. " + errText.slice(0, 160));
      }
      if (resp.status === 413 || (resp.status === 429 && /TPM|too large|tokens per minute|reduce your message/i.test(errText))) {
        body.max_tokens = Math.max(256, Math.floor((body.max_tokens || 1536) / 2));
        if (body.messages && body.messages.length > 6) {
          const sys = body.messages[0] && body.messages[0].role === "system" ? [body.messages[0]] : [];
          body.messages = sys.concat(body.messages.filter((m) => m.role !== "system").slice(-6));
        }
        await sleep(400);
        continue;
      }
      if (resp.status === 429) {
        await sleep(Math.min((attempt + 1) * 3000, 15000));
        continue;
      }
      if (resp.status >= 500 && resp.status <= 599) {
        if (/gateway_timeout|did not respond in time|gpu/i.test(errText)) {
          lastErr = "Free.ai GPU timed out — their demo cluster is busy. Retry in a few seconds, or set an sk-free- key / another provider in Settings.";
          if (typeof paintLiveWork === "function") paintLiveWork({ text: "Free.ai GPU busy — retrying" });
          await sleep(Math.min(8000, (attempt + 1) * 2500));
          continue;
        }
        if (/model is restarting|please resend/i.test(errText)) {
          if (typeof paintLiveWork === "function") paintLiveWork({ text: "Model restarting — retrying" });
        }
        await sleep((attempt + 1) * 2000);
        continue;
      }
      if (/model is restarting|please resend in a few seconds/i.test(errText)) {
        await sleep((attempt + 1) * 1800);
        continue;
      }
      throw new Error(lastErr);
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") lastErr = "Request timed out";
      else lastErr = e.message || String(e);
      if (attempt < maxRetries - 1 && /network|fetch|timeout|Failed/i.test(lastErr)) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      if (attempt >= maxRetries - 1) throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || "Connection failed");
}

/** List model ids from provider GET /models. Optional override avoids saving first. */
async function fetchModels(override) {
  const s = Object.assign({}, settingsSnapshot(), override || {});
  const provider = s.provider || detectProvider(s.apiBase);
  if (typeof isLocalLlmProvider === "function" && isLocalLlmProvider(provider, s.apiBase)) {
    const data = localLlmModels();
    return (data.data || []).map(function (x) { return x.id; });
  }
  const base = normalizeApiBase(s.apiBase || "", provider);
  if (!base) throw new Error("No API base for provider " + (provider || "?"));
  const url = modelsUrl(base, provider);
  const headers = authHeaders(s.apiKey, base, provider);
  delete headers["Content-Type"];
  const resp = await (typeof goarApiFetch === "function" ? goarApiFetch : fetch)(url, { headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const p = typeof getProvider === "function" ? getProvider(provider) : null;
    if (p && Array.isArray(p.preferredModels) && p.preferredModels.length && /freeai|free\.ai/i.test(String(provider) + String(base))) {
      return p.preferredModels.slice();
    }
    throw new Error("models HTTP " + resp.status + (body ? " · " + body.slice(0, 160) : ""));
  }
  const data = await resp.json();
  let arr = data.data || data.models || [];
  const p = typeof getProvider === "function" ? getProvider(provider) : null;
  if (p && Array.isArray(p.chatModelTypes) && p.chatModelTypes.length) {
    const allow = new Set(p.chatModelTypes);
    const typed = arr.filter((x) => !x || typeof x === "string" || !x.type || allow.has(x.type));
    if (typed.length) arr = typed;
  }
  const ids = arr.map((x) => (typeof x === "string" ? x : (x.id || x.name || ""))).filter(Boolean);
  let uniq = [...new Set(ids)];
  if (p && Array.isArray(p.preferredModels)) {
    const pref = p.preferredModels.filter((id) => uniq.includes(id));
    const rest = uniq.filter((id) => !pref.includes(id)).sort();
    uniq = pref.concat(rest);
  } else {
    uniq.sort();
  }
  return uniq;
}

/** GoarClient.probeModel — reachability + tool capability (one cheap call) */
async function probeModel(modelId) {
  const s = settingsSnapshot();
  const provider = s.provider || detectProvider(s.apiBase);
  const base = normalizeApiBase(s.apiBase || DEFAULTS.apiBase, provider);
  const url = chatCompletionsUrl(base, provider);
  const body = {
    model: modelId || s.apiModel,
    max_tokens: 64,
    messages: [{ role: "user", content: "Call the ping tool with value 1." }],
    tools: [{
      type: "function",
      function: {
        name: "ping",
        description: "A trivial test tool.",
        parameters: {
          type: "object",
          properties: { value: { type: "integer", description: "any integer" } },
          required: ["value"],
        },
      },
    }],
    tool_choice: "auto",
  };
  try {
    const resp = await (typeof goarApiFetch === "function" ? goarApiFetch : fetch)(url, {
      method: "POST",
      headers: authHeaders(s.apiKey, base, provider),
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) return { modelId, reachable: false, toolCapable: false, detail: "Invalid API key" };
    if (resp.status === 404) return { modelId, reachable: false, toolCapable: false, detail: "Model not found" };
    if (!resp.ok) {
      const toolsRejected = /tool/i.test(text) && /not support|unsupported|invalid/i.test(text);
      return { modelId, reachable: !toolsRejected, toolCapable: false, detail: toolsRejected ? "Reachable; no tool support" : "HTTP " + resp.status };
    }
    const root = JSON.parse(text);
    const msg = root.choices && root.choices[0] && root.choices[0].message;
    const tcs = msg && msg.tool_calls;
    const emitted = Array.isArray(tcs) && tcs.length > 0;
    return { modelId, reachable: true, toolCapable: emitted, detail: emitted ? "Reachable + tools OK" : "Reachable; did not use tools" };
  } catch (e) {
    return { modelId, reachable: false, toolCapable: false, detail: (e.message || "probe failed").slice(0, 80) };
  }
}


const MODELS_CACHE_KEY = "goar.models.cache.v1";
let liveModels = []; // ids from last /models fetch

function fillModelSelect(ids, selected, meta) {
  const sel = el.apiModel || document.getElementById("apiModel");
  if (!sel || sel.tagName !== "SELECT") return;
  const prev = selected || sel.value || "";
  sel.innerHTML = "";
  const seen = new Set();
  const add = (id, label) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const o = document.createElement("option");
    o.value = id;
    o.textContent = label || id;
    sel.appendChild(o);
  };
  // Prefer live API list when present
  const list = (ids && ids.length) ? ids : [];
  if (list.length) {
    // free / tools-ish first for openrouter
    const free = list.filter((x) => /:free\b|\/free$|free\//i.test(x));
    const rest = list.filter((x) => !/:free\b|\/free$|free\//i.test(x));
    if (free.length) {
      const g = document.createElement("optgroup");
      g.label = "Free / promo (" + free.length + ")";
      free.slice(0, 80).forEach((id) => {
        const o = document.createElement("option");
        o.value = id; o.textContent = id;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
    if (rest.length) {
      const g = document.createElement("optgroup");
      g.label = "All models (" + rest.length + ")";
      rest.slice(0, 200).forEach((id) => {
        const o = document.createElement("option");
        o.value = id; o.textContent = id;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
  } else {
    add("", "Paste key — models load from provider /models");
  }
  add("__custom__", "Custom model id…");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (prev && prev !== "__custom__") {
    add(prev, prev + " (saved)");
    sel.value = prev;
  }
  const st = document.getElementById("modelsStatus");
  if (st) {
    st.textContent = list.length
      ? ("loaded " + list.length + " models" + (meta ? " · " + meta : ""))
      : "no models — check key / provider";
  }
}

async function loadModelsFromApi(opts) {
  opts = opts || {};
  const st = document.getElementById("modelsStatus");
  if (st) st.textContent = "loading models from provider…";
  try {
    const ids = await fetchModels();
    liveModels = ids;
    try {
      localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify({ ts: Date.now(), ids, provider: settingsSnapshot().provider }));
    } catch (_) {}
    fillModelSelect(ids, opts.selected || settingsSnapshot().apiModel, "live");
    return ids;
  } catch (e) {
    if (st) st.textContent = "models API failed: " + (e.message || e);
    try {
      const p = typeof getProvider === "function" ? getProvider(settingsSnapshot().provider) : null;
      if (p && Array.isArray(p.preferredModels) && p.preferredModels.length) {
        fillModelSelect(p.preferredModels, opts.selected || settingsSnapshot().apiModel, "catalog");
        return p.preferredModels;
      }
    } catch (_) {}
    // try cache
    try {
      const c = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || "null");
      if (c && Array.isArray(c.ids) && c.ids.length) {
        liveModels = c.ids;
        fillModelSelect(c.ids, opts.selected || settingsSnapshot().apiModel, "cache");
        return c.ids;
      }
    } catch (_) {}
    fillModelSelect([], opts.selected || settingsSnapshot().apiModel, "live");
    throw e;
  }
}

function rebuildModelSelect(provider, selected) {
  // Prefer cached live list; catalog only as fallback
  let ids = liveModels.slice();
  if (!ids.length) {
    try {
      const c = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || "null");
      if (c && Array.isArray(c.ids)) ids = c.ids;
    } catch (_) {}
  }
  fillModelSelect(ids, selected, ids.length ? "cache" : "catalog");
  // Fire-and-forget live refresh when settings open / provider changes
  if (!rebuildModelSelect._refreshing) {
    rebuildModelSelect._refreshing = true;
    loadModelsFromApi({ selected: selected }).catch(() => {}).finally(() => {
      rebuildModelSelect._refreshing = false;
    });
  }
}

try {
  window.fetchModels = fetchModels;
  window.loadModelsFromApi = loadModelsFromApi;
  window.openaiChat = openaiChat;
} catch (_) {}




