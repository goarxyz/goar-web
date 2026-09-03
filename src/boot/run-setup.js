async function runSetup() {
  clearErr();
  try {
    if (typeof WebAssembly === "undefined" || typeof WebAssembly.instantiate !== "function") {
      throw new Error(
        "This browser has no WebAssembly API (needed for the workspace planes). " +
        "Use a current Chrome / Edge / Firefox / Safari."
      );
    }
    initTerm();
    try { if (typeof startHeavyWarm === "function") startHeavyWarm(); } catch (_) {}
    try { if (typeof ensureMwFabric === "function") ensureMwFabric(); } catch (_) {}
    try {
      if (typeof setProgress === "function") setProgress(35, "Kali", "Connecting persistent VM");
    } catch (_) {}
    const sshBoot = (typeof ensureSsh === "function")
      ? ensureSsh({ reason: "boot" }).catch(function (e) {
          console.warn("[goar] ssh boot", e);
          return null;
        })
      : Promise.resolve(null);
    try { if (typeof startGeckoWarm === "function") startGeckoWarm(); } catch (_) {}
    let boot = Promise.resolve();
    if (typeof bootWasmUnix === "function") {
      boot = bootWasmUnix();
    }
    await Promise.race([
      Promise.all([sshBoot, boot]),
      new Promise((r) => setTimeout(r, 12000)),
    ]);
    try {
      const st = typeof sshStatus === "function" ? sshStatus() : null;
      if (typeof setProgress === "function") {
        setProgress(100, st && st.ready ? "Kali ready" : "Ready", st && st.banner ? st.banner : "");
      }
    } catch (_) {
      try { if (typeof setProgress === "function") setProgress(100, "Ready", ""); } catch (__) {}
    }
    try { if (typeof showCredPhase === "function") showCredPhase(); } catch (_) {}
    boot.then(() => {
      try {
        if (typeof preloadGoarPeak === "function") preloadGoarPeak();
      } catch (_) {}
    }).catch((e) => console.warn("[goar] boot", e));
    sshBoot.then(function (st) {
      if (st && st.ready) {
        try { if (typeof __goarMarkEnvReady === "function") __goarMarkEnvReady(true, "ssh-boot"); } catch (_) {}
      }
    }).catch(function () {});
  } catch (e) {
    console.error(e);
    showErr((e && e.message) ? e.message : String(e));
  }
}

if (el.btnGoar) el.btnGoar.addEventListener("click", () => { try { term && term.focus(); } catch(_){} sendGoar(); });
el.btnSettings?.addEventListener("click", openSettings);
el.btnCloseSettings?.addEventListener("click", closeSettings);
el.settings?.addEventListener("click", (e) => { if (e.target === el.settings) closeSettings(); });
el.btnSaveSettings?.addEventListener("click", () => {
  const s = saveSettingsFromForm();
  if (!s) return;
  if (el.apiBase) el.apiBase.value = s.apiBase;
  if (typeof syncModelSelect === "function") syncModelSelect(s.apiModel); else if (el.apiModel) el.apiModel.value = s.apiModel;
  if (el.apiKey) el.apiKey.value = s.apiKey;
  if (el.provider) el.provider.value = s.provider || detectProvider(s.apiBase);
  if (el.status) el.status.textContent = "saved · loading models…";
  closeSettings();
  loadModelsFromApi({ selected: s.apiModel }).then((ids) => {
    try { if (el.status) el.status.textContent = "saved · " + (ids && ids.length ? ids.length + " models" : s.apiModel); } catch (_) {}
    try { syncIndicators({}); refreshAgentPill(); } catch (_) {}
  }).catch(() => {});
});
el.btnClearCache?.addEventListener("click", async () => {
  try {
    await caches.delete(CACHE_NAME);
    if (el.status) el.status.textContent = "asset cache cleared";
    await refreshCacheStats();
  } catch (e) { if (el.cacheStats) el.cacheStats.textContent = String(e); }
});
el.btnClearAll?.addEventListener("click", async () => {
  try {
    localStorage.removeItem(LS_KEY);
    try { localStorage.removeItem("goar_segfault_secret"); } catch (_) {}
    await caches.delete(CACHE_NAME);
    fillSettingsForm();
    await refreshCacheStats();
    if (el.status) el.status.textContent = "local data cleared";
  } catch (e) { if (el.cacheStats) el.cacheStats.textContent = String(e); }
});
el.retry?.addEventListener("click", () => location.reload());
document.getElementById("btnFreezeNow")?.addEventListener("click", async () => {
  const box = document.getElementById("freezeStatus");
  try {
    if (box) box.textContent = "Saving snapshot…";
    if (typeof saveSessionSnapshot !== "function") throw new Error("freeze unavailable");
    const m = await saveSessionSnapshot("manual");
    if (typeof paintFreezeStatus === "function") paintFreezeStatus();
    else if (box) box.textContent = "Snapshot saved · " + ((m && m.gzBytes) ? (m.gzBytes / 1048576).toFixed(1) + " MB" : "ok");
  } catch (e) {
    if (box) box.textContent = "Snapshot failed: " + (e.message || e);
  }
});


