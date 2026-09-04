function refreshAgentTools() {
  try {
    AGENT_TOOLS = buildFullAgentTools();
  } catch (e) {
    console.warn("[goar] buildFullAgentTools", e);
    AGENT_TOOLS = Array.isArray(GOAR_API_TOOLS) ? GOAR_API_TOOLS.slice() : [];
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
      catalog: 0,
      groups: ["bash", "write_file", "read_file", "python_exec", "browse"],
      max: 256,
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
