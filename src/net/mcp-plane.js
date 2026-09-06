/**
 * MCP client — Streamable HTTP JSON-RPC 2.0.
 * Add server URLs in Settings. Agent tools: mcp_list, mcp_call.
 */
(function (global) {
  "use strict";

  const LS = "goar_mcp_servers_v1";

  function servers() {
    try {
      const a = JSON.parse(localStorage.getItem(LS) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (_) {
      return [];
    }
  }
  function saveServers(list) {
    try { localStorage.setItem(LS, JSON.stringify(list || [])); } catch (_) {}
  }

  function hopFetch(url, init) {
    init = init || {};
    if (typeof goarApiFetch === "function") return goarApiFetch(url, init);
    if (typeof buildManusProxyUrl === "function") {
      const hop = buildManusProxyUrl(url, {
        method: (init.method || "GET").toUpperCase(),
        reqHeaders: init.headers || {},
      });
      return fetch(hop, init);
    }
    return fetch(url, init);
  }

  async function rpc(url, method, params, id) {
    const body = { jsonrpc: "2.0", id: id || ("mcp_" + Date.now().toString(36)), method: method };
    if (params != null) body.params = params;
    const res = await hopFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let text = await res.text();
    if (/event-stream/.test(ct)) {
      const lines = text.split("\n");
      let acc = "";
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line.indexOf("data:") === 0) acc = line.slice(5).trim();
      }
      if (acc) text = acc;
    }
    let obj = null;
    try { obj = JSON.parse(text); } catch (_) {
      throw new Error("MCP non-JSON from " + url + ": " + String(text).slice(0, 180));
    }
    if (obj.error) {
      const e = obj.error;
      throw new Error("MCP " + (e.code || "") + " " + (e.message || JSON.stringify(e)));
    }
    return obj.result;
  }

  async function initialize(url) {
    const result = await rpc(url, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      clientInfo: { name: "GOAR", version: "1" },
    });
    try { await rpc(url, "notifications/initialized", {}); } catch (_) {}
    return result;
  }

  async function listTools(url) {
    await initialize(url);
    const r = await rpc(url, "tools/list", {});
    return (r && r.tools) || [];
  }

  async function callTool(url, name, args) {
    await initialize(url);
    return rpc(url, "tools/call", { name: name, arguments: args || {} });
  }

  function parseServerList(text) {
    return String(text || "")
      .split(/\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return /^https?:\/\//i.test(s); });
  }

  function readForm() {
    const ta = document.getElementById("mcpServers");
    if (!ta) return servers();
    const list = parseServerList(ta.value).map(function (url) { return { url: url }; });
    saveServers(list);
    return list;
  }

  function fillForm() {
    const ta = document.getElementById("mcpServers");
    if (!ta) return;
    ta.value = servers().map(function (s) { return s.url; }).join("\n");
  }

  async function toolMcpList(args) {
    args = args || {};
    const list = args.url ? [{ url: args.url }] : readForm();
    if (!list.length) return JSON.stringify({ ok: false, error: "no MCP servers — add HTTPS URLs in Settings" });
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const url = list[i].url;
      try {
        const tools = await listTools(url);
        out.push({ url: url, ok: true, tools: tools });
      } catch (e) {
        out.push({ url: url, ok: false, error: e && e.message ? e.message : String(e) });
      }
    }
    return JSON.stringify({ ok: true, servers: out });
  }

  async function toolMcpCall(args) {
    args = args || {};
    const url = String(args.url || (servers()[0] && servers()[0].url) || "").trim();
    const name = String(args.name || args.tool || "").trim();
    if (!url) return JSON.stringify({ ok: false, error: "url required" });
    if (!name) return JSON.stringify({ ok: false, error: "name required" });
    try {
      const r = await callTool(url, name, args.arguments || args.args || {});
      return JSON.stringify({ ok: true, url: url, name: name, result: r });
    } catch (e) {
      return JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  try {
    global.mcpServers = servers;
    global.mcpSaveServers = saveServers;
    global.mcpListTools = listTools;
    global.mcpCallTool = callTool;
    global.toolMcpList = toolMcpList;
    global.toolMcpCall = toolMcpCall;
    global.fillMcpForm = fillForm;
    global.readMcpForm = readForm;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
