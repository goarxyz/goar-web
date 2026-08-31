/**
 * Attach CDP to the same Chrome/Edge/Brave/Firefox that opened this file.
 * Not a second browser. We talk to THIS instance, skip the GOAR tab,
 * and drive a sibling tab in the same window.
 *
 * This page cannot enable debugging on itself. Open GOAR in a browser
 * started with:
 *   chrome --remote-debugging-port=9222 --remote-allow-origins=* GOAR.html
 */
(function (G) {
  "use strict";

  const STATE = {
    http: "http://127.0.0.1:9222",
    ws: null,
    id: 0,
    pending: {},
    sessionId: "",
    targetId: "",
    attached: false,
    browser: "",
    lastError: "",
    selfUrl: "",
  };

  function selfUrl() {
    try { return String(location.href || ""); } catch (_) { return ""; }
  }

  function isSelfTarget(t) {
    const u = String((t && (t.url || t.title)) || "");
    const me = selfUrl();
    if (me && u && (u === me || u.split("#")[0] === me.split("#")[0])) return true;
    if (/GOAR(\.embedded)?\.html/i.test(u) && /GOAR/i.test(me)) return true;
    return false;
  }

  function cdpHttp() {
    try {
      const s = typeof loadSettings === "function" ? loadSettings() : {};
      return String((s && s.cdpUrl) || STATE.http).replace(/\/+$/, "");
    } catch (_) {
      return STATE.http;
    }
  }

  async function cdpGet(path) {
    const res = await fetch(cdpHttp() + path, { cache: "no-store" });
    if (!res.ok) throw new Error("CDP HTTP " + res.status);
    return res.json();
  }

  function sendRaw(method, params, sessionId) {
    if (!STATE.ws || STATE.ws.readyState !== 1) return Promise.reject(new Error("CDP not attached to this browser"));
    const id = ++STATE.id;
    const body = { id, method, params: params || {} };
    if (sessionId) body.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        delete STATE.pending[id];
        reject(new Error("CDP timeout " + method));
      }, 30000);
      STATE.pending[id] = { resolve, reject, t };
      STATE.ws.send(JSON.stringify(body));
    });
  }

  function send(method, params) {
    return sendRaw(method, params, STATE.sessionId || undefined);
  }

  function bindSocket(ws) {
    STATE.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && STATE.pending[msg.id]) {
        const p = STATE.pending[msg.id];
        delete STATE.pending[msg.id];
        clearTimeout(p.t);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result || {});
      }
    };
    ws.onclose = () => {
      STATE.attached = false;
      STATE.ws = null;
      STATE.sessionId = "";
    };
  }

  async function attachSession(targetId) {
    const r = await sendRaw("Target.attachToTarget", { targetId, flatten: true });
    STATE.sessionId = r.sessionId || "";
    STATE.targetId = targetId;
    try { await send("Page.enable"); } catch (_) {}
    try { await send("Runtime.enable"); } catch (_) {}
    try { await send("DOM.enable"); } catch (_) {}
  }

  async function cdpAttach() {
    try {
      STATE.selfUrl = selfUrl();
      const ver = await cdpGet("/json/version");
      STATE.browser = ver.Browser || "";
      const browserWs = ver.webSocketDebuggerUrl;
      if (!browserWs) throw new Error("this browser is not exposing CDP");
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(browserWs);
        ws.onopen = () => { bindSocket(ws); resolve(); };
        ws.onerror = () => reject(new Error("blocked talking to this browser — open GOAR from a debug session"));
      });
      await sendRaw("Target.setDiscoverTargets", { discover: true });
      const listed = await sendRaw("Target.getTargets");
      const targets = (listed.targetInfos || []).filter((t) => t.type === "page");
      let work = targets.find((t) => !isSelfTarget(t) && !/chrome:\/\/|edge:\/\/|about:blank/i.test(t.url || ""));
      if (!work) {
        const created = await sendRaw("Target.createTarget", { url: "https://duckduckgo.com" });
        work = { targetId: created.targetId };
      }
      await attachSession(work.targetId);
      STATE.attached = true;
      STATE.lastError = "";
      return cdpStatus();
    } catch (e) {
      STATE.attached = false;
      STATE.lastError = e && e.message ? e.message : String(e);
      return {
        ok: false,
        error: STATE.lastError,
        hint: "Open this file in the same browser started with --remote-debugging-port=9222 --remote-allow-origins=*",
      };
    }
  }

  function cdpDetach() {
    try { if (STATE.ws) STATE.ws.close(); } catch (_) {}
    STATE.ws = null;
    STATE.attached = false;
    STATE.sessionId = "";
    return { ok: true, attached: false };
  }

  function cdpStatus() {
    return {
      ok: STATE.attached,
      attached: STATE.attached,
      host: true,
      browser: STATE.browser,
      targetId: STATE.targetId,
      http: cdpHttp(),
      error: STATE.lastError || "",
    };
  }

  function cdpReady() {
    return !!(STATE.attached && STATE.ws && STATE.ws.readyState === 1 && STATE.sessionId);
  }

  async function cdpEval(js) {
    const r = await send("Runtime.evaluate", {
      expression: String(js || "document.title"),
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      return { ok: false, error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || "eval error" };
    }
    const v = r.result || {};
    return { ok: true, result: v.value != null ? v.value : v.description, via: "cdp-host" };
  }

  async function cdpRun(args) {
    args = args || {};
    const act = String(args.action || args.method || args.op || "url").toLowerCase();
    if (act === "attach" || act === "connect") return cdpAttach();
    if (act === "detach") return cdpDetach();
    if (act === "targets") {
      try {
        const r = await sendRaw("Target.getTargets");
        return { ok: true, targets: r.targetInfos || [] };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }
    if (!cdpReady()) {
      const a = await cdpAttach();
      if (!a.ok) return a;
    }
    if (act === "goto" || act === "go" || act === "open" || act === "load") {
      if (!args.url) return { ok: false, error: "url required" };
      await send("Page.navigate", { url: String(args.url) });
      return { ok: true, url: args.url, via: "cdp-host" };
    }
    if (act === "url" || act === "status") {
      const t = await cdpEval("location.href");
      const title = await cdpEval("document.title");
      return Object.assign(cdpStatus(), { url: t.result, title: title.result });
    }
    if (act === "click") {
      if (args.selector || args.sel) {
        return cdpEval(
          "(function(){var el=document.querySelector(" + JSON.stringify(args.selector || args.sel) + ");if(!el)return null;el.scrollIntoView({block:'center'});el.click();var b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,tag:el.tagName};})()"
        );
      }
      const x = Number(args.x) || 0, y = Number(args.y) || 0;
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      return { ok: true, x, y, via: "cdp-host" };
    }
    if (act === "type" || act === "fill") {
      if (args.selector || args.sel) {
        await cdpEval(
          "(function(){var el=document.querySelector(" + JSON.stringify(args.selector || args.sel) + ");if(!el)return;el.focus();if('value' in el)el.value='';})()"
        );
      }
      const s = String(args.text != null ? args.text : args.value || "");
      for (let i = 0; i < s.length; i++) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", text: s[i] });
        await send("Input.dispatchKeyEvent", { type: "keyUp", text: s[i] });
      }
      return { ok: true, n: s.length, via: "cdp-host" };
    }
    if (act === "eval" || act === "evaluate") return cdpEval(args.js || args.code || args.script || "document.title");
    if (act === "find") {
      return cdpEval(
        "(function(){var q=" + JSON.stringify(args.selector || "a,button,input") + ";return [].slice.call(document.querySelectorAll(q),0,40).map(function(el,i){return{i:i,tag:el.tagName,text:String(el.innerText||el.value||'').slice(0,80)};});})()"
      );
    }
    if (act === "shot" || act === "screenshot") {
      const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
      return { ok: true, png: r.data ? "data:image/png;base64," + r.data : "", via: "cdp-host" };
    }
    if (act === "wait") {
      await new Promise((r) => setTimeout(r, Number(args.ms || 400)));
      return { ok: true, via: "cdp-host" };
    }
    if (act === "back") { await send("Page.goBack"); return { ok: true, via: "cdp-host" }; }
    if (act === "reload") { await send("Page.reload"); return { ok: true, via: "cdp-host" }; }
    return { ok: false, error: "action attach|goto|click|type|eval|find|shot|wait|back|reload" };
  }

  const prev = G.runBrowser;
  G.runBrowser = async function (args) {
    args = args || {};
    const act = String(args.action || "").toLowerCase();
    if (act === "attach" || act === "connect" || act === "detach" || act === "targets" || args.cdp) return cdpRun(args);
    if (cdpReady()) return cdpRun(args);
    if (typeof prev === "function") return prev(args);
    return cdpRun(args);
  };

  G.cdpAttach = cdpAttach;
  G.cdpDetach = cdpDetach;
  G.cdpStatus = cdpStatus;
  G.cdpReady = cdpReady;
  G.cdpRun = cdpRun;

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(function () { cdpAttach().catch(() => {}); }, 2000);
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
