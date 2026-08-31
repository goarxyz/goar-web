#!/usr/bin/env node
/**
 * Static quality gates for modular GOAR — run before claiming a component "ok".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const issues = [];
const ok = [];

function fail(msg) { issues.push(msg); }
function pass(msg) { ok.push(msg); }

// 1) LOAD_ORDER files exist
const order = JSON.parse(fs.readFileSync(path.join(ROOT, "src/LOAD_ORDER.json"), "utf8"));
for (const f of order) {
  const p = path.join(ROOT, "src", f);
  if (!fs.existsSync(p)) fail("missing module " + f);
}
pass("LOAD_ORDER " + order.length + " modules present");

// 1b) Standalone GOAR.html must include every LOAD_ORDER module
{
  const htmlPath = path.join(ROOT, "GOAR.html");
  const html = fs.existsSync(htmlPath)
    ? fs.readFileSync(htmlPath, "utf8")
    : fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const missing = order.filter((f) => {
    const name = f.split("/").pop();
    return html.indexOf(f) === -1 && html.indexOf(name) === -1;
  });
  if (missing.length) fail("GOAR.html missing modules: " + missing.join(", "));
  else pass("GOAR.html embeds all " + order.length + " LOAD_ORDER modules");
}

// 2) Critical assets (current stack — not Alpine/v86)
const assets = [
  "assets/brand/g.png",
  "assets/pyodide/pyodide.mjs",
  "assets/pyodide/pyodide.asm.wasm",
  "assets/unix/goar-box.wasm",
  "assets/gecko/gecko.js",
];
for (const a of assets) {
  const p = path.join(ROOT, a);
  if (!fs.existsSync(p)) fail("missing asset " + a);
  else {
    const n = fs.statSync(p).size;
    if (a.includes("pyodide.asm.wasm") && n < 1_000_000) fail("pyodide wasm too small " + n);
    if (a.includes("g.png") && n < 1000) fail("logo too small " + n);
  }
}
pass("core assets present with sane sizes");

// 3) Compaction unit
const code = fs.readFileSync(path.join(ROOT, "src/agent/loop/compaction.js"), "utf8");
const ctx = {
  agentState: { mission: "", missionClosed: false, compactionSummary: "", wave: 0 },
  agentHistory: [],
  appendMsg() {},
  getStateContext: () => "CURRENT GOAL: test",
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
ctx.agentState.mission = "extreme quality mission";
ctx.agentHistory = [{ role: "system", content: "sys" }];
for (let i = 0; i < 40; i++) {
  ctx.agentHistory.push({ role: "user", content: "u" + i });
  ctx.agentHistory.push({
    role: "assistant",
    content: null,
    tool_calls: [{ function: { name: "bash", arguments: '{"command":"echo ' + i + '"}' } }],
  });
  ctx.agentHistory.push({ role: "tool", name: "bash", content: "out " + i + " " + "x".repeat(500) });
}
const r = ctx.maybeCompactAgentHistory({ force: true });
if (!r.compacted) fail("compaction did not run");
if (!ctx.agentState.compactionSummary.includes("PRIMARY USER REQUEST")) fail("summary missing mission");
if (!ctx.agentState.compactionSummary.includes("extreme quality mission")) fail("mission not in summary");
if (ctx.compactToolResult("z".repeat(20000)).length > 7000) fail("tool compact too large");
pass("compaction preserves mission + shrinks context");

// 4) detectToolLoop never blocks — load anti-repeat
const ar = fs.readFileSync(path.join(ROOT, "src/agent/loop/anti-repeat.js"), "utf8");
const ctx2 = { recentToolFingerprints: [], pathActionCounts: Object.create(null) };
// need fingerprintTool + detectToolLoop only
vm.createContext(ctx2);
// define minimal + run both files' loop parts
vm.runInContext(code + "\n" + ar.split("function persistAgentChat")[0], ctx2);
const d1 = ctx2.detectToolLoop("bash", { command: "ls" });
const d2 = ctx2.detectToolLoop("bash", { command: "ls" });
const d3 = ctx2.detectToolLoop("bash", { command: "ls" });
if (d1.loop || d2.loop || d3.loop) fail("detectToolLoop blocked tools");
else pass("tools never blocked by loop detector");

// 5) HTTP smoke if server up
await new Promise((resolve) => {
  const req = http.get("http://127.0.0.1:8080/", (res) => {
    if (res.statusCode === 200) pass("preview HTTP 200");
    else fail("preview status " + res.statusCode);
    res.resume();
    resolve();
  });
  req.on("error", () => { fail("preview server not reachable"); resolve(); });
  req.setTimeout(2000, () => { req.destroy(); fail("preview timeout"); resolve(); });
});

console.log("\n=== GOAR quality check ===");
for (const m of ok) console.log("  OK  ", m);
for (const m of issues) console.log("  FAIL", m);
console.log(issues.length ? "\nFAILED " + issues.length : "\nALL GATES PASSED");
process.exit(issues.length ? 1 : 0);
