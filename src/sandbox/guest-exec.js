let __guestExecTail = Promise.resolve();

async function guestExec(command, timeoutMs = 180000) {
  if (typeof unixExec === "function" && (typeof Unix === "undefined" || Unix.ready || window.__GOAR_UNIX)) {
    try {
      if (window.__GOAR_UNIX || (typeof Unix !== "undefined" && Unix.ready)) {
        return unixExec(command, timeoutMs);
      }
    } catch (e) {
      if (!window.GOAR_USE_V86) throw e;
    }
  }
  const run = () => guestExecUnlocked(command, timeoutMs);
  const next = __guestExecTail.then(run, run);
  __guestExecTail = next.then(function () {}, function () {});
  return next;
}

async function guestExecUnlocked(command, timeoutMs = 180000) {
  const emu = window.__emulator || (typeof emulator !== "undefined" ? emulator : null);
  if (!emu || typeof send !== "function") throw new Error("Guest environment not ready");
  const id = Math.random().toString(36).slice(2, 7);
  const start = "GOS" + id;
  const end = "GOE" + id;
  let cmd = String(command).replace(/\r/g, "");

  // python3 -c '…' cannot travel the serial console: quotes are eaten or
  // echoed as the payload. Rewrite to a file write + run. The long path
  // then base64-encodes the whole script so the snippet never hits serial.
  const dashC = cmd.match(/^\s*python3?\s+-c\s+(?:'([^']*)'|"([^"]*)")\s*(.*)$/);
  if (dashC) {
    const snippet = dashC[1] != null ? dashC[1] : dashC[2];
    const extra = (dashC[3] || "").trim();
    const staged = "/tmp/.goar_inline_" + id + ".py";
    const b64 = btoa(unescape(encodeURIComponent(snippet)));
    cmd =
      "printf %s " + JSON.stringify(b64) + " | base64 -d > " + staged +
      " && python3 " + staged + (extra ? " " + extra : "");
  }

  // Fast path only for plain single-line commands — no quotes, no python -c.
  const isShort =
    cmd.length <= 220 &&
    !cmd.includes("\n") &&
    !cmd.includes("base64") &&
    !/['"]/.test(cmd) &&
    !/\bpython3?\s+-c\b/.test(cmd);
  if (isShort) {
    try { emu.serial0_send("\n"); } catch (_) {}
    await sleep(40);
    const mark = serialBuf.length;
    const one = cmd.replace(/;/g, " ; ");
    send("echo " + start + "; { " + one + " ; } > /tmp/.gout." + id + " 2>&1; EC=$?; tail -c 12000 /tmp/.gout." + id + " 2>/dev/null; echo " + end + ":$EC");
    const re = new RegExp(end + ":([0-9]+)");
    let ok = await waitForSerial(re, timeoutMs);
    let out = typeof serialBuf === "string" ? serialBuf.slice(mark) : "";
    let m = out.match(re);
    if (!ok || !m) {
      try { emu.serial0_send("\n"); } catch (_) {}
      return { code: -1, output: (out || "").slice(0, 8000) || "timeout" };
    }
    let body = out;
    const sIdx = out.lastIndexOf(start);
    const eIdx = out.lastIndexOf(end);
    if (sIdx >= 0 && eIdx > sIdx) body = out.slice(sIdx + start.length, eIdx);
    body = body.split("\n").filter((ln) => {
      const s = ln.trim();
      if (!s) return false;
      if (s === start || s.startsWith(end)) return false;
      if (s.includes("/tmp/.gout") || s.includes("/tmp/.ginl") || s.includes("/tmp/.goar_inline")) return false;
      return true;
    }).join("\n").trim();
    try { emu.serial0_send("\n"); } catch (_) {}
    return { code: Number(m[1]), output: body.slice(0, 500000) };
  }

  try { emu.serial0_send("\u0003"); } catch (_) {}
  await sleep(60);
  try { emu.serial0_send("\n"); } catch (_) {}
  await sleep(40);

  const mark = serialBuf.length;

  // Capture all output to a temp file so long jobs (pip) cannot flood serial.
  const full = [
    "echo " + start,
    "{",
    cmd,
    "} > /tmp/.gout." + id + " 2>&1",
    "EC=$?",
    "tail -c 12000 /tmp/.gout." + id + " 2>/dev/null || true",
    "echo " + end + ":$EC",
  ].join("\n");

  const payload = btoa(unescape(encodeURIComponent(full)));
  const chunk = 64;
  send(": > /tmp/.grun.b64");
  await sleep(15);
  for (let i = 0; i < payload.length; i += chunk) {
    send("printf %s " + JSON.stringify(payload.slice(i, i + chunk)) + " >> /tmp/.grun.b64");
    await sleep(2);
  }
  send("base64 -d /tmp/.grun.b64 > /tmp/.grun.sh && sh /tmp/.grun.sh");


  const re = new RegExp(end + ":([0-9]+)");
  let ok = await waitForSerial(re, timeoutMs);
  let out = typeof serialBuf === "string" ? serialBuf.slice(mark) : "";
  let m = out.match(re);

  if (!ok || !m) {
    if (!/['"]/.test(cmd) && !/\bpython3?\s+-c\b/.test(cmd)) {
      const mark2 = serialBuf.length;
      const one = cmd.replace(/\n+/g, " ; ").slice(0, 280);
      send("echo " + start + "; { " + one + " ; } 2>&1 | tail -c 8000; echo " + end + ":$?");
      ok = await waitForSerial(re, Math.min(60000, timeoutMs));
      out = serialBuf.slice(mark2);
      m = out.match(re);
    }
  }

  let body = out;
  const sIdx = out.lastIndexOf(start);
  const eIdx = out.lastIndexOf(end);
  if (sIdx >= 0 && eIdx > sIdx) body = out.slice(sIdx + start.length, eIdx);
  body = body.split("\n").filter((ln) => {
    const s = ln.trim();
    if (!s) return false;
    if (s.startsWith("printf %s")) return false;
    if (s.includes("/tmp/.grun") || s.includes("/tmp/.gout") || s.includes("/tmp/.ginl") || s.includes("/tmp/.goar_inline")) return false;
    if (s === start || s.startsWith(end)) return false;
    return true;
  }).join("\n").trim();

  try {
    const emu2 = window.__emulator || (typeof emulator !== "undefined" ? emulator : null);
    if (emu2 && typeof emu2.serial0_send === "function") emu2.serial0_send("\n");
  } catch (_) {}

  return { code: m ? Number(m[1]) : -1, output: body.slice(0, 500000) };
}


async function ensureGuestNet() {
  return guestExec(
    "ip link set lo up 2>/dev/null; ip link set eth0 up 2>/dev/null; " +
    "udhcpc -i eth0 -q -n -t 3 -T 2 2>/dev/null || true; " +
    "ip addr add 192.168.86.100/24 dev eth0 2>/dev/null || true; " +
    "ip route replace default via 192.168.86.1 dev eth0 2>/dev/null || true; " +
    "printf 'nameserver 192.168.86.1\\n' > /etc/resolv.conf; " +
    "python3 -m pip --version; echo NET_SETUP_OK",
    60000,
  );
}



async function installOfflineFlask() {
  try {
    if (!envReady) return { ok: false, error: "env not ready" };
    const chk = await guestExec("python3 -c 'import flask; print(1)' 2>/dev/null || echo NOFLASK", 30000);
    if (chk && Number(chk.code) === 0 && chk.output && !/NOFLASK/.test(chk.output)) {
      return { ok: true, cached: true, output: chk.output };
    }
    const urls = [
      (typeof location !== "undefined" ? location.origin : "") + "/assets/flask-offline.tar.gz",
      "/assets/flask-offline.tar.gz",
    ];
    let buf = null;
    let lastErr = "";
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (!r.ok) { lastErr = "HTTP " + r.status; continue; }
        buf = new Uint8Array(await r.arrayBuffer());
        break;
      } catch (e) { lastErr = String(e && e.message ? e.message : e); }
    }
    if (!buf) return { ok: false, error: "fetch wheels failed: " + lastErr };

    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + 0x8000, buf.length)));
    }
    const b64 = btoa(bin);
    const emu = window.__emulator || (typeof emulator !== "undefined" ? emulator : null);
    try { if (emu) emu.serial0_send("\u0003"); } catch (_) {}
    await sleep(80);
    const id = Math.random().toString(36).slice(2, 7);
    const start = "FS" + id;
    const end = "FE" + id;
    const mark = serialBuf.length;
    send(": > /tmp/flask-offline.b64");
    await sleep(30);
    for (let i = 0; i < b64.length; i += 48) {
      send("printf %s " + JSON.stringify(b64.slice(i, i + 48)) + " >> /tmp/flask-offline.b64");
      await sleep(3);
    }
    send(
      "echo " + start + "; " +
      "base64 -d /tmp/flask-offline.b64 > /tmp/flask-offline.tar.gz && " +
      "mkdir -p /opt/wheels && tar -xzf /tmp/flask-offline.tar.gz -C /opt/wheels && " +
      "pip install --break-system-packages --no-index --find-links=/opt/wheels flask 2>&1 | tail -25; " +
      "python3 -c 'import flask; print(chr(70)+chr(76)+chr(65)+chr(83)+chr(75)+chr(95)+chr(79)+chr(75))'; " +
      "echo " + end + ":$?"
    );
    const re = new RegExp(end + ":([0-9]+)");
    await waitForSerial(re, 300000);
    const out = serialBuf.slice(mark);
    return { ok: /FLASK_OK/.test(out), output: out.slice(-1000) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
window.__GOAR_INSTALL_FLASK = installOfflineFlask;

async function ensurePipDistlib() {
  if (window.__GOAR_PIP_READY) return { ok: true, cached: true };
  if (window.__GOAR_PIP_LOCK) return window.__GOAR_PIP_LOCK;
  window.__GOAR_PIP_LOCK = (async () => {
    try {
      const have = await guestExec(
        "test -f /usr/lib/python3.11/site-packages/pip/_vendor/distlib/scripts.py && echo DISTLIB_FILE",
        20000,
      );
      if (have && /DISTLIB_FILE/.test(String(have.output || ""))) {
        window.__GOAR_PIP_READY = true;
        return { ok: true, cached: true };
      }
    } catch (_) {}
    try {
      const chk = await guestExec(
        "python3 -c 'from pip._vendor.distlib.scripts import ScriptMaker; print(1)'",
        25000,
      );
      const out = String((chk && chk.output) || "").replace(/\r/g, "");
      if (chk && Number(chk.code) === 0 && /(^|\n)1\s*$/.test(out)) {
        window.__GOAR_PIP_READY = true;
        return { ok: true, cached: true };
      }
    } catch (_) {}
    const url = "./assets/pip-distlib.tgz";
    let buf = null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) buf = new Uint8Array(await res.arrayBuffer());
    } catch (_) {}
    if (!buf || !buf.length) return { ok: false, error: "no distlib pack" };
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + 0x8000, buf.length)));
    }
    const b64 = btoa(bin);
    send(": > /tmp/.distlib.b64");
    await sleep(30);
    for (let i = 0; i < b64.length; i += 48) {
      send("printf %s " + JSON.stringify(b64.slice(i, i + 48)) + " >> /tmp/.distlib.b64");
      if (i % 1920 === 0) await sleep(8);
    }
    const unpack = await guestExec(
      "base64 -d /tmp/.distlib.b64 > /tmp/.distlib.tgz && tar -xzf /tmp/.distlib.tgz -C /usr/lib/python3.11/site-packages/pip/_vendor && test -f /usr/lib/python3.11/site-packages/pip/_vendor/distlib/scripts.py && echo DISTLIB_FILE",
      90000,
    );
    const ok = !!(unpack && /DISTLIB_FILE/.test(String(unpack.output || "")));
    if (ok) window.__GOAR_PIP_READY = true;
    return { ok, output: unpack && unpack.output };
  })();
  try {
    return await window.__GOAR_PIP_LOCK;
  } finally {
    window.__GOAR_PIP_LOCK = null;
  }
}
window.__GOAR_ENSURE_PIP = ensurePipDistlib;

