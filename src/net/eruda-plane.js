/**
 * Internal page inspector for the shared Firefox.
 * Agent path only — no floating Eruda UI. Injects __GOAR_DEV into content
 * via geckoEval (chrome). Cross-origin script tags cannot do this.
 */
const ERUDA = { geckoInjected: false, lastError: "" };

function geckoBridgeSource() {
  return `
(function(){
  function win(){
    try { if (typeof gBrowser !== "undefined" && gBrowser.contentWindow) return gBrowser.contentWindow; } catch(e){}
    try { if (typeof content !== "undefined" && content) return content; } catch(e){}
    try {
      var b = document.querySelector("browser, iframe");
      if (b && b.contentWindow) return b.contentWindow;
    } catch(e){}
    return window;
  }
  var w = win();
  if (!w || !w.document) return "no-content";
  if (w.__GOAR_DEV) return "ready";
  var logs = [];
  var net = [];
  try {
    ["log","info","warn","error"].forEach(function(k){
      var orig = w.console && w.console[k] ? w.console[k].bind(w.console) : function(){};
      w.console[k] = function(){
        var args = [];
        for (var i=0;i<arguments.length;i++) {
          try { args.push(typeof arguments[i]==="string"?arguments[i]:JSON.stringify(arguments[i])); }
          catch(e){ args.push(String(arguments[i])); }
        }
        logs.push({ k:k, args:args, t:Date.now() });
        if (logs.length>120) logs.shift();
        return orig.apply(w.console, arguments);
      };
    });
  } catch(e){}
  try {
    if (w.fetch) {
      var of = w.fetch.bind(w);
      w.fetch = function(input, init){
        var u = (typeof input==="string") ? input : (input && input.url) || String(input);
        var rec = { url:u, method:(init&&init.method)||"GET", t:Date.now() };
        return of(input, init).then(function(r){
          rec.status = r.status; rec.ok = r.ok; net.push(rec); if (net.length>80) net.shift();
          return r;
        }).catch(function(err){ rec.error=String(err); net.push(rec); throw err; });
      };
    }
  } catch(e){}
  w.__GOAR_DEV = {
    url: function(){ try { return String(w.location.href); } catch(e){ return ""; } },
    title: function(){ try { return String(w.document.title||""); } catch(e){ return ""; } },
    html: function(sel, lim){
      lim = lim || 8000;
      try {
        if (!sel) return (w.document.documentElement.outerHTML||"").slice(0, lim);
        var el = w.document.querySelector(sel);
        return el ? String(el.outerHTML).slice(0, lim) : "";
      } catch(e){ return "err:"+e; }
    },
    text: function(sel, lim){
      lim = lim || 4000;
      try {
        var el = sel ? w.document.querySelector(sel) : w.document.body;
        return el ? String(el.innerText||"").slice(0, lim) : "";
      } catch(e){ return "err:"+e; }
    },
    styles: function(sel){
      try {
        var el = w.document.querySelector(sel||"body");
        if (!el) return "";
        var cs = w.getComputedStyle(el);
        var o = {};
        ["display","position","width","height","color","backgroundColor","fontSize","margin","padding","overflow","visibility","zIndex"].forEach(function(k){ o[k]=cs[k]; });
        return JSON.stringify(o);
      } catch(e){ return "err:"+e; }
    },
    logs: function(){ return JSON.stringify(logs.slice(-60)); },
    network: function(){
      var perf = [];
      try {
        var list = w.performance && w.performance.getEntriesByType ? w.performance.getEntriesByType("resource") : [];
        for (var i=Math.max(0,list.length-40);i<list.length;i++){
          var e = list[i];
          perf.push({ name:e.name, type:e.initiatorType, dur:Math.round(e.duration), size:e.transferSize||0 });
        }
      } catch(e){}
      return JSON.stringify({ hook:net.slice(-40), performance:perf });
    },
    eval: function(js){
      try { return String(w.eval(js)); } catch(e){ return "err:"+e; }
    },
    info: function(){
      try {
        return JSON.stringify({
          url: String(w.location.href),
          title: String(w.document.title||""),
          ready: w.document.readyState
        });
      } catch(e){ return "err:"+e; }
    },
    snapshot: function(lim){
      lim = lim || 2500;
      try {
        var body = w.document.body ? String(w.document.body.innerText||"") : "";
        return JSON.stringify({
          url: String(w.location.href),
          title: String(w.document.title||""),
          ready: w.document.readyState,
          text: body.slice(0, lim)
        });
      } catch(e){ return "err:"+e; }
    }
  };
  return "installed "+w.__GOAR_DEV.url();
})()
`.trim();
}

