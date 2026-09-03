/**
 * Bind vibe tools to the persistent Kali SSH session.
 * guestExec / write / read / python / edit use sshExec when the VM is live.
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

  async function bringSsh(reason) {
    if (sshLive()) return true;
    if (typeof ensureSsh !== "function") return false;
    try {
      const st = await ensureSsh({ reason: reason || "tool" });
      return !!(st && st.ready) || sshLive();
    } catch (_) {
      return sshLive();
    }
  }

  function b64utf8(s) {
    return btoa(unescape(encodeURIComponent(String(s == null ? "" : s))));
  }

  async function sshPutFile(path, content) {
    if (global.sshFiles && typeof global.sshFiles.put === "function") {
      return global.sshFiles.put(path, content);
    }
    const id = Math.random().toString(36).slice(2, 8);
    const b64 = b64utf8(content);
    const tmp = "/tmp/.gw." + id + ".b64";
    await sshExec(": > " + tmp, 20000);
    const chunk = 1800;
    for (let i = 0; i < b64.length; i += chunk) {
      const piece = b64.slice(i, i + chunk);
      const r = await sshExec("printf %s " + JSON.stringify(piece) + " >> " + tmp, 20000);
      if (r && Number(r.code) !== 0) return r;
    }
    return sshExec(
      "mkdir -p \"$(dirname " +
        JSON.stringify(path) +
        ")\" && base64 -d " +
        tmp +
        " > " +
        JSON.stringify(path) +
        " && rm -f " +
        tmp +
        " && wc -c " +
        JSON.stringify(path),
      120000
    );
  }

  const prevExec = typeof guestExec === "function" ? guestExec : null;
  global.guestExec = async function guestExec(command, timeoutMs) {
    timeoutMs = timeoutMs == null ? 180000 : timeoutMs;
    if (typeof sshExec === "function") {
      try {
        await bringSsh("guestExec");
        if (sshLive()) return sshExec(command, timeoutMs);
      } catch (e) {
        try {
          console.warn("[goar] sshExec", e && e.message ? e.message : e);
        } catch (_) {}
      }
    }
    if (prevExec) return prevExec(command, timeoutMs);
    return { code: -1, output: "guest environment not ready" };
  };

  const prevReady = typeof goarPlaneReady === "function" ? goarPlaneReady : null;
  global.goarPlaneReady = function goarPlaneReady() {
    if (sshLive()) return true;
    if (prevReady) return prevReady();
    try {
      if (typeof envReady !== "undefined" && envReady) return true;
    } catch (_) {}
    return false;
  };

  const prevWrite = typeof toolWrite === "function" ? toolWrite : null;
  global.toolWrite = async function toolWrite(args) {
    args = args && typeof args === "object" ? args : {};
    const path = String(args.file_path || args.path || "").trim();
    const content = String(args.content ?? "");
    if (!path) return "error: path required";
    if (typeof sshExec === "function") {
      await bringSsh("write");
      if (sshLive()) {
        const r = await sshPutFile(path, content);
        try {
          global.__GOAR_LAST_WRITE = { path: path, content: content, at: Date.now(), via: "ssh" };
        } catch (_) {}
        try {
          if (typeof offerChatFile === "function") offerChatFile(path, content);
        } catch (_) {}
        const ok = r && Number(r.code) === 0;
        return (ok ? "" : "exit " + (r && r.code) + "\n") + String((r && r.output) || "") + (ok ? "\nOK" : "");
      }
    }
    if (prevWrite) return prevWrite(args);
    return "error: filesystem missing";
  };

  const prevRead = typeof toolRead === "function" ? toolRead : null;
  global.toolRead = async function toolRead(args) {
    args = args && typeof args === "object" ? args : {};
    const path = String(args.file_path || args.path || "").trim();
    if (!path) return "error: path required";
    const offset = Math.max(0, Number(args.offset || 0) | 0);
    const limit = args.limit != null ? Math.max(1, Number(args.limit) | 0) : 0;
    const maxb = Math.min(Number(args.max_bytes || 80000), 200000);
    if (typeof sshExec === "function") {
      await bringSsh("read");
      if (sshLive()) {
        if (global.sshFiles && typeof global.sshFiles.get === "function") {
          const g = await global.sshFiles.get(path, maxb);
          if (!g || Number(g.code) !== 0) return "error: read " + path + (g && g.output ? "\n" + g.output : "");
          let text = String(g.content || "");
          if (offset || limit) {
            const lines = text.split("\n");
            const start = offset > 0 ? offset : 1;
            const from = Math.max(0, start - 1);
            const slice = limit ? lines.slice(from, from + limit) : lines.slice(from);
            return slice.map((line, i) => String(from + i + 1).padStart(9, " ") + "\u2192" + line).join("\n").slice(0, maxb);
          }
          const lines = text.split("\n");
          if (lines.length > 1) {
            return lines.map((line, i) => String(i + 1).padStart(9, " ") + "\u2192" + line).join("\n").slice(0, maxb);
          }
          return text.slice(0, maxb);
        }
        const r = await global.guestExec("head -c " + maxb + " " + JSON.stringify(path), 30000);
        let text = String((r && r.output) || "");
        if (r && Number(r.code) !== 0 && !text) return "error: read " + path;
        if (offset || limit) {
          const lines = text.split("\n");
          const start = offset > 0 ? offset : 1;
          const from = Math.max(0, start - 1);
          const slice = limit ? lines.slice(from, from + limit) : lines.slice(from);
          return slice.map((line, i) => String(from + i + 1).padStart(9, " ") + "\u2192" + line).join("\n").slice(0, maxb);
        }
        const lines = text.split("\n");
        if (lines.length > 1) {
          return lines.map((line, i) => String(i + 1).padStart(9, " ") + "\u2192" + line).join("\n").slice(0, maxb);
        }
        return text.slice(0, maxb);
      }
    }
    if (prevRead) return prevRead(args);
    return "error: filesystem missing";
  };

  const prevPy = typeof toolPython === "function" ? toolPython : null;
  global.toolPython = async function toolPython(args) {
    args = args && typeof args === "object" ? args : {};
    if (typeof sshExec === "function") {
      await bringSsh("python");
      if (sshLive()) {
        const path = String(args.path || args.file_path || "").trim();
        const code = args.code || "";
        const argv = args.args || "";
        let cmd;
        if (path) {
          cmd = "python3 " + JSON.stringify(path) + (argv ? " " + argv : "");
        } else if (code) {
          await global.toolWrite({ path: "/tmp/.goar_py_exec.py", content: String(code), overwrite: true });
          cmd = "python3 /tmp/.goar_py_exec.py" + (argv ? " " + argv : "");
        } else {
          return "error: code or path required";
        }
        const r = await global.guestExec(cmd, Number(args.timeout_ms || 90000));
        return "exit " + r.code + "\n" + r.output;
      }
    }
    if (prevPy) return prevPy(args);
    return "error: guest environment not ready yet";
  };

  const prevEdit = typeof toolEdit === "function" ? toolEdit : null;
  global.toolEdit = async function toolEdit(args) {
    args = args && typeof args === "object" ? args : {};
    if (typeof sshExec === "function") {
      await bringSsh("edit");
      if (sshLive()) {
        const path = String(args.file_path || args.path || "").trim();
        const oldS = args.old_string ?? args.oldString ?? "";
        const newS = args.new_string ?? args.newString ?? "";
        const all = !!(args.replace_all || args.replaceAll);
        if (!path) return "error: path required";
        if (oldS === "") return "error: old_string required";
        const py =
          "import pathlib,sys\n" +
          "p=pathlib.Path(" + JSON.stringify(path) + ")\n" +
          "t=p.read_text(encoding='utf-8',errors='replace')\n" +
          "o=" + JSON.stringify(oldS) + "\n" +
          "n=" + JSON.stringify(newS) + "\n" +
          "c=t.count(o)\n" +
          "print('matches',c)\n" +
          (all ? "t2=t.replace(o,n)\n" : "t2=t.replace(o,n,1)\n") +
          "if c==0:\n    sys.exit('old_string not found')\n" +
          "p.write_text(t2,encoding='utf-8')\n" +
          "print('ok')\n";
        await global.toolWrite({ path: "/tmp/.goar_edit.py", content: py, overwrite: true });
        const r = await global.guestExec("python3 /tmp/.goar_edit.py", 60000);
        return "exit " + r.code + "\n" + r.output;
      }
    }
    if (prevEdit) return prevEdit(args);
    return "error: guest not ready";
  };

  const prevBash = typeof toolBash === "function" ? toolBash : null;
  global.toolBash = async function toolBash(args) {
    args = args && typeof args === "object" ? args : {};
    if (typeof sshExec === "function") {
      await bringSsh("bash");
      if (sshLive()) {
        const cmd = String(args.command || args.cmd || "").trim();
        if (!cmd) return "error: empty command";
        const timeoutMs = args.timeout_ms
          ? Number(args.timeout_ms)
          : args.timeout != null
            ? Number(args.timeout) * 1000
            : 300000;
        const r = await global.guestExec(cmd, timeoutMs);
        return "exit " + r.code + "\n" + r.output;
      }
    }
    if (prevBash) return prevBash(args);
    return "error: guest environment not ready yet";
  };

  try {
    if (typeof envReady !== "undefined" && sshLive()) {
      try {
        if (typeof __goarMarkEnvReady === "function") __goarMarkEnvReady(true, "ssh-bridge");
      } catch (_) {}
    }
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
