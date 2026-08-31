/**
 * GOAR Wasm Unix — native execution plane.
 * Python runs in Pyodide (WebAssembly). Shell/coreutils run in-process
 * against the same filesystem. No x86 virtualization on the default path.
 */
const UNIX_NAME = "goaros";
const UNIX_HOME = "/root";
const UNIX_CWD0 = "/workspace";

const Unix = {
  cwd: UNIX_CWD0,
  env: {
    HOME: UNIX_HOME,
    USER: "root",
    LOGNAME: "root",
    SHELL: "/bin/ash",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    PWD: UNIX_CWD0,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    PYTHONUNBUFFERED: "1",
    PIP_BREAK_SYSTEM_PACKAGES: "1",
    GOAR_WORKDIR: UNIX_CWD0,
    GOAR_ENGINE: "pyodide+unix",
  },
  aliases: { ll: "ls -la", python: "python3", pip: "pip3" },
  history: [],
  lastCode: 0,
  jsfs: new Map(),
  ready: false,
  line: "",
  histIdx: -1,
};

function unixPy() {
  return (typeof window !== "undefined" && window.__pyodide) || (typeof __pyodide !== "undefined" ? __pyodide : null);
}

function unixNorm(p) {
  const s = String(p || "").replace(/\\/g, "/");
  const abs = s.startsWith("/") ? s : (Unix.cwd.replace(/\/+$/, "") + "/" + s);
  const parts = [];
  for (const bit of abs.split("/")) {
    if (!bit || bit === ".") continue;
    if (bit === "..") parts.pop();
    else parts.push(bit);
  }
  return "/" + parts.join("/");
}

