function paintFreezeStatus() {
  const box = document.getElementById("freezeStatus");
  if (!box) return;
  const m = window.__GOAR_FROZEN_META;
  if (m && m.gzBytes) {
    box.textContent = "Snapshot ready · " + (m.gzBytes / 1048576).toFixed(1) + " MB · next boot is instant";
  } else {
    box.textContent = "Snapshot: none yet — first full boot saves one automatically";
  }
}

function openSettings() {
  try { fillSettingsForm(); } catch (e) { console.warn(e); }
  try { refreshCacheStats(); } catch (_) {}
  try { paintFreezeStatus(); } catch (_) {}
  const box = document.getElementById("settings");
  if (box) {
    box.classList.add("open");
    box.style.display = "flex";
    box.style.zIndex = "11000";
    box.style.visibility = "visible";
    box.style.opacity = "1";
    try {
      if (typeof goarMotion !== "undefined" && goarMotion.sheetIn) {
        goarMotion.sheetIn(null, box);
      }
    } catch (_) {}
  }
  loadModelsFromApi({ selected: settingsSnapshot().apiModel }).catch(() => {});
  const btn = document.getElementById("refreshModels");
  if (btn && !btn._wired) {
    btn._wired = true;
    btn.addEventListener("click", () => {
      loadModelsFromApi({ selected: settingsSnapshot().apiModel }).catch((e) => {
        if (typeof appendMsg === "function") appendMsg("Models: " + (e.message || e), "err");
      });
    });
  }
}
function closeSettings() {
  const box = document.getElementById("settings");
  const hide = () => {
    if (box) {
      box.classList.remove("open");
      box.style.display = "";
    }
    try { term && term.focus(); } catch (_) {}
  };
  try {
    if (box && typeof goarMotion !== "undefined" && goarMotion.sheetOut) {
      goarMotion.sheetOut(box.querySelector(".sheet"), box, hide);
      return;
    }
  } catch (_) {}
  hide();
}


/** Fast base64 → ArrayBuffer
 *  1) Native: fetch(data:...;base64,...) — C++ path, best for large blobs
 *  2) Fallback: lookup-table decoder (no per-char atob loops)
 *  Chunk size always ÷4.
 */


/** Base64 → ArrayBuffer (chunked, memory-safe) */
const _B64_LUT = (() => {
  const s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[s.charCodeAt(i)] = i;
  t[61] = 0;
  return t;
})();

document.addEventListener("goar:open-settings", function (e) {
  try {
    if (typeof openSettings === "function") {
      openSettings();
      if (e && e.preventDefault) e.preventDefault();
    }
  } catch (_) {}
});
