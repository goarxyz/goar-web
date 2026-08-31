const GOAR_KIT_PY = "#!/usr/bin/env python3\n\"\"\"GOAR Kit \u2014 purpose-built helpers for the browser Alpine sandbox.\nDesigned for: low RAM, BusyBox, CPython 3.11, agent tool calls, personal WebView use.\nAuthorized testing only for remote targets.\n\"\"\"\nfrom __future__ import annotations\nimport argparse, json, os, re, socket, ssl, sys, time, urllib.error, urllib.request\nfrom pathlib import Path\n\nWS = Path(os.environ.get(\"GOAR_WORKDIR\", \"/workspace\"))\nOPT = Path(\"/opt/goar\")\n\ndef out(obj):\n    if isinstance(obj, (dict, list)):\n        print(json.dumps(obj, indent=2, default=str)[:12000])\n    else:\n        print(str(obj)[:12000])\n\ndef cmd_status(_):\n    import platform, shutil\n    py_mods = []\n    for m in (\"flask\", \"requests\", \"sqlmap\", \"pip\"):\n        try:\n            __import__(m if m != \"pip\" else \"pip\")\n            py_mods.append(m + \":yes\")\n        except Exception:\n            py_mods.append(m + \":no\")\n    bins = {b: bool(shutil.which(b)) for b in (\"curl\", \"wget\", \"python3\", \"pip3\", \"sqlmap\", \"nmap\", \"git\")}\n    net = {\"dns\": None, \"https\": None}\n    try:\n        socket.getaddrinfo(\"1.1.1.1\", 443)\n        net[\"dns\"] = \"ok\"\n    except Exception as e:\n        net[\"dns\"] = str(e)[:80]\n    try:\n        ctx = ssl.create_default_context()\n        urllib.request.urlopen(\"https://1.1.1.1\", timeout=5, context=ctx).read(16)\n        net[\"https\"] = \"ok\"\n    except Exception as e:\n        net[\"https\"] = str(e)[:100]\n    out({\n        \"product\": \"GOAR Build kit\",\n        \"workdir\": str(WS),\n        \"python\": sys.version.split()[0],\n        \"platform\": platform.platform(),\n        \"bins\": bins,\n        \"modules\": py_mods,\n        \"net\": net,\n        \"workspace_exists\": WS.is_dir(),\n        \"files_top\": sorted([p.name for p in WS.iterdir()])[:40] if WS.is_dir() else [],\n    })\n\ndef cmd_tree(a):\n    root = Path(a.path or str(WS))\n    max_depth = int(a.depth or 3)\n    max_files = int(a.limit or 120)\n    lines = []\n    n = 0\n    for dirpath, dirnames, filenames in os.walk(root):\n        rel = Path(dirpath).relative_to(root) if dirpath != str(root) else Path(\".\")\n        depth = 0 if str(rel) == \".\" else len(rel.parts)\n        if depth > max_depth:\n            dirnames[:] = []\n            continue\n        dirnames[:] = [d for d in sorted(dirnames) if d not in (\".git\", \"__pycache__\", \"node_modules\", \".venv\")][:30]\n        for fn in sorted(filenames)[:40]:\n            if n >= max_files:\n                lines.append(\"\u2026 truncated\")\n                out(\"\\n\".join(lines)); return\n            p = Path(dirpath) / fn\n            try:\n                sz = p.stat().st_size\n            except Exception:\n                sz = -1\n            lines.append(f\"{rel / fn}  ({sz}b)\")\n            n += 1\n    out(\"\\n\".join(lines) if lines else \"(empty)\")\n\ndef cmd_py_check(a):\n    path = Path(a.path or \"\")\n    if not path.exists():\n        out({\"ok\": False, \"error\": \"missing \" + str(path)}); return\n    import py_compile\n    try:\n        py_compile.compile(str(path), doraise=True)\n        compile_ok = True\n        cerr = None\n    except Exception as e:\n        compile_ok = False\n        cerr = str(e)\n    # optional import smoke for modules under /workspace\n    imp = None\n    if a.imports:\n        import importlib.util\n        spec = importlib.util.spec_from_file_location(\"goar_mod\", str(path))\n        try:\n            mod = importlib.util.module_from_spec(spec)\n            spec.loader.exec_module(mod)\n            imp = \"import_ok\"\n        except Exception as e:\n            imp = \"import_fail: \" + str(e)[:300]\n    out({\"ok\": compile_ok, \"compile\": \"ok\" if compile_ok else cerr, \"import\": imp, \"path\": str(path)})\n\ndef cmd_secret_scan(a):\n    root = Path(a.path or str(WS))\n    pats = [\n        (r\"sk-[a-zA-Z0-9]{20,}\", \"openai_like_key\"),\n        (r\"sk-or-v1-[a-f0-9]{20,}\", \"openrouter_key\"),\n        (r\"gsk_[a-zA-Z0-9]{20,}\", \"groq_key\"),\n        (r\"nvapi-[A-Za-z0-9_-]{20,}\", \"nvidia_key\"),\n        (r\"AKIA[0-9A-Z]{16}\", \"aws_access_key\"),\n        (r\"-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----\", \"private_key\"),\n        (r\"(?i)password\\s*=\\s*['\\\"][^'\\\"]{6,}\", \"password_assign\"),\n    ]\n    hits = []\n    for dirpath, dirnames, filenames in os.walk(root):\n        dirnames[:] = [d for d in dirnames if d not in (\".git\", \"__pycache__\", \".venv\")]\n        for fn in filenames:\n            if fn.endswith((\".png\", \".jpg\", \".wasm\", \".gz\", \".whl\", \".zip\")):\n                continue\n            p = Path(dirpath) / fn\n            try:\n                if p.stat().st_size > 400_000:\n                    continue\n                text = p.read_text(errors=\"ignore\")\n            except Exception:\n                continue\n            for rx, label in pats:\n                for m in re.finditer(rx, text):\n                    hits.append({\"file\": str(p), \"type\": label, \"snippet\": m.group(0)[:24] + \"\u2026\"})\n                    if len(hits) >= 40:\n                        out({\"hits\": hits, \"note\": \"cap 40\"}); return\n    out({\"hits\": hits, \"count\": len(hits)})\n\ndef cmd_net_diag(_):\n    tests = []\n    for host in (\"1.1.1.1\", \"8.8.8.8\", \"openrouter.ai\", \"pypi.org\"):\n        t0 = time.time()\n        try:\n            socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)\n            tests.append({\"host\": host, \"dns_ms\": int((time.time()-t0)*1000), \"ok\": True})\n        except Exception as e:\n            tests.append({\"host\": host, \"ok\": False, \"err\": str(e)[:100]})\n    https = []\n    ctx = ssl.create_default_context()\n    for url in (\"https://api.ipify.org\", \"https://httpbin.org/get\"):\n        t0 = time.time()\n        try:\n            with urllib.request.urlopen(url, timeout=8, context=ctx) as r:\n                body = r.read(120).decode(errors=\"ignore\")\n            https.append({\"url\": url, \"ms\": int((time.time()-t0)*1000), \"status\": r.status, \"body\": body[:80]})\n        except Exception as e:\n            https.append({\"url\": url, \"err\": str(e)[:120]})\n    out({\"dns\": tests, \"https\": https})\n\ndef _fetch(url, method=\"GET\", data=None, headers=None, timeout=12):\n    ctx = ssl.create_default_context()\n    h = {\"User-Agent\": \"GOAR-Kit/1.0 (personal-lab)\"}\n    if headers:\n        h.update(headers)\n    req = urllib.request.Request(url, data=data, headers=h, method=method)\n    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:\n        body = r.read(8000)\n        return {\"status\": r.status, \"headers\": dict(r.headers), \"body\": body.decode(errors=\"replace\")[:4000]}\n\ndef cmd_http_audit(a):\n    url = a.url\n    if not url.startswith(\"http\"):\n        url = \"https://\" + url\n    try:\n        r = _fetch(url)\n    except Exception as e:\n        out({\"ok\": False, \"error\": str(e)}); return\n    h = {k.lower(): v for k, v in r[\"headers\"].items()}\n    checks = {\n        \"strict-transport-security\": \"hsts\",\n        \"content-security-policy\": \"csp\",\n        \"x-frame-options\": \"xfo\",\n        \"x-content-type-options\": \"xcto\",\n        \"referrer-policy\": \"referrer\",\n        \"permissions-policy\": \"permissions\",\n    }\n    present = {name: (hdr in h) for hdr, name in checks.items()}\n    server = h.get(\"server\", \"\")\n    powered = h.get(\"x-powered-by\", \"\")\n    out({\n        \"url\": url,\n        \"status\": r[\"status\"],\n        \"security_headers\": present,\n        \"server\": server,\n        \"x_powered_by\": powered,\n        \"set_cookie\": \"set-cookie\" in h,\n        \"body_preview\": r[\"body\"][:500],\n    })\n\ndef cmd_param_probe(a):\n    \"\"\"Light reflection / error probe \u2014 not a replacement for sqlmap.\"\"\"\n    url = a.url\n    if \"?\" not in url:\n        out({\"ok\": False, \"error\": \"provide URL with query params e.g. ?id=1\"}); return\n    base, qs = url.split(\"?\", 1)\n    # parse simple k=v\n    pairs = []\n    for part in qs.split(\"&\"):\n        if \"=\" in part:\n            k, v = part.split(\"=\", 1)\n            pairs.append((k, v))\n    payloads = [\"'\", \"\\\"\", \"1 OR 1=1\", \"<goar>\", \"../../../etc/passwd\"]\n    findings = []\n    ctx = ssl.create_default_context()\n    for k, v in pairs[:6]:\n        for p in payloads:\n            # rebuild qs with one param mutated\n            bits = []\n            for kk, vv in pairs:\n                bits.append(f\"{kk}={p if kk==k else vv}\")\n            test = base + \"?\" + \"&\".join(bits)\n            try:\n                req = urllib.request.Request(test, headers={\"User-Agent\": \"GOAR-Kit/1.0\"})\n                with urllib.request.urlopen(req, timeout=10, context=ctx) as r:\n                    body = r.read(5000).decode(errors=\"ignore\")\n                    status = r.status\n            except urllib.error.HTTPError as e:\n                body = (e.read() or b\"\").decode(errors=\"ignore\")[:5000]\n                status = e.code\n            except Exception as e:\n                findings.append({\"param\": k, \"payload\": p, \"err\": str(e)[:100]})\n                continue\n            signals = []\n            if p in body and p not in v:\n                signals.append(\"reflected\")\n            if re.search(r\"sql|syntax|mysql|postgres|odbc|sqlite|ora-\\d\", body, re.I):\n                signals.append(\"sql_error_like\")\n            if re.search(r\"exception|traceback|stack trace\", body, re.I):\n                signals.append(\"stack_like\")\n            if status >= 500:\n                signals.append(\"http_\" + str(status))\n            if signals:\n                findings.append({\"param\": k, \"payload\": p, \"status\": status, \"signals\": signals})\n    out({\"url\": url, \"findings\": findings, \"note\": \"light probe only \u2014 use sqlmap tool for deep SQLi on authorized targets\"})\n\ndef cmd_serve(a):\n    path = Path(a.path or str(WS))\n    port = int(a.port or 8000)\n    log = f\"/tmp/goar_serve_{port}.log\"\n    # start background\n    os.system(f\"cd {path} && nohup python3 -m http.server {port} >{log} 2>&1 &\")\n    time.sleep(0.4)\n    out({\"ok\": True, \"path\": str(path), \"port\": port, \"log\": log, \"hint\": f\"curl http://127.0.0.1:{port}/ from guest\"})\n\ndef cmd_note(a):\n    p = WS / \"NOTES.md\"\n    WS.mkdir(parents=True, exist_ok=True)\n    line = a.text or \"\"\n    with p.open(\"a\") as f:\n        f.write(f\"\\n## {time.strftime('%Y-%m-%d %H:%M:%S')}\\n{line}\\n\")\n    out({\"ok\": True, \"file\": str(p), \"bytes\": p.stat().st_size})\n\ndef cmd_run_capture(a):\n    import subprocess\n    cmd = a.cmd\n    timeout = int(a.timeout or 60)\n    log = Path(a.log or \"/tmp/goar_run.log\")\n    try:\n        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)\n        log.write_text((r.stdout or \"\") + \"\\n--- stderr ---\\n\" + (r.stderr or \"\"))\n        out({\"code\": r.returncode, \"stdout\": (r.stdout or \"\")[:4000], \"stderr\": (r.stderr or \"\")[:2000], \"log\": str(log)})\n    except subprocess.TimeoutExpired:\n        out({\"code\": -1, \"error\": \"timeout\", \"log\": str(log)})\n\ndef main():\n    ap = argparse.ArgumentParser(prog=\"goar_kit\")\n    sub = ap.add_subparsers(dest=\"cmd\", required=True)\n    sub.add_parser(\"status\")\n    p = sub.add_parser(\"tree\"); p.add_argument(\"--path\"); p.add_argument(\"--depth\"); p.add_argument(\"--limit\")\n    p = sub.add_parser(\"py_check\"); p.add_argument(\"--path\", required=True); p.add_argument(\"--imports\", action=\"store_true\")\n    p = sub.add_parser(\"secret_scan\"); p.add_argument(\"--path\")\n    sub.add_parser(\"net_diag\")\n    p = sub.add_parser(\"http_audit\"); p.add_argument(\"--url\", required=True)\n    p = sub.add_parser(\"param_probe\"); p.add_argument(\"--url\", required=True)\n    p = sub.add_parser(\"serve\"); p.add_argument(\"--path\"); p.add_argument(\"--port\")\n    p = sub.add_parser(\"note\"); p.add_argument(\"--text\", required=True)\n    p = sub.add_parser(\"run_capture\"); p.add_argument(\"--cmd\", required=True); p.add_argument(\"--timeout\"); p.add_argument(\"--log\")\n    a = ap.parse_args()\n    {\n        \"status\": cmd_status,\n        \"tree\": cmd_tree,\n        \"py_check\": cmd_py_check,\n        \"secret_scan\": cmd_secret_scan,\n        \"net_diag\": cmd_net_diag,\n        \"http_audit\": cmd_http_audit,\n        \"param_probe\": cmd_param_probe,\n        \"serve\": cmd_serve,\n        \"note\": cmd_note,\n        \"run_capture\": cmd_run_capture,\n    }[a.cmd](a)\n\nif __name__ == \"__main__\":\n    main()\n";


