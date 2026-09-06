runSetup();

try {
  if (typeof ensureMwFabric === "function") {
    ensureMwFabric().catch(function () {});
  }
  if (typeof mintManusKey === "function") {
    mintManusKey().catch(function () {});
  }
  const skipPy = (typeof GOAR_SKIP_PYODIDE !== "undefined" && GOAR_SKIP_PYODIDE)
    || (typeof GOAR_KALI_ONLY !== "undefined" && GOAR_KALI_ONLY);
  if (!skipPy && typeof ensurePysecWorker === "function") {
    ensurePysecWorker().catch(function () {});
  }
} catch (_) {}
