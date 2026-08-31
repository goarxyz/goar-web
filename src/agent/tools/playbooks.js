/**
 * Shared playbooks — agent and Toolkit tab run the same engine modules.
 */
(function (global) {
  "use strict";

  const GOAR_PLAYBOOKS = [
    {
      id: "audit",
      title: "Site audit",
      group: "Assess",
      blurb: "Fetch, DNS, HTTP, CORS, conservative scans.",
      input: "url",
      placeholder: "example.com",
      steps: [
        { id: "fetch.analyze", map: { url: "url" } },
        { id: "http.headers", map: { url: "url" } },
        { id: "tech.fingerprint", map: { headers: "fetch.headers", body: "fetch.body" } },
        { id: "dns.resolve", map: { name: "host" } },
        { id: "httpx.probe", map: { targets: "url" } },
        { id: "cors.scan", map: { url: "url" } },
        { id: "csp.scan", map: { url: "url" } },
        { id: "url.analyze", map: { url: "url" } },
        { id: "nuclei.scan", map: { url: "url" }, kwargs: { max_templates: 40 } },
      ],
    },
    {
      id: "inspect",
      title: "Inspect",
      group: "Assess",
      blurb: "Headers, CORS, CSP, response fingerprint.",
      input: "url",
      placeholder: "https://example.com",
      steps: [
        { id: "fetch.analyze", map: { url: "url" } },
        { id: "http.headers", map: { url: "url" } },
        { id: "headers.analyze", map: { headers: "fetch.headers" } },
        { id: "cors.scan", map: { url: "url" } },
        { id: "csp.scan", map: { url: "url" } },
      ],
    },
    {
      id: "headers",
      title: "Headers",
      group: "Assess",
      blurb: "Security headers and CSP on a live URL.",
      input: "url",
      placeholder: "https://example.com",
      steps: [
        { id: "http.headers", map: { url: "url" } },
        { id: "csp.scan", map: { url: "url" } },
        { id: "cors.scan", map: { url: "url" } },
      ],
    },
    {
      id: "cms",
      title: "CMS",
      group: "Assess",
      blurb: "Detect CMS and fingerprint the stack.",
      input: "url",
      placeholder: "https://example.com",
      steps: [
        { id: "cms.detect", map: { url: "url" } },
        { id: "fetch.analyze", map: { url: "url" } },
        { id: "tech.fingerprint", map: { headers: "fetch.headers", body: "fetch.body" } },
      ],
    },
    {
      id: "graphql",
      title: "GraphQL",
      group: "Assess",
      blurb: "Probe and introspect a GraphQL endpoint.",
      input: "url",
      placeholder: "https://example.com/graphql",
      steps: [
        { id: "graphql.scan", map: { url: "url" } },
        { id: "graphql.introspect", map: { url: "url" } },
      ],
    },
    {
      id: "secrets",
      title: "Secrets",
      group: "Assess",
      blurb: "Scan a URL or pasted text for secrets.",
      input: "mixed",
      placeholder: "URL or paste source",
      steps: [
        { id: "fetch.analyze", map: { url: "url" }, optional: true },
        { id: "secrets.scan", map: { text: "data", source_url: "url" } },
        { id: "yara.scan", map: { text: "data" } },
      ],
    },
    {
      id: "recon",
      title: "Recon",
      group: "Discover",
      blurb: "DNS, archives, subdomains — passive first.",
      input: "url",
      placeholder: "example.com",
      steps: [
        { id: "fetch.analyze", map: { url: "url" } },
        { id: "dns.info", map: { domain: "host" } },
        { id: "dns.resolve", map: { name: "host" } },
        { id: "wayback.collect", map: { domain: "host" }, kwargs: { limit: 40 } },
        { id: "subenum.enumerate", map: { domain: "host" }, kwargs: { use_brute: false, resolve: true } },
        { id: "tech.fingerprint", map: { headers: "fetch.headers", body: "fetch.body" } },
      ],
    },
    {
      id: "crawl",
      title: "Crawl",
      group: "Discover",
      blurb: "Shallow crawl of in-scope URLs.",
      input: "url",
      placeholder: "https://example.com",
      steps: [
        { id: "katana.crawl", map: { url: "url" }, kwargs: { depth: 2, max_urls: 40 } },
        { id: "fetch.analyze", map: { url: "url" } },
      ],
    },
    {
      id: "jwt",
      title: "JWT",
      group: "Crypto",
      blurb: "Inspect a token. Crack only when asked.",
      input: "token",
      placeholder: "eyJhbGciOi…",
      steps: [{ id: "jwt.inspect", map: { token: "token" } }],
    },
    {
      id: "hash",
      title: "Hash",
      group: "Crypto",
      blurb: "Digest, identify, or HMAC a value.",
      input: "data",
      placeholder: "text or hash",
      steps: [
        { id: "hash.digest", map: { data: "data" } },
        { id: "hash.multi", map: { data: "data" } },
        { id: "hashid.identify", map: { hash_value: "data" } },
      ],
    },
    {
      id: "sast",
      title: "Code review",
      group: "Code",
      blurb: "SAST, secrets, and YARA on a file or paste.",
      input: "code",
      placeholder: "path or paste code",
      steps: [
        { id: "sast.scan", map: { code: "code" } },
        { id: "secrets.scan", map: { text: "code" } },
        { id: "yara.scan", map: { text: "code" } },
      ],
    },
  ];

  function hostOf(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const u = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw.replace(/^\/\//, "");
      return new URL(u).hostname;
    } catch (_) {
      return raw.replace(/^https?:\/\//i, "").split("/")[0];
    }
  }

  function normUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    return "https://" + raw.replace(/^\/\//, "");
  }

  function playbookById(id) {
    const n = String(id || "").trim().toLowerCase();
    return GOAR_PLAYBOOKS.find((p) => p.id === n) || null;
  }

  function inferPlaybook(text) {
    const t = String(text || "").toLowerCase();
    if (/\bjwt\b|bearer eyj/i.test(t)) return "jwt";
    if (/\bgraphql\b/.test(t)) return "graphql";
    if (/\bwordpress\b|\bcms\b/.test(t)) return "cms";
    if (/\bsecret|api[_ ]?key|token leak/.test(t)) return "secrets";
    if (/\brecon|osint|subdomain|wayback|passive/.test(t)) return "recon";
    if (/\bcrawl|spider|katana/.test(t)) return "crawl";
    if (/\bheader|csp|cors\b/.test(t) && !/\baudit|comprehensive/.test(t)) return "inspect";
    if (/\bhash|sha256|md5|digest/.test(t)) return "hash";
    if (/\bsast|code review|static analysis/.test(t)) return "sast";
    if (/\baudit|review|test|scan|assess/.test(t)) return "audit";
    return "audit";
  }

  function pickFetch(blob) {
    const r = blob && blob.result !== undefined ? blob.result : blob;
    if (!r || typeof r !== "object") return null;
    let headers = r.headers || r.response_headers || r.selected_headers || "";
    if (headers && typeof headers !== "string") {
      try { headers = JSON.stringify(headers); } catch (_) { headers = String(headers); }
    }
    const body = r.body || r.response_body || r.preview || r.text || "";
    return { headers: String(headers || ""), body: String(body || "").slice(0, 180000) };
  }

  function applyMap(step, ctx) {
    const kw = Object.assign({}, step.kwargs || {});
    const map = step.map || {};
    Object.keys(map).forEach((param) => {
      const from = map[param];
      let val = "";
      if (from === "url") val = ctx.url;
      else if (from === "host") val = ctx.host;
      else if (from === "data") val = ctx.data;
      else if (from === "token") val = ctx.token;
      else if (from === "code") val = ctx.code;
      else if (from === "fetch.headers") val = ctx.fetchHeaders;
      else if (from === "fetch.body") val = ctx.fetchBody;
      if (val != null && val !== "") kw[param] = val;
    });
    return kw;
  }

  async function toolPlaybook(args) {
    args = args && typeof args === "object" ? args : {};
    const id = String(args.playbook || args.id || args.name || "audit").trim().toLowerCase();
    const spec = playbookById(id);
    if (!spec) {
      return JSON.stringify({
        ok: false,
        error: "unknown playbook",
        available: GOAR_PLAYBOOKS.map((p) => p.id),
      });
    }
    const ctx = {
      url: normUrl(args.url || args.target || args.host || args.domain || ""),
      host: "",
      data: String(args.data || args.text || args.body || "").slice(0, 180000),
      token: String(args.token || "").trim(),
      code: String(args.code || args.text || "").slice(0, 180000),
      path: String(args.path || "").trim(),
      fetchHeaders: "",
      fetchBody: "",
    };
    ctx.host = hostOf(ctx.url || args.domain || args.host || "");
    if (spec.input === "token" && !ctx.token && ctx.data) ctx.token = ctx.data;
    if ((spec.input === "data" || spec.input === "mixed") && !ctx.data && ctx.url) {
      /* fetch will fill */
    }
    if (spec.id === "sast" && ctx.path && !ctx.code && typeof toolRead === "function") {
      try {
        const raw = await toolRead({ path: ctx.path });
        ctx.code = typeof raw === "string" ? raw : JSON.stringify(raw);
      } catch (_) {}
    }
    if (spec.id === "audit" && ctx.url && typeof geckoLoad === "function") {
      try { geckoLoad(ctx.url).catch(function () {}); } catch (_) {}
    }
    if (spec.input === "url" && !ctx.url && spec.id !== "sast" && spec.id !== "jwt" && spec.id !== "hash") {
      return JSON.stringify({ ok: false, error: "url required", playbook: spec.id });
    }
    if (spec.id === "jwt" && !ctx.token) {
      return JSON.stringify({ ok: false, error: "token required", playbook: spec.id });
    }

    const findings = [];
    for (let i = 0; i < spec.steps.length; i++) {
      const step = spec.steps[i];
      const kwargs = applyMap(step, ctx);
      const needed = Object.keys(step.map || {});
      const missing = needed.filter((k) => kwargs[k] == null || kwargs[k] === "");
      if (missing.length) {
        if (step.optional) {
          findings.push({ tool: step.id, ok: true, skipped: true, reason: "no " + missing.join(",") });
          continue;
        }
        if (step.id === "fetch.analyze" && !ctx.url) {
          findings.push({ tool: step.id, ok: true, skipped: true, reason: "no url" });
          continue;
        }
        if ((step.id === "tech.fingerprint" || step.id === "headers.analyze" || step.id === "secrets.scan") && missing.length) {
          findings.push({ tool: step.id, ok: true, skipped: true, reason: "need prior fetch" });
          continue;
        }
      }
      if (step.id === "secrets.scan" && !kwargs.text && ctx.fetchBody) kwargs.text = ctx.fetchBody;
      if (step.id === "yara.scan" && !kwargs.text && (ctx.fetchBody || ctx.data || ctx.code)) {
        kwargs.text = ctx.fetchBody || ctx.data || ctx.code;
      }
      try {
        const raw = await toolPysec({ tool_id: step.id, kwargs: kwargs });
        let j = null;
        try { j = JSON.parse(raw); } catch (_) { j = { ok: false, result: raw }; }
        const ok = !!(j && j.ok !== false && !j.error);
        findings.push({
          tool: step.id,
          ok: ok,
          error: j && j.error ? String(j.error).slice(0, 240) : null,
          result: j && j.result !== undefined ? j.result : j,
        });
        if (step.id === "fetch.analyze" || step.id === "http.headers") {
          const picked = pickFetch(j);
          if (picked) {
            if (picked.headers) ctx.fetchHeaders = picked.headers;
            if (picked.body) {
              ctx.fetchBody = picked.body;
              if (!ctx.data) ctx.data = picked.body;
            }
          }
        }
      } catch (e) {
        findings.push({ tool: step.id, ok: false, error: String(e && e.message ? e.message : e) });
      }
    }
    return JSON.stringify({
      ok: true,
      playbook: spec.id,
      title: spec.title,
      target: ctx.url || ctx.host || ctx.path || null,
      steps: findings.length,
      failed: findings.filter((x) => !x.ok && !x.skipped).map((x) => x.tool),
      findings: findings,
    }, null, 2);
  }

  async function toolAudit(args) {
    return toolPlaybook(Object.assign({}, args || {}, { playbook: "audit" }));
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "\u0026amp;")
      .replace(/</g, "\u0026lt;")
      .replace(/>/g, "\u0026gt;")
      .replace(/"/g, "\u0026quot;");
  }

  function mountGoarToolkit() {
    const root = document.getElementById("kit-grid");
    if (!root) return;
    const groups = [];
    GOAR_PLAYBOOKS.forEach((p) => {
      if (groups.indexOf(p.group) < 0) groups.push(p.group);
    });
    const active = root.getAttribute("data-active") || "audit";
    root.innerHTML =
      '<div class="kit-chips">' +
      groups
        .map((g) => '<button type="button" class="kit-chip" data-group="' + escapeHtml(g) + '">' + escapeHtml(g) + "</button>")
        .join("") +
      "</div>" +
      '<div class="kit-cards">' +
      GOAR_PLAYBOOKS.map((p) => {
        return (
          '<button type="button" class="kit-card' +
          (p.id === active ? " on" : "") +
          '" data-playbook="' +
          p.id +
          '"><span class="kit-card-k">' +
          escapeHtml(p.group) +
          '</span><strong>' +
          escapeHtml(p.title) +
          "</strong><em>" +
          escapeHtml(p.blurb) +
          "</em></button>"
        );
      }).join("") +
      "</div>";
    root.querySelectorAll(".kit-card").forEach((btn) => {
      btn.addEventListener("click", () => selectPlaybook(btn.getAttribute("data-playbook")));
    });
    root.querySelectorAll(".kit-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const g = btn.getAttribute("data-group");
        root.querySelectorAll(".kit-card").forEach((c) => {
          c.style.display = !g || c.querySelector(".kit-card-k").textContent === g ? "" : "none";
        });
        root.querySelectorAll(".kit-chip").forEach((x) => x.classList.toggle("on", x === btn));
      });
    });
    selectPlaybook(active);
  }

  function selectPlaybook(id) {
    const spec = playbookById(id) || GOAR_PLAYBOOKS[0];
    const root = document.getElementById("kit-grid");
    const form = document.getElementById("kit-form");
    const out = document.getElementById("kit-out");
    if (root) {
      root.setAttribute("data-active", spec.id);
      root.querySelectorAll(".kit-card").forEach((c) => {
        c.classList.toggle("on", c.getAttribute("data-playbook") === spec.id);
      });
    }
    if (!form) return;
    const ph = spec.placeholder || "";
    form.innerHTML =
      '<div class="kit-form-h"><strong>' +
      escapeHtml(spec.title) +
      "</strong><span>" +
      escapeHtml(spec.blurb) +
      "</span></div>" +
      '<div class="kit-row">' +
      '<input id="kit-input" type="text" spellcheck="false" placeholder="' +
      escapeHtml(ph) +
      '" aria-label="' +
      escapeHtml(spec.title) +
      ' input" />' +
      '<button type="button" id="kit-run">Run</button></div>' +
      '<p class="kit-hint">Same playbook the agent uses. ' +
      spec.steps.length +
      " engine steps.</p>";
    if (out) out.textContent = "";
    const run = document.getElementById("kit-run");
    const input = document.getElementById("kit-input");
    async function go() {
      const v = (input && input.value || "").trim();
      if (!v) { if (input) input.focus(); return; }
      const args = { playbook: spec.id };
      if (spec.input === "token") args.token = v;
      else if (spec.input === "data") args.data = v;
      else if (spec.input === "code") {
        if (/^\/|^workspace\//.test(v) || /\.(py|js|ts|html|json)$/.test(v)) args.path = v;
        else args.code = v;
      } else if (spec.input === "mixed") {
        if (/^https?:\/\//i.test(v) || /^[\w.-]+\.[a-z]{2,}/i.test(v)) args.url = v;
        else args.data = v;
      } else args.url = v;
      if (run) { run.disabled = true; run.textContent = "Running"; }
      if (out) out.textContent = "Running " + spec.title + "…";
      try {
        const raw = await toolPlaybook(args);
        if (out) out.textContent = raw;
      } catch (e) {
        if (out) out.textContent = String(e && e.message ? e.message : e);
      } finally {
        if (run) { run.disabled = false; run.textContent = "Run"; }
      }
    }
    run && run.addEventListener("click", go);
    input && input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); go(); }
    });
  }

  global.GOAR_PLAYBOOKS = GOAR_PLAYBOOKS;
  global.toolPlaybook = toolPlaybook;
  global.toolAudit = toolAudit;
  global.inferPlaybook = inferPlaybook;
  global.mountGoarToolkit = mountGoarToolkit;
  global.playbookById = playbookById;
})(typeof window !== "undefined" ? window : globalThis);
