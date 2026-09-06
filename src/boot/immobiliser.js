/**
 * Debug immobiliser — keep GOAR alive when a plane throws.
 * Catches window errors, freezes a plane after repeated faults,
 * optional dock (Ctrl+Alt+I). Does not steal terminal keys while locked.
 */
(function (global) {
  "use strict";

  const LS = "goar_immobiliser_v1";
  const MAX_LOG = 200;
  const TRIP = 6;

  const IM = {
    locked: true,
    dockOpen: false,
    trips: Object.create(null),
    frozen: Object.create(null),
    log: [],
    last: "",
  };

  function now() { return Date.now(); }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || "{}");
      if (s && typeof s.locked === "boolean") IM.locked = s.locked;
    } catch (_) {}
  }
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ locked: IM.locked })); } catch (_) {}
  }

  function planeOf(msg) {
    const s = String(msg || "");
    if (/ssh|segfault|wisp|gowasm/i.test(s)) return "ssh";
    if (/duck|vqd|duckai/i.test(s)) return "duck";
    if (/pollination|generateImage/i.test(s)) return "create";
    if (/gecko|firefox/i.test(s)) return "browser";
    if (/unix|busybox|wasi/i.test(s)) return "unix";
    if (/mcp/i.test(s)) return "mcp";
    if (/xterm|terminal/i.test(s)) return "term";
    return "app";
  }

  function push(kind, msg, extra) {
    const row = {
      t: now(),
      kind: kind,
      plane: planeOf(msg),
      msg: String(msg || "").slice(0, 500),
      extra: extra ? String(extra).slice(0, 200) : "",
    };
    IM.log.push(row);
    if (IM.log.length > MAX_LOG) IM.log.splice(0, IM.log.length - MAX_LOG);
    IM.last = row.msg;
    const p = row.plane;
    IM.trips[p] = (IM.trips[p] || 0) + 1;
    if (IM.locked && IM.trips[p] >= TRIP) IM.frozen[p] = true;
    paint();
    return row;
  }

  function frozen(plane) {
    return !!(IM.locked && IM.frozen[plane]);
  }

  function thaw(plane) {
    if (plane) {
      IM.frozen[plane] = false;
      IM.trips[plane] = 0;
    } else {
      IM.frozen = Object.create(null);
      IM.trips = Object.create(null);
    }
    paint();
  }

  function paint() {
    const dock = document.getElementById("im-dock");
    const body = document.getElementById("im-log");
    const pill = document.getElementById("im-pill");
    const n = IM.log.length;
    const froze = Object.keys(IM.frozen).filter(function (k) { return IM.frozen[k]; });
    if (pill) {
      pill.hidden = !n;
      pill.textContent = froze.length ? ("locked " + froze.join(",")) : (n + " log");
      pill.classList.toggle("hot", !!froze.length);
    }
    if (!dock || !body || !IM.dockOpen) return;
    const rows = IM.log.slice(-40).reverse().map(function (r) {
      const d = new Date(r.t).toISOString().slice(11, 19);
      return '<div class="im-row im-' + r.kind + '"><span>' + d + "</span> <b>" +
        (r.plane || "") + "</b> " + String(r.msg).replace(/[<>&]/g, "") + "</div>";
    }).join("");
    body.innerHTML = rows || '<div class="im-row">quiet</div>';
    const lk = document.getElementById("im-lock");
    if (lk) lk.textContent = IM.locked ? "Immobiliser on" : "Immobiliser off";
  }

  function toggleDock(force) {
    IM.dockOpen = force == null ? !IM.dockOpen : !!force;
    const dock = document.getElementById("im-dock");
    if (dock) {
      dock.hidden = !IM.dockOpen;
      dock.setAttribute("aria-hidden", IM.dockOpen ? "false" : "true");
    }
    if (IM.dockOpen) paint();
  }

  function setLocked(on) {
    IM.locked = !!on;
    persist();
    paint();
  }

  function wrap(name, fn) {
    if (typeof fn !== "function") return fn;
    return function () {
      if (frozen(name)) return { ok: false, error: "immobilised:" + name, frozen: true };
      try {
        const r = fn.apply(this, arguments);
        if (r && typeof r.then === "function") {
          return r.catch(function (e) {
            push("err", name + ": " + (e && e.message ? e.message : e));
            throw e;
          });
        }
        return r;
      } catch (e) {
        push("err", name + ": " + (e && e.message ? e.message : e));
        if (IM.locked) return { ok: false, error: String(e && e.message ? e.message : e) };
        throw e;
      }
    };
  }

  function install() {
    load();
    const prevOn = global.onerror;
    global.onerror = function (msg, src, line, col, err) {
      push("err", String(msg || err || "error") + (src ? (" @ " + String(src).split("/").pop() + ":" + line) : ""));
      try { if (typeof prevOn === "function") prevOn.apply(this, arguments); } catch (_) {}
      return !!IM.locked;
    };
    global.addEventListener("unhandledrejection", function (ev) {
      const r = ev && ev.reason;
      push("err", "unhandled: " + (r && r.message ? r.message : r));
      if (IM.locked && ev && ev.preventDefault) ev.preventDefault();
    });
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.altKey && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        toggleDock();
      }
    });
    document.addEventListener("click", function (e) {
      const t = e.target && e.target.closest && e.target.closest("[data-im]");
      if (!t) return;
      const act = t.getAttribute("data-im");
      if (act === "toggle") toggleDock();
      if (act === "lock") setLocked(!IM.locked);
      if (act === "thaw") thaw();
      if (act === "close") toggleDock(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();

  try {
    global.GOAR_IM = IM;
    global.imLog = push;
    global.imFrozen = frozen;
    global.imThaw = thaw;
    global.imWrap = wrap;
    global.imToggle = toggleDock;
    global.imSnapshot = function () {
      return {
        locked: IM.locked,
        n: IM.log.length,
        last: IM.last,
        frozen: Object.keys(IM.frozen).filter(function (k) { return IM.frozen[k]; }),
        tail: IM.log.slice(-12),
      };
    };
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