function unixParent(p) {
  const n = unixNorm(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
}

function unixBase(p) {
  const n = unixNorm(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? n : n.slice(i + 1) || "/";
}

function unixEnsureJs(path, dir) {
  const n = unixNorm(path);
  if (!Unix.jsfs.has(n)) {
    Unix.jsfs.set(n, {
      type: dir ? "dir" : "file",
      data: new Uint8Array(0),
      mode: dir ? 0o755 : 0o644,
      mtime: Date.now(),
    });
  }
  if (n !== "/") unixEnsureJs(unixParent(n), true);
  return Unix.jsfs.get(n);
}

function unixSeedJs() {
  ["/", "/tmp", "/root", "/home", "/workspace", "/opt", "/opt/goar", "/usr", "/usr/bin", "/usr/local", "/usr/local/bin", "/bin", "/etc"].forEach((p) => unixEnsureJs(p, true));
  const release = "NAME=GOAR\nID=goaros\nPRETTY_NAME=\"GOAR Wasm Unix\"\nENGINE=pyodide\n";
  unixJsWrite("/etc/os-release", release);
  unixJsWrite("/etc/hostname", UNIX_NAME + "\n");
  unixJsWrite("/workspace/README.md", "# Workspace\nWrite files here. The agent and the editor share this tree.\n");
}

function unixJsWrite(path, data) {
  const n = unixNorm(path);
  unixEnsureJs(unixParent(n), true);
  const u8 = typeof data === "string" ? new TextEncoder().encode(data) : (data instanceof Uint8Array ? data : new Uint8Array(data));
  Unix.jsfs.set(n, { type: "file", data: u8, mode: 0o644, mtime: Date.now() });
}

function unixSyncJsIntoPy() {
  const py = unixPy();
  if (!py) return Promise.resolve();
  const jobs = [];
  for (const [path, node] of Unix.jsfs) {
    jobs.push((async () => {
      try {
        if (node.type === "dir") await Promise.resolve(py.FS.mkdirTree(path));
        else {
          await Promise.resolve(py.FS.mkdirTree(unixParent(path)));
          await Promise.resolve(py.FS.writeFile(path, node.data));
        }
      } catch (_) {}
    })());
  }
  return Promise.all(jobs);
}

function unixMkdirp(path) {
  const n = unixNorm(path);
  const py = unixPy();
  if (py) {
    try { py.FS.mkdirTree(n); return; } catch (_) {}
  }
  unixEnsureJs(n, true);
}

function unixMaybePersist(path) {
  if (typeof jliteSchedulePersist === "function" && /^\/(workspace|opt\/goar|root)(\/|$)/.test(String(path || ""))) {
    jliteSchedulePersist();
  }
}

function unixWrite(path, data) {
  const n = unixNorm(path);
  const u8 = typeof data === "string" ? new TextEncoder().encode(data) : (data instanceof Uint8Array ? data : new Uint8Array(data || []));
  unixJsWrite(n, u8);
  unixMaybePersist(n);
  const py = unixPy();
  if (py && py.FS) {
    const job = Promise.resolve(py.FS.mkdirTree(unixParent(n))).then(() => py.FS.writeFile(n, u8));
    if (job && job.catch) job.catch(() => {});
  }
}

function unixExists(path) {
  try {
    const n = unixNorm(path);
    if (Unix.jsfs.has(n)) return true;
    const st = unixStat(n);
    return !!st;
  } catch (_) {
    return false;
  }
}

function unixRead(path, bin) {
  const n = unixNorm(path);
  const node = Unix.jsfs.get(n);
  if (node && node.type === "file") return bin ? node.data : new TextDecoder().decode(node.data);
  const py = unixPy();
  if (py && py.FS && !py.worker) {
    try {
      if (bin) return py.FS.readFile(n);
      return new TextDecoder().decode(py.FS.readFile(n));
    } catch (_) {}
  }
  throw new Error(n + ": no such file");
}

function unixStat(path) {
  const n = unixNorm(path);
  const py = unixPy();
  if (py) {
    try {
      const s = py.FS.analyzePath(n);
      if (!s.exists) return null;
      const obj = s.object;
      const isDir = py.FS.isDir(obj.mode);
      return { path: n, dir: isDir, size: isDir ? 0 : (obj.contents ? obj.contents.length : (obj.size || 0)), mode: obj.mode, mtime: (obj.timestamp || 0) * 1000 };
    } catch (_) {}
  }
  const node = Unix.jsfs.get(n);
  if (!node) return null;
  return { path: n, dir: node.type === "dir", size: node.data ? node.data.length : 0, mode: node.mode, mtime: node.mtime };
}

function unixList(path) {
  const n = unixNorm(path);
  const py = unixPy();
  if (py) {
    try { return py.FS.readdir(n).filter((x) => x !== "." && x !== ".."); } catch (_) {}
  }
  const prefix = n === "/" ? "/" : n + "/";
  const names = new Set();
  for (const k of Unix.jsfs.keys()) {
    if (k === n) continue;
    if (n === "/") {
      const rest = k.slice(1);
      if (rest && rest.indexOf("/") < 0) names.add(rest);
    } else if (k.startsWith(prefix)) {
      const rest = k.slice(prefix.length);
      if (rest && rest.indexOf("/") < 0) names.add(rest);
    }
  }
  return [...names].sort();
}

function unixRm(path, rec) {
  const n = unixNorm(path);
  const st = unixStat(n);
  if (!st) throw new Error(n + ": no such file");
  const py = unixPy();
  if (st.dir) {
    if (!rec) throw new Error(n + ": is a directory");
    const kids = unixList(n);
    for (const k of kids) unixRm(n + "/" + k, true);
    if (py) { try { py.FS.rmdir(n); } catch (_) {} }
    Unix.jsfs.delete(n);
    unixMaybePersist(n);
    return;
  }
  if (py) { try { py.FS.unlink(n); } catch (_) {} }
  Unix.jsfs.delete(n);
  unixMaybePersist(n);
}

function unixExpand(s, env) {
  return String(s).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$\?/g, (_, a, b, q) => {
    if (q === "$?") return String(Unix.lastCode);
    const k = a || b;
    if (k === "?") return String(Unix.lastCode);
    return env[k] != null ? String(env[k]) : "";
  });
}

function unixTokenize(line) {
  const out = [];
  let cur = "";
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = null;
      else cur += c;
      continue;
    }
    if (q === '"') {
      if (c === '"') q = null;
      else if (c === "\\") { cur += line[++i] || ""; }
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === "\\") { cur += line[++i] || ""; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ""; } continue; }
    if (c === "&" && line[i + 1] === "&") {
      if (cur) { out.push(cur); cur = ""; }
      out.push("&&"); i++;
      continue;
    }
    if (c === "|" && line[i + 1] === "|") {
      if (cur) { out.push(cur); cur = ""; }
      out.push("||"); i++;
      continue;
    }
    if (c === "|" || c === ";" || c === "<") {
      if (cur) { out.push(cur); cur = ""; }
      out.push(c);
      continue;
    }
    if (c === ">") {
      if (cur) { out.push(cur); cur = ""; }
      if (line[i + 1] === ">") { out.push(">>"); i++; }
      else out.push(">");
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function unixSplitSeq(tokens) {
  const seq = [];
  let cur = { op: ";", tokens: [] };
  for (const t of tokens) {
    if (t === ";" || t === "&&" || t === "||") {
      seq.push(cur);
      cur = { op: t, tokens: [] };
    } else cur.tokens.push(t);
  }
  seq.push(cur);
  return seq;
}

function unixSplitPipe(tokens) {
  const stages = [];
  let cur = [];
  for (const t of tokens) {
    if (t === "|") { stages.push(cur); cur = []; }
    else cur.push(t);
  }
  stages.push(cur);
  return stages;
}

function unixParseStage(tokens) {
  const argv = [];
  let stdoutTo = null;
  let append = false;
  let stdinFrom = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === ">" || t === ">>") {
      append = t === ">>";
      stdoutTo = tokens[++i];
      continue;
    }
    if (t === "<") { stdinFrom = tokens[++i]; continue; }
    if (t === "2>&1" || t === "1>&2") continue;
    argv.push(t);
  }
  return { argv, stdoutTo, append, stdinFrom };
}

const UNIX_HELP = [
  "ash · ls cat echo pwd cd mkdir rm cp mv touch head tail wc grep find",
  "sort uniq cut tr tee seq base64 sha256sum md5sum date uname whoami id",
  "env export which printf test sleep true false python3 pip3 curl wget",
  "python and pip run in Pyodide (native Wasm). Network uses the host proxy.",
].join("\n");

