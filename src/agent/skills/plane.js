/**
 * Skill plane — index for the system prompt, skill() loads a body.
 * Built-ins + optional user skills from localStorage (goar.skills.v1).
 */
(function (global) {
  "use strict";

  const USER_KEY = "goar.skills.v1";

  function userSkills() {
    try {
      const raw = JSON.parse(localStorage.getItem(USER_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .map(function (s) {
          if (!s || !s.name) return null;
          return {
            name: String(s.name).trim(),
            description: String(s.description || s.desc || "").trim(),
            body: String(s.instructions || s.body || s.description || "").trim(),
            user: true,
          };
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function allSkills() {
    const builtin = Array.isArray(global.GOAR_BUILTIN_SKILLS) ? global.GOAR_BUILTIN_SKILLS : [];
    const seen = Object.create(null);
    const out = [];
    builtin.forEach(function (s) {
      if (!s || !s.name) return;
      const k = s.name.toLowerCase();
      seen[k] = true;
      out.push(s);
    });
    userSkills().forEach(function (s) {
      const k = s.name.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(s);
    });
    return out;
  }

  function findSkill(name) {
    const q = String(name || "").trim().toLowerCase().replace(/^skill\s+/, "");
    if (!q) return null;
    const list = allSkills();
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].name).toLowerCase() === q) return list[i];
    }
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].name).toLowerCase().indexOf(q) >= 0) return list[i];
    }
    return null;
  }

  function goarSkillIndex() {
    const list = allSkills();
    if (!list.length) return "";
    const lines = [
      "## Skills",
      "Call skill with the name before that class of work. Follow the returned instructions. Do not list skills to the user.",
    ];
    list.forEach(function (s) {
      lines.push("- " + s.name + ": " + (s.description || "").slice(0, 140));
    });
    return lines.join("\n");
  }

  function toolSkill(args) {
    args = args && typeof args === "object" ? args : {};
    const raw = String(args.name || args.skill || args.id || "").trim();
    if (!raw || /^(list|ls|index|all)$/i.test(raw)) {
      return goarSkillIndex() || "no skills";
    }
    const s = findSkill(raw);
    if (!s) {
      const names = allSkills().map(function (x) { return x.name; }).join(", ");
      return "unknown skill " + JSON.stringify(raw) + ". available: " + names;
    }
    return "# Skill: " + s.name + "\n\n" + (s.description ? s.description + "\n\n" : "") + (s.body || "");
  }

  try {
    global.allSkills = allSkills;
    global.findSkill = findSkill;
    global.goarSkillIndex = goarSkillIndex;
    global.goarSkillBlurb = goarSkillIndex;
    global.toolSkill = toolSkill;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
