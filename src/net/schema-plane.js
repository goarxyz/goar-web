(function (global) {
  "use strict";

  function schemaForTool(name) {
    try {
      const tools = typeof getAgentTools === "function" ? getAgentTools() : [];
      const t = (tools || []).find((x) => x && x.function && x.function.name === name);
      return t && t.function && t.function.parameters ? t.function.parameters : null;
    } catch (_) {
      return null;
    }
  }

  function validateJson(instance, schema, draft) {
    if (typeof validate !== "function") {
      return { valid: false, errors: [{ error: "schema engine missing" }] };
    }
    try {
      if (typeof schema === "string") schema = JSON.parse(schema);
      if (typeof instance === "string") {
        try { instance = JSON.parse(instance); } catch (_) {}
      }
      return validate(instance, schema, draft || "2019-09");
    } catch (e) {
      return { valid: false, errors: [{ error: String(e && e.message ? e.message : e) }] };
    }
  }

  function validateToolArgs(name, args) {
    const schema = schemaForTool(name);
    if (!schema) return { valid: true, skipped: true };
    return validateJson(args || {}, schema);
  }

  function formatSchemaErrors(result) {
    if (!result || result.valid) return "";
    return (result.errors || [])
      .slice(0, 8)
      .map((e) => (e.keyword ? e.keyword + ": " : "") + (e.error || JSON.stringify(e)))
      .join("; ");
  }

  global.schemaForTool = schemaForTool;
  global.validateJson = validateJson;
  global.validateToolArgs = validateToolArgs;
  global.formatSchemaErrors = formatSchemaErrors;
  global.schemaPlaneStatus = function () {
    return {
      engine: typeof Validator === "function" ? "cfworker" : "none",
      validate: typeof validate === "function",
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