async function unixRunPython(argv, stdin) {
  if (typeof ensurePysecWorker === "function") {
    try { await ensurePysecWorker(); } catch (e) { return { code: 1, stdout: "", stderr: String(e && e.message ? e.message : e) + "\n" }; }
  }
  const py = unixPy();
  if (!py) return { code: 1, stdout: "", stderr: "python: pyodide not ready\n" };
  await unixSyncJsIntoPy();
  let code = "";
  const dashC = argv.indexOf("-c");
  if (dashC >= 0) code = argv.slice(dashC + 1).join(" ");
  else if (argv[1] && argv[1][0] !== "-") {
    try { code = unixRead(unixNorm(argv[1])); }
    catch (e) { return { code: 1, stdout: "", stderr: String(e.message || e) + "\n" }; }
  } else if (stdin) code = stdin;
  else return { code: 0, stdout: "Python 3.12 (Pyodide Wasm)\n", stderr: "" };
  try {
    py.globals.set("_goar_src", code);
    py.globals.set("_goar_stdin", stdin || "");
    const raw = await py.runPythonAsync(`
import sys, io, traceback
_out, _err = io.StringIO(), io.StringIO()
_stdin = io.StringIO(str(_goar_stdin))
_so, _se, _si = sys.stdout, sys.stderr, sys.stdin
sys.stdout, sys.stderr, sys.stdin = _out, _err, _stdin
_code = 0
try:
    import ast
    src = str(_goar_src)
    tree = ast.parse(src, "<stdin>", "exec")
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = tree.body.pop()
    g = {"__name__": "__main__"}
    if tree.body:
        exec(compile(tree, "<stdin>", "exec"), g, g)
    if last is not None:
        val = eval(compile(ast.Expression(last.value), "<stdin>", "eval"), g, g)
        if val is not None:
            print(repr(val))
except SystemExit as e:
    _code = int(e.code) if isinstance(e.code, int) else 0
except Exception:
    _code = 1
    traceback.print_exc()
finally:
    sys.stdout, sys.stderr, sys.stdin = _so, _se, _si
(_code, _out.getvalue(), _err.getvalue())
`);
    const codeN = raw && raw.get ? raw.get(0) : (raw && raw[0]);
    const out = raw && raw.get ? raw.get(1) : (raw && raw[1]) || "";
    const err = raw && raw.get ? raw.get(2) : (raw && raw[2]) || "";
    try { if (raw && raw.destroy) raw.destroy(); } catch (_) {}
    return { code: Number(codeN) || 0, stdout: String(out || ""), stderr: String(err || "") };
  } catch (e) {
    return { code: 1, stdout: "", stderr: String(e && e.message ? e.message : e) + "\n" };
  }
}

