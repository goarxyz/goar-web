import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.GOAR_URL || "http://127.0.0.1:8080";
const shot = (n) => `/workspace/screenshots/val-${n}.png`;
const report = [];
const fail = (name, extra) => {
  report.push({ name, ok: false, extra });
  console.log("FAIL", name, extra || "");
};
const pass = (name, extra) => {
  report.push({ name, ok: true, extra });
  console.log("PASS", name, extra || "");
};

async function main() {
  mkdir();
  const browser = await chromium.launch({
    args: ["--ignore-gpu-blocklist", "--use-gl=angle", "--enable-features=SharedArrayBuffer"],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  ).newPage();

  const logs = [];
  const pageErrors = [];
  const failed = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (/wisp|mercury|openrouter|api\./i.test(u)) return;
    failed.push(`${u} ${r.failure()?.errorText || ""}`);
  });

  // 1 boot
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.screenshot({ path: shot("01-boot") });
  const boot0 = await page.evaluate(() => ({
    title: document.title,
    setup: !!document.getElementById("setup"),
    logo: !!document.querySelector(".goar-mark, #logo, img.goar-mark"),
    step: (document.getElementById("step") || {}).textContent || "",
    pct: (document.getElementById("pct") || {}).textContent || "",
  }));
  if (boot0.title && boot0.setup) pass("boot-shell", JSON.stringify(boot0));
  else fail("boot-shell", JSON.stringify(boot0));

  // wait pack + cred
  let cred = false;
  for (let i = 0; i < 50; i++) {
    cred = await page.evaluate(() => {
      const c = document.getElementById("credPhase");
      return !!(c && (c.classList.contains("on") || c.classList.contains("show") || getComputedStyle(c).display !== "none"));
    });
    if (cred) break;
    const ready = await page.evaluate(() => document.body.classList.contains("goar-ready"));
    if (ready) break;
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: shot("02-cred") });
  if (cred) pass("cred-screen");
  else {
    const st = await page.evaluate(() => ({
      step: (document.getElementById("step") || {}).textContent,
      pct: (document.getElementById("pct") || {}).textContent,
      err: (document.getElementById("err") || {}).textContent,
    }));
    fail("cred-screen", JSON.stringify(st));
  }

  const coi = await page.evaluate(() => ({
    isolated: !!self.crossOriginIsolated,
    sab: typeof SharedArrayBuffer !== "undefined",
    pack: typeof window.runJs === "function" || typeof window.ensureGecko === "function",
    geckoFn: typeof window.ensureGecko === "function",
    tools: typeof window.getAgentTools === "function" || typeof window.toolDispatch === "function" || typeof window.dispatchTool === "function",
  }));
  if (coi.sab) pass("shared-array-buffer", JSON.stringify(coi));
  else fail("shared-array-buffer", JSON.stringify(coi));
  if (coi.geckoFn) pass("gecko-api-loaded");
  else fail("gecko-api-loaded", JSON.stringify(coi));

  // 2 enter chat
  await page.evaluate(() => {
    try {
      localStorage.setItem("goar.provider", "openrouter");
      localStorage.setItem("goar.key", "sk-or-test-validate");
      localStorage.setItem("goar.model", "openrouter/auto");
    } catch (_) {}
    const go = document.getElementById("credGo") || document.getElementById("btn-go") || document.querySelector("#credPhase button");
    if (go) {
      go.disabled = false;
      go.click();
    }
    if (typeof finishEnterChat === "function") finishEnterChat();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("03-chat") });
  const chat = await page.evaluate(() => ({
    chat: !!document.getElementById("chat"),
    input: !!(document.getElementById("composer") || document.getElementById("input") || document.querySelector("textarea")),
    hiddenSetup: (() => {
      const s = document.getElementById("setup");
      if (!s) return true;
      const st = getComputedStyle(s);
      return st.display === "none" || st.visibility === "hidden" || s.classList.contains("off") || !s.classList.contains("on");
    })(),
    rail: document.querySelectorAll(".rail-btn, [data-view]").length,
  }));
  if (chat.chat && chat.input) pass("chat-shell", JSON.stringify(chat));
  else fail("chat-shell", JSON.stringify(chat));

  // 3 rail / views
  const views = ["computer", "files", "term", "chat"];
  for (const v of views) {
    await page.evaluate((view) => {
      if (typeof goarShowView === "function") goarShowView(view);
      else document.querySelector(`[data-view="${view}"]`)?.click();
    }, v);
    await page.waitForTimeout(700);
    const st = await page.evaluate((view) => {
      const map = {
        computer: "browser-tab",
        files: "files-sheet-overlay",
        term: "term-tab",
        chat: "chat",
      };
      const id = map[view];
      const el = document.getElementById(id);
      const vis = el
        ? el.classList.contains("open") ||
          el.classList.contains("view-active") ||
          el.classList.contains("active") ||
          getComputedStyle(el).display !== "none"
        : false;
      return {
        vis,
        display: el ? getComputedStyle(el).display : "missing",
        body: [...document.body.classList],
      };
    }, v);
    await page.screenshot({ path: shot(`04-view-${v}`) });
    if (st.vis || (v === "chat" && st.display !== "none")) pass("view-" + v, JSON.stringify(st));
    else fail("view-" + v, JSON.stringify(st));
  }

  // 4 settings
  const settings = await page.evaluate(() => {
    const btn = document.getElementById("btn-settings") || document.getElementById("menu-settings") || document.querySelector("[data-action=settings]");
    if (btn) btn.click();
    else if (typeof openSettings === "function") openSettings();
    const box = document.getElementById("settings");
    return {
      exists: !!box,
      open: !!(box && (box.classList.contains("open") || getComputedStyle(box).display !== "none")),
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("05-settings") });
  if (settings.exists && settings.open) pass("settings");
  else fail("settings", JSON.stringify(settings));
  await page.evaluate(() => {
    document.getElementById("btnCloseSettings")?.click();
    const box = document.getElementById("settings");
    if (box) box.classList.remove("open");
  });

  // 5 gecko / computer
  await page.evaluate(() => {
    if (typeof goarShowView === "function") goarShowView("computer");
  });
  let gecko = {};
  for (let i = 0; i < 40; i++) {
    gecko = await page.evaluate(() => {
      const st = typeof geckoStatus === "function" ? geckoStatus() : null;
      const frame = document.getElementById("geckoChromeFrame");
      let inner = null;
      try {
        const win = frame && frame.contentWindow;
        const doc = frame && frame.contentDocument;
        inner = {
          geckoLoad: !!(win && typeof win.geckoLoad === "function"),
          splash: !!(doc && doc.getElementById("splash")),
          title: doc && doc.title,
        };
      } catch (e) {
        inner = { error: String(e.message || e) };
      }
      const r = frame ? frame.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        st,
        frame: !!frame,
        frameDisplay: frame ? getComputedStyle(frame).display : "none",
        w: Math.round(r.width),
        h: Math.round(r.height),
        inner,
        tab: document.getElementById("browser-tab")?.classList.contains("open"),
      };
    });
    if (i % 8 === 0) console.log("gecko-tick", i, JSON.stringify(gecko.st || gecko.inner));
    if (gecko.inner && gecko.inner.geckoLoad && gecko.w > 400) break;
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: shot("06-computer") });
  if (gecko.tab && gecko.frame && gecko.w > 400) pass("computer-frame", `${gecko.w}x${gecko.h} ready=${gecko.st && gecko.st.ready}`);
  else fail("computer-frame", JSON.stringify(gecko));
  if (gecko.st && gecko.st.ready) pass("gecko-ready", gecko.st.note || gecko.st.mode);
  else fail("gecko-ready", JSON.stringify(gecko.st));
  if (gecko.inner && gecko.inner.geckoLoad) pass("gecko-load-fn");
  else fail("gecko-load-fn", JSON.stringify(gecko.inner));

  // 6 tools
  const tools = await page.evaluate(async () => {
    const out = {};
    try {
      if (typeof geckoStatus === "function") out.geckoStatus = geckoStatus();
    } catch (e) {
      out.geckoStatus = String(e);
    }
    try {
      if (typeof toolThink === "function") out.think = await toolThink({ text: "validate" });
      else if (typeof dispatchTool === "function") out.think = await dispatchTool("think", { text: "validate" });
    } catch (e) {
      out.think = String(e.message || e);
    }
    try {
      if (typeof getAgentTools === "function") {
        const t = getAgentTools();
        out.toolCount = Array.isArray(t) ? t.length : t && t.length;
        out.toolNames = Array.isArray(t) ? t.map((x) => x.function?.name || x.name).slice(0, 20) : [];
      }
    } catch (e) {
      out.toolCount = String(e.message || e);
    }
    try {
      if (typeof resolveCategoryCall === "function") {
        out.kit = await resolveCategoryCall("kit", { action: "discover", query: "status" });
      } else if (typeof toolKit === "function") {
        out.kit = await toolKit({ action: "discover", query: "status" });
      }
    } catch (e) {
      out.kit = String(e.message || e);
    }
    return out;
  });
  if (tools.toolCount && tools.toolCount > 0) pass("agent-tools", `${tools.toolCount} ${JSON.stringify(tools.toolNames)}`);
  else fail("agent-tools", JSON.stringify(tools));
  if (tools.think && (tools.think.ok !== false)) pass("tool-think");
  else fail("tool-think", JSON.stringify(tools.think));

  // 7 terminal
  await page.evaluate(() => {
    if (typeof goarShowView === "function") goarShowView("term");
  });
  await page.waitForTimeout(800);
  const term = await page.evaluate(() => {
    const tab = document.getElementById("term-tab");
    const el = document.getElementById("terminal");
    return {
      tabOpen: !!(tab && (tab.classList.contains("open") || getComputedStyle(tab).display !== "none")),
      term: !!el,
      live: !!(el && el.classList.contains("live")),
      xterm: !!document.querySelector(".xterm"),
    };
  });
  await page.screenshot({ path: shot("07-term") });
  if (term.tabOpen && (term.xterm || term.term)) pass("terminal", JSON.stringify(term));
  else fail("terminal", JSON.stringify(term));

  // 8 console hygiene
  const fatal = pageErrors.filter((e) => !/ResizeObserver|hydration/i.test(e));
  const badNet = failed.filter((u) => !/favicon|fonts.g|wisp\/|not%20authorized/i.test(u));
  if (fatal.length === 0) pass("no-page-errors");
  else fail("no-page-errors", fatal.slice(0, 5).join(" | "));
  if (badNet.length === 0) pass("no-asset-fails");
  else fail("no-asset-fails", badNet.slice(0, 6).join(" | "));

  const geckoLogs = logs.filter((l) => /Firefox front-end|xul_load: spun|embed-xul: READY/i.test(l));
  if (geckoLogs.length) pass("gecko-boot-logs", geckoLogs.slice(-3).join(" · "));
  else fail("gecko-boot-logs", "no Firefox boot log");

  await page.evaluate(() => {
    if (typeof goarShowView === "function") goarShowView("chat");
  });
  await page.screenshot({ path: shot("08-final-chat") });

  const summary = {
    passed: report.filter((r) => r.ok).length,
    failed: report.filter((r) => !r.ok).length,
    total: report.length,
    tests: report,
    pageErrors: fatal.slice(0, 8),
    lastLogs: logs.filter((l) => /\[error\]|pageerror|gecko|Firefox|pack/i.test(l)).slice(-20),
  };
  fs.writeFileSync("/workspace/screenshots/val-report.json", JSON.stringify(summary, null, 2));
  console.log("=== SUMMARY", summary.passed + "/" + summary.total, "failed=" + summary.failed);
  await browser.close();
  process.exit(summary.failed ? 2 : 0);
}

function mkdir() {
  fs.mkdirSync("/workspace/screenshots", { recursive: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
