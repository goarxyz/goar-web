/**
 * Session scratchpad.
 * Guest: /workspace/.scratch/<name>
 * KV:    ns=scratch
 * Used for notes, drafts, probes — not the product tree.
 */
const GOAR_SCRATCH = {
  guestPath: "/workspace/.scratch",
  ready: false,
  sessionId: "",
  index: [],
};

function vibeSessionId() {
  if (GOAR_SCRATCH.sessionId) return GOAR_SCRATCH.sessionId;
  try {
    let id = sessionStorage.getItem("goar_session_id");
    if (!id) {
      id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem("goar_session_id", id);
    }
    GOAR_SCRATCH.sessionId = id;
    return id;
  } catch (_) {
    GOAR_SCRATCH.sessionId = "s" + Date.now().toString(36);
    return GOAR_SCRATCH.sessionId;
  }
}

function scratchSafeName(name) {
  const n = String(name || "note").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return (n || "note").slice(0, 80);
}

function scratchGuestFile(name) {
  return GOAR_SCRATCH.guestPath + "/" + scratchSafeName(name);
}

async function ensureScratchpad() {
  GOAR_SCRATCH.sessionId = vibeSessionId();
  if (typeof envReady !== "undefined" && envReady && typeof guestExec === "function") {
    try {
      await guestExec("mkdir -p " + GOAR_SCRATCH.guestPath, 12000);
      GOAR_SCRATCH.ready = true;
    } catch (_) {
      GOAR_SCRATCH.ready = false;
    }
  }
  try {
    if (typeof kvSet === "function") {
      await kvSet({ ns: "scratch", key: "session", value: GOAR_SCRATCH.sessionId });
    }
  } catch (_) {}
  return { ok: true, path: GOAR_SCRATCH.guestPath, id: GOAR_SCRATCH.sessionId, guest: GOAR_SCRATCH.ready };
}

async function scratchWrite(name, content) {
  await ensureScratchpad();
  const key = scratchSafeName(name);
  const body = String(content == null ? "" : content);
  if (GOAR_SCRATCH.ready && typeof toolWrite === "function") {
    await toolWrite({ path: scratchGuestFile(key), content: body });
  }
  try {
    if (typeof kvSet === "function") await kvSet({ ns: "scratch", key: key, value: body });
  } catch (_) {}
  if (GOAR_SCRATCH.index.indexOf(key) < 0) GOAR_SCRATCH.index.push(key);
  return { ok: true, name: key, path: scratchGuestFile(key), bytes: body.length, guest: GOAR_SCRATCH.ready };
}

async function scratchRead(name) {
  await ensureScratchpad();
  const key = scratchSafeName(name);
  if (GOAR_SCRATCH.ready && typeof toolRead === "function") {
    try {
      const out = await toolRead({ path: scratchGuestFile(key) });
      if (out && !/^error:/i.test(String(out))) return { ok: true, name: key, content: String(out), via: "guest" };
    } catch (_) {}
  }
  try {
    if (typeof kvGet === "function") {
      const v = await kvGet({ ns: "scratch", key: key });
      if (v != null && v !== "") return { ok: true, name: key, content: String(v), via: "kv" };
    }
  } catch (_) {}
  return { ok: false, name: key, error: "not found" };
}

async function scratchList() {
  await ensureScratchpad();
  let names = GOAR_SCRATCH.index.slice();
  if (GOAR_SCRATCH.ready && typeof guestExec === "function") {
    try {
      const r = await guestExec("ls -1 " + GOAR_SCRATCH.guestPath + " 2>/dev/null", 8000);
      const out = String((r && r.output) || r || "");
      const fromGuest = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (fromGuest.length) names = fromGuest;
    } catch (_) {}
  }
  return { ok: true, path: GOAR_SCRATCH.guestPath, files: names, session: GOAR_SCRATCH.sessionId };
}

async function scratchClear(name) {
  await ensureScratchpad();
  if (name) {
    const key = scratchSafeName(name);
    if (GOAR_SCRATCH.ready && typeof toolDelete === "function") {
      try { await toolDelete({ path: scratchGuestFile(key) }); } catch (_) {}
    }
    try { if (typeof kvDel === "function") await kvDel({ ns: "scratch", key: key }); } catch (_) {}
    GOAR_SCRATCH.index = GOAR_SCRATCH.index.filter((x) => x !== key);
    return { ok: true, cleared: key };
  }
  if (GOAR_SCRATCH.ready && typeof guestExec === "function") {
    try { await guestExec("rm -rf " + GOAR_SCRATCH.guestPath + "/*", 8000); } catch (_) {}
  }
  GOAR_SCRATCH.index = [];
  return { ok: true, cleared: "all" };
}

async function toolScratch(args) {
  args = args && typeof args === "object" ? args : {};
  const act = String(args.op || args.action || "list").toLowerCase();
  const name = args.name || args.path || args.key || "note";
  if (act === "write" || act === "set" || act === "put") {
    return JSON.stringify(await scratchWrite(name, args.content != null ? args.content : args.value != null ? args.value : args.text));
  }
  if (act === "read" || act === "get") {
    return JSON.stringify(await scratchRead(name));
  }
  if (act === "clear" || act === "del" || act === "delete") {
    return JSON.stringify(await scratchClear(args.name || args.path || ""));
  }
  return JSON.stringify(await scratchList());
}

function scratchpadBlurb() {
  const files = GOAR_SCRATCH.index.length ? " files=" + GOAR_SCRATCH.index.join(",") : "";
  return (
    "Scratch: " + GOAR_SCRATCH.guestPath +
    " session=" + (GOAR_SCRATCH.sessionId || vibeSessionId()) +
    files +
    ". guest action=scratch op=write|read|list|clear name=… content=…. Notes/drafts/probes only — not the product tree."
  );
}

try {
  if (typeof window !== "undefined") {
    window.GOAR_SCRATCH = GOAR_SCRATCH;
    window.ensureScratchpad = ensureScratchpad;
    window.toolScratch = toolScratch;
    window.scratchpadBlurb = scratchpadBlurb;
  }
} catch (_) {}