async function hostInstallWheelToUnix(name) {
  const py = unixPy();
  if (!py) return { ok: false, line: "no python" };
  try {
    await py.loadPackage(String(name).replace(/[\[<>=!~].*$/, ""));
    return { ok: true, line: "Successfully installed " + name + " (pyodide package)" };
  } catch (_) {}
  if (typeof hostInstallWheel === "function") {
    try {
      const r = await hostInstallWheel(name);
      return { ok: !!r.ok, line: (r.ok ? "Successfully installed " : "ERROR: ") + name + " " + String(r.via || "") + " " + String(r.output || r.error || "").slice(0, 200) };
    } catch (e) {
      return { ok: false, line: "ERROR: " + name + ": " + String(e && e.message ? e.message : e) };
    }
  }
  return { ok: false, line: "ERROR: " + name + ": no installer" };
}

async function unixRunPip(argv) {
  if (typeof ensurePysecWorker === "function") {
    try { await ensurePysecWorker(); } catch (e) { return { code: 1, stdout: "", stderr: String(e && e.message ? e.message : e) + "\n" }; }
  }
  const py = unixPy();
  if (!py) return { code: 1, stdout: "", stderr: "pip: pyodide not ready\n" };
  if (argv[1] === "--version" || argv.includes("--version")) {
    return { code: 0, stdout: "pip 24.0 from pyodide/micropip (python 3.12)\n", stderr: "" };
  }
  const rest = argv.slice(1).filter((a) => a !== "--break-system-packages" && a !== "--disable-pip-version-check" && a !== "--no-input" && a !== "--retries" && a !== "1" && a !== "--timeout" && a !== "20" && a !== "-q");
  if (!rest.length || rest[0] === "help") {
    return { code: 0, stdout: "usage: pip install <pkg>  |  pip list  |  pip --version\n", stderr: "" };
  }
  if (rest[0] === "list") {
    try {
      const raw = await py.runPythonAsync(`
import json
mods = []
try:
    import micropip
    mods = sorted(getattr(micropip, "list", lambda: {})() or [])
except Exception:
    pass
json.dumps(mods)
`);
      return { code: 0, stdout: String(raw || "[]") + "\n", stderr: "" };
    } catch (e) {
      return { code: 1, stdout: "", stderr: String(e && e.message ? e.message : e) + "\n" };
    }
  }
  if (rest[0] !== "install") {
    return { code: 2, stdout: "", stderr: "pip: only install / list / --version in this environment\n" };
  }
  const pkgs = rest.slice(1).filter((a) => a && a[0] !== "-");
  if (!pkgs.length) return { code: 2, stdout: "", stderr: "pip install: package required\n" };
  try {
    try { await py.loadPackage(["micropip", "packaging"]); } catch (e) {
      try { await py.loadPackage("micropip"); } catch (e2) {
        return { code: 1, stdout: "", stderr: "pip: cannot load micropip: " + String(e2 && e2.message ? e2.message : e2) + "\n" };
      }
    }
    py.globals.set("_goar_pkgs_json", JSON.stringify(pkgs));
    const raw = await py.runPythonAsync(`
import json, traceback, sys
pkgs = json.loads(str(_goar_pkgs_json))
out = []
code = 0
try:
    import micropip
    for p in pkgs:
        try:
            await micropip.install(p)
            out.append("Successfully installed " + str(p))
        except Exception as e:
            out.append("micropip " + str(p) + ": " + str(e))
            raise
except Exception as e:
    code = 1
    out.append("ERROR: " + str(e))
if not out:
    out.append("pip: nothing to do")
json.dumps({"code": code, "out": "\\n".join(out)})
`);
    let parsed;
    try { parsed = JSON.parse(String(raw)); } catch (_) { parsed = { code: 1, out: String(raw) }; }
    if (parsed.code === 0) return { code: 0, stdout: (parsed.out || "") + "\n", stderr: "" };
    // Host-fetch a pure-python wheel and install from the shared FS
    const fallback = [];
    for (const name of pkgs) {
      try {
        const host = await hostInstallWheelToUnix(name);
        fallback.push(host.line);
        if (!host.ok) parsed.code = 1;
      } catch (e) {
        fallback.push("ERROR: " + name + ": " + String(e && e.message ? e.message : e));
        parsed.code = 1;
      }
    }
    return { code: parsed.code || 0, stdout: (parsed.out || "") + "\n" + fallback.join("\n") + "\n", stderr: "" };
  } catch (e) {
    return { code: 1, stdout: "", stderr: String(e && e.message ? e.message : e) + "\n" };
  }
}

async function unixHttp(url, dest) {
  let bytes = null;
  let text = "";
  let status = 0;
  try {
    if (typeof goarHostFetchBytes === "function") {
      const r = await goarHostFetchBytes(url);
      if (r && r.ok && r.bytes) { bytes = r.bytes; status = r.status || 200; }
    }
    if (!bytes && typeof goarHostFetch === "function") {
      const r = await goarHostFetch(url);
      status = r && r.status;
      text = (r && (r.text || r.body || "")) || "";
      if (!r || !r.ok) return { code: 1, stdout: "", stderr: "curl: HTTP " + status + " " + url + "\n" };
    } else if (!bytes) {
      const hop = typeof buildManusProxyUrl === "function" ? buildManusProxyUrl(url) : url;
      const key = typeof readManusKey === "function" ? readManusKey() : "";
      const res = await fetch(hop, { headers: key ? { "x-api-key": key } : {} });
      status = res.status;
      if (!res.ok) return { code: 1, stdout: "", stderr: "curl: HTTP " + status + "\n" };
      bytes = new Uint8Array(await res.arrayBuffer());
    }
  } catch (e) {
    return { code: 1, stdout: "", stderr: "curl: " + String(e && e.message ? e.message : e) + "\n" };
  }
  if (dest) {
    unixWrite(dest, bytes || text);
    return { code: 0, stdout: "", stderr: "" };
  }
  if (bytes) return { code: 0, stdout: new TextDecoder().decode(bytes), stderr: "" };
  return { code: 0, stdout: text, stderr: "" };
}

function unixFmtLs(path, long) {
  const st = unixStat(path);
  if (!st) return null;
  if (!st.dir) {
    return long ? ("-rw-r--r-- 1 root root " + String(st.size).padStart(8) + " " + unixBase(path)) : unixBase(path);
  }
  const names = unixList(path);
  if (!long) return names.join("  ");
  const lines = [];
  for (const name of names) {
    const c = unixStat(path.replace(/\/+$/, "") + "/" + name);
    if (!c) continue;
    const mode = c.dir ? "drwxr-xr-x" : "-rw-r--r--";
    lines.push(mode + " 1 root root " + String(c.size).padStart(8) + " " + name);
  }
  return lines.join("\n");
}

async function unixApplet(argv, stdin) {
  if (!argv.length) return { code: 0, stdout: "", stderr: "" };
  let cmd = argv[0];
  if (Unix.aliases[cmd]) {
    const extra = unixTokenize(Unix.aliases[cmd]);
    argv = extra.concat(argv.slice(1));
    cmd = argv[0];
  }
  const a = argv.slice(1);
  const flag = (f) => a.includes(f);
  const pos = a.filter((x) => x[0] !== "-");

  if (cmd === "cd" || cmd === "export" || cmd === "python" || cmd === "python3" || cmd === "pip" || cmd === "pip3" || cmd === "ash" || cmd === "sh" || cmd === "bash") {
    /* stay in-process */
  } else if (typeof wasiBoxCan === "function" && wasiBoxCan(cmd) && typeof wasiBusybox === "function") {
    try {
      const r = await wasiBusybox(argv, stdin, Unix.cwd);
      if (r) return r;
    } catch (e) {
      console.warn("[goar] wasi applet", cmd, e);
    }
  }

  if (cmd === "echo") {
    const n = a[0] === "-n";
    const bits = n ? a.slice(1) : a;
    return { code: 0, stdout: bits.join(" ") + (n ? "" : "\n"), stderr: "" };
  }
  if (cmd === "printf") {
    const fmt = a[0] || "";
    const rest = a.slice(1);
    let i = 0;
    const s = fmt.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/%s/g, () => String(rest[i++] ?? ""));
    return { code: 0, stdout: s, stderr: "" };
  }
  if (cmd === "pwd") return { code: 0, stdout: Unix.cwd + "\n", stderr: "" };
  if (cmd === "cd") {
    const dest = unixNorm(pos[0] || Unix.env.HOME);
    const st = unixStat(dest);
    if (!st || !st.dir) return { code: 1, stdout: "", stderr: "cd: " + dest + ": no such directory\n" };
    Unix.cwd = dest;
    Unix.env.PWD = dest;
    return { code: 0, stdout: "", stderr: "" };
  }
  if (cmd === "ls") {
    const long = flag("-l") || flag("-la") || flag("-al");
    const all = flag("-a") || flag("-la") || flag("-al");
    const target = unixNorm(pos[0] || Unix.cwd);
    const body = unixFmtLs(target, long);
    if (body == null) return { code: 1, stdout: "", stderr: "ls: " + target + ": no such file\n" };
    return { code: 0, stdout: (body ? body + "\n" : ""), stderr: "" };
  }
  if (cmd === "cat") {
    if (!pos.length && stdin != null) return { code: 0, stdout: stdin, stderr: "" };
    let out = "";
    for (const p of pos.length ? pos : ["-"]) {
      if (p === "-") { out += stdin || ""; continue; }
      try { out += unixRead(p); } catch (e) { return { code: 1, stdout: out, stderr: "cat: " + e.message + "\n" }; }
    }
    return { code: 0, stdout: out, stderr: "" };
  }
  if (cmd === "mkdir") {
    for (const p of pos) unixMkdirp(p);
    return { code: 0, stdout: "", stderr: "" };
  }
  if (cmd === "touch") {
    for (const p of pos) {
      try { unixRead(p); } catch (_) { unixWrite(p, ""); }
    }
    return { code: 0, stdout: "", stderr: "" };
  }
  if (cmd === "rm") {
    const rec = flag("-r") || flag("-rf") || flag("-fr");
    for (const p of pos) {
      try { unixRm(p, rec); } catch (e) { return { code: 1, stdout: "", stderr: "rm: " + e.message + "\n" }; }
    }
    return { code: 0, stdout: "deleted\n", stderr: "" };
  }
  if (cmd === "cp" || cmd === "mv") {
    if (pos.length < 2) return { code: 1, stdout: "", stderr: cmd + ": need src dest\n" };
    const src = pos[0], dest = pos[1];
    try {
      const data = unixRead(src, true);
      unixWrite(dest, data);
      if (cmd === "mv") unixRm(src, false);
    } catch (e) { return { code: 1, stdout: "", stderr: cmd + ": " + e.message + "\n" }; }
    return { code: 0, stdout: (cmd === "mv" ? "moved\n" : "copied\n"), stderr: "" };
  }
  if (cmd === "head" || cmd === "tail") {
    const nFlag = a.find((x) => x.startsWith("-n")) || a.find((x, i) => x === "-n" && a[i]);
    let n = 10;
    const ni = a.indexOf("-n");
    if (ni >= 0) n = parseInt(a[ni + 1], 10) || 10;
    else {
      const d = a.find((x) => /^-\d+$/.test(x));
      if (d) n = parseInt(d.slice(1), 10);
    }
    let text = stdin || "";
    if (pos[0]) { try { text = unixRead(pos[0]); } catch (e) { return { code: 1, stdout: "", stderr: e.message + "\n" }; } }
    const lines = String(text).split("\n");
    const slice = cmd === "head" ? lines.slice(0, n) : lines.slice(Math.max(0, lines.length - n));
    return { code: 0, stdout: slice.join("\n") + (slice.length ? "\n" : ""), stderr: "" };
  }
  if (cmd === "wc") {
    let text = stdin || "";
    if (pos[0]) { try { text = unixRead(pos[0]); } catch (e) { return { code: 1, stdout: "", stderr: e.message + "\n" }; } }
    const lines = text ? text.split("\n") : [];
    if (text.endsWith("\n")) lines.pop();
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return { code: 0, stdout: String(lines.length) + " " + words + " " + text.length + "\n", stderr: "" };
  }
  if (cmd === "grep") {
    const pat = pos[0];
    if (!pat) return { code: 2, stdout: "", stderr: "grep: pattern required\n" };
    let text = stdin || "";
    const files = pos.slice(1);
    if (files.length) {
      text = files.map((f) => { try { return unixRead(f); } catch (_) { return ""; } }).join("\n");
    }
    let re;
    try { re = new RegExp(pat); } catch (_) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); }
    const hits = String(text).split("\n").filter((ln) => re.test(ln));
    return { code: hits.length ? 0 : 1, stdout: hits.length ? hits.join("\n") + "\n" : "", stderr: "" };
  }
  if (cmd === "find") {
    const root = unixNorm(pos[0] || Unix.cwd);
    const acc = [];
    const walk = (p) => {
      acc.push(p);
      const st = unixStat(p);
      if (st && st.dir) for (const k of unixList(p)) walk((p === "/" ? "" : p) + "/" + k);
    };
    walk(root);
    return { code: 0, stdout: acc.join("\n") + "\n", stderr: "" };
  }
  if (cmd === "sort") {
    const text = pos[0] ? unixRead(pos[0]) : (stdin || "");
    const lines = String(text).split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    lines.sort();
    if (flag("-r") || flag("-rn") || flag("-nr")) lines.reverse();
    return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }
  if (cmd === "uniq") {
    const text = pos[0] ? unixRead(pos[0]) : (stdin || "");
    const lines = String(text).split("\n");
    const out = [];
    for (const ln of lines) if (!out.length || out[out.length - 1] !== ln) out.push(ln);
    return { code: 0, stdout: out.join("\n"), stderr: "" };
  }
  if (cmd === "cut") {
    const d = (a.find((x, i) => a[i - 1] === "-d") || "\t");
    const f = parseInt((a.find((x, i) => a[i - 1] === "-f") || "1"), 10) || 1;
    const text = pos[0] ? unixRead(pos[0]) : (stdin || "");
    const out = String(text).split("\n").map((ln) => ln.split(d)[f - 1] || "").join("\n");
    return { code: 0, stdout: out + (out.endsWith("\n") ? "" : "\n"), stderr: "" };
  }
  if (cmd === "tr") {
    const a1 = a[0] || "", a2 = a[1] || "";
    let text = stdin || "";
    if (a1 === "-d") text = text.split(a[1] || "").join("");
    else {
      const map = {};
      for (let i = 0; i < a1.length; i++) map[a1[i]] = a2[i] != null ? a2[i] : a1[i];
      text = [...text].map((c) => (map[c] != null ? map[c] : c)).join("");
    }
    return { code: 0, stdout: text, stderr: "" };
  }
  if (cmd === "tee") {
    const dest = pos[0];
    if (dest) unixWrite(dest, stdin || "");
    return { code: 0, stdout: stdin || "", stderr: "" };
  }
  if (cmd === "seq") {
    const nums = pos.map(Number);
    let start = 1, end = 1, step = 1;
    if (nums.length === 1) end = nums[0];
    else if (nums.length === 2) { start = nums[0]; end = nums[1]; }
    else { start = nums[0]; step = nums[1]; end = nums[2]; }
    const lines = [];
    if (step === 0) return { code: 1, stdout: "", stderr: "seq: zero step\n" };
    if (step > 0) for (let i = start; i <= end; i += step) lines.push(String(i));
    else for (let i = start; i >= end; i += step) lines.push(String(i));
    return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }
  if (cmd === "base64") {
    const dec = flag("-d") || flag("--decode");
    const text = pos[0] ? unixRead(pos[0]) : (stdin || "");
    if (dec) {
      try {
        const bin = atob(String(text).replace(/\s+/g, ""));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return { code: 0, stdout: new TextDecoder().decode(u8), stderr: "" };
      } catch (e) { return { code: 1, stdout: "", stderr: "base64: " + e.message + "\n" }; }
    }
    const u8 = new TextEncoder().encode(text);
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return { code: 0, stdout: btoa(s) + "\n", stderr: "" };
  }
  if (cmd === "sha256sum" || cmd === "md5sum") {
    const text = pos[0] ? unixRead(pos[0], true) : new TextEncoder().encode(stdin || "");
    const algo = cmd === "md5sum" ? "MD5" : "SHA-256";
    if (crypto && crypto.subtle && algo === "SHA-256") {
      const buf = await crypto.subtle.digest("SHA-256", text instanceof Uint8Array ? text : new TextEncoder().encode(String(text)));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      return { code: 0, stdout: hex + "  " + (pos[0] || "-") + "\n", stderr: "" };
    }
    return await unixRunPython(["python3", "-c", "import hashlib,sys; d=sys.stdin.buffer.read(); h=hashlib." + (cmd === "md5sum" ? "md5" : "sha256") + "(d).hexdigest(); print(h+'  -')"], typeof text === "string" ? text : new TextDecoder().decode(text));
  }
  if (cmd === "date") return { code: 0, stdout: new Date().toISOString() + "\n", stderr: "" };
  if (cmd === "uname") {
    if (flag("-a")) return { code: 0, stdout: "GOAR goaros 3.0.0 wasm pyodide\n", stderr: "" };
    return { code: 0, stdout: "GOAR\n", stderr: "" };
  }
  if (cmd === "whoami" || cmd === "id") return { code: 0, stdout: cmd === "id" ? "uid=0(root) gid=0(root)\n" : "root\n", stderr: "" };
  if (cmd === "hostname") return { code: 0, stdout: UNIX_NAME + "\n", stderr: "" };
  if (cmd === "env") {
    const lines = Object.keys(Unix.env).sort().map((k) => k + "=" + Unix.env[k]);
    return { code: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }
  if (cmd === "export") {
    for (const p of pos) {
      const eq = p.indexOf("=");
      if (eq > 0) Unix.env[p.slice(0, eq)] = p.slice(eq + 1);
    }
    return { code: 0, stdout: "", stderr: "" };
  }
  if (cmd === "which" || cmd === "command") {
    const name = cmd === "command" ? (pos[0] === "-v" ? pos[1] : pos[0]) : pos[0];
    if (UNIX_APPLETS.has(name) || Unix.aliases[name]) return { code: 0, stdout: "/usr/bin/" + name + "\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  }
  if (cmd === "true") return { code: 0, stdout: "", stderr: "" };
  if (cmd === "false") return { code: 1, stdout: "", stderr: "" };
  if (cmd === "sleep") {
    const ms = Math.max(0, Number(pos[0] || 0) * 1000);
    await new Promise((r) => setTimeout(r, ms));
    return { code: 0, stdout: "", stderr: "" };
  }
  if (cmd === "test" || cmd === "[") {
    const args = cmd === "[" ? a.filter((x) => x !== "]") : a;
    if (args[0] === "-f") return { code: unixStat(args[1]) && !unixStat(args[1]).dir ? 0 : 1, stdout: "", stderr: "" };
    if (args[0] === "-d") return { code: unixStat(args[1]) && unixStat(args[1]).dir ? 0 : 1, stdout: "", stderr: "" };
    if (args[0] === "-e") return { code: unixStat(args[1]) ? 0 : 1, stdout: "", stderr: "" };
    if (args[1] === "=" || args[1] === "==") return { code: args[0] === args[2] ? 0 : 1, stdout: "", stderr: "" };
    if (args[1] === "!=") return { code: args[0] !== args[2] ? 0 : 1, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  }
  if (cmd === "clear") return { code: 0, stdout: "\x1b[2J\x1b[H", stderr: "" };
  if (cmd === "help" || cmd === "busybox") return { code: 0, stdout: UNIX_HELP + "\n", stderr: "" };
  if (cmd === "python" || cmd === "python3") {
    const m = argv.indexOf("-m");
    if (m >= 0 && argv[m + 1] === "pip") return unixRunPip(["pip"].concat(argv.slice(m + 2)));
    return unixRunPython(argv, stdin);
  }
  if (cmd === "pip" || cmd === "pip3") return unixRunPip(argv[1] === "install" || argv.includes("install") ? argv : ["pip"].concat(a));
  if (cmd === "apk") {
    if (pos[0] === "add" || a[0] === "add") {
      const pkgs = pos.filter((x) => x !== "add");
      if (pkgs.some((p) => /python|pip/.test(p))) return { code: 0, stdout: "ok: python already provided by Pyodide\n", stderr: "" };
      return unixRunPip(["pip", "install"].concat(pkgs));
    }
    return { code: 0, stdout: "apk: this is Wasm Unix — use pip install <pkg>\n", stderr: "" };
  }
  if (cmd === "curl" || cmd === "wget") {
    const url = pos.find((x) => /^https?:\/\//i.test(x)) || pos[0];
    if (!url) return { code: 2, stdout: "", stderr: cmd + ": url required\n" };
    const o = a.indexOf("-o") >= 0 ? a[a.indexOf("-o") + 1] : (a.indexOf("-O") >= 0 ? unixBase(url) : null);
    return unixHttp(url, o);
  }
  if (cmd === "ash" || cmd === "sh" || cmd === "bash") {
    if (a[0] === "-c") return unixRunLine(a.slice(1).join(" "), "");
    return { code: 0, stdout: "", stderr: "" };
  }
  return { code: 127, stdout: "", stderr: cmd + ": not found\n" };
}

const UNIX_APPLETS = new Set([
  "echo","printf","pwd","cd","ls","cat","mkdir","touch","rm","cp","mv","head","tail","wc",
  "grep","find","sort","uniq","cut","tr","tee","seq","base64","sha256sum","md5sum","date",
  "uname","whoami","id","hostname","env","export","which","command","true","false","sleep",
  "test","[","clear","help","busybox","python","python3","pip","pip3","apk","curl","wget",
  "ash","sh","bash",
]);

async function unixRunStage(tokens, stdin) {
  const parsed = unixParseStage(tokens);
  let argv = parsed.argv.map((t) => unixExpand(t, Unix.env));
  while (argv.length && argv[0].includes("=") && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) {
    const eq = argv[0].indexOf("=");
    Unix.env[argv[0].slice(0, eq)] = argv[0].slice(eq + 1);
    argv = argv.slice(1);
  }
  if (parsed.stdinFrom) {
    try { stdin = unixRead(parsed.stdinFrom); } catch (e) { return { code: 1, stdout: "", stderr: e.message + "\n" }; }
  }
  const r = await unixApplet(argv, stdin || "");
  if (parsed.stdoutTo) {
    const prev = parsed.append ? (() => { try { return unixRead(parsed.stdoutTo); } catch (_) { return ""; } })() : "";
    unixWrite(parsed.stdoutTo, prev + (r.stdout || ""));
    return { code: r.code, stdout: "", stderr: r.stderr || "" };
  }
  return r;
}

async function unixRunLine(line, stdin0) {
  line = String(line || "").replace(/\r/g, "").trim();
  if (!line || line.startsWith("#")) return { code: 0, stdout: "", stderr: "" };
  const tokens = unixTokenize(line);
  const seq = unixSplitSeq(tokens);
  let last = { code: 0, stdout: "", stderr: "" };
  let accOut = "";
  let accErr = "";
  for (const step of seq) {
    if (step.op === "&&" && last.code !== 0) continue;
    if (step.op === "||" && last.code === 0) continue;
    const pipes = unixSplitPipe(step.tokens);
    let stdin = stdin0 || "";
    let r = { code: 0, stdout: "", stderr: "" };
    for (let i = 0; i < pipes.length; i++) {
      r = await unixRunStage(pipes[i], stdin);
      stdin = r.stdout || "";
      if (r.stderr) accErr += r.stderr;
    }
    last = r;
    accOut += r.stdout || "";
  }
  Unix.lastCode = last.code;
  return { code: last.code, stdout: accOut, stderr: accErr };
}

async function unixExec(command, timeoutMs) {
  const ms = Number(timeoutMs) || 180000;
  const run = unixRunLine(command, "");
  const to = new Promise((resolve) => setTimeout(() => resolve({ code: 124, stdout: "", stderr: "timeout\n", _t: 1 }), ms));
  const r = await Promise.race([run, to]);
  if (r && r._t) return { code: 124, output: "timeout" };
  const out = String((r && r.stdout) || "") + String((r && r.stderr) || "");
  return { code: r ? r.code : 1, output: out.replace(/\n$/, "") };
}

function unixPrompt() {
  let p = Unix.cwd;
  if (p === Unix.env.HOME) p = "~";
  return UNIX_NAME + ":" + p + "# ";
}

function unixTermWrite(s) {
  try { if (typeof term !== "undefined" && term && term.write) term.write(String(s).replace(/\n/g, "\r\n")); } catch (_) {}
}

function unixOnData(data) {
  if (!Unix.ready) return false;
  if (data === "\r" || data === "\n") {
    const line = Unix.line;
    Unix.line = "";
    unixTermWrite("\r\n");
    if (line.trim()) Unix.history.push(line);
    Unix.histIdx = Unix.history.length;
    unixRunLine(line, "").then((r) => {
      if (r.stdout) unixTermWrite(r.stdout);
      if (r.stderr) unixTermWrite("\x1b[31m" + r.stderr + "\x1b[0m");
      unixTermWrite(unixPrompt());
    }).catch((e) => {
      unixTermWrite("\x1b[31m" + String(e && e.message ? e.message : e) + "\x1b[0m\r\n" + unixPrompt());
    });
    return true;
  }
  if (data === "\u007f" || data === "\b") {
    if (Unix.line.length) {
      Unix.line = Unix.line.slice(0, -1);
      unixTermWrite("\b \b");
    }
    return true;
  }
  if (data === "\u0003") {
    Unix.line = "";
    unixTermWrite("^C\r\n" + unixPrompt());
    return true;
  }
  if (data === "\u0015") {
    unixTermWrite("\r\x1b[K" + unixPrompt());
    Unix.line = "";
    return true;
  }
  if (data === "\x1b[A") {
    if (Unix.history.length) {
      Unix.histIdx = Math.max(0, Unix.histIdx - 1);
      Unix.line = Unix.history[Unix.histIdx] || "";
      unixTermWrite("\r\x1b[K" + unixPrompt() + Unix.line);
    }
    return true;
  }
  if (data === "\x1b[B") {
    Unix.histIdx = Math.min(Unix.history.length, Unix.histIdx + 1);
    Unix.line = Unix.history[Unix.histIdx] || "";
    unixTermWrite("\r\x1b[K" + unixPrompt() + Unix.line);
    return true;
  }
  if (data.length === 1 && data >= " ") {
    Unix.line += data;
    unixTermWrite(data);
    return true;
  }
  if (data.length > 1 && data.indexOf("\x1b") < 0) {
    Unix.line += data;
    unixTermWrite(data);
    return true;
  }
  return true;
}

async function bootWasmUnix() {
  if (typeof window !== "undefined" && !window.__GOAR_PYPI_FETCH) {
    const orig = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const need = /pypi\.org|files\.pythonhosted\.org/i.test(url);
      try {
        const res = await orig(input, init);
        if (res.ok || !need) return res;
      } catch (e) {
        if (!need) throw e;
      }
      if (!need || typeof buildManusProxyUrl !== "function") return orig(input, init);
      const hop = buildManusProxyUrl(url);
      const key = typeof readManusKey === "function" ? readManusKey() : "";
      const headers = Object.assign({}, (init && init.headers) || {}, key ? { "x-api-key": key } : {});
      return orig(hop, Object.assign({}, init || {}, { headers }));
    };
    window.__GOAR_PYPI_FETCH = true;
  }
  unixSeedJs();
  Unix.ready = true;
  window.__GOAR_UNIX = Unix;
  window.__emulator = window.__emulator || { unix: true, serial0_send: function () {} };
  try { window.__goarMarkEnvReady?.(true, "unix jsfs"); } catch (_) {}
  try {
    if (typeof jliteRestoreTree === "function") await jliteRestoreTree();
  } catch (e) { console.warn("[goar] drive restore", e); }
  try { if (typeof setProgress === "function") setProgress(20, "Python runtime", "Pyodide"); } catch (_) {}
  try { if (typeof bootItem === "function") bootItem("sandbox", "run", "unix"); } catch (_) {}
  if (typeof ensurePysecWorker === "function") {
    try { await ensurePysecWorker(); } catch (e) { console.warn("[goar] pyodide", e); }
  }
  const py = unixPy();
  if (py) {
    try {
      py.FS.mkdirTree("/workspace");
      py.FS.mkdirTree("/tmp");
      py.FS.mkdirTree("/root");
      py.FS.mkdirTree("/opt/goar");
    } catch (_) {}
    unixSyncJsIntoPy();
    window.__pyodide = py;
    try {
      if (typeof ensureGoarKernel === "function") await ensureGoarKernel();
    } catch (e) { console.warn("[goar] kernel boot", e); }
    try {
      if (typeof ensureJit === "function") ensureJit();
      if (typeof installGoarJitPy === "function") await installGoarJitPy();
    } catch (e) { console.warn("[goar] jit", e); }
    try {
      if (typeof ensureWasiBox === "function") ensureWasiBox().catch(() => {});
    } catch (_) {}
    try {
      if (typeof upgradePysecPack === "function") upgradePysecPack().catch(() => {});
    } catch (_) {}
  }
  Unix.ready = true;
  window.__GOAR_UNIX = Unix;
  window.__emulator = window.__emulator || { unix: true, serial0_send: function () {} };
  window.__serialSend = function () {};
  try { if (typeof setProgress === "function") setProgress(92, "Unix ready", "Pyodide · ash"); } catch (_) {}
  try { if (typeof bootItem === "function") { bootItem("sandbox", "ok", "ok"); bootItem("toolkit", "ok", "ok"); } } catch (_) {}
  try { window.__goarMarkEnvReady?.(true, "wasm unix"); } catch (_) {}
  try { if (typeof seqDone !== "undefined") seqDone = true; } catch (_) {}
  try { window.seqDone = true; } catch (_) {}
  unixTermWrite("\r\n\x1b[90m" + UNIX_NAME + "  ·  Pyodide  ·  ash  ·  workspace persisted\x1b[0m\r\n" + unixPrompt());
  try { if (typeof jliteSchedulePersist === "function") jliteSchedulePersist(); } catch (_) {}
  return { ok: true, engine: "pyodide+unix" };
}

try {
  window.unixExec = unixExec;
  window.unixRunLine = unixRunLine;
  window.unixOnData = unixOnData;
  window.bootWasmUnix = bootWasmUnix;
  window.unixPrompt = unixPrompt;
  window.Unix = Unix;
} catch (_) {}
