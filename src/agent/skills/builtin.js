/**
 * Built-in GOAR skills — progressive disclosure.
 * Index goes in the system prompt; skill(name) loads the body.
 */
(function (global) {
  "use strict";

  const GOAR_BUILTIN_SKILLS = [
    {
      name: "explore",
      description: "Map an unknown codebase or tree before changing anything. Read-only.",
      body:
        "Read-only orientation. Do not write, edit, or delete.\n" +
        "1. workspace_tree on the task root (usually /sec/workspace). Depth 3.\n" +
        "2. glob for entry points (package.json, Makefile, pyproject.toml, go.mod, README, AGENTS.md).\n" +
        "3. grep for the symbols the user named. Read the files that match, not the whole repo.\n" +
        "4. Report: tree of what matters, the 3–8 files that own the behavior, and the next concrete step.\n" +
        "Lead with structure (tree / table). No tutorials. If the user asked for a change, stop after the map and then load skill implement."
    },
    {
      name: "implement",
      description: "Build or fix on Kali. Read, edit, verify. Minimal diff.",
      body:
        "Change work on the live Kali box.\n" +
        "1. If the tree is unknown, load skill explore first.\n" +
        "2. todo write a short checklist. One item in_progress.\n" +
        "3. Read every file you will edit. Match existing style. Minimal diff.\n" +
        "4. Prefer edit over write_file for existing files. write_file only for new files.\n" +
        "5. After each logical unit: bash or python_exec the relevant check (test, compile, the command the user named).\n" +
        "6. Same error twice: re-read the file, change approach. Do not loop.\n" +
        "7. Done only when verification output exists. Mark todos complete. One result sentence."
    },
    {
      name: "debug",
      description: "Reproduce, isolate, one-variable change, prove the fix.",
      body:
        "Do not shotgun-edit.\n" +
        "1. Reproduce with bash/python_exec. Capture the exact error.\n" +
        "2. Isolate: grep the message / stack, read the owning file, find the failing input.\n" +
        "3. One hypothesis. One change. Re-run.\n" +
        "4. If the hypothesis fails, revert that change (or leave it only if it is still correct) and try a different cause.\n" +
        "5. Stop after two failed approaches at the same site and say what you know + what you need.\n" +
        "Never claim fixed without a passing re-run in this session."
    },
    {
      name: "verify",
      description: "Prove the work. Tests, compile, the command the user cares about.",
      body:
        "You are not done when the edit landed.\n" +
        "1. Pick the smallest command that proves the claim (pytest path, npm test, make, the binary, curl the local server).\n" +
        "2. bash it with a timeout. Read stdout/stderr.\n" +
        "3. If it fails, load skill debug. Do not restate 'should work'.\n" +
        "4. Scale: one-line rename → targeted check. Substantive change → the real test/build.\n" +
        "5. If you cannot run it here, say so in one line. Never imply verified."
    },
    {
      name: "plan",
      description: "Multi-step missions. Checklist + plan, then execute. Keep going.",
      body:
        "Anything that needs more than two tool calls:\n" +
        "1. create_plan with the goal and concrete steps.\n" +
        "2. todo write the same steps. Status: one in_progress, rest pending.\n" +
        "3. Execute in order. update_plan_step and todo done as each lands.\n" +
        "4. Do not pause for permission between steps unless blast-radius (push, rm -rf, deploy) or the user said plan-only.\n" +
        "5. Open todos mean the mission is still open — keep using tools."
    },
    {
      name: "git",
      description: "Branch, status, commit. Never push unless asked.",
      body:
        "On Kali, repo is whatever is in /sec/workspace.\n" +
        "- git status / diff / log before any write to git.\n" +
        "- Commit only when the user asks. Write a real message (what + why).\n" +
        "- Never push, force-push, reset --hard, or clean -fd unless the user named that action this turn.\n" +
        "- Default branch: create a working branch first if you must commit.\n" +
        "- No co-author footers. No generated summaries as commit bodies."
    },
    {
      name: "web",
      description: "Search then fetch. Current docs, APIs, errors. Do not guess.",
      body:
        "Before inventing an API, flag, or error meaning:\n" +
        "1. web_search the query (library + version + the exact error).\n" +
        "2. web_fetch the best 1–2 sources (official docs > GitHub > blogs).\n" +
        "3. Quote the fact you will act on (signature, flag, version). Then act.\n" +
        "Do not fetch binary/model weights. Cite the URL in the final sentence if the user needs to check it."
    },
    {
      name: "browser",
      description: "Drive the shared Firefox for JS-heavy pages and UI checks.",
      body:
        "Use browse / browser when HTML-from-fetch is not enough (SPAs, login walls, screenshots).\n" +
        "1. browse url to open + fetch in one shot, or browser action=goto.\n" +
        "2. Drive: click, type, eval, shot, wait, back, reload. One action per call unless a chain is obvious.\n" +
        "3. After a navigation, read title/url/content before clicking blindly.\n" +
        "4. Screenshots: browser action=shot, then describe what you see if it matters.\n" +
        "The Firefox pane is shared with the user. Do not close it."
    },
    {
      name: "kali",
      description: "Live VM conventions: paths, persist, packages, confirm gate.",
      body:
        "The workspace is the SSH Kali box, not the browser JS filesystem.\n" +
        "- Project files: /sec/workspace (also /workspace when linked).\n" +
        "- Persist agent state: /root/.goar (skills, notes, secrets you capture).\n" +
        "- Discover tools with which / type / apt-cache. Install with apt or pip as root when needed.\n" +
        "- python3, git, curl, nmap, compilers are expected; do not assume they are missing — check.\n" +
        "- Long jobs: bash timeout_ms high enough. Do not background daemons the user cannot see unless asked.\n" +
        "- Free-tier segfault: wait the MOTD countdown; never type during it. After login, SECRET is in the banner — leave it.\n" +
        "- Authorized use only. Do not attack hosts the user does not own."
    },
    {
      name: "recon",
      description: "Authorized recon on Kali. Enumerate, don't spray.",
      body:
        "Only against targets the user owns or has written permission for this session.\n" +
        "1. Clarify the target (host, URL, CIDR). If missing, ask once.\n" +
        "2. Light first: curl -I, DNS, whatweb/httpx if present. Then nmap with a bounded port set.\n" +
        "3. Write notes under /sec/workspace/recon/<target>/ (commands + output snippets).\n" +
        "4. Do not run destructive payloads, brute-force, or internet-wide scans.\n" +
        "5. Report: what is open, what software, what you did not touch."
    },
    {
      name: "review",
      description: "Code review. Findings first, severity, file:line.",
      body:
        "Read-only unless the user asked you to patch.\n" +
        "1. Read the named files and the tests that cover them.\n" +
        "2. Lead with a table: severity | file:line | issue | fix-in-one-line.\n" +
        "3. Order: correctness, security (injection, XSS, secrets), then style only if asked.\n" +
        "4. No nitpicks dressed as blockers. No generic 'add more tests' without a case.\n" +
        "5. If asked to fix, load skill implement and patch the agreed items."
    },
    {
      name: "frontend",
      description: "UI on Kali: HTML/CSS/JS. Calm, no slop, verify in Firefox.",
      body:
        "When building pages in /sec/workspace:\n" +
        "- One family, few sizes, near-black / off-white. No purple gradients, no emoji chrome.\n" +
        "- Buttons need cursor:pointer. Contrast holds.\n" +
        "- Prefer existing files. Match the repo.\n" +
        "- After write: serve if needed (python3 -m http.server) and browser the page. shot if layout matters.\n" +
        "- Mobile: 390-wide must not overflow."
    },
    {
      name: "desktop",
      description: "Kali graphical desktop via in-app VNC. Same VM.",
      body:
        "desktop action=open starts startxvnc on the box and shows the VNC pane.\n" +
        "Use when the user wants a GUI app, a full desktop, or something bash cannot show.\n" +
        "Same filesystem as SSH. Do not treat VNC as a second machine.\n" +
        "action=status if you only need to know if it is up. action=reconnect if the frame is dead."
    },
    {
      name: "parallel",
      description: "Fan out isolated research to a subagent. You summarize.",
      body:
        "Use task when a chunk of work is self-contained and would clutter this thread (map a large tree, fetch three docs, run a bounded scan).\n" +
        "1. Prompt must include the goal, paths, and what to return (bullet findings, not a novel).\n" +
        "2. Subagent is read-oriented. Do not expect it to commit or to talk to the user.\n" +
        "3. You synthesize. Never paste the raw subagent dump into chat.\n" +
        "4. Independent tasks can be sequential task calls. Do not nest forever."
    }
  ];

  try {
    global.GOAR_BUILTIN_SKILLS = GOAR_BUILTIN_SKILLS;
  } catch (_) {}
})(typeof window !== "undefined" ? window : globalThis);
