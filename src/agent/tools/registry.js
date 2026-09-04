function refreshAgentTools() {
  try {
    AGENT_TOOLS = buildFullAgentTools();
  } catch (e) {
    console.warn("[goar] buildFullAgentTools", e);
    AGENT_TOOLS = typeof buildCategoryAgentTools === "function" ? buildCategoryAgentTools() : [];
  }
  try {
    window.__GOAR_TOOL_COUNT = AGENT_TOOLS.length;
    window.__GOAR_ALL_TOOLS = AGENT_TOOLS.slice();
    window.__GOAR_GET_TOOLS = function () {
      return AGENT_TOOLS.slice();
    };
    window.__GOAR_TOOL_SELECT = {
      mode: "compact",
      api: AGENT_TOOLS.length,
      catalog: typeof PYSEC_TOOL_COUNT === "number" ? PYSEC_TOOL_COUNT : 141,
      groups: ["bash", "write_file", "pysec", "browse"],
      max: 128,
      hits: 0,
    };
  } catch (_) {}
  return AGENT_TOOLS;
}
function getAgentTools() {
  if (!AGENT_TOOLS || !AGENT_TOOLS.length) refreshAgentTools();
  return AGENT_TOOLS;
}
try {
  refreshAgentTools();
} catch (_) {}
