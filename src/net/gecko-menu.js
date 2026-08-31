(function (global) {
  "use strict";

  const MENUS = {
    file: [
      ["new_tab", "New Tab"],
      ["open", "Open Location…"],
      ["save", "Save Page"],
      ["print", "Print"],
      ["close", "Close Tab"],
    ],
    edit: [
      ["find", "Find in Page"],
      ["select_all", "Select All"],
    ],
    view: [
      ["reload", "Reload"],
      ["zoom_in", "Zoom In"],
      ["zoom_out", "Zoom Out"],
      ["zoom_reset", "Reset Zoom"],
      ["source", "Page Source"],
    ],
    history: [
      ["back", "Back"],
      ["forward", "Forward"],
      ["recent", "Show Recent"],
    ],
    bookmarks: [
      ["bookmark", "Bookmark This Page"],
      ["bookmarks", "Show Bookmarks"],
    ],
    tools: [
      ["addons", "Extensions and themes"],
      ["downloads", "Downloads"],
      ["inspect", "Web Developer"],
      ["permissions", "Page Permissions"],
    ],
    help: [
      ["about", "About Firefox"],
      ["shortcuts", "Keyboard Shortcuts"],
    ],
    app: [
      ["new_tab", "New Tab"],
      ["history", "History"],
      ["downloads", "Downloads"],
      ["addons", "Extensions and themes"],
      ["print", "Print"],
      ["find", "Find in page"],
      ["zoom_in", "Zoom in"],
      ["zoom_out", "Zoom out"],
      ["settings", "Settings"],
      ["close", "Back to chat"],
    ],
  };

  const ADDONS = [
    { id: "dark", name: "Dark Reader", desc: "Dark pages via injected theme" },
    { id: "adblock", name: "Ad Shield", desc: "Hide common ad frames" },
    { id: "reader", name: "Reader", desc: "Simplify the current page" },
  ];

  function $(id) { return document.getElementById(id); }

  function loadState() {
    try { return JSON.parse(localStorage.getItem("goar.ff.v1") || "{}"); } catch (_) { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem("goar.ff.v1", JSON.stringify(s)); } catch (_) {}
  }
  function st() {
    const s = loadState();
    if (!s.addons) s.addons = {};
    if (!s.bookmarks) s.bookmarks = [];
    if (!s.history) s.history = [];
    return s;
  }

  function hideDrop() {
    const d = $("ff-drop");
    if (d) { d.hidden = true; d.innerHTML = ""; }
  }

  function showDrop(items, anchor) {
    const d = $("ff-drop");
    if (!d) return;
    d.innerHTML = items.map(([id, label]) =>
      '<button type="button" class="ff-mi" data-act="' + id + '">' + label + "</button>"
    ).join("");
    d.hidden = false;
    const r = anchor.getBoundingClientRect();
    const box = document.getElementById("browser-tab")?.getBoundingClientRect() || { left: 0, top: 0 };
    d.style.left = Math.max(8, r.left - box.left) + "px";
    d.style.top = (r.bottom - box.top + 4) + "px";
    d.querySelectorAll(".ff-mi").forEach((b) => {
      b.addEventListener("click", () => { hideDrop(); geckoMenu(b.getAttribute("data-act")); });
    });
  }

  function paintAddons() {
    const box = $("ffa-list");
    if (!box) return;
    const s = st();
    box.innerHTML = ADDONS.map((a) => {
      const on = !!s.addons[a.id];
      return (
        '<div class="ffa-row" data-id="' + a.id + '">' +
          "<div><b>" + a.name + "</b><span>" + a.desc + "</span></div>" +
          '<button type="button" class="ffa-tog' + (on ? " on" : "") + '">' + (on ? "On" : "Off") + "</button>" +
        "</div>"
      );
    }).join("");
    box.querySelectorAll(".ffa-row").forEach((row) => {
      row.querySelector("button")?.addEventListener("click", () => {
        const id = row.getAttribute("data-id");
        geckoAddon(id, !st().addons[id]);
      });
    });
  }

  function showAddons(on) {
    const el = $("ff-addons");
    if (!el) return;
    const show = on == null ? el.hidden : !!on;
    el.hidden = !show;
    if (show) paintAddons();
  }

  async function applyAddon(id, enabled) {
    const g = global.__GOAR_GECKO;
    if (!g || typeof g.evalChrome !== "function") return;
    if (id === "dark") {
      await g.evalChrome(enabled
        ? "document.documentElement.style.filter='invert(1) hue-rotate(180deg)';document.documentElement.style.background='#111'"
        : "document.documentElement.style.filter='';document.documentElement.style.background=''");
    } else if (id === "adblock") {
      await g.evalChrome(enabled
        ? "document.querySelectorAll('iframe,[id*=ad],[class*=ad-],[class*=sponsor]').forEach(e=>e.style.display='none')"
        : "document.querySelectorAll('iframe').forEach(e=>e.style.display='')");
    } else if (id === "reader") {
      await g.evalChrome(enabled
        ? "var a=[...document.querySelectorAll('p,h1,h2,article')].map(e=>e.innerText).join('\\n\\n');document.body.innerHTML='<article style=max-width:680px;margin:24px auto;font:20px/1.6 Georgia,serif;color:#111>'+a.replace(/[<>]/g,'')+'</article>'"
        : "location.reload()");
    }
  }

  async function geckoAddon(id, enabled) {
    const s = st();
    s.addons[id] = !!enabled;
    saveState(s);
    await applyAddon(id, !!enabled);
    paintAddons();
    return { ok: true, id, enabled: !!enabled };
  }

  async function geckoMenu(action, arg) {
    const act = String(action || "").toLowerCase();
    if (typeof goarShowView === "function" && act !== "close") goarShowView("computer");
    if (typeof geckoShow === "function") geckoShow();

    if (act === "new_tab" || act === "open") {
      const url = arg || "https://duckduckgo.com/";
      if (typeof geckoLoad === "function") await geckoLoad(url);
      return { ok: true, action: act, url };
    }
    if (act === "back") { if (typeof geckoBack === "function") await geckoBack(); return { ok: true, action: act }; }
    if (act === "forward") {
      try { await global.__GOAR_GECKO?.evalChrome("content.history.forward()"); } catch (_) {}
      return { ok: true, action: act };
    }
    if (act === "reload") { if (typeof geckoReload === "function") await geckoReload(); return { ok: true, action: act }; }
    if (act === "find") {
      const q = arg || prompt("Find in page");
      if (q && typeof geckoEval === "function") await geckoEval("window.find(" + JSON.stringify(q) + ")");
      return { ok: true, action: act, q };
    }
    if (act === "select_all") {
      if (typeof geckoEval === "function") await geckoEval("document.execCommand('selectAll')");
      return { ok: true, action: act };
    }
    if (act === "zoom_in" || act === "zoom_out" || act === "zoom_reset") {
      const s = st();
      let z = Number(s.zoom || 1);
      if (act === "zoom_in") z = Math.min(2, z + 0.1);
      if (act === "zoom_out") z = Math.max(0.5, z - 0.1);
      if (act === "zoom_reset") z = 1;
      s.zoom = z;
      saveState(s);
      if (typeof geckoEval === "function") await geckoEval("document.documentElement.style.zoom=" + z);
      return { ok: true, action: act, zoom: z };
    }
    if (act === "source") {
      if (typeof geckoEval === "function") {
        const r = await geckoEval("document.documentElement.outerHTML.slice(0,8000)");
        if (typeof appendMsg === "function") appendMsg(String(r.result || r).slice(0, 4000), "tool");
      }
      return { ok: true, action: act };
    }
    if (act === "bookmark") {
      const s = st();
      const url = $("browser-url")?.value || "";
      if (url && !s.bookmarks.includes(url)) s.bookmarks.unshift(url);
      saveState(s);
      return { ok: true, action: act, bookmarks: s.bookmarks };
    }
    if (act === "bookmarks" || act === "recent" || act === "history") {
      const s = st();
      const list = act === "bookmarks" ? s.bookmarks : s.history;
      const d = $("ff-drop");
      if (d) {
        d.innerHTML = (list || []).slice(0, 16).map((u) =>
          '<button type="button" class="ff-mi" data-url="' + String(u).replace(/"/g, "") + '">' + String(u).slice(0, 64) + "</button>"
        ).join() || '<div class="ff-mi">Empty</div>';
        d.hidden = false;
        d.querySelectorAll("[data-url]").forEach((b) => {
          b.addEventListener("click", () => { hideDrop(); geckoLoad(b.getAttribute("data-url")); });
        });
      }
      return { ok: true, action: act, items: list };
    }
    if (act === "addons") { showAddons(true); return { ok: true, action: act }; }
    if (act === "downloads") {
      if (typeof goarShowView === "function") goarShowView("ide");
      return { ok: true, action: act };
    }
    if (act === "permissions") {
      const host = (function(){ try { return new URL(document.getElementById("browser-url")?.value||"").hostname; } catch(_) { return "this site"; } })();
      if (typeof geckoPermit === "function") {
        const drop = document.getElementById("ff-drop");
        if (drop) {
          drop.innerHTML = '<button type="button" class="ff-mi" data-k="popup">Pop-ups…</button><button type="button" class="ff-mi" data-k="notifications">Notifications…</button>';
          drop.hidden = false;
        }
      }
      return { ok: true, action: act, host };
    }
    if (act === "inspect") {
      try { if (typeof ensureGeckoDev === "function") await ensureGeckoDev(); } catch (_) {}
      return { ok: true, action: act };
    }
    if (act === "settings") {
      if (typeof openSettings === "function") openSettings();
      return { ok: true, action: act };
    }
    if (act === "print" || act === "save") {
      try { window.print(); } catch (_) {}
      return { ok: true, action: act };
    }
    if (act === "about") {
      if (typeof geckoLoad === "function") await geckoLoad("https://www.mozilla.org/firefox/");
      return { ok: true, action: act };
    }
    if (act === "shortcuts") {
      if (typeof appendMsg === "function") appendMsg("Firefox: Ctrl+L location · Ctrl+R reload · Ctrl+F find · Alt+Left back", "sys");
      return { ok: true, action: act };
    }
    if (act === "close") {
      if (typeof goarShowView === "function") goarShowView("chat");
      return { ok: true, action: act };
    }
    return { ok: false, error: "unknown menu " + act };
  }

  function trackUrl(u) {
    if (!u) return;
    const s = st();
    s.history = [u].concat((s.history || []).filter((x) => x !== u)).slice(0, 40);
    saveState(s);
  }

  function wire() {
    document.querySelectorAll("#ff-menubar .ff-top").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-menu");
        showDrop(MENUS[id] || [], btn);
      });
    });
    $("ff-app")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showDrop(MENUS.app, e.currentTarget);
    });
    $("ff-ext")?.addEventListener("click", (e) => {
      e.stopPropagation();
      hideDrop();
      showAddons();
    });
    $("ffa-close")?.addEventListener("click", () => showAddons(false));
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#ff-drop, #ff-menubar, #ff-app")) hideDrop();
    });
    document.addEventListener("keydown", (e) => {
      if (!document.body.classList.contains("view-computer")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "l") { e.preventDefault(); $("browser-url")?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "r") { e.preventDefault(); geckoMenu("reload"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); geckoMenu("find"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "t") { e.preventDefault(); geckoMenu("new_tab"); }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); geckoMenu("back"); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  const prev = global.setUrlLabel;
  global.geckoMenu = geckoMenu;
  global.geckoAddon = geckoAddon;
  global.geckoAddons = () => st().addons;
  global.__goarTrackFfUrl = trackUrl;
})(typeof window !== "undefined" ? window : globalThis);
