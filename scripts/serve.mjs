#!/usr/bin/env node
/**
 * Static server for modular GOAR — 0.0.0.0:8080
 * + Manus-compatible CORS helpers:
 *   POST /api/manus-key  → mint local key (or pass-through Manus when env set)
 *   ALL  /api/cors-proxy → ?url= target (Manus-shaped query)
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
  ".gz": "application/gzip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".zst": "application/octet-stream",
  ".webp": "image/webp",
  ".php": "text/plain",
};

// In-memory local keys (process lifetime) — enough for pysec session
const LOCAL_KEYS = new Set();

function coi(res) {
  // credentialless: enables SharedArrayBuffer for Gecko without blocking Pyodide CDN
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-target-url, Accept, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function fetchUrl(target, method, headers, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(target);
    } catch (e) {
      reject(e);
      return;
    }
    if (!/^https?:$/.test(u.protocol)) {
      reject(new Error("only http(s)"));
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const hdrs = { "user-agent": "GOAR-CORS/1.0", accept: "*/*", ...(headers || {}) };
    // strip hop-by-hop
    delete hdrs.host;
    delete hdrs.connection;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: method || "GET",
        headers: hdrs,
        timeout: 30000,
      },
      (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          resolve({
            status: r.statusCode || 0,
            headers: r.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body && body.length) req.write(body);
    req.end();
  });
}

function isBlockedHost(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

async function handleManusKey(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const r = await fetchUrl(
      "https://cors.manus.space/api/trpc/apiKey.generate",
      "POST",
      { "content-type": "application/json", accept: "application/json" },
      Buffer.from(JSON.stringify({ json: { label: "goar" } })),
    );
    const j = JSON.parse(r.body.toString("utf8") || "{}");
    const key =
      (j && j.result && j.result.data && j.result.data.json && j.result.data.json.key) ||
      j.key ||
      "";
    if (key) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, key, source: "cors.manus.space", label: "goar" }));
      return;
    }
  } catch (e) {
    console.warn("[goar] manus mint", e && e.message);
  }
  res.writeHead(502, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "could not mint cors.manus.space key" }));
}

async function handleCorsProxy(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const u = new URL(req.url || "/", "http://local");
  let target = u.searchParams.get("url") || "";
  const apikey = u.searchParams.get("apikey") || req.headers["x-api-key"] || "";
  if (!target && req.headers["x-target-url"]) target = String(req.headers["x-target-url"]);
  if (!target) {
    const p = decodeURIComponent((req.url || "").split("?")[0] || "");
    if (p.startsWith("/api/proxy/") && p.length > 11) target = p.slice(11);
  }
  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      return;
    }
    // optional JSON {url}
    if (!target && body && body.length) {
      try {
        const j = JSON.parse(body.toString("utf8"));
        if (j && j.url) target = j.url;
      } catch (_) {}
    }
  }
  if (!target) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "url required" }));
    return;
  }
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid url" }));
    return;
  }
  if (isBlockedHost(parsed.hostname)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "blocked host" }));
    return;
  }
  const method = (u.searchParams.get("method") || req.method || "GET").toUpperCase();
  const fwd = {};
  if (req.headers.authorization) fwd.authorization = req.headers.authorization;
  if (req.headers["content-type"]) fwd["content-type"] = req.headers["content-type"];
  try {
    const r = await fetchUrl(target, method === "HEAD" ? "GET" : method, fwd, body);
    res.writeHead(r.status || 200, {
      "content-type": r.headers["content-type"] || "application/octet-stream",
      "x-goar-proxy": "local",
      "access-control-expose-headers": "*",
    });
    res.end(r.body);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/api/manus-key") return handleManusKey(req, res);
    if (urlPath === "/api/cors-proxy" || urlPath === "/api/proxy" || urlPath.startsWith("/api/proxy/")) {
      return handleCorsProxy(req, res);
    }

    let p = urlPath;
    if (p === "/") p = "/GOAR.html";
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": ext === ".html" || ext === ".js" || ext === ".css" || ext === ".zip" || ext === ".gz" ? "no-cache" : "public, max-age=3600",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Content-Length": String(fs.statSync(file).size),
    };
    if (p.endsWith("/sw.js") || p === "/sw.js") {
      headers["Service-Worker-Allowed"] = "/";
      headers["cache-control"] = "no-cache";
    }
    if (/\.(wasm|zst)$/i.test(p)) {
      headers["cache-control"] = "public, max-age=31536000, immutable";
    }
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[goar] modular server http://${HOST}:${PORT}/  root=${ROOT}`);
  console.log(`[goar] /api/manus-key  /api/cors-proxy ready`);
});
