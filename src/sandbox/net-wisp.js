/** Virtio-net: prefer browser-native fetch proxy (fast HTTPS); WSS relay fallback */
// WISP = full TCP/UDP tunnel (real HTTPS from guest Python/goar)
// Public WISP endpoint works without self-hosting; override with window.GOAR_WISP_URL
/** Networking: WISP = full TCP (HTTPS works for Python/goar). Override: window.GOAR_WISP_URL */
/** Production networking: WISP (full TCP/HTTPS). Override window.GOAR_WISP_URL */
const NET_RELAYS = [
  (typeof window !== "undefined" && window.GOAR_WISP_URL) || null,
  "wss://cors.manus.space/wisp/",
].filter(Boolean).map(function (u) {
  u = String(u || "").trim();
  if (u.startsWith("wisps://")) u = "wss://" + u.slice(8);
  if (u.startsWith("wisp://")) u = "ws://" + u.slice(7);
  return u;
}).filter(Boolean);
const NET_RELAY = NET_RELAYS[0];
const NET_CONFIG = {
  mode: (typeof window !== "undefined" && window.GOAR_NET_MODE) || "wisp",
  relay_url: NET_RELAY,
  relays: NET_RELAYS,
  router_mac: "52:54:00:01:02:03",
  router_ip: "192.168.86.1",
  vm_ip: "192.168.86.100",
  masquerade: true,
  dns_method: "doh",
  doh_server: "cloudflare-dns.com",
  // 1280 reduces frag on WISP tunnels → fewer stalls
  mtu: 1280,
  cors_proxy: (typeof window !== "undefined" && window.GOAR_CORS_PROXY) || "",
};

function buildNetDevice() {
  // v86.d.ts + docs/networking.md:
  // WISP terminates TCP; virtual DHCP/DNS/ARP. dns_method "doh" by default for wisp.
  // Guest must use router_ip as nameserver — UDP DNS to 1.1.1.1 will fail (no UDP on WISP).
  const mode = NET_CONFIG.mode || "wisp";
  const relay = NET_CONFIG.relay_url || NET_RELAY;
  const base = {
    type: "virtio",
    router_mac: NET_CONFIG.router_mac || "02:50:56:c0:00:01",
    router_ip: NET_CONFIG.router_ip || "192.168.86.1",
    vm_ip: NET_CONFIG.vm_ip || "192.168.86.100",
    masquerade: true,
    mtu: 1500,
  };
  if (mode === "fetch") {
    const dev = Object.assign({}, base, {
      relay_url: "fetch",
      dns_method: "static",
      doh_server: NET_CONFIG.doh_server || "cloudflare-dns.com",
    });
    if (NET_CONFIG.cors_proxy) dev.cors_proxy = NET_CONFIG.cors_proxy;
    return dev;
  }
  return Object.assign({}, base, {
    relay_url: relay,
    dns_method: "doh",
    doh_server: NET_CONFIG.doh_server || "cloudflare-dns.com",
  });
}


/** ── 2 GB browser memory budget (soft reservation strategy) ─────────────────
 * Browsers cannot pin RAM like a hypervisor, but we *target* ~2 GB total:
 *   • 1 GB  → guest v86 RAM (Alpine + Python + GOAR)
 *   • 1 GB  → code/packages/assets cache (Cache API + IndexedDB + session snaps)
 * Falls back gracefully on low-memory devices (512–768 MB guest).
 */
const MEM_BUDGET = {
  totalMB: 1536,
  guestRamMB: 768,
  codePackageMB: 768,
  vgaMB: 2,
  minGuestRamMB: 384,
  maxGuestRamMB: 1024,
};

function detectDeviceMemoryGB() {
  try {
    if (typeof navigator !== "undefined" && navigator.deviceMemory) {
      return Number(navigator.deviceMemory) || 4;
    }
  } catch (_) {}
  return 4; // assume mid-range if unknown
}

function planMemoryBudget() {
  const devGB = detectDeviceMemoryGB();
  // Prefer full 1 GB guest when device reports ≥4 GB; else scale down
  let guestMB = MEM_BUDGET.guestRamMB;
  let codeMB = MEM_BUDGET.codePackageMB;
  if (devGB <= 2) {
    guestMB = 512;
    codeMB = 256;
  } else if (devGB <= 4) {
    guestMB = 768;
    codeMB = 512;
  } else {
    guestMB = 1024;
    codeMB = 1024;
  }
  // Explicit override
  if (typeof window !== "undefined") {
    if (window.GOAR_GUEST_RAM_MB) guestMB = Number(window.GOAR_GUEST_RAM_MB) || guestMB;
    if (window.GOAR_CODE_CACHE_MB) codeMB = Number(window.GOAR_CODE_CACHE_MB) || codeMB;
  }
  guestMB = Math.max(MEM_BUDGET.minGuestRamMB, Math.min(2048, guestMB));
  const plan = {
    deviceMemoryGB: devGB,
    guestRamMB: guestMB,
    codePackageMB: codeMB,
    totalTargetMB: guestMB + codeMB + MEM_BUDGET.vgaMB,
    tiersMB: uniqueTiers(guestMB),
  };
  try { window.__GOAR_MEM_PLAN = plan; } catch (_) {}
  console.log("[goar] memory budget", plan);
  return plan;
}

function uniqueTiers(primaryMB) {
  const raw = [primaryMB, Math.min(primaryMB, 768), 512, 384];
  const seen = new Set();
  const out = [];
  for (const m of raw) {
    const v = Math.max(MEM_BUDGET.minGuestRamMB, m | 0);
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

async function ensureCodeCacheBudget(plan) {
  // Best-effort: query persistent storage + estimate Cache/IDB usage
  const info = { persisted: false, usageMB: null, quotaMB: null, targetMB: plan.codePackageMB };
  try {
    if (navigator.storage && navigator.storage.persist) {
      info.persisted = await navigator.storage.persist();
    }
  } catch (_) {}
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      info.usageMB = est.usage != null ? +(est.usage / 1048576).toFixed(1) : null;
      info.quotaMB = est.quota != null ? +(est.quota / 1048576).toFixed(1) : null;
    }
  } catch (_) {}
  try { window.__GOAR_CODE_CACHE = info; } catch (_) {}
  console.log("[goar] code/package cache budget", info);
  return info;
}



/** ── OPFS freeze / verified session cache ───────────────────────────────────
 * After a successful boot is verified (R/W + exec + network + agent), freeze
 * the live v86 process with save_state and store it in OPFS.
 * On next load, restore as initial_state (instant agent-ready).
 * Shipping: optional window.__EMBED_FROZEN_GZ__ or assets/goar-frozen-state.bin.gz
 */
