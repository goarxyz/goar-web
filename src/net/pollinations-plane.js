/**
 * Pollinations image plane — zero key, zero setup.
 * GET https://image.pollinations.ai/prompt/{prompt}  (200 JPEG, CORS *)
 */
(function (global) {
  "use strict";

  const LS = "goar_creative_gallery_v1";
  const MAX_GALLERY = 48;
  const SIZES = {
    "1:1": [1024, 1024],
    "16:9": [1280, 720],
    "9:16": [720, 1280],
    "4:3": [1024, 768],
    "3:2": [1200, 800],
  };
  const MODELS = ["flux", "turbo", "flux-realism", "gptimage"];

  function gallery() {
    try {
      const a = JSON.parse(localStorage.getItem(LS) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (_) {
      return [];
    }
  }
  function saveGallery(list) {
    try {
      localStorage.setItem(LS, JSON.stringify((list || []).slice(0, MAX_GALLERY)));
    } catch (_) {}
  }

  function imageUrl(prompt, opts) {
    opts = opts || {};
    const model = MODELS.indexOf(opts.model) >= 0 ? opts.model : "flux";
    let w = Number(opts.width) || 0;
    let h = Number(opts.height) || 0;
    if ((!w || !h) && opts.size && SIZES[opts.size]) {
      w = SIZES[opts.size][0];
      h = SIZES[opts.size][1];
    }
    if (!w) w = 1024;
    if (!h) h = 1024;
    const seed = opts.seed != null && opts.seed !== "" ? Number(opts.seed) : (Date.now() % 2147483647);
    const q = new URLSearchParams();
    q.set("model", model);
    q.set("width", String(w));
    q.set("height", String(h));
    q.set("nologo", "true");
    q.set("enhance", opts.enhance === false ? "false" : "true");
    q.set("seed", String(seed));
    const path = encodeURIComponent(String(prompt || "").trim()).replace(/%20/g, "%20");
    return {
      url: "https://image.pollinations.ai/prompt/" + path + "?" + q.toString(),
      model: model,
      width: w,
      height: h,
      seed: seed,
    };
  }

  function waitImg(url, timeoutMs) {
    timeoutMs = timeoutMs || 90000;
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const t = setTimeout(function () {
        img.onload = img.onerror = null;
        reject(new Error("image timed out"));
      }, timeoutMs);
      img.onload = function () {
        clearTimeout(t);
        resolve({ ok: true, url: url, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = function () {
        clearTimeout(t);
        reject(new Error("image failed"));
      };
      img.src = url;
    });
  }

  async function generateImage(opts) {
    opts = opts && typeof opts === "object" ? opts : { prompt: String(opts || "") };
    const prompt = String(opts.prompt || opts.text || "").trim();
    if (!prompt) return { ok: false, error: "prompt required" };
    const spec = imageUrl(prompt, opts);
    try {
      await waitImg(spec.url, Number(opts.timeout_ms || 90000));
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : "generate failed", url: spec.url };
    }
    const item = {
      id: "cr_" + Date.now().toString(36),
      prompt: prompt,
      url: spec.url,
      model: spec.model,
      width: spec.width,
      height: spec.height,
      seed: spec.seed,
      at: Date.now(),
    };
    const list = gallery();
    list.unshift(item);
    saveGallery(list);
    try {
      if (typeof paintCreativeGallery === "function") paintCreativeGallery();
    } catch (_) {}
    return { ok: true, ...item };
  }

  async function saveImageToKali(item, path) {
    item = item || {};
    const url = item.url;
    if (!url) return { ok: false, error: "no image" };
    path = String(path || ("/sec/workspace/creative/" + (item.id || Date.now()) + ".jpg"));
    if (typeof sshExec !== "function") return { ok: false, error: "Kali not ready", path: path };
    try {
      const r = await sshExec(
        "mkdir -p \"$(dirname " + JSON.stringify(path) + ")\" && curl -fsSL --max-time 90 " +
          JSON.stringify(url) +
          " -o " +
          JSON.stringify(path) +
          " && wc -c " +
          JSON.stringify(path),
        120000
      );
      return { ok: !!(r && Number(r.code) === 0), path: path, output: (r && r.output) || "" };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  function paintCreativeGallery() {
    const grid = document.getElementById("cr-grid");
    if (!grid) return;
    const list = gallery();
    if (!list.length) {
      grid.innerHTML = '<div class="cr-empty">Describe an image. No key. Flux on Pollinations.</div>';
      return;
    }
    grid.innerHTML = list
      .map(function (it) {
        const p = String(it.prompt || "").replace(/[<>&]/g, "");
        return (
          '<figure class="cr-card" data-id="' +
          it.id +
          '"><img src="' +
          it.url +
          '" alt="" loading="lazy"><figcaption>' +
          p.slice(0, 90) +
          "</figcaption></figure>"
        );
      })
      .join("");
    grid.querySelectorAll(".cr-card").forEach(function (el) {
      el.addEventListener("click", function () {
        const id = el.getAttribute("data-id");
        const it = gallery().find(function (x) { return x.id === id; });
        if (!it) return;
        try {
          if (typeof goarShowView === "function") goarShowView("chat");
          if (typeof appendMsg === "function") {
            appendMsg("![image](" + it.url + ")\n" + it.prompt, "ai");
          }
        } catch (_) {}
      });
    });
  }

  function setCrStatus(t) {
    const el = document.getElementById("cr-status");
    if (el) el.textContent = t || "";
  }

  function wireCreative() {
    if (wireCreative._on) return;
    wireCreative._on = true;
    paintCreativeGallery();
    const form = document.getElementById("cr-form");
    const ta = document.getElementById("cr-prompt");
    const go = document.getElementById("cr-go");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        const prompt = (ta && ta.value || "").trim();
        if (!prompt) return;
        const model = (document.getElementById("cr-model") || {}).value || "flux";
        const size = (document.getElementById("cr-size") || {}).value || "1:1";
        if (go) go.disabled = true;
        setCrStatus("generating…");
        generateImage({ prompt: prompt, model: model, size: size })
          .then(function (r) {
            setCrStatus(r.ok ? "done" : r.error || "failed");
            paintCreativeGallery();
          })
          .catch(function (e) {
            setCrStatus(e && e.message ? e.message : "failed");
          })
          .then(function () {
            if (go) go.disabled = false;
          });
      });
    }
    if (ta) {
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (form && form.requestSubmit) form.requestSubmit();
        }
      });
    }
  }

  async function toolGenerateImage(args) {
    args = args && typeof args === "object" ? args : {};
    const r = await generateImage(args);
    if (r.ok) {
      try {
        if (typeof appendMsg === "function") appendMsg("![image](" + r.url + ")", "ai");
      } catch (_) {}
      try {
        if (args.save && typeof saveImageToKali === "function") {
          const s = await saveImageToKali(r, args.path);
          r.saved = s;
        }
      } catch (_) {}
    }
    return JSON.stringify(r);
  }

  try {
    global.generateImage = generateImage;
    global.toolGenerateImage = toolGenerateImage;
    global.saveImageToKali = saveImageToKali;
    global.paintCreativeGallery = paintCreativeGallery;
    global.wireCreative = wireCreative;
    global.POLLINATIONS_SIZES = SIZES;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
