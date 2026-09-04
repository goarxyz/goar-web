function providerNeedsKey(p) {
  if (!p) return true;
  if (p.requiresApiKey === false || p.supportsOptionalApiKey || p.noKeyDemo) return false;
  return true;
}

function providerAllowsEmptyKey(idOrP) {
  const p = typeof idOrP === "string" ? getProvider(idOrP) : idOrP;
  return !providerNeedsKey(p);
}

function getProvider(id) {
  if (!id) return null;
  const key = String(id).trim().toLowerCase().replace(/\s+/g, "");
  return (
    SERVICE_PROVIDERS.find((p) => p.id === key) ||
    SERVICE_PROVIDERS.find((p) => p.id.replace(/-/g, "") === key.replace(/-/g, "")) ||
    null
  );
}

function providerByBase(base) {
  const b = (base || "").toLowerCase();
  if (!b) return getProvider("openai-compatible");
  if (b.includes("browser:") || b.includes("transformers") || b.includes("local-llm")) return getProvider("transformers");
  if (b.includes("nvidia.com")) return getProvider("nvidia");
  if (b.includes("openai.com")) return getProvider("openai");
  if (b.includes("deepseek.com")) return getProvider("deepseek");
  if (b.includes("groq.com")) return getProvider("groq");
  if (b.includes("mistral.ai")) return getProvider("mistral");
  if (b.includes("openrouter.ai")) return getProvider("openrouter");
  if (b.includes("api.x.ai") || b.includes("x.ai")) return getProvider("xai");
  if (b.includes("generativelanguage.googleapis.com") || b.includes("googleapis.com")) return getProvider("gemini");
  if (b.includes("together.xyz") || b.includes("together.ai")) return getProvider("together");
  if (b.includes("cerebras.ai")) return getProvider("cerebras");
  if (b.includes("huggingface")) return getProvider("huggingface");
  if (b.includes("deepinfra.com")) return getProvider("deepinfra");
  if (b.includes("fireworks.ai")) return getProvider("fireworks");
  if (b.includes("venice.ai")) return getProvider("venice");
  if (b.includes("11434") || b.includes("ollama")) return getProvider("ollama");
  if (b.includes("free.ai")) return getProvider("freeai");
  return getProvider("openai-compatible");
}