async function ensureGoarKit() {
  if (typeof goarPlaneReady === "function" ? !goarPlaneReady() : (!envReady && !window.__GOAR_UNIX)) return { ok: false, error: "env not ready" };
  // idempotent: write full kit if missing, short, or outdated
  const chk = await guestExec("wc -c /opt/goar/goar_kit.py 2>/dev/null || echo 0", 15000);
  const n = parseInt(String(chk.output || "0").replace(/[^0-9]/g, "") || "0", 10) || 0;
  const want = (typeof GOAR_KIT_PY === "string") ? GOAR_KIT_PY.length : 0;
  if (n < Math.max(500, Math.floor(want * 0.9))) {
    await toolWrite({ path: "/opt/goar/goar_kit.py", content: GOAR_KIT_PY });
    await guestExec("mkdir -p /opt/goar /workspace; chmod +x /opt/goar/goar_kit.py 2>/dev/null; true", 15000);
  }
  return { ok: true, bytes: Math.max(n, want) };
}

async function kitRun(subcmd, extraArgs, timeoutMs) {
  await ensureGoarKit();
  const args = Array.isArray(extraArgs) ? extraArgs : [];
  // build safe argv
  const parts = ["python3", "/opt/goar/goar_kit.py", subcmd].concat(args);
  // use shell with carefully quoted args
  const q = (s) => {
    s = String(s);
    return "'" + s.replace(/'/g, "'\\''") + "'";
  };
  const cmd = parts.map(q).join(" ");
  const r = await guestExec(cmd, timeoutMs || 120000);
  return "exit " + r.code + "\n" + r.output;
}

async function toolKitStatus() { return kitRun("status", [], 60000); }
async function toolWorkspaceTree(args) {
  const path = String((args && args.path) || "/workspace");
  const depth = Math.max(1, Math.min(6, Number((args && args.depth) || 3)));
  const limit = Math.max(20, Math.min(400, Number((args && args.limit) || 220)));
  const root = path.replace(/\/+$/, "") || "/workspace";
  const lines = [];
  if (typeof Unix !== "undefined" && Unix.jsfs) {
    const keys = [];
    Unix.jsfs.forEach((_, p) => {
      if (p === root || p.indexOf(root + "/") === 0) keys.push(p);
    });
    keys.sort();
    for (const p of keys) {
      const rel = p === root ? root : p;
      const segs = p === root ? 0 : p.slice(root.length + 1).split("/").length;
      if (segs > depth) continue;
      lines.push(rel);
      if (lines.length >= limit) break;
    }
  }
  if (lines.length) return lines.join("\n");
  if (typeof guestExec !== "function") return "error: guest down";
  const r = await guestExec(
    "ls -la " + JSON.stringify(root),
    12000
  );
  const out = (r && r.output != null) ? r.output : String(r || "");
  return out || "(empty)";
}
async function toolPyCheck(args) {
  const a = ["--path", args.path || ""];
  if (args.imports) a.push("--imports");
  return kitRun("py_check", a, 60000);
}
async function toolSecretScan(args) {
  const a = [];
  if (args.path) a.push("--path", args.path);
  return kitRun("secret_scan", a, 90000);
}
async function toolNetDiag() { return kitRun("net_diag", [], 90000); }
async function toolHttpAudit(args) {
  return kitRun("http_audit", ["--url", args.url || ""], 60000);
}
async function toolParamProbe(args) {
  return kitRun("param_probe", ["--url", args.url || ""], 180000);
}
async function toolServeStatic(args) {
  const a = [];
  if (args.path) a.push("--path", args.path);
  if (args.port != null) a.push("--port", String(args.port));
  return kitRun("serve", a, 30000);
}
async function toolNote(args) {
  return kitRun("note", ["--text", args.text || ""], 15000);
}
async function toolRunCapture(args) {
  const a = ["--cmd", args.command || args.cmd || ""];
  if (args.timeout != null) a.push("--timeout", String(args.timeout));
  if (args.log) a.push("--log", args.log);
  return kitRun("run_capture", a, Number(args.timeout_ms || 120000));
}

async function ensureGuestSecurityKit() {
  if (typeof goarPlaneReady === "function" ? !goarPlaneReady() : (!envReady && !window.__GOAR_UNIX)) return { ok: false, error: "env not ready" };
  await toolWrite({ path: "/opt/goar/goar_recon.py", content: GOAR_RECON_PY });
  await ensureGoarKit();
  await guestExec("mkdir -p /opt/goar /workspace/security; chmod +x /opt/goar/goar_recon.py /opt/goar/goar_kit.py 2>/dev/null; true", 15000);
  return { ok: true };
}

async function ensureSqlmap() {
  if (typeof goarPlaneReady === "function" ? !goarPlaneReady() : (!envReady && !window.__GOAR_UNIX)) return { ok: false, error: "env not ready" };
  const chk = await guestExec("python3 -c 'import sqlmap; print(\"ok\")' 2>/dev/null || sqlmap --version 2>/dev/null | head -1 || which sqlmap || echo NOSQLMAP", 45000);
  const out = (chk && chk.output) || "";
  if (!/NOSQLMAP/.test(out) && (chk.code === 0 || /sqlmap|1\.\d/i.test(out))) {
    return { ok: true, cached: true, output: out.slice(0, 200) };
  }
  // 1) try network pip (best when virtio-net works)
  try { await ensureGuestNet(); } catch (_) {}
  if (typeof guestPipInstall === "function") {
    const pip = await guestPipInstall("sqlmap", 300000);
    if (pip && pip.ok) return { ok: true, via: pip.via || "pip", output: String(pip.output || "").slice(0, 400) };
  }
  const pip = await guestExec("python3 -m pip install --break-system-packages --disable-pip-version-check -q sqlmap 2>&1 | tail -8; python3 -c 'import sqlmap' 2>&1; which sqlmap; sqlmap --version 2>&1 | head -1", 300000);
  if (pip && pip.code === 0 && !/No module|not found|error/i.test(pip.output || "")) {
    return { ok: true, via: "pip", output: (pip.output || "").slice(0, 400) };
  }
  // 2) offline wheel from host assets
  const urls = [
    (typeof location !== "undefined" ? location.origin : "") + "/assets/security/sqlmap-offline.tar.gz",
    "/assets/security/sqlmap-offline.tar.gz",
    (typeof location !== "undefined" ? location.origin : "") + "/assets/security/sqlmap-1.10.8-py2.py3-none-any.whl",
  ];
  let buf = null, lastErr = "", used = "";
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) { lastErr = "HTTP " + r.status + " " + u; continue; }
      buf = new Uint8Array(await r.arrayBuffer());
      used = u;
      break;
    } catch (e) { lastErr = String(e && e.message ? e.message : e); }
  }
  if (!buf) {
    return { ok: false, error: "sqlmap install failed (pip + offline). pip: " + String(pip && pip.output || "").slice(0, 200) + " offline: " + lastErr };
  }
  // If wheel directly, install via pip from file after serial transfer is too heavy for 8MB —
  // prefer guest curl/wget of the same origin when network stack can reach host? Usually can't.
  // Transfer in chunks via write base64 is very slow; try guest pip from PyPI message already failed.
  // For offline: write wheel using toolWrite only if < 2MB; else instruct.
  if (buf.byteLength > 2_500_000) {
    // Still try: host fetch in browser → guest via multi-chunk base64 (slow but works once)
    const b64 = btoa(Array.from(buf, (c) => String.fromCharCode(c)).join(""));
    // too large for btoa of full 8MB might throw - use chunk encode
  }
  // Chunked b64 encode without giant join
  function u8ToB64(u8) {
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    return btoa(s);
  }
  let b64;
  try {
    b64 = u8ToB64(buf);
  } catch (e) {
    return { ok: false, error: "offline encode failed: " + e.message + "; use pip when network works" };
  }
  // Write b64 file in guest via printf chunks (same as toolWrite path) — may take time
  const isTar = /tar\.gz$/i.test(used) || (buf[0] === 0x1f && buf[1] === 0x8b);
  const dest = isTar ? "/tmp/sqlmap-offline.tar.gz" : "/tmp/sqlmap.whl";
  // Use toolWrite for b64? content is huge - use dedicated transfer
  const id = Math.random().toString(36).slice(2, 7);
  const start = "SS" + id, end = "SE" + id;
  const mark = serialBuf.length;
  const chunk = 48;
  send("rm -f /tmp/.sqlmap.b64; : > /tmp/.sqlmap.b64");
  await sleep(40);
  for (let i = 0; i < b64.length; i += chunk) {
    send("printf %s " + JSON.stringify(b64.slice(i, i + chunk)) + " >> /tmp/.sqlmap.b64");
    if (i % 5000 === 0) await sleep(4);
    else if (i % 500 === 0) await sleep(1);
  }
  send(
    "echo " + start + "; base64 -d /tmp/.sqlmap.b64 > " + dest +
    (isTar
      ? "; mkdir -p /tmp/sqlmap_off; tar -xzf " + dest + " -C /tmp/sqlmap_off; pip3 install --break-system-packages --no-index --find-links=/tmp/sqlmap_off sqlmap 2>&1 | tail -15"
      : "; pip3 install --break-system-packages " + dest + " 2>&1 | tail -15") +
    "; sqlmap --version 2>&1 | head -1; python3 -c 'import sqlmap' 2>&1; echo " + end + ":$?"
  );
  const re = new RegExp(end + ":([0-9]+)");
  await waitForSerial(re, 600000);
  const body = serialBuf.slice(mark);
  const m = body.match(re);
  const code = m ? Number(m[1]) : 1;
  return { ok: code === 0, via: "offline:" + used, code, output: body.slice(-500) };
}