(function wireCredGate() {
  const p = document.getElementById("credProvider");
  const b = document.getElementById("credBase");
  const k = document.getElementById("credKey");
  const go = document.getElementById("credGo");
  p?.addEventListener("change", () => {
    if (b) b.dataset.auto = "1";
    applyCredProvider();
    tryModels();
  });
  b?.addEventListener("input", () => { if (b) b.dataset.auto = "0"; });
  let modelTimer = null;
  const tryModels = () => {
    clearTimeout(modelTimer);
    modelTimer = setTimeout(() => {
      const provider = (p && p.value) || "";
      const apiBase = (b && b.value) || "";
      const apiKey = (k && k.value) || "";
      const prov = typeof getProvider === "function" ? getProvider(provider) : null;
      const needsKey = typeof providerNeedsKey === "function"
        ? providerNeedsKey(prov)
        : (provider !== "ollama" && provider !== "openai-compatible" && provider !== "freeai");
      if (!apiKey && needsKey) {
        if (typeof setCredReady === "function") setCredReady(false, "Paste a key to list models");
        return;
      }
      loadModelsInto(document.getElementById("credModel"), { provider, apiBase, apiKey }).catch(() => {});
    }, 350);
  };
  k?.addEventListener("input", tryModels);
  k?.addEventListener("change", tryModels);
  document.getElementById("credModel")?.addEventListener("change", (e) => {
    const model = (e.target && e.target.value || "").trim();
    const provider = (p && p.value) || "";
    if (!model) return;
    try { saveSettings({ apiModel: model, provider }); } catch (_) {}
    if (typeof reflectActiveModel === "function") reflectActiveModel(model, provider);
  });
  document.getElementById("model-input")?.addEventListener("change", (e) => {
    const model = (e.target && e.target.value || "").trim();
    const provider = (document.getElementById("provider-select")?.value) || (p && p.value) || "";
    if (!model) return;
    try { saveSettings({ apiModel: model, provider }); } catch (_) {}
    if (typeof reflectActiveModel === "function") reflectActiveModel(model, provider);
  });
  go?.addEventListener("click", () => {
    if (typeof enterChatFromCreds === "function") {
      enterChatFromCreds();
      return;
    }
    const provider = (p && p.value) || "freeai";
    const apiBase = (b && b.value) || "";
    const apiKey = (k && k.value) || "";
    const apiModel = (document.getElementById("credModel")?.value || "qwen7b").trim();
    try { saveSettings({ provider, apiBase, apiKey, apiModel }); } catch (_) {}
    if (typeof finishEnterChat === "function") finishEnterChat();
    else {
      const setup = document.getElementById("setup");
      if (setup) setup.classList.add("hide");
      document.body.classList.add("goar-ready");
      document.getElementById("app")?.classList.add("show");
    }
  });
})();
