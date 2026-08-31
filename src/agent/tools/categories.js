/**
 * Category tool surface — agent sees ~12 tools, not 141+ schemas.
 * Each category is one OpenAI function; sub-tool picked via `action`/`tool`.
 */
(function (global) {
  "use strict";

  /** Pysec group → lane */
  const GROUP_TO_LANE = {
    Hash: "crypto",
    Cipher: "crypto",
    JWT: "crypto",
    JWTAdv: "crypto",
    OTP: "crypto",
    Password: "crypto",
    Crack: "crypto",
    "X.509": "crypto",
    Secrets: "crypto",
    Codec: "crypto",
    Proxy: "http",
    Requests: "http",
    Fetch: "http",
    Repeater: "http",
    HTTPX: "http",
    HAR: "http",
    HeaderFuzz: "http",
    Cookie: "http",
    Form: "http",
    HTTP: "http",
    DNS: "recon",
    Subenum: "recon",
    CT: "recon",
    ASN: "recon",
    RDAP: "recon",
    Wayback: "recon",
    InternetDB: "recon",
    Favicon: "recon",
    Tech: "recon",
    CMS: "recon",
    Katana: "recon",
    JSRecon: "recon",
    Robots: "recon",
    WellKnown: "recon",
    Cloud: "recon",
    EmailSec: "recon",
    Intel: "recon",
    Nuclei: "vuln",
    Nikto: "vuln",
    SQLMap: "vuln",
    XSS: "vuln",
    SSRF: "vuln",
    XXE: "vuln",
    SSTI: "vuln",
    CRLF: "vuln",
    CORS: "vuln",
    Redirect: "vuln",
    Inject: "vuln",
    NoSQL: "vuln",
    ProtoPollution: "vuln",
    Smuggle: "vuln",
    Upload: "vuln",
    Clickjack: "vuln",
    CSP: "vuln",
    WAF: "vuln",
    WPScan: "vuln",
    Backup: "vuln",
    Dirb: "vuln",
    VHost: "vuln",
    Param: "vuln",
    API: "vuln",
    OAuth: "vuln",
    GraphQL: "vuln",
    Nmap: "vuln",
    Takeover: "vuln",
    SAST: "analyze",
    YARA: "analyze",
    ReDoS: "analyze",
    URL: "analyze",
    Homoglyph: "analyze",
    Mutator: "analyze",
    FuzzGen: "analyze",
  };

  const LANES = {
    crypto: {
      name: "pysec_crypto",
      label: "Crypto / tokens",
      when: "hashes, JWT, encrypt/decrypt, OTP, passwords, certs, secret scan, codecs",
      examples: "hash.digest, jwt.inspect, jwt.crack, secrets.scan, otp.totp, cipher.decrypt",
    },
    http: {
      name: "pysec_http",
      label: "Live HTTP",
      when: "fetch, probe, replay, HTTP analysis, cookies, forms, HAR",
      examples: "httpx.probe, fetch.analyze, repeater.send, requests.get, cookie.scan",
    },
    recon: {
      name: "pysec_recon",
      label: "Recon / OSINT",
      when: "DNS, subdomains, tech, archives, intel, cloud buckets, email security",
      examples: "dns.resolve, subenum.enumerate, tech.fingerprint, wayback.collect",
    },
    vuln: {
      name: "pysec_vuln",
      label: "Vulnerability scan",
      when: "authorized vulnerability checks, scanners, payloads (sqlmap, xss, nuclei)",
      examples: "sqlmap.scan, xss.scan, nuclei.scan, nmap.http_probe, cors.scan",
    },
    analyze: {
      name: "pysec_analyze",
      label: "Local analyze",
      when: "offline code/string/header analysis, yara, redos, mutators",
      examples: "sast.scan, yara.scan, url.analyze, mutator.mutate, headers.analyze",
    },
  };

  /** Guest plane actions */
  const GUEST_ACTIONS = {
    bash: "Shell in /workspace",
    python_exec: "Run Python",
    write_file: "Write a file",
    read_file: "Read a file",
    edit_file: "Search-replace edit",
    list_dir: "List a directory",
    glob: "Find files",
    grep: "Search file contents",
    workspace_tree: "Directory tree",
  };

  const NET_ACTIONS = {
    web_search: "Search the web",
    web_fetch: "Fetch a URL",
    http_request: "HTTP request",
    browse: "Open a URL in Firefox and fetch it",
    browser: "Drive Firefox: goto|click|type|eval|shot|wait|back|reload",
  };

  const KV_ACTIONS = {
    kv_status: "KV plane status",
    kv_set: "Set key (ns, ex TTL)",
    kv_get: "Get key",
    kv_del: "Delete key(s)",
    kv_keys: "List keys by pattern",
  };

  const MIND_ACTIONS = {
    todo: "Checklist set|add|done|list|clear",
    create_plan: "Multi-step plan",
    update_plan_step: "Update plan step",
    update_ledger: "Update goal/facts/decisions",
    think: "Reason before acting",
    complete_task: "Finish with summary",
    store_memory: "Store session fact",
    recall_memory: "Recall memories",
    set_phase: "Set execution phase",
  };

  const KIT_ACTIONS = {
    micropip_install: "Install a pure-Python package",
    create_tool: "Create a session tool",
    edit_tool: "Edit a session tool",
    list_session_tools: "Session tools",
    remove_tool: "Remove a session tool",
    install_flask: "Install Flask",
    crypto: "Host hash/hmac",
    wasm: "Call a WASM module",
    schema_validate: "Validate JSON Schema",
    chart: "Draw a chart",
  };

  function indexCatalog(catalog) {
    const byLane = { crypto: [], http: [], recon: [], vuln: [], analyze: [], other: [] };
    const idToLane = Object.create(null);
    const idToMeta = Object.create(null);
    for (const t of catalog || []) {
      if (!t || !t.id) continue;
      const lane = GROUP_TO_LANE[t.group] || "other";
      idToLane[t.id] = lane;
      idToMeta[t.id] = t;
      if (!byLane[lane]) byLane[lane] = [];
      byLane[lane].push(t.id);
    }
    return { byLane, idToLane, idToMeta };
  }

  let _index = null;
  function getIndex() {
    if (_index) return _index;
    let cat = [];
    try {
      if (typeof pysecCatalogTools === "function") cat = pysecCatalogTools() || [];
    } catch (_) {}
    if ((!cat || !cat.length) && typeof PYSEC_CATALOG_JSON === "string") {
      try {
        cat = JSON.parse(PYSEC_CATALOG_JSON);
      } catch (_) {}
    }
    _index = indexCatalog(cat);
    return _index;
  }

  function invalidateCategoryIndex() {
    _index = null;
  }

  function fn(name, description, properties, required) {
    const parameters = { type: "object", properties: properties || {} };
    if (required && required.length) parameters.required = required;
    return {
      type: "function",
      function: {
        name: name,
        description: String(description).slice(0, 1024),
        parameters: parameters,
      },
    };
  }

  function actionEnumDesc(map) {
    return Object.keys(map)
      .map((k) => k + " — " + map[k])
      .join("; ");
  }

  /**
   * Build the compact tool list exposed to the model (well under 128).
   */
  function buildCategoryAgentTools() {
    const idx = getIndex();
    const tools = [];

    tools.push(
      fn(
        "guest",
        "Wasm Unix /workspace. action=" + Object.keys(GUEST_ACTIONS).join("|") + ". Extra fields go in kwargs or top-level (command,path,content,code).",
        {
          action: { type: "string" },
          kwargs: { type: "object" },
          command: { type: "string" },
          code: { type: "string" },
          path: { type: "string" },
          content: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          src: { type: "string" },
          dest: { type: "string" },
          pattern: { type: "string" },
        },
        ["action"]
      )
    );

    tools.push(
      fn(
        "net",
        "Web + shared Firefox. action=" + Object.keys(NET_ACTIONS).join("|") + ". url/query/text/x/y in kwargs or top-level.",
        {
          action: { type: "string" },
          kwargs: { type: "object" },
          url: { type: "string" },
          query: { type: "string" },
          text: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          method: { type: "string" },
          body: { type: "string" },
        },
        ["action"]
      )
    );

    tools.push(
      fn(
        "kv",
        "Session KV. action=" + Object.keys(KV_ACTIONS).join("|"),
        {
          action: { type: "string" },
          kwargs: { type: "object" },
          key: { type: "string" },
          value: {},
          ns: { type: "string" },
        },
        ["action"]
      )
    );

    tools.push(
      fn(
        "mind",
        "Mission state. action=" + Object.keys(MIND_ACTIONS).join("|"),
        {
          action: { type: "string" },
          kwargs: { type: "object" },
          thought: { type: "string" },
          text: { type: "string" },
          goal: { type: "string" },
          summary: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          content: { type: "string" },
        },
        ["action"]
      )
    );

    for (const key of Object.keys(LANES)) {
      const L = LANES[key];
      const ids = (idx.byLane[key] || []).slice(0, 10).join("|");
      tools.push(
        fn(
          L.name,
          L.label + ". " + L.when + ". tool=<id> e.g. " + L.examples + ".",
          {
            tool: { type: "string" },
            action: { type: "string" },
            query: { type: "string" },
            url: { type: "string" },
            data: { type: "string" },
            text: { type: "string" },
            domain: { type: "string" },
            target: { type: "string" },
          },
          []
        )
      );
    }

    return tools;
  }

  function categoryKitBlurb() {
    return "";
  }

  const HASH_ALGO = {
    sha1: "sha1",
    "sha-1": "sha1",
    sha256: "sha256",
    "sha-256": "sha256",
    sha384: "sha384",
    "sha-384": "sha384",
    sha512: "sha512",
    "sha-512": "sha512",
    sha3: "sha3",
    md5: "md5",
    blake2: "blake2s",
    blake2s: "blake2s",
    blake2b: "blake2b",
  };

  const FAMILY_DEFAULT = {
    hash: "hash.digest",
    codec: "codec.encode",
    jwt: "jwt.inspect",
    sqlmap: "sqlmap.scan",
    xss: "xss.scan",
    nuclei: "nuclei.scan",
    dns: "dns.resolve",
    sast: "sast.scan",
    secrets: "secrets.scan",
    nmap: "nmap.http_probe",
    cors: "cors.scan",
    csp: "csp.analyze",
    httpx: "httpx.probe",
    yara: "yara.scan",
    ssti: "ssti.scan",
    ssrf: "ssrf.scan",
    xxe: "xxe.scan",
    waf: "waf.detect",
    cookie: "cookie.scan",
    emailsec: "emailsec.check",
    subenum: "subenum.enumerate",
    wayback: "wayback.collect",
    cloud: "cloud.bucket",
    otp: "otp.totp",
    cipher: "cipher.decrypt",
    password: "password.analyze",
    headers: "headers.analyze",
    url: "url.analyze",
    fetch: "fetch.analyze",
    nikto: "nikto.scan",
    dirb: "dirb.brute",
    backup: "backup.scan",
    cms: "cms.detect",
    graphql: "graphql.introspect",
    redos: "redos.analyze",
    nosql: "nosql.scan",
    clickjack: "clickjack.scan",
    robots: "robots.scan",
    asn: "asn.lookup",
    ct: "ct.search",
    mutator: "mutator.mutate",
    upload: "upload.bypass",
    homoglyph: "homoglyph.generate",
    form: "form.scan",
    intel: "intel.urlhaus",
    crack: "crack.hash",
    hashid: "hashid.identify",
    x509: "x509.parse",
    jwtadv: "jwtadv.none",
    fuzzgen: "fuzzgen.generate",
    requests: "requests.get",
    param: "param.discover",
    takeover: "takeover.check",
    wpscan: "wpscan.scan",
    smuggle: "smuggle.detect",
    inject: "inject.scan",
    crlf: "crlf.scan",
    redirect: "redirect.scan",
    pp: "pp.scan",
    oauth: "oauth.analyze",
    wellknown: "wellknown.scan",
    katana: "katana.crawl",
    jsrecon: "jsrecon.analyze",
    headerfuzz: "headerfuzz.fuzz",
    internetdb: "internetdb.lookup",
    favicon: "favicon.hash",
    tech: "tech.fingerprint",
    api: "api.discover",
    vhost: "vhost.brute",
    har: "har.parse",
    proxy: "proxy.status",
    repeater: "repeater.send",
  };

  /**
   * Map shorthand / wrong ids (hash, hash.sha256, codec.b64) to catalog ids
   * and fill implied kwargs (algorithm, format).
   */
  function resolvePysecToolId(raw, kwargs) {
    const out = Object.assign({}, kwargs || {});
    let id = String(raw || "").trim();
    if (!id) return { id: "", kwargs: out };

    if (out.format === "b64") out.format = "base64";
    if (out.fmt === "b64") out.format = out.format || "base64";

    let known = false;
    try {
      const meta = getIndex().idToMeta;
      known = !!(meta && meta[id]);
    } catch (_) {}
    if (known) {
      return { id: id, kwargs: aliasPysecKwargs(id, out) };
    }

    const lower = id.toLowerCase().replace(/\s+/g, "");

    if (HASH_ALGO[lower] || lower === "sha256" || lower === "sha1" || lower === "md5") {
      if (!out.algorithm) out.algorithm = HASH_ALGO[lower] || lower;
      return { id: "hash.digest", kwargs: aliasPysecKwargs("hash.digest", out) };
    }
    const hashAlgo = lower.match(/^hash\.(sha-?1|sha-?256|sha-?384|sha-?512|sha3|md5|blake2s?|blake2b)$/);
    if (hashAlgo) {
      if (!out.algorithm) out.algorithm = HASH_ALGO[hashAlgo[1]] || hashAlgo[1].replace(/-/g, "");
      return { id: "hash.digest", kwargs: aliasPysecKwargs("hash.digest", out) };
    }
    if (lower === "hash" || lower === "hash.hash" || lower === "digest" || lower === "sha") {
      if (!out.algorithm) out.algorithm = "sha256";
      return { id: "hash.digest", kwargs: aliasPysecKwargs("hash.digest", out) };
    }

    const encodeB64 = /^(codec\.(b64|base64|encode\.b64)|b64|base64|b64encode)$/.test(lower);
    const decodeB64 = /^(codec\.(decode\.b64|unb64|fromb64|decode\.base64)|b64decode)$/.test(lower);
    if (decodeB64 || (encodeB64 && /decod/i.test(String(out.action || "")))) {
      if (!out.format) out.format = "base64";
      delete out.action;
      return { id: "codec.decode", kwargs: aliasPysecKwargs("codec.decode", out) };
    }
    if (encodeB64) {
      if (!out.format) out.format = "base64";
      delete out.action;
      return { id: "codec.encode", kwargs: aliasPysecKwargs("codec.encode", out) };
    }
    if (lower === "codec.hex" || lower === "hex") {
      if (!out.format) out.format = "hex";
      return { id: "codec.encode", kwargs: aliasPysecKwargs("codec.encode", out) };
    }

    const fam = FAMILY_DEFAULT[lower];
    if (fam) {
      return { id: fam, kwargs: aliasPysecKwargs(fam, out) };
    }

    if (typeof PYSEC_FN_TO_ID !== "undefined" && PYSEC_FN_TO_ID && PYSEC_FN_TO_ID[id]) {
      const mapped = PYSEC_FN_TO_ID[id];
      return { id: mapped, kwargs: aliasPysecKwargs(mapped, out) };
    }

    return { id: id, kwargs: aliasPysecKwargs(id, out) };
  }

  function aliasPysecKwargs(toolId, kwargs) {
    const out = Object.assign({}, kwargs || {});
    let params = [];
    try {
      const meta = getIndex().idToMeta[toolId];
      const raw = meta && meta.params;
      if (Array.isArray(raw)) params = raw;
      else if (raw && typeof raw === "object") {
        params = Object.keys(raw).map(function (name) {
          return { name: name };
        });
      }
    } catch (_) {}
    const aliases = {
      targets: ["url", "target", "host", "domain", "name"],
      target: ["url", "targets", "host", "domain"],
      name: ["domain", "host", "url", "target", "hostname"],
      host: ["domain", "url", "target", "name", "ip"],
      url: ["target", "targets", "href", "link"],
      data: ["text", "input", "content", "value"],
      text: ["data", "content", "input", "body"],
      domain: ["name", "host", "url"],
      ip: ["host", "address"],
      query: ["q", "search"],
      algorithm: ["algo", "hash"],
      format: ["fmt", "encoding", "enc"],
    };
    if (out.format === "b64") out.format = "base64";
    if (out.fmt === "b64") out.format = out.format || "base64";
    for (const p of params) {
      const key = p && p.name;
      if (!key) continue;
      if (out[key] != null && out[key] !== "") continue;
      for (const c of aliases[key] || []) {
        if (out[c] != null && out[c] !== "") {
          out[key] = out[c];
          break;
        }
      }
    }
    return out;
  }

  /**
   * Resolve a category tool call → { kind, name, args } for inner dispatch.
   * kind: 'core' | 'pysec'
   */
  function resolveCategoryCall(name, args) {
    args = args && typeof args === "object" ? Object.assign({}, args) : {};
    const n = String(name || "");

    if (n === "guest" || n === "net" || n === "browser" || n === "kv" || n === "mind") {
      let action = String(args.action || args.tool || args.tool_id || "").trim();
      if (!action) {
        return { error: "action required for " + n };
      }
      if (n === "kit" && action.indexOf(".") !== -1) {
        let kwargs = args.kwargs && typeof args.kwargs === "object" ? Object.assign({}, args.kwargs) : Object.assign({}, args);
        delete kwargs.action; delete kwargs.tool; delete kwargs.tool_id; delete kwargs.kwargs;
        const resolved = resolvePysecToolId(action, kwargs);
        return { kind: "pysec", name: resolved.id, args: resolved.kwargs };
      }
      if (n === "kv") {
        const kvAlias = { set: "kv_set", get: "kv_get", del: "kv_del", delete: "kv_del", keys: "kv_keys", status: "kv_status" };
        if (kvAlias[action]) action = kvAlias[action];
      }
      const BROWSER_VERBS = {
        goto: 1, go: 1, open: 1, load: 1, click: 1, type: 1, fill: 1, send_keys: 1,
        eval: 1, evaluate: 1, execute: 1, find: 1, elements: 1, shot: 1, screenshot: 1,
        wait: 1, waitfor: 1, url: 1, title: 1, content: 1, html: 1, back: 1, reload: 1, forward: 1,
      };
      if ((n === "browser" || n === "net") && BROWSER_VERBS[action]) {
        return { kind: "core", name: "browser_drive", args: Object.assign({ action: action }, args) };
      }
      const maps = {
        guest: GUEST_ACTIONS,
        net: NET_ACTIONS,
        browser: NET_ACTIONS,
        kv: KV_ACTIONS,
        mind: MIND_ACTIONS,
        kit: KIT_ACTIONS,
      };
      if (!maps[n][action] && !maps[n][action.replace(/^gecko_/, "gecko_")]) {
        // allow unknown but warn — still try if it looks like a known core tool
      }
      delete args.action;
      delete args.tool;
      if (args.kwargs && typeof args.kwargs === "object" && !Array.isArray(args.kwargs)) {
        const flat = Object.assign({}, args, args.kwargs);
        delete flat.kwargs;
        args = flat;
      }
      return { kind: "core", name: action, args: args };
    }

    if (n === "pysec" || n.indexOf("pysec_") === 0) {
      const lane = n === "pysec" ? "" : n.replace(/^pysec_/, "");
      const action = String(args.action || "").trim().toLowerCase();
      let toolId = String(args.tool || args.tool_id || args.id || "").trim();
      if (action === "discover" || toolId === "discover") {
        toolId = "";
      }
      if (!toolId) {
        if (lane === "crypto") toolId = args.token ? "jwt.inspect" : "hash.digest";
        else if (lane === "http") toolId = "fetch.analyze";
        else if (lane === "recon") toolId = (args.domain || args.host) ? "dns.resolve" : "tech.fingerprint";
        else if (lane === "vuln") toolId = "nuclei.scan";
        else if (lane === "analyze") toolId = args.path ? "sast.scan" : "url.analyze";
        else toolId = (args.url || args.target) ? "fetch.analyze" : "hash.digest";
      }
      let kwargs =
        args.kwargs && typeof args.kwargs === "object" && !Array.isArray(args.kwargs)
          ? Object.assign({}, args.kwargs)
          : null;
      if (!kwargs) {
        kwargs = Object.assign({}, args);
        delete kwargs.tool;
        delete kwargs.tool_id;
        delete kwargs.id;
        delete kwargs.kwargs;
      }
      if (!toolId) {
        return { error: "tool (catalog id) required for " + n };
      }
      const resolved = resolvePysecToolId(toolId, kwargs);
      toolId = resolved.id;
      kwargs = resolved.kwargs;
      // optional lane check
      if (n !== "pysec") {
        const lane = n.replace(/^pysec_/, "");
        const idx = getIndex();
        const toolLane = idx.idToLane[toolId];
        if (toolLane && toolLane !== lane && toolLane !== "other") {
          // soft warn — still run (agent may mis-bucket)
          kwargs.__lane_hint =
            "note: " + toolId + " is usually under pysec_" + toolLane;
        }
      }
      return { kind: "pysec", name: toolId, args: kwargs };
    }

    return null; // not a category tool
  }

  function isCategoryToolName(name) {
    return (
      name === "guest" ||
      name === "net" ||
      name === "browser" ||
      name === "kv" ||
      name === "mind" ||
      name === "pysec" ||
      (typeof name === "string" && name.indexOf("pysec_") === 0)
    );
  }

  const STOP = new Set(
    "the a an to of and or for in on at is it its you we do be as by from with this that what how can should please just any all our my your use using via then than not but if so get set want need would could".split(/\s+/)
  );

  function toolDiscover(args) {
    args = args && typeof args === "object" ? args : {};
    const q = String(args.query || args.q || args.intent || "").toLowerCase().trim();
    const lane = String(args.lane || args.category || "").replace(/^pysec_/, "");
    const idx = getIndex();
    let ids = [];
    if (lane && idx.byLane[lane] && idx.byLane[lane].length) ids = idx.byLane[lane].slice();
    else {
      for (const k of Object.keys(idx.byLane)) ids = ids.concat(idx.byLane[k] || []);
    }
    const words = q.split(/[^a-z0-9.]+/).filter((w) => w && w.length > 1 && !STOP.has(w));
    function score(id) {
      const meta = idx.idToMeta[id] || {};
      const blob = (id + " " + (meta.group || "") + " " + (meta.desc || meta.summary || "")).toLowerCase();
      if (!words.length) return 1;
      let s = 0;
      for (const w of words) {
        if (id === w || id.endsWith("." + w)) s += 8;
        else if (id.indexOf(w) >= 0) s += 4;
        else if (blob.indexOf(w) >= 0) s += 2;
      }
      return s;
    }
    const ranked = ids
      .map((id) => ({ id: id, group: (idx.idToMeta[id] && idx.idToMeta[id].group) || "", n: score(id) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8)
      .map((x) => ({ tool: x.id, group: x.group }));
    const cat = lane ? "pysec_" + lane : "pysec_http";
    return JSON.stringify({
      ok: true,
      lane: lane || "all",
      matches: ranked,
      next: ranked[0] ? ("call " + cat + " with tool=" + ranked[0].tool) : "try another query",
    });
  }

  global.GROUP_TO_LANE = GROUP_TO_LANE;
  global.LANES = LANES;
  global.buildCategoryAgentTools = buildCategoryAgentTools;
  global.categoryKitBlurb = categoryKitBlurb;
  global.resolveCategoryCall = resolveCategoryCall;
  global.resolvePysecToolId = resolvePysecToolId;
  global.isCategoryToolName = isCategoryToolName;
  global.invalidateCategoryIndex = invalidateCategoryIndex;
  global.getCategoryIndex = getIndex;
  global.toolDiscover = toolDiscover;
  try {
    if (typeof window !== "undefined" && window !== global) {
      for (const k of [
        "buildCategoryAgentTools",
        "categoryKitBlurb",
        "resolveCategoryCall",
        "resolvePysecToolId",
        "isCategoryToolName",
        "invalidateCategoryIndex",
        "getCategoryIndex",
        "toolDiscover",
        "GROUP_TO_LANE",
        "LANES",
      ]) {
        if (global[k] != null) window[k] = global[k];
      }
    }
  } catch (_) {}
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
