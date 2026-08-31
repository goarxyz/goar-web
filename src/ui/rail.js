/**
 * Samsung-style edge rail.
 * Clicks bubble — this file only owns open/close/drag. Views are wired in ghtml-shell.
 */
(function (global) {
  "use strict";

  const RAIL_W = 56;
  const SNAP = 28;

  function railEl() { return document.getElementById("side-rail"); }
  function tabEl() { return document.getElementById("rail-tab"); }
  function scrimEl() { return document.getElementById("rail-scrim"); }
  function edgeEl() { return document.getElementById("rail-edge"); }
  function isOpen() { return document.body.classList.contains("rail-open"); }

  function setOpen(on) {
    const rail = railEl();
    const scrim = scrimEl();
    const tab = tabEl();
    document.body.classList.toggle("rail-open", !!on);
    if (rail) {
      rail.style.transform = "";
      rail.classList.remove("rail-dragging");
      rail.style.transition = "";
    }
    if (scrim) {
      if (on) scrim.removeAttribute("hidden");
      else scrim.setAttribute("hidden", "");
    }
    if (tab) {
      tab.setAttribute("aria-expanded", on ? "true" : "false");
      tab.setAttribute("aria-label", on ? "Close menu" : "Open menu");
    }
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function ensureEdge() {
    let edge = edgeEl();
    if (edge) return edge;
    edge = document.createElement("div");
    edge.id = "rail-edge";
    edge.setAttribute("aria-hidden", "true");
    document.body.appendChild(edge);
    return edge;
  }

  function wire() {
    const rail = railEl();
    const tab = tabEl();
    const scrim = scrimEl();
    if (!tab || !rail || tab.dataset.wired === "1") return;
    tab.dataset.wired = "1";
    const edge = ensureEdge();
    try {
      if (rail.parentElement !== document.body) document.body.appendChild(rail);
      if (tab.parentElement !== document.body) document.body.appendChild(tab);
      if (scrim && scrim.parentElement !== document.body) document.body.appendChild(scrim);
      if (edge.parentElement !== document.body) document.body.appendChild(edge);
      rail.style.zIndex = "12000";
      if (scrim) scrim.style.zIndex = "11990";
      edge.style.zIndex = "12010";
      tab.style.zIndex = "12020";
    } catch (_) {}

    let drag = null;
    let suppressClick = false;

    function startDrag(x, pointerId, target) {
      drag = { x0: x, open: isOpen(), moved: 0, id: pointerId };
      rail.classList.add("rail-dragging");
      rail.style.transition = "none";
      try {
        if (pointerId != null && target && target.setPointerCapture) target.setPointerCapture(pointerId);
      } catch (_) {}
    }

    function moveDrag(x) {
      if (!drag) return;
      const dx = x - drag.x0;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      const from = drag.open ? 0 : -RAIL_W;
      const tx = clamp(from + dx, -RAIL_W, 0);
      rail.style.transform = "translateX(" + tx + "px)";
      drag.tx = tx;
    }

    function endDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      rail.classList.remove("rail-dragging");
      rail.style.transition = "";
      if (d.moved >= 8) suppressClick = true;
      if (d.moved < 8) {
        rail.style.transform = "";
        setOpen(!d.open);
        return;
      }
      const tx = typeof d.tx === "number" ? d.tx : d.open ? 0 : -RAIL_W;
      setOpen(tx > -SNAP);
    }

    function onHandleDown(e) {
      if (e.button != null && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest(".rail-btn")) return;
      e.preventDefault();
      startDrag(e.clientX, e.pointerId, e.currentTarget);
    }

    tab.addEventListener("pointerdown", onHandleDown);
    edge.addEventListener("pointerdown", onHandleDown);
    window.addEventListener("pointermove", function (e) {
      if (drag) moveDrag(e.clientX);
    }, { passive: true });
    window.addEventListener("pointerup", endDrag, { passive: true });
    window.addEventListener("pointercancel", endDrag, { passive: true });
    document.addEventListener("click", function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    tab.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(!isOpen());
      }
    });

    if (scrim) {
      scrim.addEventListener("click", function () { setOpen(false); });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) setOpen(false);
    });
    rail.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".rail-btn")) setOpen(false);
    });

    setOpen(false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  global.wireGoarRail = wire;
  global.openGoarRail = function () { setOpen(true); };
  global.closeGoarRail = function () { setOpen(false); };
  global.toggleGoarRail = function () { setOpen(!isOpen()); };
})(typeof window !== "undefined" ? window : this);
