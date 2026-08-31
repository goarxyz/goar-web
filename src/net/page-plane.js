/**
 * Puppeteer-shaped control of the shared Firefox.
 * Not Node Puppeteer — same verbs on Gecko + inspect.
 */
function pageSelJs(sel, body) {
  return "(function(){ var el=document.querySelector(" + JSON.stringify(sel || "") + "); " + body + " })()";
}

async function pageEvalRaw(js) {
  if (typeof liveEval === "function" && window.GOAR_GECKO_MODE === "live") {
    const r = await liveEval(js);
    return { ok: !!(r && r.ok !== false), result: r && r.result, error: r && r.error };
  }
  if (typeof erudaInspect === "function") {
    const r = await erudaInspect({ action: "eval", js: js });
    const v = r && r.result !== undefined ? r.result : r;
    return { ok: !!(r && r.ok !== false), result: v };
  }
  if (typeof geckoEval === "function") {
    const r = await geckoEval(js);
    return { ok: !!r.ok, result: r.result, error: r.error };
  }
  return { ok: false, error: "no eval" };
}

async function runPage(args) {
  args = args || {};
  const method = String(args.method || args.action || args.op || "url").toLowerCase();
  const sel = args.selector || args.sel || args.query || "";
  const url = args.url;
  const text = args.text != null ? args.text : args.value;

  if (method === "goto" || method === "go") {
    if (!url) return { ok: false, error: "url required" };
    if (typeof geckoLoad === "function") await geckoLoad(url);
    const page = typeof pageSnapshot === "function" ? await pageSnapshot({ max: 1800 }) : null;
    return { ok: true, method: "goto", url, page };
  }

  if (method === "url" || method === "title" || method === "content") {
    if (method === "content") {
      const r = typeof erudaInspect === "function"
        ? await erudaInspect({ action: "dom", selector: sel || "", max: 8000 })
        : await pageEvalRaw("document.documentElement.outerHTML.slice(0,8000)");
      return r;
    }
    const r = typeof erudaInspect === "function"
      ? await erudaInspect({ action: "info" })
      : await pageEvalRaw("JSON.stringify({url:location.href,title:document.title})");
    return r;
  }

  if (method === "evaluate" || method === "eval" || method === "$eval") {
    return pageEvalRaw(args.js || args.code || args.expr || "document.title");
  }

  if (method === "waitfor" || method === "waitforselector" || method === "wait") {
    if (!sel && args.ms) {
      if (typeof geckoWait === "function") return geckoWait(args.ms);
      await new Promise((r) => setTimeout(r, Number(args.ms) || 300));
      return { ok: true, ms: args.ms };
    }
    const limit = Math.max(200, Math.min(20000, Number(args.timeout || args.ms) || 8000));
    const t0 = Date.now();
    while (Date.now() - t0 < limit) {
      const r = await pageEvalRaw(pageSelJs(sel, "return el?'1':'0'"));
      if (String(r.result) === "1") return { ok: true, selector: sel, ms: Date.now() - t0 };
      await new Promise((res) => setTimeout(res, 200));
    }
    return { ok: false, error: "timeout", selector: sel };
  }

  if (method === "click" || method === "$") {
    if (!sel) return { ok: false, error: "selector required" };
    const hit = await pageEvalRaw(
      pageSelJs(sel, "if(!el)return 'missing'; el.scrollIntoView({block:'center'}); el.focus(); el.click(); var b=el.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height,tag:el.tagName});")
    );
    if (String(hit.result) === "missing") return { ok: false, error: "no element", selector: sel };
    try {
      const box = typeof hit.result === "string" && hit.result.charAt(0) === "{"
        ? JSON.parse(hit.result)
        : hit.result;
      if (box && typeof geckoClick === "function" && box.x != null) {
        await geckoClick(box.x, box.y, args.button);
      }
    } catch (_) {}
    return { ok: true, selector: sel, hit: hit.result };
  }

  if (method === "type" || method === "fill") {
    if (sel) {
      await pageEvalRaw(
        pageSelJs(sel, "if(!el)return 'missing'; el.focus(); if('value' in el) el.value=''; el.click(); return 'ok';")
      );
    }
    if (typeof geckoType === "function") return geckoType(String(text || ""));
    return pageEvalRaw(
      pageSelJs(sel, "if(!el)return 'missing'; el.value=" + JSON.stringify(String(text || "")) + "; el.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';")
    );
  }

  if (method === "press" || method === "key") {
    if (typeof geckoKey === "function") return geckoKey(args.key || "Enter", args.keyCode);
    return { ok: false, error: "no key" };
  }

  if (method === "screenshot" || method === "shot") {
    if (typeof geckoShot !== "function") return { ok: false, error: "no shot" };
    const r = await geckoShot();
    return {
      ok: !!r.ok,
      mime: r.mime,
      bytes: r.bytes,
      url: r.url,
      note: "on the shared canvas — not inlined",
    };
  }

  if (method === "reload") {
    await pageEvalRaw("location.reload(); 'ok'");
    return { ok: true, method: "reload" };
  }

  return { ok: false, error: "page method goto|click|type|evaluate|waitFor|screenshot|content|title" };
}

try {
  window.runPage = runPage;
} catch (_) {}
