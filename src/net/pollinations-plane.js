/**
 * Pollinations image studio — no key.
 * GET https://image.pollinations.ai/prompt/{prompt}
 */
(function (global) {
  "use strict";

  const LS = "goar_creative_gallery_v1";
  const MAX_GALLERY = 64;
  const SIZES = {
    "1:1": [1024, 1024],
    "16:9": [1456, 816],
    "9:16": [816, 1456],
    "4:3": [1232, 928],
    "3:2": [1344, 896],
    "21:9": [1536, 656],
  };
  const MODELS = ["flux", "turbo", "flux-realism", "flux-anime", "flux-3d", "gptimage", "sana"];

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
    const model = MODELS.indexOf(opts.model) >= 0 ? opts.model : "turbo";
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
    q.set("private", "true");
    q.set("seed", String(seed));
    const path = encodeURIComponent(String(prompt || "").trim());
    return {
      url: "https://image.pollinations.ai/prompt/" + path + "?" + q.toString(),
      model: model,
      width: w,
      height: h,
      seed: seed,
    };
  }

  function waitImg(url, timeoutMs) {
    timeoutMs = timeoutMs || 120000;
    return new Promise(function (resolve, reject) {
      const img = new Image();
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
      await waitImg(spec.url, Number(opts.timeout_ms || 120000));
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
    try { paintCreativeGallery(); } catch (_) {}
    return { ok: true, id: item.id, prompt: item.prompt, url: item.url, model: item.model, width: item.width, height: item.height, seed: item.seed, at: item.at };
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

  function esc(s) {
    return String(s || "").replace(/[<>&"]/g, function (c) {
      if (c === "<") return "&" + "lt;";
      if (c === ">") return "&" + "gt;";
      if (c === "&") return "&" + "amp;";
      return "&" + "quot;";
    });
  }

  function paintCreativeGallery() {
    const grid = document.getElementById("cr-grid");
    if (!grid) return;
    const list = gallery();
    if (!list.length) {
      grid.innerHTML =
        '<div class="cr-empty"><h3>Create</h3><p>Describe a still. Flux on Pollinations — no key. Colour, full frame, saved in this browser.</p></div>';
      return;
    }
    grid.innerHTML = list
      .map(function (it) {
        return (
          '<figure class="cr-card" data-id="' +
          esc(it.id) +
          '"><img src="' +
          esc(it.url) +
          '" alt="" loading="lazy"><figcaption>' +
          esc(it.prompt).slice(0, 110) +
          "<em>" +
          esc(it.model) +
          " · " +
          it.width +
          "×" +
          it.height +
          "</em></figcaption></figure>"
        );
      })
      .join("");
    grid.querySelectorAll(".cr-card").forEach(function (el) {
      el.addEventListener("click", function () {
        openLightbox(el.getAttribute("data-id"));
      });
    });
  }

  function openLightbox(id) {
    const it = gallery().find(function (x) { return x.id === id; });
    const box = document.getElementById("cr-light");
    if (!it || !box) return;
    box.hidden = false;
    box.setAttribute("data-id", it.id);
    const img = document.getElementById("cr-light-img");
    const cap = document.getElementById("cr-light-cap");
    if (img) img.src = it.url;
    if (cap) cap.textContent = it.prompt + " · " + it.model + " · seed " + it.seed;
  }

  function closeLightbox() {
    const box = document.getElementById("cr-light");
    if (box) box.hidden = true;
  }

  function currentLight() {
    const box = document.getElementById("cr-light");
    const id = box && box.getAttribute("data-id");
    return gallery().find(function (x) { return x.id === id; }) || null;
  }

  function setCrStatus(t) {
    const el = document.getElementById("cr-status");
    if (el) el.textContent = t || "";
  }

  function readForm() {
    return {
      prompt: (document.getElementById("cr-prompt") && document.getElementById("cr-prompt").value || "").trim(),
      model: (document.getElementById("cr-model") && document.getElementById("cr-model").value) || "turbo",
      size: (document.getElementById("cr-size") && document.getElementById("cr-size").value) || "1:1",
      seed: (document.getElementById("cr-seed") && document.getElementById("cr-seed").value) || "",
      enhance: !(document.getElementById("cr-enhance") && document.getElementById("cr-enhance").checked === false),
    };
  }

  function runGenerate() {
    const f = readForm();
    if (!f.prompt) {
      setCrStatus("describe an image");
      return;
    }
    const go = document.getElementById("cr-go");
    if (go) go.disabled = true;
    setCrStatus("generating…");
    generateImage(f)
      .then(function (r) {
        setCrStatus(r.ok ? "done · " + r.model : (r.error || "failed"));
        paintCreativeGallery();
        if (r.ok) openLightbox(r.id);
      })
      .catch(function (e) {
        setCrStatus(e && e.message ? e.message : "failed");
      })
      .then(function () {
        if (go) go.disabled = false;
      });
  }

  function wireCreative() {
    if (wireCreative._on) return;
    wireCreative._on = true;
    const modelSel = document.getElementById("cr-model");
    if (modelSel && modelSel.options.length < MODELS.length) {
      modelSel.innerHTML = MODELS.map(function (m) {
        return '<option value="' + m + '">' + m + "</option>";
      }).join("");
    }
    const sizeSel = document.getElementById("cr-size");
    if (sizeSel) {
      sizeSel.innerHTML = Object.keys(SIZES).map(function (k) {
        return '<option value="' + k + '">' + k + "</option>";
      }).join("");
    }
    paintCreativeGallery();
    const form = document.getElementById("cr-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        runGenerate();
      });
    }
    const ta = document.getElementById("cr-prompt");
    if (ta) {
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          runGenerate();
        }
      });
    }
    document.getElementById("cr-light-close")?.addEventListener("click", closeLightbox);
    document.getElementById("cr-light")?.addEventListener("click", function (e) {
      if (e.target && e.target.id === "cr-light") closeLightbox();
    });
    document.getElementById("cr-light-chat")?.addEventListener("click", function () {
      const it = currentLight();
      if (!it) return;
      closeLightbox();
      try { if (typeof goarShowView === "function") goarShowView("chat"); } catch (_) {}
      try { if (typeof appendMsg === "function") appendMsg("![image](" + it.url + ")\n" + it.prompt, "ai"); } catch (_) {}
    });
    document.getElementById("cr-light-save")?.addEventListener("click", function () {
      const it = currentLight();
      if (!it) return;
      setCrStatus("saving to Kali…");
      saveImageToKali(it).then(function (r) {
        setCrStatus(r.ok ? "saved " + r.path : (r.error || "save failed"));
      });
    });
    document.getElementById("cr-light-dl")?.addEventListener("click", function () {
      const it = currentLight();
      if (!it) return;
      const a = document.createElement("a");
      a.href = it.url;
      a.download = (it.id || "goar") + ".jpg";
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    });
    document.getElementById("cr-light-again")?.addEventListener("click", function () {
      const it = currentLight();
      if (!it) return;
      const ta = document.getElementById("cr-prompt");
      if (ta) ta.value = it.prompt;
      const seed = document.getElementById("cr-seed");
      if (seed) seed.value = String((Number(it.seed) || Date.now()) + 1);
      closeLightbox();
      runGenerate();
    });
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
    global.POLLINATIONS_MODELS = MODELS;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
