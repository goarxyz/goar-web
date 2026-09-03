/**
 * Kali-only execution plane. Pyodide / pysec / wasm-unix are not the workspace.
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
  async function bringKali(reason) {
    if (sshLive()) return true;
    if (typeof ensureSsh !== "function") return false;
    try {
      const st = await ensureSsh({ reason: reason || "kali-only" });
      return !!(st && st.ready) || sshLive();
    } catch (_) { return sshLive(); }
  }
  function dead(msg) {
    return { code: -1, output: msg || "Kali VM not connected. Pyodide/pysec disabled." };
  }
  global.guestExec = async function guestExec(command, timeoutMs) {
    timeoutMs = timeoutMs == null ? 180000 : timeoutMs;
    await bringKali("guestExec");
    if (typeof sshExec === "function" && sshLive()) return sshExec(command, timeoutMs);
    let err = "connecting";
    try { if (typeof sshStatus === "function") err = (sshStatus() || {}).lastError || err; } catch (_) {}
    return dead("Kali SSH not ready (" + err + "). Agent will not use pysec/pyodide.");
  };
  global.toolBash = async function toolBash(args) {
    args = args && typeof args === "object" ? args : {};
    const cmd = String(args.command || args.cmd || "").trim();
    if (!cmd) return "error: empty command";
    const timeoutMs = args.timeout_ms ? Number(args.timeout_ms) : args.timeout != null ? Number(args.timeout) * 1000 : 300000;
    const r = await global.guestExec(cmd, timeoutMs);
    return "exit " + r.code + "\n" + r.output;
  };
  global.toolPython = async function toolPython(args) {
    args = args && typeof args === "object" ? args : {};
    const path = String(args.path || args.file_path || "").trim();
    const code = args.code || "";
    const argv = args.args || "";
    let cmd;
    if (path) cmd = "python3 " + JSON.stringify(path) + (argv ? " " + argv : "");
    else if (code) {
      await global.toolWrite({ path: "/tmp/.goar_py_exec.py", content: String(code), overwrite: true });
      cmd = "python3 /tmp/.goar_py_exec.py" + (argv ? " " + argv : "");
    } else return "error: code or path required";
    const r = await global.guestExec(cmd, Number(args.timeout_ms || 90000));
    return "exit " + r.code + "\n" + r.output;
  };
  global.toolPysec = async function toolPysec(args) {
    args = args && typeof args === "object" ? args : {};
    const id = String(args.tool_id || args.id || args.name || "help");
    const r = await global.guestExec("echo pysec-retired tool=" + JSON.stringify(id) + "; which nmap python3 sqlmap nuclei 2>/dev/null; uname -a", 30000);
    return "exit " + r.code + "\n" + r.output;
  };
  global.toolMicropipInstall = async function toolMicropipInstall(args) {
    args = args && typeof args === "object" ? args : {};
    const spec = String(args.package || args.name || args.spec || "").trim();
    if (!spec) return "error: package required";
    const r = await global.guestExec("python3 -m pip install --break-system-packages --disable-pip-version-check " + spec + " 2>&1 | tail -40", 180000);
    return "exit " + r.code + "\n" + r.output;
  };
  try { global.GOAR_KALI_ONLY = true; } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
