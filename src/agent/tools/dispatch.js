async function runAgentTool(name, args) {
  args = args && typeof args === "object" ? args : {};
  if (typeof validateToolArgs === "function") {
    const chk = validateToolArgs(name, args);
    if (chk && chk.valid === false && !chk.skipped) {
      return "TOOL_ERROR: schema " + (typeof formatSchemaErrors === "function" ? formatSchemaErrors(chk) : "invalid args");
    }
  }

  // Category surface: guest/net/browser/kv/mind/kit/pysec_* → inner tool
  const _isCat =
    typeof isCategoryToolName === "function"
      ? isCategoryToolName
      : typeof window !== "undefined"
        ? window.isCategoryToolName
        : null;
  const _resolveCat =
    typeof resolveCategoryCall === "function"
      ? resolveCategoryCall
      : typeof window !== "undefined"
        ? window.resolveCategoryCall
        : null;
  if (_isCat && _resolveCat && _isCat(name)) {
    const resolved = _resolveCat(name, args);
    if (resolved && resolved.error) return "TOOL_ERROR: " + resolved.error;
    if (resolved && resolved.kind === "discover") {
      return typeof toolDiscover === "function"
        ? toolDiscover(resolved.args || {})
        : JSON.stringify({ ok: false, error: "discover missing" });
    }
    if (resolved && resolved.kind === "audit") {
      return await toolPlaybook(Object.assign({}, resolved.args || args || {}, { playbook: resolved.name || "audit" }));
    }
    if (resolved && resolved.kind === "pysec") {
      return await toolPysec({ tool_id: resolved.name, kwargs: resolved.args || {} });
    }
    if (resolved && resolved.kind === "core") {
      // re-enter with concrete core tool name (never a category name)
      name = resolved.name;
      args = resolved.args || {};
    }
  }

  if (typeof name === "string" && (name === "pysec" || name.indexOf("pysec_") === 0 || name === "playbook" || name === "audit" || name === "micropip_install" || name === "install_flask" || name === "kit_status")) {
    return "removed: use bash / python_exec / read_file / write_file on Kali. Pysec and playbooks are gone.";
  }
  if (typeof name === "string" && PYSEC_FN_TO_ID && PYSEC_FN_TO_ID[name]) {
    return "removed: use bash on Kali.";
  }
  if (typeof name === "string" && name.indexOf(".") !== -1 && typeof toolPysec === "function") {
    return "removed: use bash on Kali.";
  }

  switch (name) {
    case "bash": return toolBash(args);
    case "audit":
    case "playbook":
      return "removed: use bash on Kali. Playbooks are gone.";
    case "pysec":
      return "removed: use bash on Kali. Pysec is gone.";
    case "install_flask":
    case "micropip_install":
    case "kit_status":
      return "removed: pip install on Kali via bash.";
    case "task":
    case "agent_run": {
      if (typeof wasmAgentRun === "function") {
        const r = await wasmAgentRun(args.prompt || args.description || args.input || "", {
          name: args.name || "Task",
          instructions: args.instructions || args.description || "Finish the assigned task. Use tools.",
          tools: args.tools !== false,
        });
        return typeof r === "string" ? r : JSON.stringify(r);
      }
      return "error: wasm-agents not loaded";
    }
    case "handoff": {
      if (typeof wasmAgentHandoff === "function") {
        let specs = args.agents || args.handoffs;
        if (typeof specs === "string") {
          try { specs = JSON.parse(specs); } catch (_) { specs = []; }
        }
        if (!Array.isArray(specs) || !specs.length) {
          specs = [
            { name: "Spanish agent", instructions: "You only speak Spanish, and you do it in rhymes." },
            { name: "English agent", instructions: "You only speak English, and you do it in rhymes." },
          ];
        }
        const r = await wasmAgentHandoff(args.prompt || args.input || args.query || "", specs);
        return typeof r === "string" ? r : JSON.stringify(r);
      }
      return "error: wasm-agents not loaded";
    }
    case "python_exec": return toolPython(args);
    case "write_file": return toolWrite(args);
    case "read_file": return toolRead(args);
    case "edit":
    case "edit_file": return toolEdit(args);
    case "delete_file": return toolDelete(args);
    case "move_file": return toolMove(args);
    case "copy_file": return toolCopy(args);
    case "list_dir": return toolLs(args);
    case "mkdir": return toolMkdir(args);
    case "glob": return toolGlob(args);
    case "grep": return toolGrep(args);
    case "web_search": return toolWebSearch(args);
    case "web_fetch": {
      const out = await toolWebFetch(args);
      // Keep the in-app Firefox on the same URL so work stays one picture
      try {
        const u = args && args.url;
        if (u && typeof geckoLoad === "function" && /^(https?:)?\/\//i.test(String(u))) {
          geckoLoad(u).catch(() => {});
        }
      } catch (_) {}
      return out;
    }
    case "browse": {
      const url = args && args.url;
      if (!url) return JSON.stringify({ ok: false, error: "url required" });
      const cap = (p, ms) => Promise.race([
        Promise.resolve(p).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) })),
        new Promise((res) => setTimeout(() => res({ ok: false, error: "timeout" }), ms)),
      ]);
      try {
        if (typeof ensureGecko === "function") {
          cap(ensureGecko({ mode: args.mode || "embed", show: args.show !== false, url }), 4000);
        }
      } catch (_) {}
      const geckoP = typeof geckoLoad === "function" ? cap(geckoLoad(url), 7000) : Promise.resolve(null);
      const fetchP = cap(toolWebFetch({ url, timeout_ms: 7000, render: true }), 8000);
      const [gecko, fetchOut] = await Promise.all([geckoP, fetchP]);
      let text = fetchOut;
      if (typeof text === "string" && text.length > 4000) text = text.slice(0, 4000) + "…";
      return JSON.stringify({ ok: true, url, gecko, fetch: text }, null, 2);
    }
    case "browser":
    case "browser_drive": {
      const fn = typeof runBrowser === "function" ? runBrowser : (typeof runPage === "function" ? runPage : null);
      if (!fn) return JSON.stringify({ ok: false, error: "browser plane missing" });
      const r = await fn(args);
      try { return typeof r === "string" ? r : JSON.stringify(r); } catch (_) { return String(r); }
    }
    case "http_request": return toolHttp(args);
    case "env_info": return toolEnvInfo(args);
    case "guest_http": return typeof toolGuestHttp === "function" ? toolGuestHttp(args) : "error: guest_http missing";
    case "workspace_tree": return toolWorkspaceTree(args);
    case "scratch": return typeof toolScratch === "function" ? toolScratch(args) : "error: scratch missing";
    case "py_check": return toolPyCheck(args);
    case "net_diag": return toolNetDiag(args);
    case "todo": return toolTodo(args);
    case "create_plan": return toolCreatePlan(args);
    case "update_plan_step": return toolUpdatePlanStep(args);
    case "update_ledger": return toolUpdateLedger(args);
    case "think": return toolThink(args);
    case "complete_task": return toolCompleteTask(args);
    case "store_memory": return toolStoreMemory(args);
    case "recall_memory": return toolRecallMemory(args);
    case "set_phase": return toolSetPhase(args);
    case "micropip_install": return toolMicropipInstall(args);
    case "discover":
      return typeof toolDiscover === "function"
        ? toolDiscover(args)
        : JSON.stringify({ ok: false, error: "discover missing" });
    case "list_session_tools": return typeof toolListSessionTools === "function" ? toolListSessionTools() : "[]";
    case "edit_tool": return typeof toolEditTool === "function" ? toolEditTool(args) : toolCreateTool(args);
    case "remove_tool": return typeof toolRemoveTool === "function" ? toolRemoveTool(args) : "error: remove missing";
    case "mw_status": {
      try {
        if (typeof ensureMwFabric === "function") await ensureMwFabric();
      } catch (_) {}
      const st = typeof mwFabricStatus === "function" ? mwFabricStatus() : {};
      const planes = typeof planeSnapshot === "function" ? planeSnapshot() : {};
      return JSON.stringify({ fabric: st, planes: planes.host || planes }, null, 2);
    }
    case "browser_status": {
      const st = typeof browserPlaneStatus === "function"
        ? browserPlaneStatus()
        : { error: "browser plane helper missing", gecko: typeof geckoStatus === "function" ? geckoStatus() : null };
      return JSON.stringify(st, null, 2);
    }
    case "gecko_status": {
      const st = typeof geckoStatus === "function" ? geckoStatus() : { error: "gecko-plane not loaded" };
      return JSON.stringify(st, null, 2);
    }
    case "gecko_open": {
      if (typeof ensureGecko !== "function") return JSON.stringify({ ok: false, error: "gecko-plane not loaded" });
      const mode = (args.mode || "embed").toLowerCase();
      const st = await ensureGecko({
        mode: mode === "chrome" ? "chrome" : "embed",
        show: args.show !== false,
        url: args.url || undefined,
      });
      return JSON.stringify({ ok: !!st.ready, ...st }, null, 2);
    }
    case "gecko_load": {
      if (typeof geckoLoad !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoLoad(args.url);
      let page = null;
      try {
        if (typeof pageSnapshot === "function") page = await pageSnapshot({ max: 1800 });
      } catch (_) {}
      return JSON.stringify({ ...r, page }, null, 2);
    }
    case "gecko_hide": {
      try { if (typeof geckoHide === "function") geckoHide(); } catch (_) {}
      return JSON.stringify({ ok: true, hidden: true }, null, 2);
    }
    case "gecko_click": {
      if (typeof geckoClick !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoClick(args.x, args.y, args.button);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_type": {
      if (typeof geckoType !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoType(args.text || args.query || "");
      return JSON.stringify(r, null, 2);
    }
    case "gecko_key": {
      if (typeof geckoKey !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoKey(args.key || "Enter", args.keyCode);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_eval": {
      if (typeof erudaInspect === "function") {
        const r = await erudaInspect({ action: "eval", js: args.js || args.code || args.text || "" });
        return JSON.stringify(r);
      }
      if (typeof geckoEval !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoEval(args.js || args.code || args.text || "");
      return JSON.stringify({ ok: r.ok, result: (r.result || "").slice(0, 4000), error: r.error || null }, null, 2);
    }
    case "gecko_shot": {
      if (typeof geckoShot !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoShot();
      if (!r.ok) return JSON.stringify(r, null, 2);
      try { window.__GOAR_LAST_SHOT = r.data || r.data_url || ""; } catch (_) {}
      return JSON.stringify({
        ok: true,
        mime: r.mime,
        bytes: r.bytes,
        url: r.url,
      }, null, 2);
    }
    case "gecko_permit": {
      if (typeof geckoPermit !== "function") return JSON.stringify({ ok: false, error: "permissions missing" });
      const r = await geckoPermit(args.kind || args.name, args.value || args.state, args.host);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_popup": {
      if (typeof geckoPopup !== "function") return JSON.stringify({ ok: false, error: "popup missing" });
      const r = await geckoPopup(args.action, args.url);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_dialog": {
      if (typeof geckoDialog !== "function") return JSON.stringify({ ok: false, error: "dialog missing" });
      const r = await geckoDialog(args.action, args.text);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_td": {
      if (typeof geckoTestdriver !== "function") return JSON.stringify({ ok: false, error: "testdriver missing" });
      const r = await geckoTestdriver(args.command || args.cmd || args.action, args);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_menu": {
      if (typeof geckoMenu !== "function") return JSON.stringify({ ok: false, error: "menu missing" });
      const r = await geckoMenu(args.action || args.item || args.op, args.url || args.query || args.arg);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_addon": {
      if (typeof geckoAddon !== "function") return JSON.stringify({ ok: false, error: "addons missing" });
      const r = await geckoAddon(args.id || args.name, args.enabled !== false && args.on !== false);
      return JSON.stringify(r, null, 2);
    }
    case "gecko_wait": {
      if (typeof geckoWait !== "function") return JSON.stringify({ ok: false, error: "gecko not loaded" });
      const r = await geckoWait(args.ms || args.timeout_ms);
      return JSON.stringify(r, null, 2);
    }
    case "inspect": {
      if (typeof erudaInspect !== "function") return JSON.stringify({ ok: false, error: "inspect missing" });
      const out = await erudaInspect({
        action: args.op || args.action || args.kind || "snapshot",
        selector: args.selector || args.sel,
        js: args.js || args.code || args.expr,
        max: args.max,
      });
      return typeof out === "string" ? out : JSON.stringify(out);
    }
    case "page": {
      if (typeof runPage !== "function") return JSON.stringify({ ok: false, error: "page plane missing" });
      const r = await runPage(args);
      return JSON.stringify(r);
    }
    case "kv_status": {
      try { if (typeof ensureGoarKv === "function") await ensureGoarKv(); } catch (_) {}
      const st = typeof goarKvStatus === "function" ? goarKvStatus() : { error: "kv-plane missing" };
      return JSON.stringify(st, null, 2);
    }
    case "kv_set": {
      if (typeof goarKvSet !== "function") return JSON.stringify({ ok: false, error: "kv-plane missing" });
      const r = await goarKvSet(args.key, args.value, { ns: args.ns, ex: args.ex });
      return JSON.stringify(r, null, 2);
    }
    case "kv_get": {
      if (typeof goarKvGet !== "function") return JSON.stringify({ ok: false, error: "kv-plane missing" });
      const r = await goarKvGet(args.key, { ns: args.ns });
      return JSON.stringify(r, null, 2);
    }
    case "kv_del": {
      if (typeof goarKvDel !== "function") return JSON.stringify({ ok: false, error: "kv-plane missing" });
      const keys = args.keys || args.key;
      const r = await goarKvDel(keys, { ns: args.ns });
      return JSON.stringify(r, null, 2);
    }
    case "kv_keys": {
      if (typeof goarKvKeys !== "function") return JSON.stringify({ ok: false, error: "kv-plane missing" });
      const r = await goarKvKeys(args.pattern || "*", { ns: args.ns });
      return JSON.stringify(r, null, 2);
    }
    case "crypto": {
      if (typeof runHostCrypto !== "function") return JSON.stringify({ ok: false, error: "crypto plane missing" });
      const r = await runHostCrypto(args);
      return JSON.stringify(r);
    }
    case "wasm": {
      if (typeof runHostWasm !== "function") return JSON.stringify({ ok: false, error: "wasm plane missing" });
      const r = await runHostWasm(args);
      return JSON.stringify(r);
    }
    case "compute": {
      if (typeof computeCall !== "function") return JSON.stringify({ ok: false, error: "compute worker missing" });
      const op = String(args.op || args.action || "ping");
      const r = await computeCall(op, args.data != null ? args.data : { text: args.text, algo: args.algo, messages: args.messages });
      return JSON.stringify({ ok: true, op, result: r });
    }
    case "schema_validate": {
      if (typeof validateJson !== "function") return JSON.stringify({ ok: false, error: "schema plane missing" });
      const inst = args.instance != null ? args.instance : args.data;
      const sch = args.schema;
      if (sch == null) return JSON.stringify({ ok: false, error: "schema required" });
      const r = validateJson(inst, sch, args.draft);
      return JSON.stringify({ ok: !!r.valid, valid: !!r.valid, errors: r.errors || [] });
    }
    case "chart": {
      if (typeof renderChart !== "function") return JSON.stringify({ ok: false, error: "viz plane missing" });
      return JSON.stringify(renderChart(args));
    }
    default: {
      if (typeof runDynamicTool === "function") {
        const dyn = await runDynamicTool(name, args);
        if (dyn != null) return dyn;
      }
      return JSON.stringify({ ok: false, error: "unknown tool " + name });
    }
  }
}


function syncModelSelect(model) {
  const p = getProvider((el.provider && el.provider.value) || loadSettings().provider || "openrouter");
  rebuildModelSelect(p, model || (p && p.defaultModel) || "");
}
function readModelSelect() {
  const sel = el.apiModel || document.getElementById("apiModel");
  if (!sel) return "";
  if (sel.tagName === "SELECT") {
    if (sel.value === "__custom__") {
      const c = document.getElementById("apiModelCustom");
      return (c && c.value || "").trim();
    }
    return (sel.value || "").trim();
  }
  return (sel.value || "").trim();
}


function wireProviderUi() {
  if (el.provider) {
    el.provider.addEventListener("change", () => {
      applyProviderPreset(el.provider.value);
    });
  }
  const sel = document.getElementById("apiModel");
  if (sel && sel.tagName === "SELECT") {
    sel.addEventListener("change", () => {
      const c = document.getElementById("apiModelCustom");
      if (c) c.style.display = sel.value === "__custom__" ? "block" : "none";
    });
  }
  const btnM = document.getElementById("btnLoadModels");
  if (btnM) {
    btnM.onclick = async () => {
      const out = document.getElementById("apiVerifyOut");
      try {
        if (out) out.textContent = "Loading models...";
        const apiKey = (el.apiKey && el.apiKey.value || "").trim();
        const provider = (el.provider && el.provider.value) || "openrouter";
        let apiBase = (el.apiBase && el.apiBase.value || "").trim();
        const p = getProvider(provider);
        if (!apiBase && p) apiBase = p.apiBase;
        saveSettings({ provider, apiBase, apiKey, apiModel: readModelSelect() || (p && p.defaultModel) || "" });
        const ids = await fetchModels();
        const seli = el.apiModel || document.getElementById("apiModel");
        if (seli && seli.tagName === "SELECT") {
          const cur = readModelSelect();
          seli.innerHTML = "";
          ids.slice(0, 200).forEach((id) => {
            const o = document.createElement("option");
            o.value = id; o.textContent = id;
            seli.appendChild(o);
          });
          const custom = document.createElement("option");
          custom.value = "__custom__"; custom.textContent = "Custom model id...";
          seli.appendChild(custom);
          if (ids.includes(cur)) seli.value = cur;
          else if (ids.length) seli.value = ids[0];
        }
        if (out) out.textContent = ids.length + " models loaded";
      } catch (e) {
        if (out) out.textContent = "Load failed: " + (e.message || e);
      }
    };
  }
  const btnV = document.getElementById("btnVerifyApi");
  if (btnV) {
    btnV.onclick = async () => {
      const out = document.getElementById("apiVerifyOut");
      try {
        const provider = (el.provider && el.provider.value) || "openrouter";
        const p = getProvider(provider);
        let apiBase = (el.apiBase && el.apiBase.value || "").trim() || (p && p.apiBase) || "";
        const apiKey = (el.apiKey && el.apiKey.value || "").trim();
        const apiModel = readModelSelect() || (p && p.defaultModel) || "";
        saveSettings({ provider, apiBase, apiKey, apiModel });
        if (out) out.textContent = "Verifying...";
        const probe = await probeModel(apiModel);
        if (out) out.textContent = (probe.detail || "") + (probe.toolCapable ? " · tools ok" : "");
      } catch (e) {
        if (out) out.textContent = "Verify failed: " + (e.message || e);
      }
    };
  }
}
