/**
 * GOAR 2.7.1 kernel — operator OS inside Pyodide.
 * Memory, plans, skills, adaptive mode, ledger, git-wasm, create_tool.
 */
(function (global) {
  "use strict";

  let booting = null;

  async function ensureGoarKernel() {
    if (global.__GOAR_KERNEL) return true;
    if (booting) return booting;
    booting = (async () => {
      const py = global.__pyodide || (typeof unixPy === "function" ? unixPy() : null);
      if (!py || typeof py.runPythonAsync !== "function") return false;
      const src = typeof GOAR_KERNEL_SRC === "string" ? GOAR_KERNEL_SRC : "";
      if (!src) throw new Error("kernel source missing");
      try {
        await Promise.resolve(py.FS.mkdirTree("/workspace"));
        await Promise.resolve(py.FS.mkdirTree("/workspace/.goar"));
        await Promise.resolve(py.FS.mkdirTree("/tmp"));
        await Promise.resolve(py.FS.mkdirTree("/opt/goar"));
      } catch (_) {}
      await py.runPythonAsync(src);
      global.__GOAR_KERNEL = true;
      global.__GOAR_KERNEL_VER = "2.7.1";
      try { if (typeof ensureWasmAgents === "function") await ensureWasmAgents(); } catch (e) {
        console.warn("[goar] wasm-agents", e);
      }
      try {
        if (typeof jliteSchedulePersist === "function") jliteSchedulePersist();
      } catch (_) {}
      console.log("[goar] kernel 2.7.1 ready");
      return true;
    })().catch((e) => {
      booting = null;
      console.warn("[goar] kernel", e);
      return false;
    });
    return booting;
  }

  async function goarKernel(op, payload) {
    const ok = await ensureGoarKernel();
    if (!ok) return { ok: false, error: "kernel not ready" };
    const py = global.__pyodide || (typeof unixPy === "function" ? unixPy() : null);
    if (!py) return { ok: false, error: "python not ready" };
    try {
      if (String(op || "") === "exec" && payload && /\bawait\b/.test(String(payload.code || ""))) {
        const src = String(payload.code || "");
        const wrapped =
          "import json as _j\n" +
          "async def __goar_main():\n" +
          src.split("\n").map((l) => "    " + l).join("\n") + "\n" +
          "_r = await __goar_main()\n" +
          "(_j.dumps(_r, default=str) if _r is not None else '')\n";
        const raw = await py.runPythonAsync(wrapped);
        return { ok: true, stdout: raw == null ? "" : String(raw), stderr: "", result: raw };
      }
      if (py.globals && py.globals.set) {
        py.globals.set("_k_op", String(op || ""));
        py.globals.set("_k_pl", JSON.stringify(payload || {}));
      }
      const raw = await py.runPythonAsync("kernel_call(_k_op, _k_pl)");
      if (raw && typeof raw === "object" && raw.ok != null) return raw;
      try {
        return JSON.parse(String(raw || "{}"));
      } catch (_) {
        return { ok: true, result: raw };
      }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  async function upgradePysecPack() {
    const py = global.__pyodide || (typeof unixPy === "function" ? unixPy() : null);
    if (!py) return false;
    let url = "./assets/pyodide/pyodide-security.zip";
    try {
      if (typeof goarAssetUrl === "function") url = goarAssetUrl("assets/pyodide/pyodide-security.zip");
    } catch (_) {}
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      if (typeof py.unpackArchive === "function") {
        py.unpackArchive(buf, "zip", { extractDir: "/home/pyodide" });
      } else if (typeof pyRpc === "function") {
        let s = "";
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i += 0x8000) {
          s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length)));
        }
        await pyRpc("write", { path: "/tmp/pyodide-security.zip", b64: btoa(s) });
        await py.runPythonAsync(
          "import zipfile,sys\n" +
            "zipfile.ZipFile('/tmp/pyodide-security.zip').extractall('/home/pyodide')\n" +
            "sys.path.insert(0,'/home/pyodide')\n" +
            "import importlib, pyodide_security\n" +
            "importlib.reload(pyodide_security)\n"
        );
      } else {
        return false;
      }
      await py.runPythonAsync(
        "import sys\n" +
          "if '/home/pyodide' not in sys.path: sys.path.insert(0,'/home/pyodide')\n" +
          "import pyodide_security as ps\n" +
          "from pyodide_security import policy\n" +
          "policy.configure(max_requests=200, allow_active_scanning=True, reset_budget=True)\n"
      );
      console.log("[goar] security pack mounted");
      return true;
    } catch (e) {
      console.warn("[goar] security pack", e);
      return false;
    }
  }

  global.ensureGoarKernel = ensureGoarKernel;
  global.goarKernel = goarKernel;
  global.upgradePysecPack = upgradePysecPack;
})(typeof window !== "undefined" ? window : globalThis);