function normalizeApiBase(base, providerId) {
  let b = (base || "").trim().replace(/\/+$/, "");
  const p = getProvider(providerId) || providerByBase(b);
  if (!b && p && p.apiBase) b = p.apiBase;
  // Groq: always .../openai/v1
  if (/api\.groq\.com/i.test(b)) {
    if (/\/openai\/v1$/i.test(b)) return b;
    if (/\/openai$/i.test(b)) return b + "/v1";
    if (/\/v1$/i.test(b) && !/\/openai\//i.test(b)) return b.replace(/\/v1$/i, "/openai/v1");
    return "https://api.groq.com/openai/v1";
  }
  // DeepSeek accepts /v1 or root; prefer no double /v1
  if (/api\.deepseek\.com$/i.test(b)) return b; // chat is /chat/completions on host
  if (/api\.deepseek\.com\/v1$/i.test(b)) return b;
  // OpenRouter
  if (/openrouter\.ai$/i.test(b)) return b + "/api/v1";
  if (/openrouter\.ai\/api$/i.test(b)) return b + "/v1";
  // Fireworks
  if (/api\.fireworks\.ai$/i.test(b)) return b + "/inference/v1";
  // DeepInfra openai path
  if (/api\.deepinfra\.com$/i.test(b)) return b + "/v1/openai";
  // Venice
  if (/api\.venice\.ai$/i.test(b)) return b + "/api/v1";
  if (/api\.venice\.ai\/api$/i.test(b)) return b + "/v1";
  // Gemini openai-compat
  if (/generativelanguage\.googleapis\.com\/v1beta$/i.test(b)) return b + "/openai";
  return b.replace(/\/+$/, "");
}

function chatCompletionsUrl(base, providerId) {
  const b = normalizeApiBase(base, providerId);
  if ((providerId === "freeai") || /api\.free\.ai/i.test(b)) {
    if (/\/v1\/chat\/?$/i.test(b)) return b.replace(/\/?$/, "/");
    return (b.replace(/\/v1$/i, "") + "/v1/chat/").replace(/([^:]\/)\/+/g, "$1");
  }
  if (/api\.deepseek\.com$/i.test(b)) return b + "/chat/completions";
  return b.replace(/\/+$/, "") + "/chat/completions";
}

function modelsUrl(base, providerId) {
  const b = normalizeApiBase(base, providerId);
  if (/api\.deepseek\.com$/i.test(b)) return b + "/models";
  return b.replace(/\/+$/, "") + "/models";
}

function goarUrlNeedsProxy(url) {
  try {
    const u = new URL(String(url || ""), typeof location !== "undefined" ? location.href : "http://local/");
    if (u.protocol === "data:" || u.protocol === "blob:") return false;
    const h = String(u.hostname || "");
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return false;
    if (typeof location !== "undefined" && u.origin === location.origin) return false;
    if (/cors\.manus\.space$/i.test(h)) return false;
    if (/api\.free\.ai$/i.test(h)) return false;
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

async function goarApiFetch(url, init) {
  init = init || {};
  if (!goarUrlNeedsProxy(url) || typeof buildManusProxyUrl !== "function") {
    return fetch(url, init);
  }
  const hop = buildManusProxyUrl(url, { method: init.method || "GET" });
  const key = typeof readManusKey === "function" ? readManusKey() : "";
  const headers = Object.assign({}, init.headers || {});
  if (key) headers["x-api-key"] = key;
  return fetch(hop, Object.assign({}, init, { headers }));
}

function goarAnonId() {
  let id = "";
  try { id = localStorage.getItem("goar.anon.id") || ""; } catch (_) {}
  if (!id) {
    id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem("goar.anon.id", id); } catch (_) {}
  }
  return id;
}

function authHeaders(apiKey, base, providerId) {
  const headers = { "Content-Type": "application/json" };
  const key = (apiKey || "").trim();
  if (key) headers.Authorization = "Bearer " + key;
  const b = (base || "").toLowerCase();
  const pid = String(providerId || "").toLowerCase();
  if (b.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = (typeof location !== "undefined" && location.origin) || "https://goar.local";
    headers["X-Title"] = "GOAR OS";
  }
  if (pid === "freeai" || b.includes("free.ai")) {
    headers["X-User-Id"] = goarAnonId();
    headers.Accept = headers.Accept || "application/json";
  }
  return headers;
}

// OpenRouter free tool-capable presets (shown when provider=openrouter)
const FREE_TOOL_MODELS = (getProvider("openrouter") && getProvider("openrouter").freeToolModels) || [];

const SETTINGS_KEY = "goar.workspace.settings.v7-providers";
const LS_KEY = SETTINGS_KEY;

const DEFAULTS = {
  provider: "freeai",
  wispUrl: "",
  apiBase: "https://api.free.ai/v1",
  apiModel: "qwen7b",
  apiKey: "",
  customDns: "",
  temperature: 0.2,
  maxTokens: 1536,
  sshHost: "segfault.net",
  sshPort: 443,
  sshUser: "root",
  sshPassword: "segfault",
  sshSecret: "",
};

/** Live DOM map — never snapshot nulls from missing design IDs */
function _elOne() {
  for (let i = 0; i < arguments.length; i++) {
    const id = arguments[i];
    if (!id) continue;
    const n = document.getElementById(id);
    if (n) return n;
  }
  return null;
}
const el = {
  get setup() { return _elOne("setup"); },
  get app() { return _elOne("app"); },
  get pct() { return _elOne("pct"); },
  get bar() { return _elOne("barFill"); },
  get step() { return _elOne("step"); },
  get detail() { return _elOne("detail"); },
  get err() { return _elOne("err"); },
  get retry() { return _elOne("retry"); },
  get status() { return _elOne("statusLine", "status-line", "provider-status", "st-l", "hdr-status-text"); },
  get statusMid() { return _elOne("statusMid", "st-r", "status-line"); },
  get running() { return _elOne("running"); },
  get runningText() { return _elOne("runningText"); },
  get btnGoar() { return _elOne("btnGoar", "btn-term"); },
  get btnSettings() { return _elOne("btnSettings", "btn-settings"); },
  get settings() { return _elOne("settings"); },
  get apiKey() { return _elOne("apiKey", "token-input"); },
  get provider() { return _elOne("provider", "provider-select"); },
  get apiBase() { return _elOne("apiBase"); },
  get cdpUrl() { return _elOne("cdpUrl"); },
  get apiModel() { return _elOne("apiModel", "model-input"); },
  get customDns() { return _elOne("customDns"); },
  get sshHost() { return _elOne("sshHost"); },
  get sshPort() { return _elOne("sshPort"); },
  get sshUser() { return _elOne("sshUser"); },
  get sshPassword() { return _elOne("sshPassword"); },
  get sshSecret() { return _elOne("sshSecret"); },
  get btnSshDefault() { return _elOne("btnSshDefault"); },
  get btnSshReconnect() { return _elOne("btnSshReconnect"); },
  get btnSaveSettings() { return _elOne("btnSaveSettings"); },
  get btnCloseSettings() { return _elOne("btnCloseSettings"); },
  get btnClearCache() { return _elOne("btnClearCache"); },
  get btnClearAll() { return _elOne("btnClearAll"); },
  get cacheStats() { return _elOne("cacheStats"); },
  /** Terminal host: design uses #view-term > #terminal (no #termHost) */
  get host() {
    return (
      _elOne("termHost") ||
      (_elOne("terminal") && _elOne("terminal").parentElement) ||
      _elOne("view-term") ||
      _elOne("terminal")
    );
  },
  get terminal() { return _elOne("terminal"); },
};

let emulator = null;
let term = null;
let fitAddon = null;
let serialBuf = "";
let seqRunning = false;
let seqDone = false;
const progress = { wasm: 0, lib: 0, bzimage: 0, initrd: 0 };
const weights = { wasm: 0.05, lib: 0.02, bzimage: 0.08, initrd: 0.85 };

/* ── settings ── */
function detectProvider(base) {
  const p = providerByBase(base);
  return p ? p.id : "openai-compatible";
}

