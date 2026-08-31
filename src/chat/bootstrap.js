try {
  const ms = document.getElementById("apiModel");
  const mc = document.getElementById("apiModelCustom");
  ms?.addEventListener("change", () => {
    if (mc) mc.style.display = ms.value === "custom-model" ? "block" : "none";
  });
} catch (_) {}
try { wireAgentUi(); } catch (e) { console.error(e); }

