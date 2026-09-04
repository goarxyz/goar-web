/* ── Agent cognition (APK ToolHandler patterns) ── */
const agentState = {
  todos: [],
  plan: null,
  ledger: { goal: "", currentStep: "", facts: [], decisions: [], deadEnds: [] },
  memories: [],
  turnMs: 0,
  lastTool: "",
  /** Sticky original user request — survives compaction (ADK session state) */
  mission: "",
  missionClosed: false,
  /** Rolling ADK-style compaction summary of older events */
  compactionSummary: "",
  compactionRange: null,
  /** Seamless multi-wave counter (same mission, no history wipe) */
  wave: 0,
};
function sq(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function pathArg(p) {
  p = String(p || "");
  if (p === "~") return '"$HOME"';
  if (p.startsWith("~/")) return '"$HOME"/' + sq(p.slice(2));
  return sq(p);
}
function sqList(value) {
  return String(value).trim().split(/\s+/).filter(Boolean).map(sq).join(" ");
}
function heredocTag() {
  return "GOAR_EOF_" + Date.now().toString(36);
}
function getStateContext() {
  const parts = [];
  if (agentState.mission) {
    parts.push("MISSION: " + agentState.mission);
    if (agentState.wave > 0) parts.push("WAVE: " + (agentState.wave + 1) + " (same mission, keep going)");
  }
  if (agentState.compactionSummary) {
    parts.push("HAS_ROLLING_CONTEXT: yes (" + String(agentState.compactionSummary).length + " chars)");
  }
  const L = agentState.ledger;
  if (L.goal) {
    parts.push("CURRENT GOAL: " + L.goal);
    if (L.currentStep) parts.push("CURRENT STEP: " + L.currentStep);
    if (L.facts.length) parts.push("KNOWN FACTS: " + L.facts.slice(-8).join("; "));
    if (L.decisions.length) parts.push("DECISIONS: " + L.decisions.slice(-6).join("; "));
    if (L.deadEnds.length) parts.push("DEAD ENDS: " + L.deadEnds.slice(-4).join("; "));
  }
  if (agentState.plan) {
    const pl = agentState.plan;
    parts.push("PLAN: " + pl.goal);
    pl.steps.forEach((s, i) => {
      parts.push("  " + (i + 1) + ". [" + (s.status || "pending") + "] " + s.name + (s.result ? " -> " + s.result : ""));
    });
  }
  if (agentState.todos.length) {
    const done = agentState.todos.filter((x) => x.done).length;
    parts.push("TODO (" + done + "/" + agentState.todos.length + " done):");
    agentState.todos.forEach((td, i) => {
      parts.push("  " + (i + 1) + ". [" + (td.done ? "x" : " ") + "] " + td.text);
    });
  }
  if (agentState.memories.length) {
    parts.push("REMEMBERED:");
    agentState.memories.slice(-8).forEach((m) => {
      parts.push("  - " + (m.category ? "[" + m.category + "] " : "") + String(m.content).slice(0, 200));
    });
  }
  try {
    if (typeof GOAR_SCRATCH !== "undefined" && GOAR_SCRATCH && GOAR_SCRATCH.index && GOAR_SCRATCH.index.length) {
      parts.push("SCRATCH: " + GOAR_SCRATCH.guestPath + " [" + GOAR_SCRATCH.index.join(", ") + "]");
    }
  } catch (_) {}
  try {
    parts.push("kit: " + (__pysecReady ? "ready" : "loading") + " via pysec");
  } catch (_) { parts.push("kit: pysec"); }
  try {
    if (agentState.framework) {
      parts.push("FRAMEWORK PHASE: " + (agentState.framework.phase || "ASSESS"));
      if (agentState.framework.extensions && agentState.framework.extensions.length) {
        parts.push("DYNAMIC TOOLS: " + agentState.framework.extensions.join(", "));
      }
    }
  } catch (_) {}
  return parts.length ? parts.join("\n") : "";
}


/**
 * @typedef {Object} TokenUsage
 * @property {number} [prompt_tokens]
 * @property {number} [completion_tokens]
 * @property {number} [total_tokens]
 * @property {number} [promptTokens]
 * @property {number} [completionTokens]
 * @property {number} [totalTokens]
 */

/**
 * @typedef {Object} IndicatorState
 * @property {string} model
 * @property {string} phase   // idle | thinking | streaming | tool | boot | error
 * @property {string} tool    // active tool name
 * @property {'off'|'loading'|'ready'|'error'} kit
 * @property {number} tokens
 * @property {string} detail  // short mid-line only
 */

/**
 * @typedef {Object} PysecCall
 * @property {string} tool_id
 * @property {Record<string, unknown>} [kwargs]
 */

/**
 * @typedef {Object} PysecAgentResult
 * @property {'pysec'} agent_toolkit
 * @property {string} tool_id
 * @property {boolean} ok
 * @property {unknown} [result]
 * @property {string|null} [error]
 * @property {number} [ms]
 */

/**
 * @typedef {Object} ChatStreamResult
 * @property {string} text
 * @property {string} thinking
 * @property {Array<{id:string,type?:string,function:{name:string,arguments:string}}>} toolCalls
 * @property {string} finish_reason
 * @property {TokenUsage|null} usage
 */

/** @type {{ prompt: number, completion: number, total: number, lastPrompt: number, lastCompletion: number, lastTotal: number, context: number }} */
let __sessionTokens = { prompt: 0, completion: 0, total: 0, lastPrompt: 0, lastCompletion: 0, lastTotal: 0, context: 0 };

/** @type {IndicatorState} */
let __ind = {
  model: "",
  phase: "idle",
  tool: "",
  kit: "off",
  tokens: 0,
  detail: "",
};

/**
 * @param {number} n
 * @returns {string}
 */
function formatTokenCount(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/**
 * Single source of truth for model / phase / kit / tokens.
 * @param {Partial<IndicatorState>} [patch]
 */
function syncIndicators(patch) {
  if (patch) {
    if (patch.model != null) __ind.model = String(patch.model);
    if (patch.phase != null) __ind.phase = String(patch.phase);
    if (patch.tool != null) __ind.tool = String(patch.tool);
    if (patch.kit != null) __ind.kit = /** @type {any} */ (patch.kit);
    if (patch.tokens != null) __ind.tokens = Number(patch.tokens) || 0;
    if (patch.detail != null) __ind.detail = String(patch.detail);
  }
  // pull live settings/kit if not overridden this tick
  try {
    const s = typeof settingsSnapshot === "function" ? settingsSnapshot() : {};
    if (!patch || patch.model == null) __ind.model = String(s.apiModel || __ind.model || "").trim();
  } catch (_) {}
  try {
    if (__pysecReady) __ind.kit = "ready";
    else if (__pysecInitPromise && !__pysecReady) __ind.kit = __ind.kit === "error" ? "error" : "loading";
  } catch (_) {}
  if (!__ind.tokens) {
    __ind.tokens = __sessionTokens.total || (__sessionTokens.prompt + __sessionTokens.completion) || 0;
  }

  const modelEl = document.getElementById("sbModel");
  const statusEl = document.getElementById("sbStatus");
  const tokenEl = document.getElementById("sbTokens");
  const mid = document.getElementById("statusMid");
  const kitEl = document.getElementById("sbKit");

  if (modelEl) modelEl.textContent = __ind.model || "no model";
  const am = document.getElementById("active-model");
  if (am && __ind.model) {
    let p = "";
    try { p = (typeof settingsSnapshot === "function" && settingsSnapshot().provider) || ""; } catch (_) {}
    am.textContent = p ? p + " · " + __ind.model : __ind.model;
  }

  /** @type {string[]} */
  const bits = [];
  if (__ind.phase && __ind.phase !== "idle") {
    if (__ind.phase === "tool" && __ind.tool) bits.push(__ind.tool);
    else bits.push(__ind.phase);
  }
  if (__ind.detail) bits.push(__ind.detail);
  if (statusEl) statusEl.textContent = bits.join(" · ");

  if (tokenEl) {
    tokenEl.textContent = __ind.tokens > 0 ? formatTokenCount(__ind.tokens) + " tokens" : "tokens —";
  }
  try { paintTokenMeter(); } catch (_) {}
  if (kitEl) {
    kitEl.textContent = __ind.kit === "ready" ? "kit" : (__ind.kit === "loading" ? "kit…" : (__ind.kit === "error" ? "kit!" : "kit—"));
    kitEl.dataset.state = __ind.kit;
  }
  if (mid) mid.textContent = __ind.phase === "idle" ? "" : (__ind.phase === "tool" ? __ind.tool : __ind.phase);
  try { if (typeof paintLiveWork === "function") paintLiveWork(); } catch (_) {}
}

/** @deprecated use syncIndicators */
function updateStatusBar(opts) {
  opts = opts || {};
  /** @type {Partial<IndicatorState>} */
  const patch = {};
  if (opts.model != null) patch.model = opts.model;
  if (opts.status != null) {
    const st = String(opts.status);
    if (!st) patch.phase = "idle";
    else if (/think/i.test(st)) patch.phase = "thinking";
    else if (/stream/i.test(st)) patch.phase = "streaming";
    else if (/start|boot/i.test(st)) patch.phase = "boot";
    else if (/error|fail/i.test(st)) patch.phase = "error";
    else { patch.phase = "tool"; patch.tool = st.replace(/\.\.\./g, "").slice(0, 40); }
  }
  if (opts.tokensText != null) {
    const m = String(opts.tokensText).match(/([\d.]+)\s*([kKmM])?/);
    // leave display via tokens field if numeric total known
  }
  if (opts.headerStatus != null) patch.detail = opts.headerStatus;
  syncIndicators(patch);
}

function paintTokenMeter() {
  const fill = document.getElementById("tm-fill");
  const ctxEl = document.getElementById("tm-ctx");
  const sessEl = document.getElementById("tm-sess");
  const box = document.getElementById("token-meter");
  if (!fill && !ctxEl) return;
  const cap = (typeof GOAR_COMPACTION !== "undefined" && GOAR_COMPACTION.tokenThreshold) || 22000;
  let ctx = __sessionTokens.context || 0;
  if (!ctx && typeof estimatePromptTokens === "function" && typeof agentHistory !== "undefined") {
    ctx = estimatePromptTokens(agentHistory);
    __sessionTokens.context = ctx;
  }
  const pct = Math.max(0, Math.min(100, Math.round((ctx / cap) * 100)));
  if (fill) fill.style.width = pct + "%";
  if (ctxEl) ctxEl.textContent = formatTokenCount(ctx) + " / " + formatTokenCount(cap);
  if (sessEl) sessEl.textContent = formatTokenCount(__sessionTokens.total || 0);
  const hdrTok = document.getElementById("hdr-tokens");
  if (hdrTok) {
    hdrTok.textContent = ctx
      ? formatTokenCount(ctx) + " / " + formatTokenCount(cap)
      : "";
  }
  const hdrSt = document.getElementById("hdr-status-text");
  if (hdrSt && __ind && __ind.phase) {
    hdrSt.textContent = __ind.phase === "idle" ? "ready" : __ind.phase;
  }
  if (box) {
    box.classList.toggle("hot", pct >= 85);
    box.classList.toggle("warn", pct >= 60 && pct < 85);
    const last = __sessionTokens.lastTotal
      ? " last +" + formatTokenCount(__sessionTokens.lastTotal)
      : "";
    box.title =
      "Context " + ctx + " / " + cap + " · session " + (__sessionTokens.total || 0) + last;
  }
}

/**
 * @param {TokenUsage|null|undefined} usage
 */
function accumulateUsage(usage) {
  if (!usage) return;
  const pt = Number(usage.prompt_tokens || usage.promptTokens || 0);
  const ct = Number(usage.completion_tokens || usage.completionTokens || 0);
  const tt = Number(usage.total_tokens || usage.totalTokens || (pt + ct));
  __sessionTokens.prompt += pt;
  __sessionTokens.completion += ct;
  __sessionTokens.total += tt || (pt + ct);
  __sessionTokens.lastPrompt = pt;
  __sessionTokens.lastCompletion = ct;
  __sessionTokens.lastTotal = tt || (pt + ct);
  if (pt) __sessionTokens.context = pt;
  else if (typeof estimatePromptTokens === "function" && typeof agentHistory !== "undefined") {
    __sessionTokens.context = estimatePromptTokens(agentHistory);
  }
  syncIndicators({ tokens: __sessionTokens.total });
}

function setStatusFooter(text) {
  const st = String(text || "").trim();
  if (!st) syncIndicators({ phase: "idle", tool: "", detail: "" });
  else updateStatusBar({ status: st });
}


function toolTodo(args) {
  const action = String(args.action || "list").toLowerCase();
  if (action === "set") {
    let items = args.items;
    if (Array.isArray(items)) items = items.map((s) => String(s).trim()).filter(Boolean);
    else items = String(items || args.item || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    agentState.todos = items.map((text) => ({ text, done: false }));
    return "TODO set (" + agentState.todos.length + " items)\n" + agentState.todos.map((td, ix) => (ix + 1) + ". [ ] " + td.text).join("\n");
  }
  if (action === "add") {
    const item = String(args.item || "").trim();
    if (!item) return "error: item required";
    agentState.todos.push({ text: item, done: false });
    return "Added: " + item;
  }
  if (action === "done") {
    const raw = String(args.item || "").trim();
    let hit = false;
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= agentState.todos.length) {
      agentState.todos[n - 1].done = true; hit = true;
    } else {
      for (const t of agentState.todos) {
        if (t.text === raw || t.text.toLowerCase().includes(raw.toLowerCase())) { t.done = true; hit = true; break; }
      }
    }
    return hit ? "Marked done: " + raw : "Not found: " + raw;
  }
  if (action === "clear") { agentState.todos = []; return "TODO cleared"; }
  if (!agentState.todos.length) return "TODO empty";
  return agentState.todos.map((t, i) => (i + 1) + ". [" + (t.done ? "x" : " ") + "] " + t.text).join("\n");
}
function toolCreatePlan(args) {
  const goal = String(args.goal || args.title || args.name || "").trim();
  if (!goal) return "error: goal required";
  let steps = args.steps;
  if (typeof steps === "string") {
    try { steps = JSON.parse(steps); } catch (_) { steps = steps.split(/\n+/); }
  }
  if (!Array.isArray(steps)) steps = [];
  steps = steps.map((s) => (typeof s === "string" ? s : (s && s.name) || String(s))).filter(Boolean);
  agentState.plan = { id: "plan_" + Date.now(), goal, steps: steps.map((name) => ({ name, status: "pending", result: "" })) };
  agentState.ledger.goal = goal;
  agentState.ledger.currentStep = steps[0] || "";
  return "Plan created: " + goal + "\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n");
}
function toolUpdatePlanStep(args) {
  if (!agentState.plan) return "error: no active plan";
  const n = agentState.plan.steps.length;
  if (!n) return "error: plan has no steps";
  let raw = args.step != null ? args.step : (args.index != null ? args.index : args.step_index);
  let idx = Number(raw);
  if (isNaN(idx)) return "error: bad step index";
  // Accept 1-based (1..n) or 0-based (0..n-1)
  if (idx >= 1 && idx <= n) idx = idx - 1;
  if (idx < 0 || idx >= n) return "error: bad step index (use 1.." + n + ")";
  const status = String(args.status || "done");
  const result = String(args.result || "");
  agentState.plan.steps[idx].status = status;
  if (result) agentState.plan.steps[idx].result = result;
  agentState.ledger.currentStep = agentState.plan.steps[idx].name + " [" + status + "]";
  return "Step " + (idx + 1) + " → " + status + (result ? " · " + result : "");
}
function toolUpdateLedger(args) {
  const L = agentState.ledger;
  if (args.goal) L.goal = String(args.goal);
  if (args.current_step) L.currentStep = String(args.current_step);
  if (args.fact) L.facts.push(String(args.fact));
  if (args.note) L.facts.push(String(args.note));
  if (args.decision) L.decisions.push(String(args.decision));
  if (args.dead_end) L.deadEnds.push(String(args.dead_end));
  L.facts = L.facts.slice(-24);
  L.decisions = L.decisions.slice(-16);
  L.deadEnds = L.deadEnds.slice(-12);
  return "Ledger updated. Goal: " + (L.goal || "(none)") + " · Step: " + (L.currentStep || "(none)");
}
function toolThink(args) {
  const thought = String(args.thought || args.text || args.content || "").trim();
  if (!thought) return "error: thought required";
  return "[thinking] " + thought;
}
function toolCompleteTask(args) {
  const summary = String(args.summary || "Task completed.");
  agentState.ledger.currentStep = "DONE";
  if (agentState.plan) {
    agentState.plan.steps.forEach((s) => { if (s.status === "pending" || s.status === "in_progress") s.status = "done"; });
  }
  return "[exit] " + summary;
}
function toolStoreMemory(args) {
  const content = String(args.content || args.value || args.text || "").trim();
  if (!content) return "error: content required";
  agentState.memories.push({ content, category: String(args.category || ""), importance: Number(args.importance) || 0.5 });
  agentState.memories = agentState.memories.slice(-40);
  // Mirror into G · kv plane (HeyPuter kv.js) — additive, non-blocking
  try {
    if (typeof goarKvSet === "function") {
      const id = "m" + Date.now().toString(36);
      goarKvSet(id, { content, category: String(args.category || ""), importance: Number(args.importance) || 0.5, t: Date.now() }, { ns: "mem" }).catch(function () {});
    }
  } catch (_) {}
  return "Memory stored: " + content.slice(0, 80);
}
function toolRecallMemory(args) {
  const q = String(args.query || "").toLowerCase();
  const limit = Number(args.limit) || 5;
  let list = agentState.memories.slice();
  if (q) list = list.filter((m) => (m.content + " " + m.category).toLowerCase().includes(q));
  list = list.sort((a, b) => (b.importance || 0) - (a.importance || 0)).slice(0, limit);
  if (!list.length) return "No memories found.";
  return list.map((m) => "• " + (m.category ? "[" + m.category + "] " : "") + m.content).join("\n");
}


let envReady = false;
window.__GOAR_ENV_READY = false;


function agentBoot(msg) {
  // quiet — status bar only; toolkit preloads with agent
  try { if (typeof updateStatusBar === "function" && msg) updateStatusBar({ status: String(msg).slice(0, 48) }); } catch (_) {}
  try {
    if (typeof ensurePysecWorker === "function" && !__pysecReady) {
      ensurePysecWorker().catch(function () {});
    }
  } catch (_) {}
}
function agentBootOff() { agentEl.bootStrip?.classList.remove("on"); }


function escHtml(s) {
  return String(s || "").replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}
function renderMd(src) {
  let s = String(src || "");
  const fences = [];
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, function (_, lang, code) {
    fences.push('<pre class="md-code"><code>' + escHtml(code.replace(/\n$/, "")) + "</code></pre>");
    return "\u0000F" + (fences.length - 1) + "\u0000";
  });
  s = escHtml(s);
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/^(?:- |\* )(.+)$/gm, "<li>$1</li>");
  s = s.replace(/(<li>.*<\/li>\n?)+/g, function (m) { return "<ul>" + m + "</ul>"; });
  s = s.replace(/\n{2,}/g, "</p><p>");
  s = "<p>" + s + "</p>";
  s = s.replace(/\u0000F(\d+)\u0000/g, function (_, i) { return fences[Number(i)] || ""; });
  s = s.replace(/<p>\s*<\/p>/g, "");
  return s;
}
function formatToolOut(text) {
  const raw = String(text || "");
  try {
    const j = JSON.parse(raw);
    const ok = j.ok !== false && !j.error;
    let title = j.tool_id || j.agent_toolkit || j.action || "";
    if (!title || title === "tool" || title === "Output") title = "";
    const body = j.result !== undefined ? j.result : (j.error || j);
    const pretty = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    return { title: String(title), ok: ok, body: pretty.slice(0, 8000) };
  } catch (_) {
    return { title: "", ok: true, body: raw.slice(0, 8000) };
  }
}

