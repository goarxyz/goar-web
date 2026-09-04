/**
 * Full ghtml product shell: onboard, rail views, Computer (Gecko), Files/IDE (guest).
 */
(function () {
  "use strict";

  const SKILLS_KEY = "goar.skills.v1";
  const LOGO = "https://i.ibb.co/KpDHHP3b/goar-chat-boot.png";

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- onboard panes ---------- */
  function showOnboardPane(n) {
    [1, 2, 3].forEach((i) => {
      const pane = $("ob-pane-" + i);
      if (pane) pane.hidden = i !== n;
      const step = document.querySelector('.ob-step[data-step="' + i + '"]');
      if (step) {
        step.classList.toggle("on", i === n);
        step.classList.toggle("done", i < n);
      }
    });
    if (n === 2 && typeof showCredPhase === "function") {
      try { showCredPhase(); } catch (_) {}
    }
    if (n === 3) paintReadyStats();
  }

  function paintReadyStats() {
    const el = $("ob-ready-stats");
    if (!el) return;
    let s = {};
    try { s = typeof settingsSnapshot === "function" ? settingsSnapshot() : {}; } catch (_) {}
    const step = $("step") ? $("step").textContent : "";
    el.innerHTML =
      "Provider: " + esc(s.provider || "—") + "<br>" +
      "Model: " + esc(s.apiModel || "—") + "<br>" +
      "Computer: Firefox WASM<br>" +
      "Boot: " + esc(step || "warming");
  }

  function fillPresets() {
    const box = $("ob-presets");
    if (!box || box.dataset.ready) return;
    const list = ((typeof SERVICE_PROVIDERS !== "undefined" && SERVICE_PROVIDERS) || []).slice();
    const prefer = ["openrouter", "groq", "openai", "xai", "mistral", "deepseek"];
    list.sort((a, b) => {
      const ia = prefer.indexOf(a.id);
      const ib = prefer.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    box.innerHTML = list
      .slice(0, 16)
      .map(
        (p) =>
          '<button type="button" class="ob-preset" data-id="' +
          esc(p.id) +
          '"><b>' +
          esc(p.displayName || p.id) +
          "</b><span>" +
          esc((p.apiBase || "").replace(/^https?:\/\//, "")) +
          "</span></button>"
      )
      .join("");
    box.querySelectorAll(".ob-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        box.querySelectorAll(".ob-preset").forEach((x) => x.classList.remove("on"));
        btn.classList.add("on");
        const sel = $("credProvider");
        if (sel) {
          sel.value = btn.getAttribute("data-id");
          sel.dispatchEvent(new Event("change"));
        }
      });
    });
    box.dataset.ready = "1";
  }

  /* ---------- views ---------- */
  function restackRail() {
    ["rail-scrim", "side-rail", "rail-edge", "rail-tab"].forEach((id) => {
      const n = document.getElementById(id);
      if (n && n.parentElement !== document.body) {
        try { document.body.appendChild(n); } catch (_) {}
      }
    });
  }

  function goarShowView(view) {
    if (view === "files" || view === "workspace") view = "ide";
    document.body.classList.remove("split-computer", "files-only", "files-ide", "view-computer", "view-files", "view-term", "view-kit", "view-vnc", "view-creative");
    $("browser-tab")?.classList.remove("open", "view-active", "active");
    $("files-sheet-overlay")?.classList.remove("open", "view-active", "active");
    $("ide-shell")?.classList.remove("open", "view-active", "active");
    $("term-tab")?.classList.remove("open", "view-active", "active");
    $("vnc-tab")?.classList.remove("open", "view-active", "active");
    $("creative-tab")?.classList.remove("open", "view-active", "active");
    $("kit-tab")?.classList.remove("open", "view-active", "active");
    $("view-skills")?.classList.remove("active");
    $("chat")?.classList.remove("active");
    if ($("browser-tab")) $("browser-tab").setAttribute("aria-hidden", "true");
    if ($("files-sheet-overlay")) $("files-sheet-overlay").setAttribute("aria-hidden", "true");
    if ($("ide-shell")) $("ide-shell").setAttribute("aria-hidden", "true");
    document.querySelectorAll(".rail-btn[data-view]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-view") === view);
    });
    const lab = $("hdr-view-label");
    const labels = { chat: "Chat", computer: "Computer", ide: "Files", skills: "Skills", kit: "Toolkit", vnc: "Desktop", term: "Terminal", creative: "Create" };
    if (lab) lab.textContent = labels[view] || view;

    if (view === "chat") {
      $("chat")?.classList.add("active");
      try { if (typeof goarMotion !== "undefined") goarMotion.panelIn($("chat")); } catch (_) {}
    } else if (view === "computer") {
      document.body.classList.add("view-computer");
      $("browser-tab")?.classList.add("open", "view-active", "active");
      if ($("browser-tab")) $("browser-tab").setAttribute("aria-hidden", "false");
      try { if (typeof goarMotion !== "undefined") goarMotion.panelIn($("browser-tab")); } catch (_) {}
      openComputer();
    } else if (view === "term") {
      document.body.classList.add("view-term");
      const tab = $("term-tab");
      if (tab) {
        tab.classList.add("open", "view-active", "active");
        tab.setAttribute("aria-hidden", "false");
      }
      if (typeof attachTermView === "function") attachTermView();
      else {
        const stage = $("term-stage");
        const termEl = $("terminal");
        if (stage && termEl && termEl.parentElement !== stage) stage.appendChild(termEl);
        termEl?.classList.add("live");
        try {
          if (typeof fitAddon !== "undefined" && fitAddon && fitAddon.fit) fitAddon.fit();
          if (typeof term !== "undefined" && term && term.focus) term.focus();
        } catch (_) {}
      }
    } else if (view === "vnc") {
      document.body.classList.add("view-vnc");
      const tab = $("vnc-tab");
      if (tab) {
        tab.classList.add("open", "view-active", "active");
        tab.setAttribute("aria-hidden", "false");
      }
      if (typeof ensureVnc === "function") {
        ensureVnc({}).catch(function (e) {
          const st = $("vnc-status");
          if (st) st.textContent = String(e && e.message ? e.message : e).slice(0, 80);
        });
      }
    } else if (view === "creative") {
      document.body.classList.add("view-creative");
      const tab = $("creative-tab");
      if (tab) {
        tab.classList.add("open", "view-active", "active");
        tab.setAttribute("aria-hidden", "false");
      }
      if (typeof wireCreative === "function") wireCreative();
      if (typeof paintCreativeGallery === "function") paintCreativeGallery();
    } else if (view === "ide") {
      document.body.classList.add("view-files", "files-ide");
      $("files-sheet-overlay")?.classList.add("open", "view-active");
      $("ide-shell")?.classList.add("open", "view-active", "active");
      if ($("files-sheet-overlay")) $("files-sheet-overlay").setAttribute("aria-hidden", "false");
      try { if (typeof goarMotion !== "undefined") goarMotion.panelIn($("ide-shell") || $("files-sheet-overlay")); } catch (_) {}
      loadFileList();
      if (typeof ensureVscode === "function") ensureVscode().catch(function () {});
    } else if (view === "kit") {
      document.body.classList.add("view-kit");
      const tab = $("kit-tab");
      if (tab) {
        tab.classList.add("open", "view-active", "active");
        tab.setAttribute("aria-hidden", "false");
      }
      if (typeof mountGoarToolkit === "function") mountGoarToolkit();
      try { if (typeof goarMotion !== "undefined") goarMotion.panelIn($("kit-tab")); } catch (_) {}
    } else if (view === "skills") {
      $("view-skills")?.classList.add("active");
      renderSkills();
    }
    restackRail();
  }


  function toggleHistory(force) {
    const ov = $("history-overlay");
    if (!ov) return;
    const open = force == null ? !ov.classList.contains("open") : !!force;
    ov.classList.toggle("open", open);
    ov.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      renderHistory();
      try { if (typeof goarMotion !== "undefined") goarMotion.historyIn(); } catch (_) {}
    }
  }

  function renderHistory() {
    const box = $("history-list");
    if (!box) return;
    const items = typeof listSessions === "function" ? listSessions() : [];
    const cur = typeof currentSessionId === "function" ? currentSessionId() : "";
    if (!items.length) {
      box.innerHTML = '<div class="hist-empty">No chats yet</div>';
      return;
    }
    box.innerHTML = items.map((it) => {
      const when = it.updated ? new Date(it.updated).toLocaleString() : "";
      const cps = (it.checkpoints || []).length;
      return (
        '<div class="hist-item' + (it.id === cur ? " current" : "") + '" data-id="' + esc(it.id) + '">' +
          '<button type="button" class="hist-main" data-act="resume">' +
            '<span class="hist-title">' + esc(it.title || "Chat") + "</span>" +
            '<span class="hist-meta">' + esc(when) + (cps ? " · " + cps + " rewind" : "") + "</span>" +
          "</button>" +
          '<button type="button" class="hist-ico" data-act="rewind" title="Rewind">↩</button>' +
          '<button type="button" class="hist-ico" data-act="del" title="Delete">🗑</button>' +
        "</div>"
      );
    }).join("");
    box.querySelectorAll(".hist-item").forEach((row) => {
      const id = row.getAttribute("data-id");
      row.querySelectorAll("[data-act]").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = b.getAttribute("data-act");
          if (act === "resume") {
            if (typeof resumeSession === "function") resumeSession(id);
            toggleHistory(false);
            goarShowView("chat");
          } else if (act === "rewind") {
            const cps = typeof listCheckpoints === "function" ? listCheckpoints(id) : [];
            if (cps.length > 1) {
              let box = row.querySelector(".hist-rewind-list");
              if (box) { box.remove(); return; }
              box = document.createElement("div");
              box.className = "hist-rewind-list";
              cps.slice().reverse().forEach((cp, i) => {
                const real = cps.length - 1 - i;
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = (cp.label || "checkpoint") + " · " + new Date(cp.ts || Date.now()).toLocaleString();
                b.addEventListener("click", (ev) => {
                  ev.stopPropagation();
                  if (typeof rewindSession === "function") rewindSession(id, real);
                  toggleHistory(false);
                  goarShowView("chat");
                });
                box.appendChild(b);
              });
              row.appendChild(box);
              return;
            }
            if (typeof rewindSession === "function") rewindSession(id);
            toggleHistory(false);
            goarShowView("chat");
          } else if (act === "del") {
            if (typeof deleteSession === "function") deleteSession(id);
            renderHistory();
          }
        });
      });
    });
  }

  function toggleDrawer(force) {
    const ov = $("drawer-overlay");
    if (!ov) return;
    const open = force == null ? !ov.classList.contains("open") : !!force;
    ov.classList.toggle("open", open);
    ov.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      try { if (typeof goarMotion !== "undefined") goarMotion.drawerIn(); } catch (_) {}
    }
  }

  function newSession() {
    if (typeof startNewSession === "function") {
      startNewSession();
      toggleHistory(false);
      return;
    }
    try {
      if (typeof clearMission === "function") clearMission();
      if (typeof agentHistory !== "undefined") agentHistory.length = 0;
      localStorage.removeItem("goar.agent.chat.v1");
    } catch (_) {}
    const inner = $("chat-inner");
    if (inner) {
      [...inner.children].forEach((n) => {
        if (n.id !== "welcome") n.remove();
      });
    }
    const w = $("welcome");
    if (w) {
      w.classList.remove("hide");
      w.style.display = "";
      w.classList.add("show", "on");
    }
    toggleDrawer(false);
    goarShowView("chat");
  }

  /* ---------- Computer = Gecko ---------- */
  async function openComputer() {
    const st = $("browser-status");
    const empty = $("browser-empty");
    if (st) st.textContent = "starting";
    if (typeof ensureGecko === "function") {
      try {
        const cur = (typeof geckoStatus === "function" && geckoStatus()) || {};
        const keep = !!(cur.lastUrl || (cur.ready && document.getElementById("goar-live-frame")));
        const r = await ensureGecko({
          mode: "embed",
          show: true,
          url: keep ? undefined : (window.GOAR_GECKO_HOME || "https://html.duckduckgo.com/html/"),
        });
        if (st) st.textContent = r && r.ready ? "live" : "warming";
        if (empty && r && r.ready) {
          empty.style.display = "none";
          empty.classList.add("hidden");
        }
        if (typeof geckoShow === "function") geckoShow();
        if (typeof fitGecko === "function") await fitGecko();
        if (typeof sizeChromeIframe === "function") sizeChromeIframe();
        try { document.getElementById("goar-live-frame")?.contentWindow?.focus(); } catch (_) {}
        try { document.getElementById("geckoChromeFrame")?.contentWindow?.focus(); } catch (_) {}
        try { document.getElementById("geckoCanvas")?.focus(); } catch (_) {}
      } catch (e) {
        if (st) st.textContent = "error";
      }
    }
  }

  async function computerGo() {
    const input = $("browser-url");
    const url = (input && input.value || "").trim();
    if (!url) return;
    const st = $("browser-status");
    if (st) st.textContent = "loading…";
    try {
      if (typeof geckoLoad === "function") await geckoLoad(url);
      else if (typeof pageGoto === "function") await pageGoto(url);
      if (st) st.textContent = "live";
    } catch (e) {
      if (st) st.textContent = String(e.message || e).slice(0, 48);
    }
  }

  /* ---------- Files / IDE on guest ---------- */
  let idePath = "";
  let ideOriginal = "";
  let filesCwd = "/workspace";

  function langFromName(name) {
    const ext = (String(name).split(".").pop() || "").toLowerCase();
    const map = {
      py: "python", js: "javascript", ts: "typescript", json: "json", md: "markdown",
      html: "html", css: "css", sh: "shell", yml: "yaml", yaml: "yaml", rs: "rust",
      txt: "text",
    };
    return map[ext] || ext || "text";
  }
  function extBadge(name) {
    const ext = (String(name).split(".").pop() || "").toLowerCase();
    if (!ext || ext === String(name).toLowerCase()) return "dir";
    return ext.slice(0, 4);
  }

  function updateGutter() {
    const ed = $("ide-editor");
    const g = $("ide-gutter");
    if (!ed || !g) return;
    const n = Math.min(ed.value.split("\n").length, 5000);
    let h = "";
    for (let i = 1; i <= n; i++) h += i + "\n";
    g.textContent = h;
    g.scrollTop = ed.scrollTop;
  }

  function parseLs(raw, cwd) {
    const files = [];
    for (const line of String(raw || "").split("\n")) {
      const t = line.trim();
      if (!t || /^total\s/i.test(t) || /^TOOL_ERROR|^error:/i.test(t)) continue;
      const parts = t.split(/\s+/);
      const name = parts[parts.length - 1];
      if (!name || name === "." || name === "..") continue;
      const isDir = t.startsWith("d") || name.endsWith("/");
      const clean = name.replace(/\/$/, "");
      files.push({
        name: clean,
        path: (cwd.replace(/\/$/, "") + "/" + clean).replace(/\/+/g, "/"),
        dir: isDir,
      });
    }
    return files;
  }

  async function loadFileList() {
    const list = $("files-list");
    if (!list) return;
    const crumb = $("files-crumb");
    if (crumb) crumb.textContent = filesCwd;
    const guestUp =
      (typeof envReady !== "undefined" && !!envReady) ||
      !!(typeof window !== "undefined" && (window.__emulator || window.__GOAR_UNIX || window.__pyodide || (window.Unix && window.Unix.ready)));
    if (typeof toolLs !== "function" && typeof unixList !== "function") {
      list.innerHTML = '<div class="files-empty">Workspace warming. <button type="button" id="files-retry" class="ide-tool-btn">Retry</button></div>';
      document.getElementById("files-retry")?.addEventListener("click", () => loadFileList());
      if (!loadFileList._retry) {
        loadFileList._retry = setTimeout(() => { loadFileList._retry = 0; loadFileList(); }, 2500);
      }
      return;
    }
    list.innerHTML = '<div class="files-empty">Reading /workspace…</div>';
    try {
      const raw = await Promise.race([
        toolLs({ path: filesCwd }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("list timed out")), 2500)),
      ]);
      const files = parseLs(raw, filesCwd);
      if (!files.length) {
        list.innerHTML = '<div class="files-empty">Empty — upload or ask the agent to write a file.</div>';
        return;
      }
      const up =
        filesCwd !== "/workspace" && filesCwd !== "/"
          ? '<div class="file-row" data-up="1"><span class="ext">dir</span><span class="meta"><span class="name">..</span></span></div>'
          : "";
      list.innerHTML =
        up +
        files
          .slice(0, 400)
          .map((f) => {
            return (
              '<div class="file-row" data-path="' +
              esc(f.path) +
              '" data-dir="' +
              (f.dir ? "1" : "0") +
              '"><span class="ext">' +
              esc(f.dir ? "dir" : extBadge(f.name)) +
              '</span><span class="meta"><span class="name">' +
              esc(f.name) +
              "</span></span></div>"
            );
          })
          .join("");
      list.querySelectorAll(".file-row").forEach((row) => {
        row.addEventListener("click", () => {
          if (row.getAttribute("data-up") === "1") {
            filesCwd = filesCwd.replace(/\/[^/]+$/, "") || "/workspace";
            loadFileList();
            return;
          }
          const p = row.getAttribute("data-path");
          if (row.getAttribute("data-dir") === "1") {
            filesCwd = p;
            loadFileList();
          } else {
            openFile(p);
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<div class="files-empty">Could not list files. <button type="button" id="files-retry" class="ide-tool-btn">Retry</button></div>';
      document.getElementById("files-retry")?.addEventListener("click", () => loadFileList());
      if (!loadFileList._retry) {
        loadFileList._retry = setTimeout(() => { loadFileList._retry = 0; loadFileList(); }, 3000);
      }
    }
  }

  async function openFile(path) {
    if (!path) return;
    idePath = path;
    const ed = $("ide-editor");
    if ($("ide-path")) $("ide-path").textContent = path;
    const lang = langFromName(path);
    if ($("ide-lang")) $("ide-lang").textContent = lang;
    if ($("ide-status-lang")) $("ide-status-lang").textContent = lang;
    try {
      const raw = typeof toolRead === "function" ? await toolRead({ path }) : "";
      const text = String(raw || "");
      if (typeof vscodeOpen === "function") {
        await vscodeOpen(path, text, lang);
      } else if (ed) {
        ed.value = text;
      }
      ideOriginal = typeof vscodeGetValue === "function" ? vscodeGetValue() : (ed ? ed.value : "");
      if ($("ide-status-size")) $("ide-status-size").textContent = (ed ? ed.value.length : 0) + " B";
      if ($("ide-status-dirty")) $("ide-status-dirty").textContent = "";
      updateGutter();
      $("ide-shell")?.classList.add("open", "view-active");
      document.body.classList.add("files-ide");
      if (window.matchMedia && window.matchMedia("(min-width: 960px)").matches) {
        $("files-sheet-overlay")?.classList.add("open", "view-active");
      }
      ed?.focus();
    } catch (e) {
      if ($("ide-ai-status")) $("ide-ai-status").textContent = String(e.message || e);
    }
  }

  async function saveFile() {
    const body = typeof vscodeGetValue === "function" ? vscodeGetValue() : ($("ide-editor") && $("ide-editor").value);
    if (!idePath || body == null) return;
    try {
      if (typeof toolWrite === "function") await toolWrite({ path: idePath, content: body, overwrite: true });
      ideOriginal = body;
      if ($("ide-status-dirty")) $("ide-status-dirty").textContent = "";
      if ($("ide-ai-status")) $("ide-ai-status").textContent = "Saved";
    } catch (e) {
      if ($("ide-ai-status")) $("ide-ai-status").textContent = "Save failed: " + (e.message || e);
    }
  }

  async function newFile() {
    const name = prompt("New file path:", filesCwd.replace(/\/$/, "") + "/untitled.py");
    if (!name) return;
    try {
      if (typeof toolWrite === "function") await toolWrite({ path: name, content: "" });
      await openFile(name);
      await loadFileList();
    } catch (e) {
      alert("Could not create: " + (e.message || e));
    }
  }

  async function uploadToGuest(fileList) {
    for (const file of fileList || []) {
      let text = "";
      try { text = await file.text(); } catch (_) { text = ""; }
      const path = filesCwd.replace(/\/$/, "") + "/" + file.name;
      if (typeof toolWrite === "function") await toolWrite({ path, content: text });
    }
    await loadFileList();
  }

  function downloadCurrent() {
    if (!idePath || !$("ide-editor")) return;
    const blob = new Blob([$("ide-editor").value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = idePath.split("/").pop() || "file.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function applyAiEdit() {
    const prompt = ($("ide-ai-input")?.value || "").trim();
    const ed = $("ide-editor");
    if (!prompt || !ed || !idePath) return;
    const st = $("ide-ai-status");
    if (st) st.textContent = "Editing…";
    const input = $("msg-input");
    if (input && typeof sendCommand === "function") {
      input.value =
        "Edit this file in place. Return by writing the full file with guest write.\nFile: " +
        idePath +
        "\nInstruction: " +
        prompt +
        "\n\n--- CURRENT ---\n" +
        ed.value.slice(0, 60000);
      goarShowView("chat");
      sendCommand();
      if (st) st.textContent = "Sent to agent";
    }
  }

  /* ---------- skills ---------- */
  function readSkills() {
    try {
      const raw = JSON.parse(localStorage.getItem(SKILLS_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }
  function writeSkills(arr) {
    localStorage.setItem(SKILLS_KEY, JSON.stringify(arr.slice(0, 40)));
  }
  function renderSkills() {
    const list = $("skills-list");
    if (!list) return;
    const skills = readSkills();
    list.innerHTML =
      skills
        .map(
          (s) =>
            '<div class="skill-item"><div><b style="color:#eee">' +
            esc(s.name) +
            '</b><div style="color:#888;font-size:12px;margin-top:4px">' +
            esc(s.description || "") +
            "</div></div></div>"
        )
        .join("") ||
      '<div style="color:#666;padding:12px">No skills yet. Outcomes only — they load into the agent automatically.</div>';
  }
  function skillBlurb() {
    const skills = readSkills();
    if (!skills.length) return "";
    return (
      "## SKILLS (apply when relevant — do not list them)\n" +
      skills
        .slice(0, 12)
        .map((s) => "- " + s.name + ": " + (s.instructions || s.description || ""))
        .join("\n")
    );
  }

  function useChip(el) {
    const t = ((el && (el.getAttribute("data-q") || el.textContent)) || "").trim();
    const input = $("msg-input");
    if (!input || !t) return;
    if (/open the live computer/i.test(t)) goarShowView("computer");
    input.value = t;
    input.focus();
    if (typeof sendCommand === "function") sendCommand();
  }

  function wire() {
    fillPresets();
    $("ob-next-1")?.addEventListener("click", () => showOnboardPane(2));
    $("ob-back-2")?.addEventListener("click", () => showOnboardPane(1));
    $("ob-finish")?.addEventListener("click", () => {
      window.__goarOnboardDone = true;
      if (typeof finishEnterChat === "function") finishEnterChat();
    });
    $("ob-open-computer")?.addEventListener("click", () => {
      window.__goarOnboardDone = true;
      if (typeof finishEnterChat === "function") finishEnterChat();
      setTimeout(() => goarShowView("computer"), 80);
    });

    document.querySelectorAll(".rail-btn[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => goarShowView(btn.getAttribute("data-view")));
    });
    $("btn-new")?.addEventListener("click", newSession);
    $("btn-history")?.addEventListener("click", () => toggleHistory());
    $("btn-rewind")?.addEventListener("click", () => toggleHistory());
    $("btn-settings")?.addEventListener("click", (e) => {
      toggleHistory(false);
      if (typeof closeGoarRail === "function") closeGoarRail();
      if (typeof openSettings === "function") openSettings();
      else {
        const box = $("settings");
        if (box) { box.classList.add("open"); box.style.display = "flex"; box.style.zIndex = "10000"; }
      }
    });
    $("settings")?.addEventListener("click", (e) => {
      if (e.target === $("settings") && typeof closeSettings === "function") closeSettings();
    });
    $("history-overlay")?.addEventListener("click", (e) => {
      if (e.target === $("history-overlay")) toggleHistory(false);
    });
    $("history-clear")?.addEventListener("click", () => {
      if (typeof clearAllSessions === "function") clearAllSessions();
      newSession();
      renderHistory();
    });
    $("btn-menu")?.addEventListener("click", () => toggleHistory());
    $("drawer-overlay")?.addEventListener("click", (e) => {
      if (e.target === $("drawer-overlay")) toggleHistory(false);
    });
    document.querySelectorAll(".menu-item[data-view]").forEach((b) => {
      b.addEventListener("click", () => {
        toggleDrawer(false);
        goarShowView(b.getAttribute("data-view"));
      });
    });
    $("menu-history")?.addEventListener("click", () => {
      toggleDrawer(false);
      toggleHistory(true);
    });
    $("menu-settings")?.addEventListener("click", () => {
      toggleDrawer(false);
      if (typeof openSettings === "function") openSettings();
    });
    $("hdr-new")?.addEventListener("click", newSession);
    $("drawer-new")?.addEventListener("click", newSession);
    $("drawer-settings")?.addEventListener("click", () => {
      toggleDrawer(false);
      if (typeof openSettings === "function") openSettings();
    });
    $("btnCloseSettingsTop")?.addEventListener("click", () => {
      if (typeof closeSettings === "function") closeSettings();
    });
    $("drawer-clear")?.addEventListener("click", newSession);

    $("browser-close")?.addEventListener("click", () => goarShowView("chat"));
    $("computer-reload-vnc")?.addEventListener("click", openComputer);
    $("vnc-reload")?.addEventListener("click", () => {
      if (typeof ensureVnc === "function") ensureVnc({ force: true }).catch(function () {});
    });
    $("browser-go")?.addEventListener("click", computerGo);
    $("browser-url-form")?.addEventListener("submit", (e) => { e.preventDefault(); computerGo(); });
    $("browser-reload")?.addEventListener("click", () => {
      if (typeof geckoReload === "function") geckoReload();
      else computerGo();
    });
    $("browser-back")?.addEventListener("click", () => {
      if (typeof geckoBack === "function") geckoBack();
    });
    $("browser-forward")?.addEventListener("click", () => {
      try { window.__GOAR_GECKO?.evalChrome("content.history.forward()"); } catch (_) {}
    });
    $("browser-url")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") computerGo();
    });
    $("browser-reload")?.addEventListener("click", computerGo);
    $("handoff-computer")?.addEventListener("click", () => goarShowView("computer"));

    $("files-close")?.addEventListener("click", () => goarShowView("chat"));
    $("ide-close")?.addEventListener("click", () => goarShowView("chat"));
    $("files-refresh")?.addEventListener("click", loadFileList);
    $("files-new")?.addEventListener("click", newFile);
    $("ide-new")?.addEventListener("click", newFile);
    $("ide-save")?.addEventListener("click", saveFile);
    $("ide-download")?.addEventListener("click", downloadCurrent);
    $("files-upload-btn")?.addEventListener("click", () => $("files-upload-input")?.click());
    $("files-upload-input")?.addEventListener("change", (e) => {
      uploadToGuest(e.target.files);
      e.target.value = "";
    });
    $("ide-upload-ed")?.addEventListener("click", () => $("ide-upload-input")?.click());
    $("ide-upload-input")?.addEventListener("change", (e) => {
      uploadToGuest(e.target.files);
      e.target.value = "";
    });
    $("ide-editor")?.addEventListener("input", () => {
      if ($("ide-status-dirty")) $("ide-status-dirty").textContent = "• unsaved";
      updateGutter();
    });
    $("ide-editor")?.addEventListener("scroll", () => {
      if ($("ide-gutter") && $("ide-editor")) $("ide-gutter").scrollTop = $("ide-editor").scrollTop;
    });
    $("ide-format")?.addEventListener("click", () => {
      const ed = $("ide-editor");
      if (!ed) return;
      try {
        if (($("ide-lang")?.textContent || "") === "json") {
          ed.value = JSON.stringify(JSON.parse(ed.value), null, 2) + "\n";
        }
      } catch (_) {}
      updateGutter();
    });
    $("ide-ai-btn")?.addEventListener("click", () => $("ide-ai-bubble")?.classList.toggle("open"));
    $("ide-ai-close")?.addEventListener("click", () => $("ide-ai-bubble")?.classList.remove("open"));
    $("ide-ai-cancel")?.addEventListener("click", () => $("ide-ai-bubble")?.classList.remove("open"));
    $("ide-ai-apply")?.addEventListener("click", applyAiEdit);

    document.querySelectorAll(".w-chip").forEach((c) => {
      c.addEventListener("click", () => useChip(c));
    });
    $("skill-save")?.addEventListener("click", () => {
      const name = ($("skill-name")?.value || "").trim();
      if (!name) return;
      const skills = readSkills();
      skills.push({
        name,
        description: ($("skill-desc")?.value || "").trim(),
        instructions: ($("skill-body")?.value || "").trim(),
      });
      writeSkills(skills);
      ["skill-name", "skill-desc", "skill-body"].forEach((id) => {
        if ($(id)) $(id).value = "";
      });
      renderSkills();
    });
    $("skill-refresh")?.addEventListener("click", renderSkills);
    const pick = () => $("chat-attach-input")?.click();
    $("chat-plus")?.addEventListener("click", pick);
    $("chat-attach")?.addEventListener("click", pick);
    $("chat-attach-input")?.addEventListener("change", async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      if (!files.length) return;
      window.__GOAR_ATTACHMENTS = window.__GOAR_ATTACHMENTS || [];
      for (const f of files) {
        let text = "";
        let kind = "text";
        try {
          if (/^(text|application\/(json|xml|javascript|typescript)|image\/svg)/i.test(f.type) || /\.(txt|md|json|js|ts|py|html|css|svg|sh|yml|yaml|toml|rs|go|c|h)$/i.test(f.name)) {
            text = (await f.text()).slice(0, 120000);
          } else {
            kind = "binary";
            text = "[binary " + f.type + " · " + f.size + " B]";
          }
        } catch (_) {
          kind = "binary";
          text = "[unreadable]";
        }
        window.__GOAR_ATTACHMENTS.push({ name: f.name, size: f.size, type: f.type || kind, text });
      }
      if (typeof renderAttachChips === "function") renderAttachChips();
    });

    $("chat")?.classList.add("active");
    showOnboardPane(1);

    // keep ready-stats in sync with boot
    const step = $("step");
    if (step && typeof MutationObserver !== "undefined") {
      new MutationObserver(paintReadyStats).observe(step, { childList: true, characterData: true, subtree: true });
    }
  }

  window.goarShowView = goarShowView;
  window.goarShowOnboardPane = showOnboardPane;
  window.toggleHistory = toggleHistory;
  window.renderHistory = renderHistory;
  window.toggleDrawer = toggleDrawer;
  window.closeDrawer = function (e) {
    if (!e || e.target === $("drawer-overlay")) toggleDrawer(false);
  };
  window.newSession = newSession;
  window.useChip = useChip;
  window.goarSkillBlurb = skillBlurb;
  window.__goarOpenBrowser = () => goarShowView("computer");
  window.__goarOpenFiles = () => goarShowView("ide");
  window.__goarOpenFile = openFile;
  window.__goarEnsureEditor = () => goarShowView("ide");

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
