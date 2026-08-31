const GOAR_DOH = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
  "https://dns.nextdns.io/dns-query",
];

function parseCustomDns(raw) {
  const extra = [];
  String(raw || "").split(/[\s,]+/).forEach((p) => {
    p = p.trim();
    if (/^https:\/\//i.test(p)) extra.push(p.replace(/\/+$/, ""));
  });
  return {
    label: "doh",
    resolvers: ["1.1.1.1", "8.8.8.8"],
    doh: extra.length ? extra.concat(GOAR_DOH) : GOAR_DOH.slice(),
  };
}

function resolvConfText(resolvers) {
  const rs = (resolvers && resolvers.length) ? resolvers : ["1.1.1.1", "8.8.8.8"];
  return rs.map((r) => "nameserver " + r).join("\n") + "\n";
}

function dohBases() {
  try {
    const s = typeof loadSettings === "function" ? loadSettings() : {};
    return parseCustomDns(s && s.customDns).doh;
  } catch (_) {}
  return GOAR_DOH.slice();
}

function parseDohAnswers(data) {
  const out = [];
  const ans = (data && data.Answer) || [];
  for (let i = 0; i < ans.length; i++) {
    const a = ans[i];
    if (!a) continue;
    if (Number(a.type) === 1 && a.data && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(a.data))) {
      out.push(String(a.data));
    }
  }
  return out;
}

async function resolveA(hostname, bases) {
  const host = String(hostname || "").trim().replace(/\.$/, "");
  if (!host || host === "localhost") return [];
  const list = (bases && bases.length) ? bases : dohBases();
  const hop = typeof goarHostFetch === "function" ? goarHostFetch : null;
  if (!hop) return [];
  for (let i = 0; i < list.length; i++) {
    const base = String(list[i] || "").replace(/\/+$/, "");
    const url = base + (base.indexOf("?") >= 0 ? "&" : "?") + "name=" + encodeURIComponent(host) + "&type=A";
    try {
      const r = await hop(url, {
        method: "GET",
        maxBytes: 8000,
        reqHeaders: { Accept: "application/dns-json" },
      });
      if (!r || !(r.body || r.ok)) continue;
      let data = r.body;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch (_) { continue; }
      }
      const ips = parseDohAnswers(data);
      if (ips.length) {
        try { window.__GOAR_DOH_LAST = { host: host, ips: ips, via: r.via || "doh", server: base }; } catch (_) {}
        return ips;
      }
    } catch (_) {}
  }
  return [];
}

function hostFromBase(base) {
  try {
    return new URL(base.includes("://") ? base : "https://" + base).hostname;
  } catch {
    return "api.groq.com";
  }
}

async function injectHostsForApi() {
  try { if (el.status) el.status.textContent = "auto · network + hosts..."; } catch (_) {}
  const STATIC = {
    "integrate.api.nvidia.com": ["75.2.113.119", "99.83.136.103"],
    "api.nvcf.nvidia.com": ["3.218.201.149", "98.83.173.66"],
    "api.openai.com": ["162.159.140.245", "172.66.0.245"],
    "openrouter.ai": ["104.18.2.115", "104.18.3.115"],
    "api.groq.com": ["172.64.149.20", "104.18.38.236"],
    "api.together.xyz": ["104.18.0.0"],
    "api.deepseek.com": ["104.18.0.0"],
    "pypi.org": ["151.101.0.223", "151.101.64.223"],
    "files.pythonhosted.org": ["151.101.0.223", "151.101.64.223"],
    "example.com": ["104.20.23.154", "172.66.147.243"],
    "api.ipify.org": ["104.26.12.24", "104.26.13.24"],
    "en.wikipedia.org": ["208.80.154.224", "185.15.59.224"],
    "api.duckduckgo.com": ["52.250.42.157"],
    "lite.duckduckgo.com": ["52.250.42.157"],
    "html.duckduckgo.com": ["52.250.42.157"],
    "search.brave.com": ["13.248.202.133"],
    "www.mojeek.com": ["5.135.165.54"],
    "www.bing.com": ["204.79.197.200"],
    "www.google.com": ["142.250.72.100"],
    "cloudflare-dns.com": ["104.16.248.249", "104.16.249.249"],
    "dns.google": ["8.8.8.8", "8.8.4.4"],
  };
  try {
    const s = ensureDefaultSettings();
    const u = new URL(s.apiBase || DEFAULTS.apiBase);
    if (u.hostname && !STATIC[u.hostname]) {
      const ips = await resolveA(u.hostname);
      STATIC[u.hostname] = ips;
    }
  } catch (_) {}
  const hostLines = ["127.0.0.1 localhost", "::1 localhost"];
  for (const [h, ips] of Object.entries(STATIC)) {
    for (const ip of ips) if (ip) hostLines.push(ip + " " + h);
  }
  const hostsText = hostLines.join("\n") + "\n";
  const resolvText = "nameserver 1.1.1.1\nnameserver 8.8.8.8\nnameserver 9.9.9.9\n";
  const hostsB64 = btoa(unescape(encodeURIComponent(hostsText)));
  const rcB64 = btoa(unescape(encodeURIComponent(resolvText)));
  const dnsMapStr = Object.entries(STATIC).map(([h, ips]) => h + ":" + (ips.join("|") || "")).join(";");
  window.__GOAR_DNS_MAP = dnsMapStr;
  window.__GOAR_DOH = { servers: dohBases(), method: "doh" };
  if (typeof send === "function") {
    send(
      "echo " + hostsB64 + " | base64 -d > /etc/hosts; " +
      "echo " + rcB64 + " | base64 -d > /etc/resolv.conf; " +
      "echo '[goar-seq] dns-done n=" + Object.keys(STATIC).length + "'"
    );
    if (typeof waitForSerial === "function") {
      try { await waitForSerial(/\[goar-seq\] dns-done/, 25000); } catch (_) {}
    }
  }
}

try {
  if (typeof window !== "undefined") {
    window.resolveA = resolveA;
    window.GOAR_DOH = GOAR_DOH;
  }
} catch (_) {}
