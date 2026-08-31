(function (global) {
  "use strict";

  const SETTLE = "out(4)";
  const LEAVE = "in(2)";
  let started = false;
  let barTween = null;
  let bound = false;

  function reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  function compact() {
    try {
      return !!(window.matchMedia && window.matchMedia("(max-width: 640px)").matches);
    } catch (_) {
      return false;
    }
  }

  function dur(ms) {
    const n = compact() ? Math.round(ms * 0.82) : ms;
    return reduced() ? 1 : n;
  }

  function api() {
    const a = global.anime;
    return a && typeof a.animate === "function" ? a : null;
  }

  function $(sel) {
    return typeof sel === "string" ? document.querySelector(sel) : sel;
  }

  function panelIn(el) {
    el = $(el);
    const a = api();
    if (!el) return;
    if (el.id === "term-tab" || el.id === "terminal" || el.id === "browser-tab" || (el.closest && (el.closest("#term-tab") || el.closest("#browser-tab")))) return;
    if (reduced() || !a) {
      el.style.opacity = "1";
      return;
    }
    a.animate(el, {
      opacity: [0, 1],
      y: [compact() ? 10 : 8, 0],
      duration: dur(360),
      ease: SETTLE,
    });
  }

  function sheetIn(sheet, overlay) {
    sheet = $(sheet);
    overlay = $(overlay);
    const a = api();
    if (reduced() || !a) return;
    if (overlay) {
      a.animate(overlay, { opacity: [0, 1], duration: dur(220), ease: SETTLE });
    }
    if (sheet) {
      const fromY = compact() ? 28 : 12;
      a.animate(sheet, {
        opacity: [0, 1],
        y: [fromY, 0],
        scale: [compact() ? 1 : 0.98, 1],
        duration: dur(420),
        ease: SETTLE,
      });
    }
  }

  function sheetOut(sheet, overlay, then) {
    sheet = $(sheet);
    overlay = $(overlay);
    const a = api();
    const done = () => { if (typeof then === "function") then(); };
    if (reduced() || !a) {
      done();
      return;
    }
    if (overlay) a.animate(overlay, { opacity: [1, 0], duration: dur(180), ease: LEAVE });
    if (sheet) {
      a.animate(sheet, {
        opacity: [1, 0],
        y: [0, compact() ? 16 : 8],
        duration: dur(200),
        ease: LEAVE,
        onComplete: done,
      });
    } else done();
  }

  function drawerIn() {
    const ov = document.getElementById("drawer-overlay");
    const dr = document.getElementById("drawer");
    const a = api();
    if (reduced() || !a || !ov) return;
    const items = dr ? [...dr.querySelectorAll(".menu-item")] : [];
    a.animate(ov, { opacity: [0, 1], duration: dur(200), ease: SETTLE });
    if (dr) {
      a.animate(dr, { x: [compact() ? -18 : -12, 0], opacity: [0, 1], duration: dur(320), ease: SETTLE });
    }
    if (items.length) {
      a.animate(items, {
        opacity: [0, 1],
        x: [-6, 0],
        duration: dur(280),
        delay: a.stagger ? a.stagger(28, { start: 60 }) : 60,
        ease: SETTLE,
      });
    }
  }

  function historyIn() {
    const ov = document.getElementById("history-overlay");
    const panel = document.getElementById("history-panel");
    const a = api();
    if (reduced() || !a || !ov) return;
    a.animate(ov, { opacity: [0, 1], duration: dur(200), ease: SETTLE });
    if (panel) {
      a.animate(panel, {
        x: [compact() ? 20 : 16, 0],
        opacity: [0, 1],
        duration: dur(340),
        ease: SETTLE,
      });
    }
    const rows = panel ? [...panel.querySelectorAll(".hist-item, .hist-empty")] : [];
    if (rows.length) {
      a.animate(rows, {
        opacity: [0, 1],
        y: [6, 0],
        duration: dur(280),
        delay: a.stagger ? a.stagger(24, { start: 80 }) : 80,
        ease: SETTLE,
      });
    }
  }

  function studioOpen() {
    if (started) return;
    started = true;
    const line = document.getElementById("studio-line");
    const a = api();
    if (!line) return;
    const collapsed = getComputedStyle(line).opacity === "0" || line.style.transform === "scaleX(0)";
    if (reduced() || !a) {
      line.style.transform = "scaleX(1)";
      line.style.opacity = "0.45";
      return;
    }
    if (collapsed) {
      a.animate(line, { scaleX: [0, 1], opacity: [0, 0.45], duration: dur(520), ease: SETTLE });
    }
  }

  function progress(pct) {
    const fill = document.getElementById("barFill");
    if (!fill) return;
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    fill.style.width = p + "%";
  }

  function toCred() {
    const a = api();
    const bp = document.getElementById("bootPhase");
    const line = document.getElementById("studio-line");
    const cp = document.getElementById("credPhase");
    if (!cp) return;
    const show = () => {
      if (bp) { bp.hidden = true; bp.style.display = "none"; }
      if (line) line.style.display = "none";
      cp.hidden = false;
      cp.removeAttribute("hidden");
      cp.classList.add("on", "show");
    };
    if (reduced() || !a) { show(); return; }
    const leaving = [bp, line].filter(Boolean);
    if (leaving.length) {
      a.animate(leaving, { opacity: [1, 0], duration: dur(220), ease: LEAVE, onComplete: show });
    } else show();
    requestAnimationFrame(() => {
      const bits = [...cp.querySelectorAll(".hint, label, select, input, #credGo")];
      bits.forEach((n) => { n.style.opacity = "0"; });
      a.animate(bits, {
        opacity: [0, 1],
        y: [8, 0],
        duration: dur(420),
        delay: a.stagger ? a.stagger(40, { start: 70 }) : 70,
        ease: SETTLE,
      });
    });
  }

  function leaveSetup(then) {
    const setup = document.getElementById("setup");
    const a = api();
    const done = () => { if (typeof then === "function") then(); };
    if (!setup || reduced() || !a) {
      if (setup) { setup.classList.add("hide"); setup.classList.remove("open"); }
      try { if (typeof window.__goarStopParticles === "function") window.__goarStopParticles(); } catch (_) {}
      done();
      return;
    }
    a.animate(setup, {
      opacity: [1, 0],
      duration: dur(400),
      ease: LEAVE,
      onComplete: () => {
        setup.classList.add("hide");
        setup.classList.remove("open");
        setup.style.opacity = "";
        try { if (typeof window.__goarStopParticles === "function") window.__goarStopParticles(); } catch (_) {}
        done();
      },
    });
  }

  function enterStage() {
    const a = api();
    bindChrome();
    if (reduced() || !a) return;
    const welcome = document.getElementById("welcome");
    const composer = document.querySelector("#input-wrap .input-box");
    const rail = document.getElementById("side-rail");
    const btns = rail ? [...rail.querySelectorAll(".rail-btn")] : [];
    if (rail) a.animate(rail, { opacity: [0, 1], duration: dur(320), ease: SETTLE });
    if (btns.length) {
      a.animate(btns, {
        opacity: [0, 1],
        y: [6, 0],
        duration: dur(360),
        delay: a.stagger ? a.stagger(32, { start: 40 }) : 40,
        ease: SETTLE,
      });
    }
    if (welcome && welcome.classList.contains("on")) {
      const mark = welcome.querySelector(".goar-mark");
      const title = welcome.querySelector(".w-title");
      const sub = welcome.querySelector(".w-sub");
      const chips = welcome.querySelector(".w-chips");
      const tl = typeof a.createTimeline === "function" ? a.createTimeline({ defaults: { ease: SETTLE } }) : null;
      if (mark) {
        const g = { opacity: [0, 1], scale: [0.97, 1], y: [6, 0], filter: ["blur(6px)", "blur(0px)"], duration: dur(700) };
        if (tl) tl.add(mark, g, 40); else a.animate(mark, Object.assign({ delay: 40, ease: SETTLE }, g));
      }
      if (title) {
        const t = { opacity: [0, 1], y: [6, 0], duration: dur(500) };
        if (tl) tl.add(title, t, 260); else a.animate(title, Object.assign({ delay: 260, ease: SETTLE }, t));
      }
      if (sub) {
        const s = { opacity: [0, 1], duration: dur(380) };
        if (tl) tl.add(sub, s, 430); else a.animate(sub, Object.assign({ delay: 430, ease: SETTLE }, s));
      }
      if (chips) {
        const c = { opacity: [0, 1], y: [4, 0], duration: dur(380) };
        if (tl) tl.add(chips, c, 520); else a.animate(chips, Object.assign({ delay: 520, ease: SETTLE }, c));
      }
    }
    if (composer) {
      a.animate(composer, { opacity: [0, 1], y: [10, 0], duration: dur(460), delay: 180, ease: SETTLE });
    }
  }

  function enterMsg(el) {
    if (!el || reduced()) return;
    const a = api();
    if (!a) return;
    const user = el.classList.contains("user");
    a.animate(el, {
      opacity: [0, 1],
      y: [user ? 8 : 5, 0],
      scale: [user ? 0.98 : 1, 1],
      duration: dur(user ? 280 : 240),
      ease: SETTLE,
    });
  }

  function leaveWelcome() {
    const w = document.getElementById("welcome");
    if (!w || w.classList.contains("hide")) return;
    const a = api();
    const hide = () => {
      w.classList.add("hide");
      w.classList.remove("show", "on");
      w.style.display = "none";
    };
    if (reduced() || !a) { hide(); return; }
    a.animate(w, { opacity: [1, 0], y: [0, -6], duration: dur(220), ease: LEAVE, onComplete: hide });
  }

  function press(el) {
    const a = api();
    if (!el || reduced() || !a) return;
    a.animate(el, { scale: [1, 0.96, 1], duration: dur(180), ease: SETTLE });
  }

  function bindChrome() {
    if (bound) return;
    bound = true;
    const a = api();
    if (!a || reduced()) return;
    document.addEventListener("pointerenter", (e) => {
      const btn = e.target && e.target.closest && e.target.closest(".rail-btn, .w-chip, #chat-plus, #send-btn");
      if (!btn || btn.disabled) return;
      a.animate(btn, { scale: 1.04, duration: dur(180), ease: SETTLE });
    }, true);
    document.addEventListener("pointerleave", (e) => {
      const btn = e.target && e.target.closest && e.target.closest(".rail-btn, .w-chip, #chat-plus, #send-btn");
      if (!btn) return;
      a.animate(btn, { scale: 1, duration: dur(200), ease: SETTLE });
    }, true);
    document.addEventListener("pointerdown", (e) => {
      const btn = e.target && e.target.closest && e.target.closest(".rail-btn, .w-chip, #send-btn, #credGo, .menu-item, .action");
      if (!btn || btn.disabled) return;
      press(btn);
    }, true);
    const box = document.querySelector("#input-wrap .input-box");
    const input = document.getElementById("msg-input");
    if (box && input) {
      input.addEventListener("focus", () => {
        a.animate(box, { scale: 1.008, duration: dur(240), ease: SETTLE });
      });
      input.addEventListener("blur", () => {
        a.animate(box, { scale: 1, duration: dur(220), ease: SETTLE });
      });
    }
  }

  function boot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => { studioOpen(); bindChrome(); }, { once: true });
    } else {
      studioOpen();
      bindChrome();
    }
  }

  global.goarMotion = {
    studioOpen,
    toCred,
    leaveSetup,
    enterStage,
    enterMsg,
    leaveWelcome,
    progress,
    panelIn,
    sheetIn,
    sheetOut,
    drawerIn,
    historyIn,
    press,
    bindChrome,
    reduced,
  };
  boot();
})(typeof window !== "undefined" ? window : globalThis);
