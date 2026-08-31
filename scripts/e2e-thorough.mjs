#!/usr/bin/env node
/**
 * Thorough E2E — every surface: boot, cred, chat, live-work, steer/stop,
 * rail views, settings, history, files, term, browser, tools, kit, net,
 * scratch, compaction, mobile. Fixes nothing here — reports only.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const DIR = "/workspace/screenshots";
mkdirSync(DIR, { recursive: true });

const report = { pass: [], fail: [], errors: [], buckets: {} };
function mark(bucket, name, ok, detail) {
  const row = { bucket, name, ok, detail: String(detail ?? "").slice(0, 280) };
  (ok ? report.pass : report.fail).push(row);
  if (!report.buckets[bucket]) report.buckets[bucket] = { pass: 0, fail: 0 };
  report.buckets[bucket][ok ? "pass" : "fail"]++;
  console.log(ok ? "PASS" : "FAIL", bucket + "/" + name, row.detail.slice(0, 140));
}

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(25000);
page.on("pageerror", (e) => report.errors.push("page:" + String(e.message || e).slice(0, 220)));
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text();
    if (/sandbox|allow-scripts|favicon|net::ERR_BLOCKED/i.test(t)) return;
    report.errors.push("con:" + t.slice(0, 220));
  }
});

async function shot(name) {
  await page.screenshot({ path: `${DIR}/thorough-${name}.png` });
}
async function ev(fn, arg) {
  return page.evaluate(fn, arg);
}

try {
  await page.goto(BASE + (BASE.includes("?") ? "&" : "?") + "e2e=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await shot("01-boot");

  const boot0 = await ev(() => ({
    title: document.title,
    setup: !!document.getElementById("setup"),
    mark: !!document.querySelector(".goar-mark"),
    particles: !!document.getElementById("particles-js"),
    step: document.getElementById("step")?.textContent || "",
    pct: document.getElementById("pct")?.textContent || "",
  }));
  mark("boot", "shell", !!(boot0.title && boot0.setup && boot0.mark), JSON.stringify(boot0));
  mark("boot", "particles", !!boot0.particles, "canvas host");

  await page.waitForFunction(() => {
    const s = document.getElementById("step")?.textContent || "";
    const cred = document.getElementById("credPhase");
    const credOn = cred && (cred.classList.contains("on") || cred.classList.contains("show") || getComputedStyle(cred).display !== "none");
    return /Ready|Failed|Pack failed/i.test(s) || credOn || typeof paintComposerMode === "function";
  }, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot("02-ready");

  const boot1 = await ev(() => ({
    step: document.getElementById("step")?.textContent,
    pct: document.getElementById("pct")?.textContent,
    paint: typeof paintComposerMode,
    send: typeof sendCommand,
    turn: typeof agentTurn,
    tool: typeof runAgentTool,
    isolated: !!self.crossOriginIsolated,
    sab: typeof SharedArrayBuffer !== "undefined",
  }));
  mark("boot", "pack", boot1.paint === "function" && boot1.tool === "function", JSON.stringify(boot1));
  mark("boot", "isolation", !!(boot1.isolated && boot1.sab), JSON.stringify({ isolated: boot1.isolated, sab: boot1.sab }));

  await ev(() => {
    try {
      if (typeof saveSettings === "function") {
        saveSettings({
          provider: "freeai",
          apiKey: "",
          apiModel: "qwen7b",
          apiBase: "",
        });
      }
    } catch (_) {}
    if (typeof finishEnterChat === "function") finishEnterChat();
    document.body.classList.add("goar-ready");
    document.getElementById("setup")?.classList.add("hide");
    const app = document.getElementById("app");
    if (app) {
      app.classList.add("show");
      app.style.display = "flex";
    }
    if (typeof goarShowView === "function") goarShowView("chat");
  });
  await page.waitForTimeout(500);
  await shot("03-chat");

  const chat = await ev(() => {
    const input = document.getElementById("msg-input");
    const welcome = document.querySelector("#welcome .w-sub");
    const live = document.getElementById("live-work");
    const abort = document.getElementById("abortBtn");
    const send = document.getElementById("send-btn");
    const app = document.getElementById("app");
    return {
      app: app && getComputedStyle(app).display !== "none",
      placeholder: input?.placeholder || "",
      welcome: welcome?.textContent || "",
      live: !!live,
      liveHidden: live ? live.hidden : null,
      abort: !!abort,
      send: !!send,
      chips: document.querySelectorAll(".w-chip").length,
    };
  });
  mark("chat", "visible", !!chat.app, JSON.stringify(chat));
  mark("chat", "placeholder", chat.placeholder === "Request Anything", chat.placeholder);
  mark("chat", "welcome", /Request Anything/i.test(chat.welcome), chat.welcome);
  mark("chat", "live-dom", !!(chat.live && chat.abort), JSON.stringify(chat));
  mark("chat", "chips", chat.chips >= 3, String(chat.chips));

  await page.fill("#msg-input", "ping thorough");
  mark("chat", "type", (await page.inputValue("#msg-input")).includes("ping"), "typed");
  await ev(() => {
    const el = document.getElementById("msg-input");
    if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
  });

  const live = await ev(() => {
    agentBusy = true;
    setRunningUI(true, "write /workspace/scanner.py");
    const liveEl = document.getElementById("live-work");
    const send = document.getElementById("send-btn");
    const input = document.getElementById("msg-input");
    return {
      hidden: liveEl.hidden,
      text: document.getElementById("live-work-text")?.textContent || "",
      stop: send.classList.contains("is-stop"),
      label: send.getAttribute("aria-label"),
      ph: input.placeholder,
    };
  });
  await shot("04-live-work");
  mark("live", "strip-visible", live.hidden === false, JSON.stringify(live));
  mark("live", "label-tool", /write \/workspace\/scanner\.py/i.test(live.text), live.text);
  mark("live", "send-is-stop", live.stop === true && live.label === "Stop", live.label);
  mark("live", "placeholder-steer", /Add context/i.test(live.ph), live.ph);

  const steer = await ev(async () => {
    const input = document.getElementById("msg-input");
    input.value = "also write tests";
    paintComposerMode();
    const mid = document.getElementById("send-btn").classList.contains("is-stop");
    await sendCommand();
    return {
      midStop: mid,
      queue: window.__GOAR_STEER || [],
      afterStop: document.getElementById("send-btn").classList.contains("is-stop"),
    };
  });
  mark("live", "steer-queue", Array.isArray(steer.queue) && steer.queue.some((x) => /tests/i.test(x)), JSON.stringify(steer));
  mark("live", "typed-becomes-send", steer.midStop === false, JSON.stringify(steer));

  const stop = await ev(() => {
    requestAgentStop();
    return { abort: !!agentAbort, text: document.getElementById("live-work-text")?.textContent };
  });
  mark("live", "stop", stop.abort === true, JSON.stringify(stop));
  await ev(() => {
    agentBusy = false;
    agentAbort = false;
    window.__GOAR_STEER = [];
    setRunningUI(false, "");
  });

  const views = [
    ["computer", "#browser-tab"],
    ["term", "#term-tab"],
    ["ide", "#ide-shell"],
    ["chat", "#chat"],
  ];
  for (const [view, sel] of views) {
    const vis = await ev(({ view, sel }) => {
      goarShowView(view);
      const el = document.querySelector(sel);
      if (!el) return { missing: true };
      const cs = getComputedStyle(el);
      return {
        display: cs.display,
        open: el.classList.contains("open") || el.classList.contains("active") || el.classList.contains("view-active"),
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
    }, { view, sel });
    await page.waitForTimeout(280);
    await shot("view-" + view);
    const ok = view === "chat" ? vis.w > 200 : (vis.open && vis.w > 80 && vis.display !== "none");
    mark("nav", view, ok, JSON.stringify(vis));
  }

  const rail = await ev(() => {
    const btns = [...document.querySelectorAll(".rail-btn[data-view]")].map((b) => b.getAttribute("data-view"));
    return {
      btns,
      hist: !!document.getElementById("btn-history"),
      neu: !!document.getElementById("btn-new"),
      settings: !!document.getElementById("btn-settings"),
    };
  });
  mark("nav", "rail", rail.btns.includes("chat") && rail.btns.includes("computer") && rail.hist && rail.settings, JSON.stringify(rail));

  const hist = await ev(() => {
    if (typeof toggleHistory === "function") toggleHistory(true);
    else document.getElementById("btn-history")?.click();
    const ov = document.getElementById("history-overlay");
    const cs = ov ? getComputedStyle(ov) : {};
    const open = !!(ov && ov.classList.contains("open") && cs.display !== "none");
    return { open, display: cs.display, list: !!document.getElementById("history-list") };
  });
  await shot("05-history");
  mark("nav", "history", hist.open && hist.list, JSON.stringify(hist));
  await ev(() => { if (typeof toggleHistory === "function") toggleHistory(false); });

  const settings = await ev(() => {
    if (typeof openSettings === "function") openSettings();
    const box = document.getElementById("settings");
    const cs = box ? getComputedStyle(box) : {};
    const st = {
      open: box?.classList.contains("open") || cs.display === "flex",
      display: cs.display,
      provider: !!(document.getElementById("provider") || document.getElementById("apiProvider") || document.querySelector("#settings select")),
      key: !!(document.getElementById("apiKey") || document.getElementById("cfg-provider-key")),
    };
    if (typeof closeSettings === "function") closeSettings();
    else box?.classList.remove("open");
    return st;
  });
  await shot("06-settings");
  mark("nav", "settings", settings.open && settings.provider, JSON.stringify(settings));

  await ev(() => { goarShowView("chat"); });

  const guestUp = await page.waitForFunction(
    () => !!(window.__emulator && typeof guestExec === "function"),
    null,
    { timeout: 40000 },
  ).then(() => true).catch(() => false);
  mark("term", "emulator", guestUp, guestUp ? "serial ready" : "no __emulator");

  await ev(() => goarShowView("term"));
  await page.waitForTimeout(400);
  const termVis = await ev(() => {
    const tab = document.getElementById("term-tab");
    const termEl = document.getElementById("terminal");
    return {
      open: tab && (tab.classList.contains("open") || tab.classList.contains("active") || tab.classList.contains("view-active")),
      h: termEl?.offsetHeight || 0,
    };
  });
  await shot("07-term");
  mark("term", "view", !!(termVis.open && termVis.h > 30), JSON.stringify(termVis));

  if (guestUp) {
    const echo = await ev(async () => {
      try { return await guestExec("echo GOAR_TERM_OK; uname -s; pwd", 25000); }
      catch (e) { return { error: String(e) }; }
    });
    mark("term", "echo", /GOAR_TERM_OK/.test(JSON.stringify(echo)), JSON.stringify(echo).slice(0, 160));
    const py = await ev(async () => {
      try {
        const a = await guestExec('python3 -c "print(40+2)"', 30000);
        const b = await guestExec("python3 -c 'print(7*6)'", 30000);
        return { a, b };
      } catch (e) { return { error: String(e) }; }
    });
    const pyOk = /42/.test(JSON.stringify(py && py.a)) && /42/.test(JSON.stringify(py && py.b));
    mark("term", "python3", pyOk, JSON.stringify(py).slice(0, 220));
  }

  await ev(() => goarShowView("computer"));
  await page.waitForTimeout(1400);
  const br = await ev(() => {
    const tab = document.getElementById("browser-tab");
    const url = document.getElementById("browser-url");
    const frame = document.getElementById("goar-live-frame") || document.querySelector("#browser-frame-wrap iframe");
    return {
      open: tab && (tab.classList.contains("open") || tab.classList.contains("active") || tab.classList.contains("view-active")),
      url: url?.value || "",
      frame: !!(frame && frame.offsetWidth > 40),
      fw: frame?.offsetWidth || 0,
      fh: frame?.offsetHeight || 0,
    };
  });
  await shot("08-browser");
  mark("browser", "chrome", !!(br.open && (br.url || br.frame)), JSON.stringify(br));

  const nav = await ev(async () => {
    if (typeof geckoLoad === "function") await geckoLoad("https://example.com/");
    else if (typeof window.goarLiveNav === "function") await window.goarLiveNav("https://example.com/");
    await new Promise((r) => setTimeout(r, 1800));
    return {
      url: document.getElementById("browser-url")?.value || "",
      title: document.getElementById("ff-tab-title")?.textContent || "",
    };
  });
  await shot("09-example");
  mark("browser", "navigate", /example|duckduckgo/i.test(nav.url + " " + nav.title), JSON.stringify(nav));

  const agentBr = await ev(async () => {
    if (typeof runAgentTool !== "function") return { missing: true };
    try {
      const st = await runAgentTool("gecko_status", {});
      const load = await runAgentTool("gecko_load", { url: "https://example.com/" });
      return { st: String(st).slice(0, 180), load: String(load).slice(0, 180) };
    } catch (e) { return { error: String(e) }; }
  });
  mark("browser", "agent-control", !agentBr.missing && !/not loaded|is not defined/i.test(JSON.stringify(agentBr)), JSON.stringify(agentBr).slice(0, 200));

  await ev(() => goarShowView("ide"));
  await page.waitForTimeout(400);
  const files = await ev(() => {
    const shell = document.getElementById("ide-shell");
    return {
      open: shell && (shell.classList.contains("open") || shell.classList.contains("active")),
      tree: !!(document.getElementById("ide-tree") || document.getElementById("file-tree") || document.getElementById("files-list")),
      editor: !!(document.getElementById("ide-editor") || document.querySelector("#ide-shell textarea")),
    };
  });
  await shot("10-files");
  mark("files", "view", !!files.open, JSON.stringify(files));

  await ev(() => goarShowView("chat"));

  const CORE = [
    ["think", { text: "thorough check" }],
    ["todo", { action: "list" }],
    ["create_plan", { title: "thorough", steps: ["a", "b"] }],
    ["env_info", {}],
    ["list_session_tools", {}],
    ["mw_status", {}],
    ["browser_status", {}],
    ["gecko_status", {}],
    ["kit", { action: "discover", query: "hash" }],
    ["kv", { action: "kv_status" }],
    ["net", { action: "gecko_status" }],
    ["scratch", { action: "read" }],
  ];
  if (guestUp) {
    CORE.push(
      ["bash", { command: "echo BASH_OK" }],
      ["python_exec", { code: "print('PY_OK', 6*7)" }],
      ["write_file", { path: "/workspace/thorough_e2e.txt", content: "hello-thorough\n" }],
      ["read_file", { path: "/workspace/thorough_e2e.txt" }],
      ["list_dir", { path: "/workspace" }],
      ["mkdir", { path: "/workspace/thorough_dir" }],
      ["workspace_tree", { path: "/workspace" }],
      ["guest", { action: "bash", command: "echo GUEST_OK" }],
    );
  }
  for (const [name, args] of CORE) {
    const r = await ev(async ({ name, args }) => {
      try {
        const out = await runAgentTool(name, args);
        return { out: typeof out === "string" ? out : JSON.stringify(out) };
      } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
    }, { name, args });
    const text = r.out || r.error || JSON.stringify(r);
    const bad = r.error || /TOOL_ERROR|is not defined|TypeError/i.test(text);
    mark("tools", name, !bad || /ok["']?\s*:\s*true/i.test(text), text);
  }

  const aliases = await ev(() => {
    const fn = typeof resolvePysecToolId === "function" ? resolvePysecToolId : null;
    if (!fn) return { missing: true };
    return {
      hash: fn("hash", { data: "goar" }),
      sha: fn("hash.sha256", { data: "goar" }),
      b64: fn("codec.b64", { data: "goar", action: "encode" }),
    };
  });
  mark("kit", "alias-hash", !aliases.missing && aliases.hash && aliases.hash.id === "hash.digest", JSON.stringify(aliases.hash || aliases));
  mark("kit", "alias-sha256", !aliases.missing && aliases.sha && aliases.sha.id === "hash.digest" && String((aliases.sha.kwargs || {}).algorithm) === "sha256", JSON.stringify(aliases.sha || aliases));
  mark("kit", "alias-b64", !aliases.missing && aliases.b64 && aliases.b64.id === "codec.encode" && String((aliases.b64.kwargs || {}).format) === "base64", JSON.stringify(aliases.b64 || aliases));

  const kitReady = await ev(async () => {
    try {
      if (typeof ensurePysecWorker === "function") await ensurePysecWorker();
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }
    return { ready: !!(window.__pysecReady || (typeof __pysecReady !== "undefined" && __pysecReady)) };
  });
  mark("kit", "pysec-ready", !!(kitReady && kitReady.ready), JSON.stringify(kitReady));

  const PYSEC = [
    ["pysec_crypto", { tool: "hash", kwargs: { algo: "sha256", data: "goar" } }],
    ["pysec", { tool_id: "codec.b64", kwargs: { action: "encode", data: "goar" } }],
    ["pysec", { tool_id: "hash.sha256", kwargs: { data: "goar" } }],
  ];
  for (const [name, args] of PYSEC) {
    const r = await ev(async ({ name, args }) => {
      try {
        const out = await runAgentTool(name, args);
        return { out: typeof out === "string" ? out : JSON.stringify(out) };
      } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
    }, { name, args });
    const text = r.out || r.error || JSON.stringify(r);
    const id = args.tool_id || args.tool || "x";
    const digest = "01858a949a488cf675f20f3896d6f960e4753f3f0808b1cdebcd3984dacdfded";
    const digestOk = text.indexOf(digest) !== -1 && /ok["']?\s*:\s*true/i.test(text);
    const b64Ok = /Z29hcg==/.test(text) && !/unknown tool/i.test(text);
    const ok = !r.error && !/TOOL_ERROR|not defined|unknown tool/i.test(text) &&
      (id === "codec.b64" ? b64Ok : digestOk);
    mark("kit", name + ":" + id, ok, text.slice(0, 280));
  }

  const loop = await ev(() => ({
    turn: typeof agentTurn === "function",
    compact: typeof maybeCompactAgentHistory === "function" || typeof maybeCompactAgentHistoryAsync === "function",
    pin: typeof pinMission === "function",
    steer: typeof queueSteer === "function" && typeof drainSteers === "function",
    middleware: typeof runVibeBeforeTurn === "function",
    tools: (typeof getAgentTools === "function" ? getAgentTools() : []).length,
  }));
  mark("loop", "turn", loop.turn, JSON.stringify(loop));
  mark("loop", "compact", loop.compact, JSON.stringify(loop));
  mark("loop", "steer-api", loop.steer, JSON.stringify(loop));
  mark("loop", "middleware", loop.middleware, JSON.stringify(loop));
  mark("loop", "tool-count", loop.tools > 0 && loop.tools <= 128, String(loop.tools));

  const net = await ev(() => ({
    fabric: typeof goarHostFetch === "function" || typeof mwFetch === "function" || !!window.__GOAR_FABRIC,
    gecko: typeof geckoLoad === "function",
    live: typeof window.goarLiveNav === "function" || !!document.getElementById("goar-live-frame"),
  }));
  mark("net", "fabric", !!net.fabric, JSON.stringify(net));
  mark("net", "gecko-fn", !!net.gecko, JSON.stringify(net));

  // mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await ev(() => goarShowView("chat"));
  await page.waitForTimeout(300);
  const mobile = await ev(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    input: !!document.getElementById("msg-input"),
    rail: (document.getElementById("side-rail")?.offsetWidth || 0) > 30,
  }));
  await shot("11-mobile");
  mark("mobile", "no-overflow", mobile.overflow === false, JSON.stringify(mobile));
  mark("mobile", "composer", !!mobile.input, JSON.stringify(mobile));

  await ev(() => {
    agentBusy = true;
    setRunningUI(true, "Thinking");
  });
  await shot("12-mobile-live");
  const mobLive = await ev(() => ({
    hidden: document.getElementById("live-work")?.hidden,
    text: document.getElementById("live-work-text")?.textContent,
  }));
  mark("mobile", "live-strip", mobLive.hidden === false, JSON.stringify(mobLive));
  await ev(() => { agentBusy = false; setRunningUI(false, ""); });

  const fatal = report.errors.filter((e) => /Uncaught|TypeError|ReferenceError|is not defined/i.test(e));
  mark("console", "no-fatal", fatal.length === 0, fatal.slice(0, 4).join(" | ") || "clean");

} catch (e) {
  mark("runner", "crash", false, e && e.message ? e.message : String(e));
}

const total = report.pass.length + report.fail.length;
const summary = {
  pass: report.pass.length,
  fail: report.fail.length,
  total,
  buckets: report.buckets,
  fails: report.fail,
  errors: report.errors.slice(0, 16),
};
writeFileSync(DIR + "/thorough-report.json", JSON.stringify(summary, null, 2));
console.log("\n==== THOROUGH", report.pass.length + "/" + total, "fail", report.fail.length, "====");
console.log(JSON.stringify(summary, null, 2));
await browser.close();
process.exit(report.fail.length ? 1 : 0);
