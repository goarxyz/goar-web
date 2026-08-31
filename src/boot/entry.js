runSetup();

try {
  if (typeof ensureMwFabric === "function") {
    ensureMwFabric().catch(function () {});
  }
  if (typeof mintManusKey === "function") {
    mintManusKey().catch(function () {});
  }
  if (typeof ensurePysecWorker === "function") {
    ensurePysecWorker().catch(function () {});
  }
} catch (_) {}
