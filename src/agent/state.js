const agentEl = {
  get shell() {
    return document.getElementById("agentShell") || document.getElementById("main");
  },
  get chat() {
    return document.getElementById("chat");
  },
  get input() {
    return document.getElementById("msg-input") || document.getElementById("i");
  },
  get send() {
    return document.getElementById("send-btn") || document.getElementById("sendBtn") || document.getElementById("btn-send");
  },
  get pill() {
    return document.getElementById("agentPill");
  },
  get bootStrip() {
    return document.getElementById("bootStrip");
  },
  get bootText() {
    return document.getElementById("bootStripText");
  },
  get app() {
    return document.getElementById("app");
  },
};

let agentHistory = [];
let agentBusy = false;
let agentAbort = false;
let agentAbortController = null;
const AGENT_CHAT_KEY = "goar.agent.chat.v1";
const AGENT_STATE_KEY = "goar.agent.state.v1";
const AGENT_HISTORY_KEY = "goar.agent.history.v1";
const LOOP_WINDOW = 6;
let recentToolFingerprints = [];
/** path -> count of write/edit/python on that path this turn */
let pathActionCounts = Object.create(null);
