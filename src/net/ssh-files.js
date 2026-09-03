/**
 * Browser-side Kali file plane (SFTP-class get/put over the live SSH PTY).
 * No backend. No Cloudflare. Bytes stay in this tab until they hit the VM.
 */
(function (global) {
  "use strict";

  function sshLive() {
    try {
      if (typeof sshReady === "function" && sshReady()) return true;
      if (global.SSH && global.SSH.ready) return true;
    } catch (_) {}
    return false;
  }

  async function bring(reason) {
    if (sshLive()) return true;
    if (typeof ensureSsh !== "function") return false;
    try {
      const st = await ensureSsh({ reason: reason || "sftp" });
      return !!(st && st.ready) || sshLive();
    } catch (_) {
      return sshLive();
    }
  }

  async function run(cmd, timeoutMs) {
    await bring("sftp");
    if (typeof sshExec !== "function" || !sshLive()) {
      return { code: -1, output: "Kali SSH not ready" };
    }
    return sshExec(cmd, timeoutMs || 120000);
  }

  function shq(s) {
    return "'" + String(s || "").replace(/'/g, "'\\''") + "'";
  }

  function b64utf8(s) {
    return btoa(unescape(encodeURIComponent(String(s == null ? "" : s))));
  }

  function utf8b64(b64) {
    try {
      return decodeURIComponent(escape(atob(String(b64 || "").replace(/\s+/g, ""))));
    } catch (_) {
      try {
        return atob(String(b64 || "").replace(/\s+/g, ""));
      } catch (e) {
        return "";
      }
    }
  }

  async function put(path, content) {
    path = String(path || "").trim();
    if (!path) return { code: -1, output: "path required" };
    const b64 = b64utf8(content);
    const id = Math.random().toString(36).slice(2, 10);
    const tmp = "/tmp/.gsftp." + id + ".b64";
    if (b64.length <= 12000) {
      const py =
        "python3 -c " +
        shq(
          "import os,base64,pathlib,sys\n" +
            "p=pathlib.Path(sys.argv[1])\n" +
            "p.parent.mkdir(parents=True, exist_ok=True)\n" +
            "data=base64.b64decode(sys.argv[2].encode())\n" +
            "t=p.with_name(p.name+'.goartmp')\n" +
            "t.write_bytes(data)\n" +
            "t.replace(p)\n" +
            "print('WROTE',len(data))\n"
        ) +
        " " +
        shq(path) +
        " " +
        shq(b64);
      return run(py, 120000);
    }
    const chunk = 8000;
    let r = await run(": > " + shq(tmp), 20000);
    if (r && Number(r.code) !== 0) return r;
    for (let i = 0; i < b64.length; i += chunk) {
      r = await run("printf %s " + shq(b64.slice(i, i + chunk)) + " >> " + shq(tmp), 20000);
      if (r && Number(r.code) !== 0) return r;
    }
    return run(
      "python3 -c " +
        shq(
          "import os,base64,pathlib,sys\n" +
            "p=pathlib.Path(sys.argv[1]); b=pathlib.Path(sys.argv[2])\n" +
            "p.parent.mkdir(parents=True, exist_ok=True)\n" +
            "data=base64.b64decode(b.read_bytes())\n" +
            "t=p.with_name(p.name+'.goartmp')\n" +
            "t.write_bytes(data); t.replace(p); b.unlink(missing_ok=True)\n" +
            "print('WROTE',len(data))\n"
        ) +
        " " +
        shq(path) +
        " " +
        shq(tmp),
      180000
    );
  }

  async function get(path, maxBytes) {
    path = String(path || "").trim();
    if (!path) return { code: -1, output: "path required", content: "" };
    maxBytes = Math.min(Number(maxBytes || 200000) || 200000, 500000);
    const r = await run(
      "python3 -c " +
        shq(
          "import pathlib,base64,sys\n" +
            "p=pathlib.Path(sys.argv[1]); n=int(sys.argv[2])\n" +
            "if not p.exists():\n" +
            "    sys.stderr.write('ENOENT\\n'); sys.exit(2)\n" +
            "data=p.read_bytes()[:n]\n" +
            "sys.stdout.write(base64.b64encode(data).decode())\n"
        ) +
        " " +
        shq(path) +
        " " +
        String(maxBytes),
      60000
    );
    const raw = String((r && r.output) || "").replace(/\s+/g, "");
    const content = r && Number(r.code) === 0 ? utf8b64(raw) : "";
    return { code: r ? r.code : -1, output: r && Number(r.code) !== 0 ? String(r.output || "") : "", content: content };
  }

  async function list(path) {
    path = String(path || ".").trim() || ".";
    return run("ls -la -- " + shq(path), 30000);
  }

  async function stat(path) {
    path = String(path || "").trim();
    if (!path) return { code: -1, output: "path required" };
    return run("stat -- " + shq(path), 15000);
  }

  async function mkdir(path) {
    path = String(path || "").trim();
    if (!path) return { code: -1, output: "path required" };
    return run("mkdir -p -- " + shq(path) + " && ls -ld -- " + shq(path), 15000);
  }

  async function rm(path) {
    path = String(path || "").trim();
    if (!path) return { code: -1, output: "path required" };
    return run("rm -f -- " + shq(path) + " && echo RM_OK", 15000);
  }

  const api = { put: put, get: get, list: list, stat: stat, mkdir: mkdir, rm: rm, bring: bring };
  try {
    global.sshFiles = api;
    global.GOAR_SFTP = api;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
