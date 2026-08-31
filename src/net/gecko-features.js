(function (global) {
  "use strict";

  const KEY = "goar.ff.perm.v1";
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) { return {}; }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }
  function hostOf(u) {
    try { return new URL(u).hostname; } catch (_) { return String(u || "").slice(0, 80); }
  }
  function siteKey() {
    const u = document.getElementById("browser-url")?.value || (global.__GOAR_GECKO && "") || "";
    return hostOf(u || "https://duckduckgo.com/");
  }
  function perm(host, kind) {
    const s = load();
    return ((s[host] || {})[kind]) || "ask";
  }
  function setPerm(host, kind, value) {
    const s = load();
    s[host] = s[host] || {};
    s[host][kind] = value;
    save(s);
    return { host, kind, value };
  }

  const HOOK = `(function(){
    if (window.__goarHooked) return "ok";
    window.__goarHooked = true;
    window.__goarPendingPopup = null;
    window.__goarDialog = null;
    window.__goarPermAsk = null;
    var _open = window.open;
    window.open = function(url, name, feats){
      window.__goarPendingPopup = { url: String(url||""), name: String(name||""), feats: String(feats||""), ts: Date.now() };
      return null;
    };
    window.alert = function(msg){ window.__goarDialog = { type:"alert", msg: String(msg), ts: Date.now() }; };
    window.confirm = function(msg){ window.__goarDialog = { type:"confirm", msg: String(msg), ts: Date.now() }; return true; };
    window.prompt = function(msg, d){ window.__goarDialog = { type:"prompt", msg: String(msg), def: d==null?"":String(d), ts: Date.now() }; return d; };
    try {
      if (navigator.permissions && navigator.permissions.query) {
        var q = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function(desc){
          return q(desc).catch(function(){ return { state: "prompt", onchange: null }; });
        };
      }
    } catch(e) {}
    try {
      if (window.Notification) {
        var _req = Notification.requestPermission.bind(Notification);
        Notification.requestPermission = function(cb){
          window.__goarPermAsk = { kind: "notifications", ts: Date.now() };
          if (cb) try { cb("default"); } catch(e) {}
          return Promise.resolve("default");
        };
      }
    } catch(e) {}
    return "ok";
  })()`;

  async function injectHooks() {
    const g = global.__GOAR_GECKO;
    if (!g || typeof g.evalChrome !== "function") return false;
    try {
      await g.evalChrome(HOOK);
      return true;
    } catch (_) {
      return false;
    }
  }

  function bar() { return document.getElementById("ff-notify"); }
  function hideBar() {
    const el = bar();
    if (el) { el.hidden = true; el.dataset.kind = ""; }
  }
  function showBar(kind, host, extra) {
    const el = bar();
    if (!el) return;
    el.hidden = false;
    el.dataset.kind = kind;
    el.dataset.host = host || "";
    el.dataset.extra = extra || "";
    const msg = el.querySelector(".ffn-msg");
    const allow = el.querySelector(".ffn-allow");
    if (kind === "popup") {
      if (msg) msg.textContent = "Firefox prevented this site from opening a pop-up window.";
      if (allow) allow.textContent = "Allow pop-ups for " + (host || "this site");
    } else if (kind === "notifications") {
      if (msg) msg.textContent = host + " wants to send notifications.";
      if (allow) allow.textContent = "Allow";
    } else if (kind === "geolocation") {
      if (msg) msg.textContent = host + " wants to know your location.";
      if (allow) allow.textContent = "Allow";
    } else {
      if (msg) msg.textContent = host + " wants permission: " + kind;
      if (allow) allow.textContent = "Allow";
    }
  }

  async function pollEngine() {
    const g = global.__GOAR_GECKO;
    if (!g || typeof g.evalChrome !== "function") return;
    let raw = "";
    try {
      raw = await g.evalChrome(
        "JSON.stringify({p:window.__goarPendingPopup,d:window.__goarDialog,a:window.__goarPermAsk,hooked:!!window.__goarHooked})"
      );
    } catch (_) {
      return;
    }
    let st = null;
    try { st = JSON.parse(String(raw || "{}")); } catch (_) { return; }
    if (!st || !st.hooked) {
      await injectHooks();
      return;
    }
    const host = siteKey();
    if (st.p && st.p.url) {
      try { await g.evalChrome("window.__goarPendingPopup=null"); } catch (_) {}
      const allowed = perm(host, "popup") === "allow";
      if (allowed) {
        if (typeof geckoLoad === "function") await geckoLoad(st.p.url);
      } else if (perm(host, "popup") !== "block") {
        showBar("popup", host, st.p.url);
      }
    }
    if (st.a && st.a.kind) {
      try { await g.evalChrome("window.__goarPermAsk=null"); } catch (_) {}
      if (perm(host, st.a.kind) === "ask") showBar(st.a.kind, host, "");
    }
    if (st.d && st.d.msg) {
      try { await g.evalChrome("window.__goarDialog=null"); } catch (_) {}
      showDialog(st.d);
    }
  }

  function showDialog(d) {
    let box = document.getElementById("ff-dialog");
    if (!box) return;
    box.hidden = false;
    box.querySelector(".ffd-msg").textContent = d.msg || "";
    const input = box.querySelector(".ffd-input");
    if (input) {
      input.hidden = d.type !== "prompt";
      input.value = d.def || "";
    }
    box.dataset.type = d.type || "alert";
  }

  async function geckoPermit(kind, value, host) {
    const h = host || siteKey();
    const k = kind || "popup";
    const v = value === true || value === "allow" ? "allow" : value === false || value === "block" ? "block" : "ask";
    const r = setPerm(h, k, v);
    if (k === "popup" && v === "allow") {
      const extra = bar()?.dataset.extra;
      if (extra && typeof geckoLoad === "function") await geckoLoad(extra);
    }
    hideBar();
    return { ok: true, ...r };
  }

  async function geckoPopup(action, url) {
    const act = String(action || "status");
    if (act === "allow") return geckoPermit("popup", "allow");
    if (act === "block") return geckoPermit("popup", "block");
    if (act === "open" && url) {
      if (typeof geckoLoad === "function") await geckoLoad(url);
      return { ok: true, url };
    }
    return { ok: true, host: siteKey(), popup: perm(siteKey(), "popup"), bar: !bar()?.hidden };
  }

  async function geckoDialog(action, text) {
    const box = document.getElementById("ff-dialog");
    if (action === "dismiss" || action === "cancel") {
      if (box) box.hidden = true;
      return { ok: true, dismissed: true };
    }
    if (action === "accept" || action === "ok") {
      const v = text || box?.querySelector(".ffd-input")?.value || "";
      if (box) box.hidden = true;
      return { ok: true, accepted: true, value: v };
    }
    return { ok: true, open: box && !box.hidden };
  }

  async function geckoTestdriver(cmd, args) {
    const c = String(cmd || args?.command || "").toLowerCase();
    const a = args || {};
    if (c === "set_permission" || c === "permission") return geckoPermit(a.kind || a.name, a.state || a.value, a.host);
    if (c === "accept_alert" || c === "accept") return geckoDialog("accept", a.text);
    if (c === "dismiss_alert" || c === "dismiss") return geckoDialog("dismiss");
    if (c === "click") {
      if (typeof geckoClick === "function") return geckoClick(a.x, a.y, a.button);
    }
    if (c === "send_keys" || c === "type") {
      if (typeof geckoType === "function") return geckoType(a.text || a.keys);
    }
    if (c === "navigate" || c === "goto") {
      if (typeof geckoLoad === "function") return geckoLoad(a.url);
    }
    if (c === "new_window" || c === "new_tab") {
      if (typeof geckoMenu === "function") return geckoMenu("new_tab", a.url);
    }
    if (c === "bless" || c === "user_activation") {
      try { await global.__GOAR_GECKO?.evalChrome("void document.body.click()"); } catch (_) {}
      return { ok: true, blessed: true };
    }
    if (c === "inject") return { ok: await injectHooks() };
    return { ok: false, error: "unknown testdriver " + c };
  }

  function wire() {
    document.getElementById("ffn-options")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const drop = document.getElementById("ff-drop");
      if (!drop) return;
      drop.innerHTML =
        '<button type="button" class="ff-mi" data-p="allow">Allow pop-ups for this site</button>' +
        '<button type="button" class="ff-mi" data-p="block">Block pop-ups</button>' +
        '<button type="button" class="ff-mi" data-p="ask">Ask every time</button>';
      drop.hidden = false;
      const r = e.currentTarget.getBoundingClientRect();
      const box = document.getElementById("browser-tab")?.getBoundingClientRect() || { left: 0, top: 0 };
      drop.style.left = (r.left - box.left) + "px";
      drop.style.top = (r.bottom - box.top + 4) + "px";
      drop.querySelectorAll("[data-p]").forEach((b) => {
        b.addEventListener("click", () => {
          drop.hidden = true;
          geckoPermit(bar()?.dataset.kind || "popup", b.getAttribute("data-p"));
        });
      });
    });
    document.getElementById("ffn-allow")?.addEventListener("click", () => {
      geckoPermit(bar()?.dataset.kind || "popup", "allow");
    });
    document.getElementById("ffd-ok")?.addEventListener("click", () => geckoDialog("accept"));
    document.getElementById("ffd-cancel")?.addEventListener("click", () => geckoDialog("dismiss"));
    setInterval(function () {
      if (!document.body.classList.contains("view-computer")) return;
      pollEngine().catch(function () {});
    }, 900);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  const prevLoad = global.geckoLoad;
  if (typeof prevLoad === "function") {
    global.geckoLoad = async function (url) {
      const r = await prevLoad(url);
      setTimeout(function () { injectHooks().catch(function () {}); }, 400);
      return r;
    };
  }

  global.geckoPermit = geckoPermit;
  global.geckoPopup = geckoPopup;
  global.geckoDialog = geckoDialog;
  global.geckoTestdriver = geckoTestdriver;
  global.injectGeckoHooks = injectHooks;
})(typeof window !== "undefined" ? window : globalThis);
