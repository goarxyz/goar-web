/**
 * Design chrome ↔ live GOAR: panels, gecko browser host, empty state, provider bar.
 * Gecko mounts into #browser-frame-wrap (always-on plane F).
 */
(function () {
  "use strict";

  function $(s, r) {
    return (r || document).querySelector(s);
  }

  function termLog(cls, text) {
    try {
      if (typeof window.term !== "undefined" && window.term && window.term.writeln) {
        window.term.writeln("\x1b[90m" + text + "\x1b[0m");
        return;
      }
    } catch (_) {}
    const side = document.getElementById("side-log");
    if (side) {
      const line = document.createElement("div");
      line.className = "line " + (cls || "");
      line.textContent = text;
      side.appendChild(line);
      side.scrollTop = side.scrollHeight;
    }
    console.log("[goar]", text);
  }

  function setGeckoPill(msg) {
    const el = $("#gecko-status-pill");
    if (el) el.textContent = msg;
  }

  let geckoMode = (window.GOAR_GECKO_MODE || "chrome").toLowerCase();

  function setModeBtn() {
    const b = $("#browser-mode");
    if (b) b.textContent = geckoMode === "chrome" ? "firefox ui" : "embed";
  }

  async function warmGecko() {
    if (typeof ensureGecko !== "function") {
      setGeckoPill("gecko-plane not loaded");
      return null;
    }
    try {
      setGeckoPill("booting " + geckoMode + "…");
      const st = await ensureGecko({ mode: geckoMode, show: false });
      if (st && st.ready) {
        setGeckoPill("on · " + (st.mode || geckoMode) + " · " + (st.host || "host"));
        termLog("meta", "gecko on · " + (st.mode || geckoMode));
      } else {
        setGeckoPill((st && st.lastError) || "warming / need COI");
      }
      return st;
    } catch (e) {
      setGeckoPill(String(e.message || e));
      return null;
    }
  }

  function openPanel(which) {
    if (typeof goarShowView === "function" && which === "browser") {
      goarShowView("computer");
      return;
    }
    const app = document.getElementById("app");
    if (app) app.classList.add("panel-open");
    document.querySelectorAll(".panel-tab").forEach((t) => {
      t.classList.toggle("on", t.dataset.panel === which);
    });
    document.querySelectorAll(".panel-view").forEach((v) => v.classList.remove("on"));
    const view = document.getElementById(which === "browser" ? "view-browser" : "view-term");
    if (view) view.classList.add("on");
    $("#btn-term")?.classList.toggle("on", which === "term");
    $("#btn-browser")?.classList.toggle("on", which === "browser");
    if (which === "browser") warmGecko();
    if (which === "term") {
      try {
        if (window.term && window.term.focus) window.term.focus();
        // refit xterm when panel opens
        if (window.__goarTermFit) window.__goarTermFit();
      } catch (_) {}
    }
  }

  function closePanel() {
    document.getElementById("app")?.classList.remove("panel-open");
    $("#btn-term")?.classList.remove("on");
    $("#btn-browser")?.classList.remove("on");
  }

  async function navigateBrowser(url) {
    const browserUrl = $("#browser-url");
    const browserHint = $("#browser-hint");
    const browserFrame = $("#browser-frame");
    let u = (url || (browserUrl && browserUrl.value) || "").trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u) && !/^data:/i.test(u)) u = "https://" + u;
    if (browserUrl) browserUrl.value = u;
    browserHint?.classList.add("hide");
    openPanel("browser");

    if (typeof ensureGecko === "function") {
      try {
        const st = await ensureGecko({ mode: geckoMode, url: u, show: true });
        if (st && st.ready) {
          if (typeof geckoLoad === "function") await geckoLoad(u);
          setGeckoPill("on · " + (st.mode || geckoMode) + " · " + u.slice(0, 40));
          termLog("meta", "gecko → " + u);
          if (browserFrame) browserFrame.style.display = "none";
          return;
        }
        setGeckoPill((st && st.lastError) || "gecko not ready");
        termLog("meta", "gecko not ready · " + ((st && st.lastError) || ""));
      } catch (e) {
        termLog("meta", "gecko fail · " + (e.message || e));
        setGeckoPill(String(e.message || e));
      }
    }

    if (browserFrame) {
      browserFrame.style.display = "block";
      browserFrame.src = u;
      termLog("meta", "iframe degrade → " + u);
      setGeckoPill("iframe fallback");
    }
  }

  function wirePanels() {
    $("#btn-term")?.addEventListener("click", () => {
      const app = document.getElementById("app");
      if (app?.classList.contains("panel-open") && $("#view-term")?.classList.contains("on")) closePanel();
      else openPanel("term");
    });
    $("#btn-browser")?.addEventListener("click", () => {
      const app = document.getElementById("app");
      if (app?.classList.contains("panel-open") && $("#view-browser")?.classList.contains("on")) closePanel();
      else openPanel("browser");
    });
    document.querySelectorAll(".panel-tab").forEach((tab) => {
      tab.addEventListener("click", () => openPanel(tab.dataset.panel));
    });
    $("#btn-panel-close")?.addEventListener("click", closePanel);
    $("#btn-panel-clear")?.addEventListener("click", () => {
      if ($("#view-term")?.classList.contains("on")) {
        try {
          if (window.term) window.term.clear();
        } catch (_) {}
      }
      if ($("#view-browser")?.classList.contains("on")) {
        try {
          if (typeof geckoHide === "function") geckoHide();
        } catch (_) {}
        document.getElementById("geckoPane")?.remove();
        const bf = $("#browser-frame");
        if (bf) {
          bf.src = "about:blank";
          bf.style.display = "none";
        }
        $("#browser-hint")?.classList.remove("hide");
        setGeckoPill("cleared");
      }
    });

    $("#browser-go")?.addEventListener("click", () => navigateBrowser());
    $("#browser-url")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") navigateBrowser();
    });
    $("#browser-mode")?.addEventListener("click", async () => {
      geckoMode = geckoMode === "chrome" ? "embed" : "chrome";
      window.GOAR_GECKO_MODE = geckoMode;
      setModeBtn();
      // force re-init by clearing ready via hide + ensure with new mode
      try {
        document.getElementById("geckoPane")?.remove();
      } catch (_) {}
      // reset plane state by reloading path — ensureGecko checks STATE.ready+mode
      if (typeof ensureGecko === "function") {
        // poke internal by calling with new mode after nulling globals
        if (typeof geckoReset === "function") geckoReset();
      }
      await warmGecko();
      const u = $("#browser-url")?.value;
      if (u) navigateBrowser(u);
    });
    $("#browser-reload")?.addEventListener("click", () => {
      const u = $("#browser-url")?.value;
      if (u) navigateBrowser(u);
    });
  }

  function wireProviderBar() {
    const sel = $("#provider-select");
    const token = $("#token-input");
    const model = $("#model-input");
    const status = $("#provider-status");
    const save = $("#btn-save-provider");
    if (!sel && !token) return;

    try {
      if (typeof fillProviderSelect === "function") fillProviderSelect(sel);
    } catch (_) {}

    try {
      if (typeof loadSettings === "function") {
        const s = loadSettings();
        if (sel && s.provider) sel.value = s.provider;
        if (token && s.apiKey) token.value = s.apiKey;
        if (status) {
          const noKey = typeof providerAllowsEmptyKey === "function" ? providerAllowsEmptyKey(s.provider) : !s.apiKey;
          status.textContent = s.apiKey ? "key set" : (noKey ? "Free.ai demo" : "no key");
          status.classList.toggle("ok", !!(s.apiKey || noKey));
        }
        if ((s.apiKey || (typeof providerAllowsEmptyKey === "function" && providerAllowsEmptyKey(s.provider))) && typeof fetchModels === "function") {
          fetchModels({ provider: s.provider, apiBase: s.apiBase, apiKey: s.apiKey })
            .then((ids) => {
              if (typeof syncInAppProviderBar === "function") {
                syncInAppProviderBar(s.provider, s.apiKey, s.apiModel, ids);
              }
            })
            .catch(() => {});
        }
      }
    } catch (_) {}

    async function saveBar() {
      try {
        const provider = sel?.value || "";
        const apiKey = token?.value?.trim() || "";
        let apiBase = "";
        try {
          const prov = typeof getProvider === "function" ? getProvider(provider) : null;
          apiBase = (prov && prov.apiBase) || "";
        } catch (_) {}
        if (status) status.textContent = "querying /models…";
        const ids = (apiKey || (typeof providerAllowsEmptyKey === "function" && providerAllowsEmptyKey(provider)) || provider === "ollama")
          ? await fetchModels({ provider, apiBase, apiKey })
          : [];
        let apiModel = "";
        if (model && model.tagName === "SELECT") {
          apiModel = (model.value || "").trim();
          if (!apiModel && ids[0]) apiModel = ids[0];
        } else {
          apiModel = (model?.value || "").trim();
        }
        if (!ids.length && provider !== "ollama") {
          if (status) {
            status.textContent = "models failed";
            status.classList.remove("ok");
          }
          return;
        }
        if (!apiModel || (ids.length && !ids.includes(apiModel))) apiModel = ids[0] || "";
        if (typeof saveSettings === "function") {
          saveSettings({ provider, apiKey, apiModel, apiBase });
        }
        if (typeof syncInAppProviderBar === "function") {
          syncInAppProviderBar(provider, apiKey, apiModel, ids);
        } else if (status) {
          status.textContent = ids.length + " models";
          status.classList.add("ok");
        }
        termLog("meta", "provider saved · " + provider + " · " + apiModel);
      } catch (e) {
        if (status) {
          status.textContent = String(e.message || e).slice(0, 80);
          status.classList.remove("ok");
        }
        termLog("meta", "provider save failed · " + (e.message || e));
      }
    }

    save?.addEventListener("click", () => saveBar());
    sel?.addEventListener("change", () => {
      if (token?.value) saveBar();
    });
    token?.addEventListener("change", () => saveBar());
  }


  function openMenu() {
    document.getElementById("sidebar")?.classList.add("open");
    document.getElementById("backdrop")?.classList.add("show");
  }
  function closeMenu() {
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("backdrop")?.classList.remove("show");
  }

  function fillComposer(text, sendNow) {
    const input = document.getElementById("msg-input") || document.getElementById("i");
    if (!input) return;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    if (sendNow && typeof sendCommand === "function") {
      try { sendCommand(); } catch (_) {}
    } else if (sendNow && typeof window.sendCommand === "function") {
      try { window.sendCommand(); } catch (_) {}
    }
  }

  function wireNavTools() {
    document.querySelectorAll("#nav-list .nav-item[data-q], #nav-list .nav-item[data-chip]").forEach((btn) => {
      if (btn._goarWired) return;
      btn._goarWired = true;
      btn.addEventListener("click", () => {
        const q = btn.getAttribute("data-q") || btn.getAttribute("data-chip") || "";
        const act = btn.getAttribute("data-action");
        closeMenu();
        if (act === "new") {
          document.getElementById("btn-new")?.click();
          return;
        }
        if (!q) return;
        if (q.startsWith("/")) {
          fillComposer(q, true);
          return;
        }
        // direct agent: send immediately so category is used
        fillComposer(q, true);
      });
    });
    document.querySelectorAll("#emptyState .chip[data-q], .chips .chip[data-q]").forEach((btn) => {
      if (btn._goarWired) return;
      btn._goarWired = true;
      btn.addEventListener("click", () => {
        const q = btn.getAttribute("data-q") || "";
        if (!q) return;
        fillComposer(q, true);
      });
    });
  }

  function wireChrome() {
    if (!document.getElementById("drawer-overlay")) {
      $("#btn-history")?.addEventListener("click", () => {
        if (typeof toggleHistory === "function") toggleHistory();
      });
      $("#btn-menu")?.addEventListener("click", () => {
        if (typeof toggleHistory === "function") toggleHistory();
      });
      document.getElementById("backdrop")?.addEventListener("click", () => closeMenu());
      document.getElementById("btn-sidebar-close")?.addEventListener("click", () => closeMenu());
      document.getElementById("btn-sidebar-close-foot")?.addEventListener("click", () => closeMenu());
    }
    $("#btn-theme")?.addEventListener("click", () => {
      const root = document.documentElement;
      root.setAttribute(
        "data-theme",
        root.getAttribute("data-theme") === "paper" ? "mono" : "paper"
      );
    });
    // settings owned by ghtml-shell
    $("#btn-new-legacy")?.addEventListener("click", () => {
      const chat = document.getElementById("chat");
      // keep emptyState node
      if (chat) {
        [...chat.children].forEach((n) => {
          if (n.id !== "emptyState") n.remove();
        });
      }
      const es = document.getElementById("emptyState");
      if (es) {
        es.classList.add("show", "on");
        if (!chat.contains(es)) chat.prepend(es);
      }
      closeMenu();
    });
    $("#btn-clear")?.addEventListener("click", () => {
      $("#btn-new")?.click();
    });
  }

  // Point modular agentShell at main column for layout
  function bridgeAgentShell() {
    const shell = document.getElementById("agentShell");
    const main = document.getElementById("main");
    const chat = document.getElementById("chat");
    // state.js already captured refs at parse time — rebind if global el exists
    try {
      if (typeof el === "object" && el) {
        if (!el.chat || !el.chat.isConnected) el.chat = chat;
        if (!el.input || !el.input.isConnected) el.input = document.getElementById("msg-input") || document.getElementById("i");
        if (!el.send || !el.send.isConnected) el.send = document.getElementById("send-btn") || document.getElementById("sendBtn");
        if (!el.shell || !el.shell.isConnected || el.shell.hidden) el.shell = main || shell;
        if (!el.app || !el.app.isConnected) el.app = document.getElementById("app");
      }
    } catch (_) {}
  }

  function boot() {
    setModeBtn();
    wirePanels();
    wireProviderBar();
    wireChrome();
    wireNavTools();
    bridgeAgentShell();
    // Always-on gecko warm once COI is present
    setTimeout(() => {
      warmGecko();
      try { if (typeof paintTokenMeter === "function") paintTokenMeter(); } catch (_) {}
    }, 800);
    // Re-bridge after boot finishes (DOM stable)
    setTimeout(bridgeAgentShell, 2000);
    termLog("meta", "design chrome · gecko wired to #browser-frame-wrap");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.__goarOpenBrowser = navigateBrowser;
  window.__goarWarmGecko = warmGecko;
  window.__goarOpenPanel = openPanel;
  window.__goarCloseMenu = closeMenu;
  window.__goarOpenMenu = openMenu;
})();