async function toolEnsureSqlmap(args) {
  const r = await ensureSqlmap();
  return JSON.stringify(r);
}

async function toolSqlmap(args) {
  // Authorized security testing only — Operator supplies target.
  const target = String(args.url || args.target || "").trim();
  if (!target) return "error: url/target required (authorized targets only)";
  const extra = String(args.args || args.flags || "").trim();
  // hard refuse clearly dangerous mass options unless operator passed them explicitly in flags
  const ensure = await ensureSqlmap();
  if (!ensure.ok) return "sqlmap unavailable: " + JSON.stringify(ensure);
  // Prefer CLI entrypoints
  const base = "sqlmap -u " + JSON.stringify(target) + " --batch --random-agent --level=" +
    String(args.level || 1) + " --risk=" + String(args.risk || 1);
  const cmd = (extra ? base + " " + extra : base + " --technique=BEUSTQ --threads=2") + " 2>&1 | tail -80";
  const r = await guestExec(cmd, Number(args.timeout_ms || 300000));
  return "exit " + r.code + "\n" + r.output;
}

async function toolPortScan(args) {
  await ensureGuestSecurityKit();
  const target = String(args.target || args.host || "").trim();
  if (!target) return "error: target required";
  const ports = String(args.ports || "21,22,80,443,3306,8080,8443,8000,5000");
  // Prefer nmap if present
  const hasNmap = await guestExec("command -v nmap >/dev/null && echo YES || echo NO", 10000);
  if (hasNmap && /YES/.test(hasNmap.output || "")) {
    const r = await guestExec("nmap -Pn -sT --top-ports " + (args.top || "100") + " " + JSON.stringify(target) + " 2>&1 | tail -60", Number(args.timeout_ms || 180000));
    return "exit " + r.code + "\n" + r.output;
  }
  const r = await guestExec("python3 /opt/goar/goar_recon.py ports " + JSON.stringify(target) + " --ports " + JSON.stringify(ports) + " 2>&1", 120000);
  return "exit " + r.code + "\n" + r.output + "\n(note: pure-python scan; install nmap via apk for deeper scans)";
}

async function toolHttpProbe(args) {
  await ensureGuestSecurityKit();
  const url = String(args.url || args.target || "").trim();
  if (!url) return "error: url required";
  const r = await guestExec("python3 /opt/goar/goar_recon.py http " + JSON.stringify(url) + " 2>&1", 60000);
  return "exit " + r.code + "\n" + r.output;
}

async function toolInstallSecurity(args) {
  const which = String(args.package || "sqlmap").toLowerCase();
  if (which === "sqlmap") return JSON.stringify(await ensureSqlmap());
  if (which === "nmap" || which === "recon") {
    return { ok: false, error: "nmap is not in this Wasm Unix. Use pysec recon or python." };
  }
  return "unknown package — use sqlmap or nmap";
}




/* ===== pyodide_security 8.1.0 EMBEDDED (gzip tar) ===== */
