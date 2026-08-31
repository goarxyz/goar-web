function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {};
    const s = (typeof raw === "object" && raw) ? raw : {};
    // Fill gaps only — never replace a user-set OpenAI-compatible provider
    /* no default API key — user must supply */
    if (!s.apiBase) s.apiBase = DEFAULTS.apiBase;
    if (s.apiModel == null || s.apiModel === "") s.apiModel = DEFAULTS.apiModel || "";
    if (!s.provider) s.provider = detectProvider(s.apiBase) || DEFAULTS.provider;
    // First-run / empty-key users land on Free.ai so chat works with no key
    if (!(s.apiKey || "").trim()) {
      const p = typeof getProvider === "function" ? getProvider(s.provider) : null;
      const needs = typeof providerNeedsKey === "function" ? providerNeedsKey(p) : (p && p.requiresApiKey);
      if (!p || needs) {
        s.provider = "freeai";
        s.apiBase = "https://api.free.ai/v1";
        if (!s.apiModel) s.apiModel = "qwen7b";
      }
    }
    if (s.customDns == null) s.customDns = DEFAULTS.customDns || "";
    if (!s.wispUrl) s.wispUrl = (typeof window !== "undefined" && window.GOAR_WISP_URL) || DEFAULTS.wispUrl || "";
    if (!s.cdpUrl) s.cdpUrl = "http://127.0.0.1:9222";
    return s;
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function saveSettings(partial) {
  let cur = {};
  try { cur = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (_) { cur = {}; }
  // migrate old key once
  try {
    if (!localStorage.getItem(LS_KEY) && localStorage.getItem("goar.workspace.settings.v6-or-free")) {
      cur = JSON.parse(localStorage.getItem("goar.workspace.settings.v6-or-free") || "{}") || {};
    }
  } catch (_) {}
  const next = { ...cur, ...(partial || {}), updatedAt: Date.now() };
  next.provider = next.provider || detectProvider(next.apiBase) || DEFAULTS.provider;
  next.apiBase = normalizeApiBase(next.apiBase || DEFAULTS.apiBase, next.provider);
  next.apiModel = (next.apiModel || "").trim();
  next.apiKey = (next.apiKey || "").trim();
  next.customDns = (next.customDns || "").trim();
  try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}


async function preflightApi() {
  try {
    const s = ensureDefaultSettings();
    const key = (s.apiKey || "").trim();
    const provider = s.provider || detectProvider(s.apiBase);
    const p = getProvider(provider);
    if (p && p.requiresApiKey && !p.supportsOptionalApiKey && !key) return { ok: false, reason: "no key" };
    const base = normalizeApiBase(s.apiBase || DEFAULTS.apiBase, provider);
    const headers = authHeaders(key, base, provider);
    // models (optional)
    let modelsOk = false;
    try {
      const r = await (typeof goarApiFetch === "function" ? goarApiFetch : fetch)(modelsUrl(base, provider), { headers: { Authorization: headers.Authorization || "" } });
      modelsOk = r.ok;
    } catch (_) {}
    const cr = await (typeof goarApiFetch === "function" ? goarApiFetch : fetch)(chatCompletionsUrl(base, provider), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: s.apiModel || DEFAULTS.apiModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
        temperature: 0,
        stream: false,
      }),
    });
    if (cr.ok) return { ok: true, chat: true, modelsOk };
    const txt = await cr.text().catch(() => "");
    return { ok: modelsOk, chat: false, reason: "chat " + cr.status + " " + txt.slice(0, 120) };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

function ensureDefaultSettings() {
  let s = {};
  try { s = loadSettings() || {}; } catch (_) { s = {}; }
  // v6 factory: OpenRouter free tool models + provided key
  const out = {
    provider: s.provider || DEFAULTS.provider || "freeai",
    apiBase: (s.apiBase || "").trim() || DEFAULTS.apiBase,
    apiModel: (s.apiModel || "").trim() || DEFAULTS.apiModel || "qwen7b",
    wispUrl: "",
      apiKey: (s.apiKey || "").trim(),
    customDns: (s.customDns || "").trim() || DEFAULTS.customDns || "",
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) saveSettings(out);
  } catch (_) {
    try { saveSettings(out); } catch (__) {}
  }
  return out;
}