function u8ToB64(u8) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
  }
  return btoa(s);
}

async function injectGuestFile(dest, u8) {
  const b64 = u8ToB64(u8);
  const chunk = 96;
  send("rm -f /tmp/.ginj.b64; : > /tmp/.ginj.b64");
  await sleep(20);
  for (let i = 0; i < b64.length; i += chunk) {
    send("printf %s " + JSON.stringify(b64.slice(i, i + chunk)) + " >> /tmp/.ginj.b64");
    if (i % 3072 === 0) await sleep(6);
  }
  const r = await guestExec(
    "mkdir -p \"$(dirname " + JSON.stringify(dest) + ")\" && base64 -d /tmp/.ginj.b64 > " +
      JSON.stringify(dest) + " && wc -c " + JSON.stringify(dest),
    120000,
  );
  return r;
}

function pipSpecName(spec) {
  const tok = String(spec || "").trim().split(/\s+/).filter(Boolean)[0] || "";
  return tok.replace(/[\[<>=!~].*$/, "").replace(/[\\/].*$/, "") || tok;
}

async function hostFetchBytes(url) {
  if (typeof goarHostFetchBytes === "function") {
    const r = await goarHostFetchBytes(url);
    if (r && r.ok && r.bytes && r.bytes.byteLength) return r.bytes;
  }
  const hop = typeof buildManusProxyUrl === "function" ? buildManusProxyUrl(url) : url;
  const key = typeof readManusKey === "function" ? readManusKey() : "";
  const headers = key ? { "x-api-key": key, "x-target-url": url } : {};
  const res = await fetch(hop, { headers });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return new Uint8Array(await res.arrayBuffer());
}

async function hostInstallWheel(spec) {
  const name = pipSpecName(spec);
  if (!name || /^-/.test(name)) return { ok: false, error: "no package name" };
  let meta = null;
  try {
    const raw = await hostFetchBytes("https://pypi.org/pypi/" + encodeURIComponent(name) + "/json");
    meta = JSON.parse(new TextDecoder().decode(raw));
  } catch (e) {
    return { ok: false, error: "pypi metadata: " + String(e && e.message ? e.message : e) };
  }
  const files = (meta && meta.urls) || [];
  let file = files.find((u) => u.packagetype === "bdist_wheel" && /py3|py2.py3/i.test(u.filename || "") && /none-any/.test(u.filename || ""));
  if (!file) file = files.find((u) => u.packagetype === "bdist_wheel");
  if (!file) file = files.find((u) => u.packagetype === "sdist");
  if (!file || !file.url) return { ok: false, error: "no pypi artifact for " + name };
  let bytes;
  try {
    bytes = await hostFetchBytes(file.url);
  } catch (e) {
    return { ok: false, error: "wheel fetch: " + String(e && e.message ? e.message : e) };
  }
  const dest = "/tmp/wheels/" + (file.filename || (name + ".whl"));
  const put = await injectGuestFile(dest, bytes);
  if (!put || Number(put.code) !== 0) {
    return { ok: false, error: "inject failed", output: put && put.output };
  }
  const inst = await guestExec(
    "python3 -m pip install --break-system-packages --disable-pip-version-check --no-input " +
      JSON.stringify(dest) + " 2>&1 | tail -40",
    300000,
  );
  const out = String((inst && inst.output) || "");
  return {
    ok: !!(inst && Number(inst.code) === 0 && !/ModuleNotFoundError|No module named 'pip._vendor.distlib'/i.test(out)),
    via: "host-wheel",
    artifact: file.filename,
    output: out.slice(0, 4000),
  };
}

async function guestPipInstall(spec, timeoutMs) {
  spec = String(spec || "").trim();
  if (!spec) return { ok: false, error: "package required" };
  if (typeof unixRunPip === "function" || (window.__GOAR_UNIX && typeof unixExec === "function")) {
    const r = await unixExec("pip install " + spec, timeoutMs || 180000);
    const out = String((r && r.output) || "");
    return {
      ok: !!(r && Number(r.code) === 0 && !/ERROR:|not found/i.test(out)),
      via: "pyodide-micropip",
      output: out,
    };
  }
  try { await ensurePipDistlib(); } catch (_) {}
  try { await ensureGuestNet(); } catch (_) {}
  const cmd =
    "python3 -m pip install --break-system-packages --disable-pip-version-check --no-input --retries 1 --timeout 20 " +
    spec + " 2>&1 | tail -50";
  const r = await guestExec(cmd, 90000);
  const out = String((r && r.output) || "");
  const crashed = /ModuleNotFoundError|No module named 'pip._vendor.distlib'|ImportError/i.test(out);
  const netFail = /NewConnectionError|Failed to establish|Network is unreachable|Name or service not known|Temporary failure in name resolution|Max retries exceeded|Could not find a version|No matching distribution/i.test(out);
  if (r && Number(r.code) === 0 && !crashed && /Successfully installed|Requirement already|already satisfied/i.test(out)) {
    return { ok: true, via: "guest-pip", output: out };
  }
  if (r && Number(r.code) === 0 && !crashed && !netFail && !/ERROR/i.test(out)) {
    return { ok: true, via: "guest-pip", output: out };
  }
  if (crashed) {
    try { await ensurePipDistlib(); } catch (_) {}
    const r2 = await guestExec(cmd, 90000);
    const out2 = String((r2 && r2.output) || "");
    if (r2 && Number(r2.code) === 0 && !/ModuleNotFoundError|distlib/i.test(out2)) {
      return { ok: true, via: "guest-pip-retry", output: out2 };
    }
  }
  const host = await hostInstallWheel(spec);
  if (host.ok) return host;
  return {
    ok: false,
    via: "failed",
    output: out.slice(0, 2500),
    host: host,
  };
}
window.__GOAR_PIP_INSTALL = guestPipInstall;