function isStagingProse(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t.length > 280) return false;
  return /^(i(?:'ll| will)|let me|i(?:'m| am) (?:going to |about to )?|now i(?:'ll| will)|next[,:]?\s|here(?:'s| is) (?:a |the )?(?:tiny |quick |small )?|this will|i(?:'m| am) (?:now )?(?:write|creat|open|build|check|run|fetch|brows|scan|add|updat|fix|read|edit|mak))/i.test(t);
}

function lastChatRow() {
  const host = document.getElementById("chat-inner") || (typeof agentEl !== "undefined" && agentEl.chat);
  if (!host) return null;
  return host.lastElementChild;
}

function lastChatBodyText(el) {
  if (!el) return "";
  const body = el.querySelector(".body");
  return ((body && body.textContent) || el.textContent || "").replace(/\s+/g, " ").trim();
}

function appendMsg(text, kind = "ai") {
  /* Transcript layout mirrors GoarClient.kt + APK chat surface:
     user / Thought (stream) / * tools / tool output / assistant (stream) / turn footer
     Strict ASCII — no emoji. */
  if (!agentEl.chat) return null;
  const host = document.getElementById("chat-inner") || agentEl.chat;
  kind = kind || "ai";

  if (text && (kind === "thought" || kind === "ai") && isStagingProse(text)) {
    return null;
  }

  const last = lastChatRow();
  if (last && text) {
    const sameKind =
      (kind === "thought" && last.classList.contains("thought")) ||
      (kind === "tool-run" && last.classList.contains("tool-run")) ||
      (kind === "tool-out" && last.classList.contains("tool-out")) ||
      (kind === "ai" && last.classList.contains("ai") && !last.classList.contains("thought")) ||
      (kind === "sys" && last.classList.contains("sys"));
    if (sameKind && lastChatBodyText(last) === String(text).replace(/\s+/g, " ").trim()) {
      return { el: last, body: last.querySelector(".body") || last };
    }
  }

  try {
    const es = document.getElementById("emptyState") || document.getElementById("welcome");
    if (es) {
      es.classList.remove("on", "show");
      es.classList.add("hide");
      es.style.display = "none";
    }
    try { if (typeof goarMotion !== "undefined" && goarMotion.leaveWelcome) goarMotion.leaveWelcome(); } catch (_) {}
  } catch (_) {}
  const div = document.createElement("div");
  const body = document.createElement("div");
  body.className = "body";
  if (kind === "user") {
    div.className = "msg user";
    const pre = document.createElement("span");
    pre.className = "prefix";
    pre.textContent = "> ";
    div.appendChild(pre);
    body.textContent = text;
  } else if (kind === "tool" || kind === "tool-run") {
    div.className = "msg tool-run";
    const pre = document.createElement("span");
    pre.className = "prefix";
    pre.textContent = "* ";
    div.appendChild(pre);
    body.textContent = text;
  } else if (kind === "tool-out") {
    div.className = "msg tool-out collapsed";
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "fold";
    fold.textContent = "Output";
    fold.addEventListener("click", () => div.classList.toggle("collapsed"));
    div.appendChild(fold);
    body.classList.add("fold-body");
    const fmt = formatToolOut(text);
    fold.textContent = fmt.title
      ? ((fmt.ok ? "" : "Failed · ") + fmt.title)
      : (fmt.ok ? "Output" : "Failed");
    body.classList.add("fold-body");
    body.innerHTML = '<pre>' + escHtml(fmt.body) + "</pre>";
    body.addEventListener("click", () => {
      if (div.classList.contains("collapsed")) div.classList.remove("collapsed");
    });
  } else if (kind === "thought") {
    div.className = "msg thought collapsed";
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "fold";
    fold.textContent = "Thought";
    fold.addEventListener("click", () => div.classList.toggle("collapsed"));
    div.appendChild(fold);
    body.classList.add("fold-body");
    body.textContent = text || "";
    div._fold = fold;
  } else if (kind === "chart") {
    div.className = "msg chart";
    body.innerHTML = String(text || "");
  } else if (kind === "err") {
    div.className = "msg err";
    body.textContent = "error: " + text;
  } else if (kind === "sys") {
    div.className = "msg sys";
    body.textContent = text;
  } else if (kind === "turn-foot") {
    div.className = "msg turn-foot";
    body.textContent = text;
  } else {
    div.className = "msg ai";
    body.classList.add("md");
    body.innerHTML = renderMd(text);
  }
  div.appendChild(body);
  host.appendChild(div);
  try {
    if (kind === "user" || kind === "ai" || kind === "thought") {
      if (typeof goarMotion !== "undefined" && goarMotion.enterMsg) goarMotion.enterMsg(div);
    }
  } catch (_) {}
  try { div.scrollIntoView({ block: "end", behavior: "smooth" }); } catch (_) {}
  try {
    while (host.children.length > 500) host.removeChild(host.firstChild);
  } catch (_) {}
  return { el: div, body };
}

function paintToolPreview(name, args, out) {
  const host = document.getElementById("chat-inner") || (typeof agentEl !== "undefined" && agentEl.chat);
  if (!host) return;
  const last = host.lastElementChild;
  if (last && last.classList.contains("preview") && last.getAttribute("data-prev") === name) return;

  const card = document.createElement("div");
  card.className = "msg preview";
  card.setAttribute("data-prev", String(name || ""));
  const path = String((args && (args.path || args.file || args.url)) || "").trim();
  const lower = (path || name || "").toLowerCase();
  let painted = false;

  if (name === "gecko_shot" || name === "browse") {
    const shot = (typeof window !== "undefined" && window.__GOAR_LAST_SHOT) || "";
    if (shot && /^data:image\//.test(shot)) {
      const img = document.createElement("img");
      img.className = "preview-img";
      img.alt = "Firefox";
      img.src = shot;
      card.appendChild(img);
      if (path) {
        const cap = document.createElement("div");
        cap.className = "preview-cap";
        cap.textContent = path;
        card.appendChild(cap);
      }
      painted = true;
    }
  }

  if (!painted && (name === "write_file" || name === "edit_file")) {
    const lastW = (typeof window !== "undefined" && window.__GOAR_LAST_WRITE) || null;
    const content = (lastW && lastW.path === path && lastW.content != null)
      ? String(lastW.content)
      : String((args && args.content) || "");
    if (/\.(html?|svg)$/i.test(path) && content) {
      const frame = document.createElement("iframe");
      frame.className = "preview-frame";
      frame.setAttribute("sandbox", "allow-scripts allow-modals");
      frame.setAttribute("title", path);
      frame.srcdoc = content.slice(0, 180000);
      card.appendChild(frame);
      const cap = document.createElement("div");
      cap.className = "preview-cap";
      cap.textContent = path;
      card.appendChild(cap);
      painted = true;
    } else if (/\.(png|jpe?g|gif|webp)$/i.test(path) && content && /^data:image\//.test(content)) {
      const img = document.createElement("img");
      img.className = "preview-img";
      img.alt = path;
      img.src = content;
      card.appendChild(img);
      painted = true;
    } else if (content && /\.(md|py|js|ts|css|json|sh|txt)$/i.test(path)) {
      const pre = document.createElement("pre");
      pre.className = "preview-code";
      pre.textContent = content.split("\n").slice(0, 24).join("\n").slice(0, 2400);
      card.appendChild(pre);
      const cap = document.createElement("div");
      cap.className = "preview-cap";
      cap.textContent = path;
      card.appendChild(cap);
      painted = true;
    }
  }

  if (!painted) return;
  host.appendChild(card);
  try { card.scrollIntoView({ block: "end", behavior: "smooth" }); } catch (_) {}
}

/** APK GoarClient.chatStream: create once, feed onTextDelta / onThinkingDelta. */
function beginStreamMsg(kind) {
  const ref = appendMsg("", kind === "thought" ? "thought" : "ai");
  if (ref && ref.el) ref.el.classList.add("streaming");
  return ref;
}
function collapseDoubledWords(s) {
  if (!s || typeof s !== "string") return s || "";
  let out = s;
  // Passes: spaced doubles, glued doubles, multi-word phrase doubles
  for (let i = 0; i < 4; i++) {
    const prev = out;
    out = out.replace(/\b([A-Za-z0-9_.'\-]{1,48})\s+\1\b/g, "$1");
    out = out.replace(/\b([A-Za-z]{2,32})\1\b/g, "$1");
    // "The user The user" / short phrase repeat
    out = out.replace(/\b((?:[A-Za-z0-9_.'\-]+\s+){1,6}[A-Za-z0-9_.'\-]+)\s+\1\b/g, "$1");
    if (out === prev) break;
  }
  // Collapse runaway identical lines
  out = out.replace(/(^|\n)([^\n]{8,200})\n(?:\2\n?){2,}/g, "$1$2\n");
  return out;
}
function streamDelta(ref, fullText) {
  if (!ref || !ref.body) return;
  const clean = collapseDoubledWords(String(fullText || ""));
  ref.body.textContent = clean;
  ref._full = clean;
  try {
    if (ref.el && ref.el.classList.contains("thought") && ref.el._fold) {
      ref.el._fold.textContent = "Thinking";
      ref.el.classList.add("streaming", "collapsed");
    }
  } catch (_) {}
  try {
    if (ref.el && ref.el.classList.contains("ai") && !ref.el.classList.contains("thought")) {
      const hide = typeof isStagingProse === "function" && isStagingProse(clean);
      ref._staging = hide;
      ref.el.style.display = hide ? "none" : "";
    }
  } catch (_) {}
  try {
    const chat = document.getElementById("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  } catch (_) {}
}

function endStreamMsg(ref) {
  if (!ref || !ref.el) return;
  ref.el.classList.remove("streaming");
  try {
    const b = ref.body && ref.body.textContent ? ref.body.textContent.trim() : "";
    if (!b || ref._staging || (ref.el.classList.contains("ai") && !ref.el.classList.contains("thought") && typeof isStagingProse === "function" && isStagingProse(b))) {
      ref.el.remove();
      return;
    }
    if (ref.el.classList.contains("thought") && ref.el._fold) {
      ref.el.classList.remove("ack");
      const n = b.split(/\s+/).filter(Boolean).length;
      ref.el._fold.textContent = n > 4 ? ("Thought · " + n + " words") : "Thought";
      ref.el.classList.add("collapsed");
    }
  } catch (_) {}
}

function enableAgentMode() {
  try {
    agentEl.app?.classList.add("agent-mode");
    const top = document.getElementById("topbar");
    const dock = document.getElementById("dock");
    const sb = document.getElementById("statusbar");
    // Keep chrome visible (logo + model/tokens status bar)
    if (top) top.style.display = "";
    if (dock) dock.style.display = "none";
    if (sb) sb.style.display = "flex";
    try { if (typeof updateStatusBar === "function") updateStatusBar({}); } catch (_) {}
    // Preload integrated toolkit in background (agent-owned kit)
    try {
      if (typeof ensurePysecWorker === "function" && !__pysecReady) {
        ensurePysecWorker().then(() => {
          try { updateStatusBar({ status: "" }); } catch (_) {}
          /* toolkit ready */
        }).catch((e) => console.warn("[goar] toolkit preload", e && e.message ? e.message : e));
      }
    } catch (_) {}
  } catch (_) {}
}

function settingsSnapshot() {
  try { return ensureDefaultSettings(); } catch (_) { return { ...(typeof DEFAULTS !== "undefined" ? DEFAULTS : {}) }; }
}

function refreshAgentPill() {
  syncIndicators({});
}
/** @param {string} text */
function agentSetPill(text) {
  const s = String(text || "").trim();
  if (!s || s === "idle") syncIndicators({ phase: "idle", tool: "", detail: "" });
  else if (/think/i.test(s)) syncIndicators({ phase: "thinking", tool: "" });
  else if (/stream/i.test(s)) syncIndicators({ phase: "streaming", tool: "" });
  else if (/work/i.test(s)) syncIndicators({ phase: "thinking", tool: "" });
  else syncIndicators({ phase: "tool", tool: s.replace(/\.\.\./g, "").slice(0, 48) });
  const pill = document.getElementById("agentPill");
  if (pill) pill.textContent = s || "idle";
}