function parseMaybe(text) {
  const s = String(text == null ? "" : text);
  if (!s) return s;
  try { return JSON.parse(s); } catch (_) { return s; }
}

async function geckoDevEval(expr) {
  if (typeof geckoEval !== "function") return { ok: false, error: "gecko eval missing" };
  const js =
    "(function(){ try { var w=(typeof gBrowser!=='undefined'&&gBrowser.contentWindow)||(typeof content!=='undefined'&&content)||window;" +
    "var d=w.__GOAR_DEV; if(!d) return 'NO_DEV'; return String(" +
    expr +
    "); } catch(e){ return 'err:'+e; } })()";
  return geckoEval(js);
}

async function ensureGeckoDev() {
  if (typeof ensureGecko === "function") {
    try { await ensureGecko({ show: true }); } catch (_) {}
  }
  if (typeof geckoEval !== "function") return { ok: false, error: "no gecko" };
  const r = await geckoEval(geckoBridgeSource());
  const out = (r && (r.result || r.error || "")) || "";
  ERUDA.geckoInjected = /installed|ready/.test(String(out));
  ERUDA.lastError = ERUDA.geckoInjected ? "" : String(out);
  return { ok: ERUDA.geckoInjected || r.ok, inject: out };
}

async function pageSnapshot(opts) {
  const inj = await ensureGeckoDev();
  const r = await geckoDevEval("d.snapshot(" + (Number(opts && opts.max) || 2500) + ")");
  const text = r && r.result != null ? String(r.result) : "";
  if (text === "NO_DEV") return { ok: false, inject: inj.inject, error: "inspector not in page yet" };
  return { ok: r && r.ok !== false, page: parseMaybe(text) };
}

async function erudaInspect(args) {
  args = args || {};
  const action = String(args.action || args.op || args.kind || "snapshot").toLowerCase();
  const sel = args.selector || args.sel || "";
  const js = args.js || args.code || args.expr || "";

  if (action === "open" || action === "show" || action === "hide" || action === "warm") {
    return ensureGeckoDev();
  }

  const run = async (expr) => {
    let r = await geckoDevEval(expr);
    let text = r && r.result != null ? String(r.result) : "";
    if (text === "NO_DEV") {
      await ensureGeckoDev();
      r = await geckoDevEval(expr);
      text = r && r.result != null ? String(r.result) : "";
    }
    return { ok: r && r.ok !== false && text !== "NO_DEV", result: parseMaybe(text) };
  };

  if (action === "info" || action === "status") return run("d.info()");
  if (action === "snapshot") return run("d.snapshot(2500)");
  if (action === "dom" || action === "html" || action === "elements") {
    return run("d.html(" + JSON.stringify(sel) + "," + (Number(args.max) || 8000) + ")");
  }
  if (action === "text") {
    return run("d.text(" + JSON.stringify(sel) + "," + (Number(args.max) || 4000) + ")");
  }
  if (action === "styles" || action === "css") {
    return run("d.styles(" + JSON.stringify(sel || "body") + ")");
  }
  if (action === "console" || action === "logs") {
    return js ? run("d.eval(" + JSON.stringify(js) + ")") : run("d.logs()");
  }
  if (action === "eval" || action === "snippet") {
    return run("d.eval(" + JSON.stringify(js || "1+1") + ")");
  }
  if (action === "network" || action === "net" || action === "resources") {
    return run("d.network()");
  }
  return run("d.snapshot(2500)");
}

try {
  window.ensureGeckoDev = ensureGeckoDev;
  window.pageSnapshot = pageSnapshot;
  window.erudaInspect = erudaInspect;
  window.ERUDA = ERUDA;
} catch (_) {}