function fillSettingsForm() {
  const s = ensureDefaultSettings();
  let pid = s.provider || detectProvider(s.apiBase) || "freeai";
  if (pid === "custom") pid = "openai-compatible";
  if (typeof fillProviderSelect === "function") {
    fillProviderSelect(el.provider, pid);
    fillProviderSelect(document.getElementById("credProvider"), pid);
  }
  if (el.apiKey) el.apiKey.value = s.apiKey || "";
  if (el.apiBase) el.apiBase.value = s.apiBase || DEFAULTS.apiBase;
  if (el.cdpUrl) el.cdpUrl.value = s.cdpUrl || "http://127.0.0.1:9222";
  /* dns option removed */
  try {
    applyProviderPreset(el.provider ? el.provider.value : pid);
    // restore user model/base after preset
    if (el.apiBase && s.apiBase) el.apiBase.value = s.apiBase;
    if (typeof rebuildModelSelect === "function") {
      rebuildModelSelect(getProvider(el.provider && el.provider.value), s.apiModel || DEFAULTS.apiModel);
    } else if (typeof syncModelSelect === "function") {
      syncModelSelect(s.apiModel || DEFAULTS.apiModel);
    } else if (el.apiModel) el.apiModel.value = s.apiModel || DEFAULTS.apiModel;
    wireProviderUi();
  } catch (e) {
    console.warn("[goar] fillSettingsForm", e);
  }
}

function applyProviderPreset(id) {
  const p = getProvider(id) || getProvider("openai-compatible");
  if (!p) return;
  if (el.provider) el.provider.value = p.id;
  const isCustom = p.id === "openai-compatible" || p.isCustom;
  if (el.apiBase) {
    el.apiBase.value = p.apiBase || "";
    el.apiBase.disabled = !isCustom && !!p.apiBase;
    el.apiBase.placeholder = isCustom ? "https://your-host/v1" : (p.apiBase || "");
  }
  const baseField = document.getElementById("apiBaseField");
  if (baseField) {
    if (isCustom) baseField.removeAttribute("hidden");
    else baseField.setAttribute("hidden", "");
  }
  if (el.apiKey) {
    el.apiKey.placeholder = p.placeholder || "API key";
    el.apiKey.required = !!p.requiresApiKey && !p.supportsOptionalApiKey;
  }
  // model list comes from live /models — never inject catalog defaults
  if (typeof rebuildModelSelect === "function") rebuildModelSelect(p, "");
  else if (typeof syncModelSelect === "function") syncModelSelect("");
  else if (el.apiModel) el.apiModel.value = "";
  // help link
  const hint = document.getElementById("providerHint");
  if (hint) {
    const need = p.requiresApiKey && !p.supportsOptionalApiKey ? "API key required" : "API key optional";
    hint.innerHTML = "<b>" + p.displayName + "</b> · " + need +
      (p.apiKeyUrl ? ' · <a href="' + p.apiKeyUrl + '" target="_blank" rel="noopener" style="color:#f44">get key</a>' : "") +
      " · base auto-filled" + (isCustom ? " (edit for custom host)" : "");
  }
}

function saveSettingsFromForm() {
  const provider = (el.provider && el.provider.value) || "openrouter";
  const p = getProvider(provider) || getProvider("openai-compatible");
  let apiBase = (el.apiBase && el.apiBase.value || "").trim();
  if (!apiBase && p && p.apiBase) apiBase = p.apiBase;
  apiBase = normalizeApiBase(apiBase, provider);
  const apiModel = (typeof readModelSelect === "function" ? readModelSelect() : (el.apiModel && el.apiModel.value || "")).trim();
  const apiKey = (el.apiKey && el.apiKey.value || "").trim();
  const customDns = "";
  if (!apiBase) {
    alert("Set an API base URL (or pick a preset provider).");
    return null;
  }
  if (!apiModel) {
    alert("Pick or type a model id.");
    return null;
  }
  if ((p && p.requiresApiKey && !p.supportsOptionalApiKey) && !apiKey) {
    alert("This provider needs an API key. Paste it above — it stays in this browser only.");
    return null;
  }
  const cdpUrl = (el.cdpUrl && el.cdpUrl.value || "").trim() || "http://127.0.0.1:9222";
  const s = { provider: p ? p.id : provider, apiBase, apiModel, apiKey, customDns, cdpUrl };
  saveSettings(s);
  return s;
}

async function refreshCacheStats() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    let bytes = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      bytes += (await res.clone().arrayBuffer()).byteLength;
    }
    const mb = (bytes / 1048576).toFixed(1);
    const s = loadSettings();
    el.cacheStats.innerHTML =
      "<b>Cached assets</b> · " + keys.length + " file(s) · ~" + mb + " MB · " +
      (s.apiKey ? "key set · " + (s.apiModel || "") : "no API key yet");
  } catch {
    el.cacheStats.textContent = "Cache stats unavailable";
  }
}

/* ── UI progress ── */
