/**
 * In-app terms, privacy, and thanks — pages, not onboarding, not chat chrome.
 * Opened from the tiny links under the composer.
 */
(function (global) {
  "use strict";

  const TITLES = { thanks: "Thanks", privacy: "Privacy", licence: "Terms" };

  const THANKS = [
    { name: "THC — The Hacker's Choice", href: "https://www.thc.org/segfault", blurb: "segfault.net disposable root. Kali lives here." },
    { name: "segfault.net", href: "https://www.segfault.net", blurb: "Free SSH root servers. Join them: thc.org/ops." },
    { name: "Duck.ai", href: "https://duck.ai", blurb: "Private, no-account chat from DuckDuckGo." },
    { name: "DuckDuckGo", href: "https://duckduckgo.com", blurb: "Search." },
    { name: "Free.ai", href: "https://free.ai", blurb: "OpenAI-compatible demo models." },
    { name: "Pollinations", href: "https://pollinations.ai", blurb: "Image generation. No key." },
    { name: "xterm.js", href: "https://xtermjs.org", blurb: "The terminal you type into." },
    { name: "sshclient-wasm", href: "https://github.com/VerdigrisTech/sshclient-wasm", blurb: "SSH in this tab." },
  ];

  const PRIVACY = [
    "GOAR runs in this browser. There is no GOAR account and no GOAR backend of our own.",
    "Provider keys, SSH host/user/password, reconnect SECRET, chats, and the image gallery stay in this browser's localStorage until you clear them.",
    "The live workspace is the SSH host you choose (default: THC segfault.net). Commands, files, and desktop sessions exist on that machine, under their terms.",
    "Chat is sent to the intelligence you pick in Settings (GOAR is built in). Image prompts go to Pollinations. Those services have their own privacy policies.",
    "Network from this tab uses a CORS/WISP relay so the browser can open sockets it otherwise cannot. Relays see destination hosts, not your disk.",
    "We do not add telemetry, analytics, or crash beacons. Clearing site data in the browser wipes GOAR state on this device.",
  ];

  const LICENCE = [
    "GOAR is provided as-is, without warranty, for the person using this copy.",
    "Third-party code keeps its own licences: xterm.js (MIT), sshclient-wasm, BusyBox/WASI, Gecko WASM, Pollinations, Duck.ai, Free.ai, THC segfault.",
    "Kali, Pollinations, and THC services are not affiliated with GOAR. Use them under their terms.",
    "Do not use the Kali box to attack systems you do not own. THC will ban abuse; so will we by cutting the session.",
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;");
  }

  function paintThanks(el) {
    if (!el) return;
    el.innerHTML = THANKS.map(function (t) {
      return (
        '<a class="legal-card" href="' + esc(t.href) + '" target="_blank" rel="noopener noreferrer">' +
        "<b>" + esc(t.name) + "</b><span>" + esc(t.blurb) + "</span></a>"
      );
    }).join("");
  }

  function paintList(el, lines) {
    if (!el) return;
    el.innerHTML = lines.map(function (s) { return "<p>" + esc(s) + "</p>"; }).join("");
  }

  function showLegal(tab) {
    const ov = document.getElementById("legal-overlay");
    if (!ov) return;
    const name = (tab === "terms" || tab === "tos") ? "licence" : (tab || "privacy");
    ov.classList.add("open");
    ov.setAttribute("aria-hidden", "false");
    const title = document.getElementById("legal-title");
    if (title) title.textContent = TITLES[name] || "Legal";
    ov.querySelectorAll("[data-legal-pane]").forEach(function (p) {
      p.hidden = p.getAttribute("data-legal-pane") !== name;
    });
    paintThanks(document.getElementById("legal-thanks"));
    paintList(document.getElementById("legal-privacy"), PRIVACY);
    paintList(document.getElementById("legal-licence"), LICENCE);
  }

  function hideLegal() {
    const ov = document.getElementById("legal-overlay");
    if (!ov) return;
    ov.classList.remove("open");
    ov.setAttribute("aria-hidden", "true");
  }

  function wire() {
    paintThanks(document.getElementById("legal-thanks"));
    paintList(document.getElementById("legal-privacy"), PRIVACY);
    paintList(document.getElementById("legal-licence"), LICENCE);
    document.addEventListener("click", function (e) {
      const t = e.target && e.target.closest && e.target.closest("[data-legal]");
      if (!t) return;
      const act = t.getAttribute("data-legal");
      if (act === "open" || act === "thanks" || act === "privacy" || act === "licence" || act === "terms" || act === "tos") {
        e.preventDefault();
        showLegal(act === "open" ? "privacy" : act);
      }
      if (act === "close") hideLegal();
    });
    const ov = document.getElementById("legal-overlay");
    if (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target === ov) hideLegal();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hideLegal();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  try {
    global.goarShowLegal = showLegal;
    global.goarHideLegal = hideLegal;
    global.paintThanks = paintThanks;
    global.GOAR_THANKS = THANKS;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
