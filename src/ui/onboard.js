/**
 * Onboarding removed — boot goes straight into chat.
 * Server details live in Settings.
 */
(function (global) {
  "use strict";

  function hideOnboard() {
    try {
      const ob = document.getElementById("onboard");
      if (ob) {
        ob.hidden = true;
        ob.classList.remove("on");
        ob.style.display = "none";
      }
      const setup = document.getElementById("setup");
      if (setup) {
        setup.classList.add("hide");
        setup.classList.remove("open");
      }
      const boot = document.getElementById("bootPhase");
      if (boot) {
        boot.hidden = true;
        boot.style.display = "none";
      }
      const cred = document.getElementById("credPhase");
      if (cred) {
        cred.hidden = true;
        cred.classList.remove("on", "show");
        cred.style.display = "none";
      }
    } catch (_) {}
  }

  function enter() {
    hideOnboard();
    try { localStorage.setItem("goar_onboard_v2", "1"); } catch (_) {}
    if (typeof finishEnterChat === "function") finishEnterChat();
  }

  try {
    global.startOnboard = enter;
    global.goarOnboardDone = function () { return true; };
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
