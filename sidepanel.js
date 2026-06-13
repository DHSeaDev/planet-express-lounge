/**
 * sidepanel.js  —  Planet Express Lounge
 *
 * Serverless. All LLM calls, DB operations, and crew logic run
 * client-side via crew.js, llm.js, database.js, and prompts.js.
 * No fetch() to localhost required.
 */

import { db }          from "./database.js";
import { LLMClient }   from "./llm.js";
import { Crew }        from "./crew.js";
import { tts, setChromeVoiceOverride, setElevenLabsKey, setElevenLabsVoiceIds } from "./tts.js";
import {
  CHARS, CREW_WEIGHTS, FULL_CAST,
  PROVIDERS, PROVIDER_GROQ, PROVIDER_OR, PROVIDER_GEM,
  GROQ_MODELS, OR_MODELS, GEM_MODELS, DEFAULT_MODEL, TEMPERATURE,
  DEMO_EPISODE, DEMO_CHAT_SCRIPT, EPISODE_SUMMARY_SYS,
} from "./prompts.js";
// Dark Matter widgets (Alphabet, Archive, Smelloscope, Slurm) live in lab.js
// (a separate <script type="module"> loaded by sidepanel.html), rendered via
// window.LabModule.renderDarkMatterWidgets().

// ── DOM helpers ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const escHtml = (s) =>
  String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ── State ────────────────────────────────────────────────────────────────────
let currentSid     = null;
let currentTopic   = "";
let transcript     = "";
let isFirstMessage = true;
let isSending      = false;
let isAutopilot    = false;
let chaosMode      = false;
let lightMode      = false;
let disabledAgents = new Set();
let _mutedVoices   = new Set();
let _voiceSpeed    = 1.0;
let fontSize       = 14;

/** @type {LLMClient|null} */
let llmClient = null;
/** @type {Crew|null} */
let crew      = null;

// ── Character colour lookup ──────────────────────────────────────────────────
const CHAR_COLOR = Object.fromEntries(
  Object.entries(CHARS).map(([id, [,, col]]) => [id, col])
);

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", async () => {
    const id = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach(t  => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`panel-${id}`)?.classList.add("active");
    if (id === "lab")      { window.LabModule?.startLabWidgets(); window.LabModule?.renderPatentOffice(); await window.LabModule?.renderDarkMatterWidgets(); }
    if (id === "cold")     loadPins();
    if (id === "settings") loadDataSummary();
  });
});

// ── First-run card: Open Settings button ─────────────────────────────────────
const firstRunSettingsBtn = $("firstRunSettingsBtn");
if (firstRunSettingsBtn) {
  firstRunSettingsBtn.addEventListener("click", () => {
    document.querySelector('.tab[data-tab="settings"]')?.click();
  });
}

function _hideFirstRunCard() {
  const card = $("firstRunCard");
  if (card) { card.style.display = "none"; }
}

// ── DEMO MODE ─────────────────────────────────────────────────────────────────
// Active only when no API key is connected.
// Completely removed the instant _initLLM succeeds — no state leaks into live.

let _demoActive    = false;
let _demoChatIdx   = 0;
let _demoApRunning = false;
let _demoApTimer   = null;

const demoChatPanel   = $("demoChatPanel");
const demoChatLog     = $("demoChatLog");
const demoNextBtn     = $("demoNextBtn");
const demoCounterEl   = $("demoCounter");
const demoSettingsBtn = $("demoSettingsBtn");
const apDemoBanner    = $("apDemoBanner");

function _enterDemoMode() {
  _demoActive  = true;
  _demoChatIdx = 0;
  if (demoChatPanel) demoChatPanel.style.display = "flex";
  const chatlogEl = $("chatlog");
  const footerEl  = document.querySelector(".chat-footer");
  if (chatlogEl)  chatlogEl.style.display  = "none";
  if (footerEl)   footerEl.style.display   = "none";
  if (demoChatLog) _renderDemoExchange(0);
  _updateDemoCounter();
}

function _exitDemoMode() {
  _demoActive = false;
  _stopDemoAutopilot();
  if (demoChatPanel) demoChatPanel.style.display = "none";
  const chatlogEl = $("chatlog");
  const footerEl  = document.querySelector(".chat-footer");
  if (chatlogEl)  chatlogEl.style.display  = "";
  if (footerEl)   footerEl.style.display   = "";
  if (apDemoBanner) apDemoBanner.style.display = "none";
  if (demoChatLog)  demoChatLog.innerHTML  = "";
}

function _renderDemoExchange(idx) {
  if (!demoChatLog) return;
  const item = DEMO_CHAT_SCRIPT[idx];
  if (!item) return;

  const exchange       = document.createElement("div");
  exchange.className   = "demo-exchange";

  const userBubble       = document.createElement("div");
  userBubble.className   = "demo-user-bubble";
  userBubble.textContent = item.userPrompt;

  const agentData = CHARS[item.agent] || ["Crew", "🤖", "#ABB2BF"];
  const nameRow       = document.createElement("div");
  nameRow.className   = "demo-agent-name";
  nameRow.style.color = agentData[2];
  nameRow.textContent = `${agentData[1]} ${agentData[0]}`;

  const agentBubble       = document.createElement("div");
  agentBubble.className   = "demo-agent-bubble";
  agentBubble.style.borderColor = `color-mix(in srgb, ${agentData[2]} 30%, var(--border))`;
  agentBubble.appendChild(nameRow);

  const responseText       = document.createElement("div");
  responseText.textContent = item.response;
  agentBubble.appendChild(responseText);

  exchange.appendChild(userBubble);
  exchange.appendChild(agentBubble);
  demoChatLog.appendChild(exchange);
  demoChatLog.scrollTop = demoChatLog.scrollHeight;

  // Real TTS — same voices the user will hear in live mode
  tts.speak(item.response, item.agent);
}

function _updateDemoCounter() {
  if (!demoCounterEl || !demoNextBtn) return;
  const total = DEMO_CHAT_SCRIPT.length;
  demoCounterEl.textContent = `${Math.min(_demoChatIdx + 1, total)} / ${total}`;
  demoNextBtn.disabled      = (_demoChatIdx >= total - 1);
  demoNextBtn.textContent   = (_demoChatIdx >= total - 1) ? "✓ Done" : "Next ›";
}

if (demoNextBtn) {
  demoNextBtn.addEventListener("click", () => {
    if (_demoChatIdx < DEMO_CHAT_SCRIPT.length - 1) {
      _demoChatIdx++;
      _renderDemoExchange(_demoChatIdx);
      _updateDemoCounter();
    }
  });
}
if (demoSettingsBtn) {
  demoSettingsBtn.addEventListener("click", () => {
    document.querySelector('.tab[data-tab="settings"]')?.click();
  });
}

// ── Demo Autopilot ────────────────────────────────────────────────────────────
// Plays DEMO_EPISODE through the real handleEmit pipeline — same TTS, same
// turn display, same AP card controls. No special rendering path needed.

function _runDemoAutopilot() {
  if (_demoApRunning) return;
  _demoApRunning = true;
  if (apDemoBanner)          apDemoBanner.style.display = "";
  const apStreamEl = $("ap-stream");
  if (apStreamEl)            apStreamEl.innerHTML = "";

  let idx = 0;
  const step = () => {
    if (!_demoApRunning || idx >= DEMO_EPISODE.length) {
      _demoApRunning = false;
      handleEmit({ type: "ap_done" });
      return;
    }
    const evt = DEMO_EPISODE[idx++];

    // DEMO_EPISODE pairs a standalone {type:"speaker", agent} entry with a
    // following {type:"turn_end", agent, text} entry for the same line.
    // The turn_end branch below already emits its own "speaker" event right
    // before streaming tokens, so passing this standalone one through to
    // handleEmit() creates an empty duplicate turn header for the character
    // (the crew member appears twice — once with no text, once with the
    // actual line). Skip it; the turn_end entry handles the speaker change.
    if (evt.type === "speaker") {
      step();
      return;
    }

    if (evt.type === "turn_end") {
      handleEmit({ type: "speaker", agent: evt.agent });
      const words = evt.text.split(" ");
      let wi = 0;
      const wordTick = () => {
        if (wi < words.length) {
          handleEmit({ type: "token", agent: evt.agent, text: (wi === 0 ? "" : " ") + words[wi++] });
          _demoApTimer = setTimeout(wordTick, 38);
        } else {
          handleEmit({ type: "turn_end", agent: evt.agent });
          const breathMs = Math.min(180 + evt.text.length * 22, 4500);
          _demoApTimer = setTimeout(step, breathMs);
        }
      };
      wordTick();
    } else {
      handleEmit(evt);
      _demoApTimer = setTimeout(step, evt.type === "ep_title" ? 1400 : 600);
    }
  };
  step();
}

function _stopDemoAutopilot() {
  _demoApRunning = false;
  isAutopilot    = false;  // ensure handleEmit routes back to chatlog
  if (_demoApTimer) { clearTimeout(_demoApTimer); _demoApTimer = null; }
  tts.stop();
  if (apDemoBanner) apDemoBanner.style.display = "none";
}

// ── Status bar ────────────────────────────────────────────────────────────────
function setStatus(msg, timeout = 0) {
  const bar = $("statusBar");
  if (bar) bar.textContent = msg;
  if (timeout) setTimeout(() => { if (bar) bar.textContent = ""; }, timeout);
}

// ── Auto-scroll chatlog ───────────────────────────────────────────────────────
function autoScroll(el) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

// ── TTS is handled by TTSQueueManager (tts.js) — push()/flush() per agent.
// tts.setRate() and tts.setMuted() are called from settings handlers below.

// ── Chat rendering ────────────────────────────────────────────────────────────
const chatlog  = $("chatlog");
const apStream = $("ap-stream");

let _activeTurnDiv  = null;
let _activeTurnBody = null;
let _activeAgent    = null;

// ── Social Share Menu ───────────────────────────────────────────────────────
// Replaces the old "copy to clipboard" share buttons with real social-share
// intents. Each target opens a share-intent URL in a new tab pre-filled with
// the quote text (and, where the platform requires it, a link back to the
// project so the share isn't a bare floating quote).
const SHARE_HOMEPAGE = "https://github.com/dhseadev/planet-express-lounge";

const SHARE_TARGETS = [
  { id: "reddit",   label: "Reddit",      icon: "👽",
    url: text => `https://www.reddit.com/submit?type=TEXT&title=${encodeURIComponent(_shareTitle(text))}&text=${encodeURIComponent(text)}` },
  { id: "facebook", label: "Facebook",    icon: "📘",
    url: text => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_HOMEPAGE)}&quote=${encodeURIComponent(text)}` },
  { id: "twitter",  label: "X / Twitter", icon: "🐦",
    url: text => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}` },
  { id: "email",    label: "Email",       icon: "✉️",
    url: text => `mailto:?subject=${encodeURIComponent(_shareTitle(text))}&body=${encodeURIComponent(text)}` },
];

function _shareTitle(text) {
  const firstLine = text.split("\n")[0].slice(0, 80);
  return firstLine || "Planet Express Lounge";
}

let _activeShareMenu = null;

/**
 * Opens a small popup menu of social share targets anchored to `btnEl`.
 * `text` is the plain-text quote to share. Dismisses on outside click or Esc.
 */
function openShareMenu(text, btnEl) {
  if (!text.trim()) return;
  _activeShareMenu?.remove();

  const menu = document.createElement("div");
  menu.className = "share-menu";
  menu.setAttribute("role", "menu");

  for (const target of SHARE_TARGETS) {
    const item = document.createElement("button");
    item.className = "share-menu-item";
    item.textContent = `${target.icon} ${target.label}`;
    item.addEventListener("click", () => {
      window.open(target.url(text), "_blank", "noopener,noreferrer");
      menu.remove();
      _activeShareMenu = null;
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  _activeShareMenu = menu;

  const rect = btnEl.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top  = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(4, rect.right - menu.offsetWidth)}px`;

  const dismiss = (e) => {
    if (menu.contains(e.target) || e.target === btnEl) return;
    menu.remove();
    _activeShareMenu = null;
    document.removeEventListener("click", dismiss, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => { if (e.key === "Escape") dismiss(e); };
  // Defer so the click that opened the menu doesn't immediately dismiss it.
  setTimeout(() => {
    document.addEventListener("click", dismiss, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
}


function startTurn(agentId) {
  const log    = isAutopilot ? apStream : chatlog;
  const [name,, col] = CHARS[agentId] || [agentId, "?", "#888"];
  const icon   = (CHARS[agentId] || ["","?"])[1];
  const color  = col;

  const div  = document.createElement("div");
  div.className = `turn turn-${agentId}`;

  const hdr = document.createElement("div");
  hdr.className = "turn-header";
  hdr.style.color = color;
  hdr.textContent = `${icon} ${name}`;

  const body = document.createElement("div");
  body.className = "turn-body";

  div.appendChild(hdr);
  div.appendChild(body);

  // Pin button
  const pin = document.createElement("button");
  pin.className   = "pin-btn";
  pin.textContent = "📌";
  pin.title       = "Pin to Cold Storage";
  pin.addEventListener("click", () => pinExchange(agentId, body.textContent || ""));
  div.appendChild(pin);

  // Share button — opens a social-share menu (Reddit/Facebook/X/Email)
  const shareBtn = document.createElement("button");
  shareBtn.className   = "pin-btn share-btn";
  shareBtn.textContent = "🔗";
  shareBtn.title       = "Share this line";
  shareBtn.addEventListener("click", () => {
    const text = body.textContent || "";
    if (!text.trim()) return;
    const [charName] = (CHARS[agentId] || [agentId]);
    const plain = `${charName}: "${text.trim()}"\n\nAI fan parody — Planet Express Lounge | #DHSeaDev`;
    openShareMenu(plain, shareBtn);
  });
  div.appendChild(shareBtn);

  log.appendChild(div);
  autoScroll(log);

  _activeTurnDiv  = div;
  _activeTurnBody = body;
  _activeAgent    = agentId;
}

function receiveToken(chunk, agentId) {
  if (!_activeTurnBody || _activeAgent !== agentId) return;
  // DOM update FIRST — never block the UI on speech processing
  _activeTurnBody.textContent += chunk;
  autoScroll(isAutopilot ? apStream : chatlog);
  // Feed chunk into TTS sentence buffer AFTER DOM update
  tts.push(chunk, agentId);
}


// ── Chaos word highlighter ───────────────────────────────────────────────────
// Applied once per turn on finishTurn(), only when chaosMode is active.
// Wraps matched words in <mark class="chaos-word"> for red styling.
// Input text came from textContent — safe to re-insert as innerHTML
// because we escape it first, then selectively add only our own tags.
const CHAOS_WORD_RE = /\b(damn|hell|ass|bastard|crap|piss|idiot|moron|loser|stupid|pathetic|worthless|shut up|shut it|bite me|go to hell|screw you|jerk|schmuck|dumbass|dolt|nincompoop|buffoon|imbecile|useless|incompetent|failure|disgrace|insufferable|wretched|deplorable|abysmal|horrific|appalling|catastrophic|disastrous|atrocious)\b/gi;

function _applyChaosHighlight(el) {
  if (!chaosMode || !el) return;
  const raw   = el.textContent;
  // Escape HTML entities from the raw text before injecting as innerHTML
  const safe  = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const highlighted = safe.replace(CHAOS_WORD_RE,
    m => `<mark class="chaos-word">${m}</mark>`
  );
  // Only update DOM if something actually changed — avoids unnecessary reflows
  if (highlighted !== safe) {
    el.innerHTML = highlighted;
  }
}
function finishTurn(agentId) {
  // Flush any remaining partial sentence in the TTS buffer for this agent.
  tts.flush(agentId);
  // Apply chaos word highlighting once the full turn text is assembled
  _applyChaosHighlight(_activeTurnBody);
  _activeTurnDiv  = null;
  _activeTurnBody = null;
  _activeAgent    = null;
}

function appendSystemBubble(text, cls, color) {
  const log = isAutopilot ? apStream : chatlog;
  const div = document.createElement("div");
  div.className   = `system-bubble ${cls || ""}`;
  div.textContent = text;
  if (color) div.style.color = color;
  log.appendChild(div);
  autoScroll(log);
}

// ── Emit handler — processes events from Crew ────────────────────────────────
function handleEmit(evt) {
  // Drop autopilot-origin events if stop was requested (prevents ghost printing)
  if (_apStopRequested && ["speaker","token","turn_end","ap_topic","ep_title",
      "scheme_update","invention_complication","ap_episode_end"].includes(evt.type)) {
    return;
  }
  switch (evt.type) {
    case "speaker":
      startTurn(evt.agent);
      break;

    case "token":
      receiveToken(evt.text, evt.agent);
      break;

    case "turn_end":
      finishTurn(evt.agent);
      break;

    case "done":
      isSending = false;
      setSendState(false);
      setStatus("Ready — crew has spoken.", 0);
      chrome.runtime.sendMessage({ type: "crew_done" }).catch(()=>{});
      _refreshTranscript();
      break;

    case "system":
      appendSystemBubble(`⚙️ ${evt.text}`, "sys-msg");
      setStatus(evt.text);
      break;

    case "ap_topic":
      appendTopicBanner(evt.topic);
      break;

    case "ep_title":
      appendEpTitle(evt.title);
      break;

    case "scheme_update": {
      // Each refreshed scheme pays out a small Dark Matter "profit".
      const SCHEME_PROFIT = 10;
      appendSystemBubble(
        `🤖 Bender's new scheme: ${evt.scheme} (+${SCHEME_PROFIT} ⚛️ "profit")`,
        "scheme-bubble", CHAR_COLOR.BENDER
      );
      window.earnDarkMatter?.(SCHEME_PROFIT, "Bender's scheme profit").catch(() => {});
      break;
    }

    case "invention_complication":
      appendSystemBubble(`🧪 Plot twist: ${evt.invention} is now a factor.`, "inv-bubble", CHAR_COLOR.PROF);
      break;

    case "ap_episode_end":
      appendSystemBubble(`— End of episode —`, "ep-end-bubble");
      _recordDelivery();
      break;

    case "ap_done":
      isAutopilot = false;
      setApState(false);
      setStatus("Autopilot finished.");
      chrome.runtime.sendMessage({ type: "autopilot_stopped" }).catch(()=>{});
      break;

    case "invention":
      _showInvention(evt.text);
      break;

    case "previously":
      appendSystemBubble(`📺 Previously on Planet Express… ${evt.text}`, "previously-bubble", CHAR_COLOR.NARRATOR);
      break;
  }
}

function appendTopicBanner(topic) {
  const div = document.createElement("div");
  div.className   = "ap-topic-banner";
  div.textContent = `🤖 Autopilot: ${topic}`;
  apStream.appendChild(div);
  autoScroll(apStream);
}

function appendEpTitle(title) {
  const div = document.createElement("div");
  div.className   = "ep-title-banner";
  div.textContent = `"${title}"`;
  apStream.appendChild(div);
  autoScroll(apStream);

  // Narrator voice announces the episode title — a classic cold-open
  // "Tonight's episode" beat, and gives the Narrator character (otherwise
  // mostly silent outside "Previously on..." recaps) an actual TTS line
  // at the top of every Autopilot episode.
  tts.push(`Tonight's episode: "${title}".`, "NARRATOR");
  tts.flush("NARRATOR");
}

// ── Send message ──────────────────────────────────────────────────────────────
const chatInput = $("chatInput");
const sendBtn   = $("sendBtn");
const chatStopBtn  = $("chatStopBtn");
const chatStopAudioBtn = $("chatStopAudioBtn");
const chatMuteBtn  = $("chatMuteBtn");
const chatSummaryBtn = $("chatSummaryBtn");

// ── Rate limiter ─────────────────────────────────────────────────────────────
// Hard limit: one LLM request per 3 seconds. If violated, the request is denied
// and the user must manually press Send or re-enable autopilot.
// This prevents keyboard repeat, paste-and-enter spam, and runaway rerequests.
const SEND_RATE_MS   = 3000;
let   _lastSendTime  = 0;
let   _rateLimited   = false;

function _checkRateLimit() {
  const now  = Date.now();
  const gap  = now - _lastSendTime;
  if (gap < SEND_RATE_MS) {
    if (!_rateLimited) {
      _rateLimited = true;
      // Hard stop — cancel anything in flight
      if (crew) crew.cancel();
      tts.stop();
      isSending = false;
      setSendState(false);
      setStatus(`⛔ Rate limit — wait ${Math.ceil((SEND_RATE_MS - gap) / 1000)}s or press Send again.`);
      // Disable input briefly so the user has to deliberately re-press Send
      if (chatInput) { chatInput.disabled = true; }
      if (sendBtn)   { sendBtn.disabled   = true; }
      setTimeout(() => {
        _rateLimited = false;
        if (chatInput) { chatInput.disabled = false; chatInput.focus(); }
        if (sendBtn && llmClient)   { sendBtn.disabled = false; }
        setStatus("Ready — send when you are.");
      }, SEND_RATE_MS);
    }
    return false;
  }
  _lastSendTime = now;
  return true;
}

// ── Chat stop button ──────────────────────────────────────────────────────────
function stopChat() {
  if (crew) crew.cancel();
  tts.stop();
  isSending = false;
  setSendState(false);
  setStatus("Stopped.");
}
if (chatStopBtn) chatStopBtn.addEventListener("click", stopChat);

// ── Chat stop-audio button ──────────────────────────────────────────────────
// Stops TTS playback only — unlike chatStopBtn, doesn't cancel an in-flight
// LLM response, and stays available even after generation finishes (audio
// can keep playing well after the text stream completes).
if (chatStopAudioBtn) chatStopAudioBtn.addEventListener("click", () => tts.stop());

// ── Chat mute button ─────────────────────────────────────────────────────────
if (chatMuteBtn) {
  chatMuteBtn.addEventListener("click", () => {
    _globalAudioMuted = !_globalAudioMuted;
    if (_globalAudioMuted) {
      tts.stop();
      FULL_CAST.forEach(a => tts.mute(a));
      chatMuteBtn.textContent = "🔇";
      chatMuteBtn.title = "Unmute voices";
      chatMuteBtn.dataset.muted = "1";
    } else {
      FULL_CAST.forEach(a => { if (!_mutedVoices.has(a)) tts.unmute(a); });
      chatMuteBtn.textContent = "🔊";
      chatMuteBtn.title = "Mute voices";
      chatMuteBtn.dataset.muted = "0";
    }
    // Keep ap mute button in sync
    const apMute = document.querySelector(".mute-btn.ap-narrator-btn");
    if (apMute) {
      apMute.textContent = _globalAudioMuted ? "🔇 OFF" : "🔊 ON";
      apMute.dataset.muted = _globalAudioMuted ? "1" : "0";
    }
    chrome.storage.local.set({ audioMuted: _globalAudioMuted }).catch(()=>{});
  });
}

if (sendBtn) sendBtn.addEventListener("click", () => sendMessage());
if (chatInput) chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function resizeInput() {
  if (!chatInput) return;
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
}
if (chatInput) chatInput.addEventListener("input", resizeInput);

async function sendMessage() {
  // ── If autopilot is running, stop it before sending user message ─────────
  if (isAutopilot) {
    _apStopRequested = true;
    _apPaused = false;
    if (crew) { crew.resume(); crew.cancel(); }
    tts.stop();
    isAutopilot = false;
    setApState(false);
    chrome.runtime.sendMessage({ type: "autopilot_stopped" }).catch(()=>{});
    setTimeout(() => { _apStopRequested = false; }, 800);
    setStatus("Autopilot stopped — sending your message…");
    // Brief yield so autopilot state fully unwinds
    await new Promise(r => setTimeout(r, 80));
  }

  // ── Atomic guard: set isSending synchronously before any await ────────────
  if (isSending) {
    stopChat();
    return;
  }
  if (_rateLimited) return;
  if (!_checkRateLimit()) return;

  if (!crew || !llmClient) {
    setStatus("⚠️ No API key — go to Settings.");
    document.querySelector('.tab[data-tab="settings"]')?.click();
    return;
  }
  const msg = (chatInput?.value || "").trim();
  if (!msg) return;

  // A new prompt takes priority over whatever TTS is still playing from the
  // previous response (the text stream finishes well before the TTS queue
  // drains it). Without this, the old response keeps talking while the new
  // one starts streaming/talking too. Does NOT touch the LLM stream itself
  // — only clears the speech queue/audio.
  tts.stop();

  // SET isSending IMMEDIATELY — before any await — to block re-entry
  isSending = true;
  setSendState(true);

  chatInput.value = "";
  resizeInput();

  if (!currentSid) await _newSession();
  isFirstMessage = false;
  _hideFirstRunCard();
  // Mark first run complete so card never shows again
  chrome.storage.local.get("firstRunComplete").then(s => {
    if (!s.firstRunComplete) {
      chrome.storage.local.set({ firstRunComplete: true }).catch(()=>{});
    }
  }).catch(()=>{});

  // Render user message with pin button
  const userDiv = document.createElement("div");
  userDiv.className = "turn turn-USER";
  const userHdr  = document.createElement("div");
  userHdr.className = "turn-header";
  userHdr.style.color = CHAR_COLOR.USER;
  userHdr.textContent = "👤 You";
  const userBody = document.createElement("div");
  userBody.className = "turn-body";
  userBody.textContent = msg;
  const userPin = document.createElement("button");
  userPin.className   = "pin-btn";
  userPin.textContent = "📌";
  userPin.title       = "Pin to Cold Storage";
  userPin.addEventListener("click", () => pinExchange("USER", msg));
  userDiv.appendChild(userHdr);
  userDiv.appendChild(userBody);
  userDiv.appendChild(userPin);
  chatlog.appendChild(userDiv);
  autoScroll(chatlog);

  await db.logTurn(currentSid, "USER", msg);
  transcript += `\nUSER: ${msg}`;

  setStatus("Crew is reading…");
  chrome.runtime.sendMessage({ type: "crew_responding" }).catch(()=>{});

  await db.newSession(currentSid, currentTopic || msg);

  // Update crew state
  crew.chaos = chaosMode;
  FULL_CAST.forEach(a => { crew.enabled[a] = !disabledAgents.has(a); });

  try {
    await crew.respondToUser(currentSid, transcript, msg, handleEmit);
  } catch (e) {
    if (e.name !== "AbortError") setStatus(`Error: ${e.message}`);
    isSending = false;
    setSendState(false);
  }
}

function setSendState(sending) {
  if (!sendBtn) return;
  if (sending) {
    sendBtn.textContent = "⏹ Stop";
    sendBtn.classList.add("stop-mode");
  } else {
    sendBtn.textContent = "Send";
    sendBtn.classList.remove("stop-mode");
  }
  // Show/hide the dedicated stop button
  if (chatStopBtn) chatStopBtn.style.display = sending ? "flex" : "none";
}

// ── Autopilot ─────────────────────────────────────────────────────────────────
const apToggle = $("apToggle");
if (apToggle) apToggle.addEventListener("click", () => toggleAutopilot());

// ── Sound/Pause button ───────────────────────────────────────────────────────
// When OFF: stops TTS, pauses autopilot (cancels current LLM request, stops loop),
// mutes all agent voices. Acts as a global pause for the whole app.
// When ON: resumes autopilot if it was paused by mute, unmutes voices.
let _globalAudioMuted = false;
let _autoPausedByMute = false;  // true if autopilot was running when mute was hit

const muteBtn = document.querySelector(".mute-btn.ap-narrator-btn");
if (muteBtn) {
  muteBtn.addEventListener("click", async () => {
    _globalAudioMuted = !_globalAudioMuted;
    if (_globalAudioMuted) {
      // ── PAUSE ──
      tts.stop();
      FULL_CAST.forEach(a => tts.mute(a));
      muteBtn.textContent = "🔇 OFF";
      muteBtn.dataset.muted = "1";
      // Pause autopilot if running
      if (isAutopilot) {
        _autoPausedByMute = true;
        if (crew) crew.cancel();
        isAutopilot = false;
        setApState(false);
        setStatus("⏸ Paused — press 🔊 to resume autopilot.");
      }
      // Stop any active chat LLM call
      if (isSending) {
        if (crew) crew.cancel();
        isSending = false;
        setSendState(false);
      }
    } else {
      // ── RESUME ──
      FULL_CAST.forEach(a => { if (!_mutedVoices.has(a)) tts.unmute(a); });
      muteBtn.textContent = "🔊 ON";
      muteBtn.dataset.muted = "0";
      // Resume autopilot if it was paused by mute
      if (_autoPausedByMute) {
        _autoPausedByMute = false;
        setStatus("▶ Resuming autopilot…");
        await toggleAutopilot();
      }
    }
    chrome.storage.local.set({ audioMuted: _globalAudioMuted }).catch(()=>{});
  });
}

let _apStopRequested = false;  // drain flag — drops late tokens after stop

async function toggleAutopilot(seedTopic = null) {
  if (isAutopilot) {
    _apStopRequested = true;
    _apPaused = false;
    if (crew) { crew.resume(); crew.cancel(); }
    tts.stop();
    isAutopilot = false;
    setApState(false);
    setStatus("Autopilot stopped.");
    chrome.runtime.sendMessage({ type: "autopilot_stopped" }).catch(()=>{});
    // Clear the drain flag after a short window so future runs work normally
    setTimeout(() => { _apStopRequested = false; }, 800);
    return;
  }
  if (!crew || !llmClient) {
    // No API key — run the hardcoded demo episode instead of redirecting to settings
    if (_demoApRunning) {
      _stopDemoAutopilot();
      isAutopilot = false;
      setApState(false);
      setStatus("Demo episode stopped.");
    } else {
      isAutopilot = true;   // route handleEmit output to apStream, not chatlog
      setApState(true);
      setStatus("▶ Demo episode — connect an API key for live episodes.");
      _runDemoAutopilot();
    }
    return;
  }
  if (!currentSid) await _newSession();
  await db.newSession(currentSid, "[Autopilot]");

  isAutopilot = true;
  setApState(true);
  setStatus("Autopilot on — crew debating their own thing…");
  chrome.runtime.sendMessage({ type: "autopilot_started" }).catch(()=>{});

  crew.chaos = chaosMode;
  FULL_CAST.forEach(a => { crew.enabled[a] = !disabledAgents.has(a); });

  try {
    await crew.startAutopilot(currentSid, handleEmit, seedTopic);
  } catch (e) {
    if (e.name !== "AbortError") setStatus(`Autopilot error: ${e.message}`);
    isAutopilot = false;
    setApState(false);
  }
}

const apPauseBtn = $("apPauseBtn");
let _apPaused = false;

function setApState(on) {
  if (!apToggle) return;
  apToggle.textContent = on ? "⏹ STOP" : "🚀 LAUNCH AUTOPILOT";
  apToggle.classList.toggle("ap-on", on);
  // Show/hide pause button
  if (apPauseBtn) apPauseBtn.style.display = on ? "flex" : "none";
  // Enable/disable save button
  if (apSaveBtn) apSaveBtn.disabled = !on && !apStream?.children.length;
  // Re-sync TTS provider so the selected voice pack (ElevenLabs/OS/Chrome)
  // is active for this episode, even if it was changed since the last run.
  if (on) _setVoiceEngineMode(_voiceEngineMode, { persist: false });
}

// Pause / Resume button
if (apPauseBtn) {
  apPauseBtn.addEventListener("click", () => {
    if (!crew || !isAutopilot) return;
    _apPaused = !_apPaused;
    if (_apPaused) {
      crew.pause();
      tts.stop();
      apPauseBtn.textContent = "▶";
      apPauseBtn.title = "Resume episode";
      apPauseBtn.style.borderColor = "var(--gold)";
      apPauseBtn.style.color = "var(--gold)";
      setStatus("⏸ Episode paused — press ▶ to resume.");
    } else {
      crew.resume();
      apPauseBtn.textContent = "⏸";
      apPauseBtn.title = "Pause episode";
      apPauseBtn.style.borderColor = "";
      apPauseBtn.style.color = "";
      setStatus("▶ Resuming episode…");
    }
  });
}

// ── Autopilot save ────────────────────────────────────────────────────────────
const apSaveBtn = $("apPdfBtn");
if (apSaveBtn) apSaveBtn.addEventListener("click", saveApTranscriptToColdStorage);

async function saveApTranscriptToColdStorage() {
  if (!apSaveBtn) return;
  apSaveBtn.textContent = "⏳"; apSaveBtn.disabled = true;
  try {
    const lines = [];
    apStream.querySelectorAll(".turn").forEach(turn => {
      const hdr  = turn.querySelector(".turn-header")?.textContent?.trim() || "";
      const body = turn.querySelector(".turn-body")?.textContent?.trim()   || "";
      if (body) lines.push(hdr ? `${hdr}\n${body}` : body);
    });
    // Also capture banners/system bubbles
    apStream.querySelectorAll(".ap-topic-banner,.ep-title-banner,.system-bubble").forEach(el => {
      const t = el.textContent.trim();
      if (t) lines.unshift(t);  // banners go at top
    });
    if (!lines.length) { setStatus("Nothing to save yet."); return; }
    const date    = new Date().toLocaleString();
    const DISCLAIMER = "Futurama and all related characters are the intellectual property of The Walt Disney Company / 20th Television Animation. Non-commercial AI-generated parody under fair use (17 U.S.C. § 107). Planet Express Lounge — Unofficial fan project — #DHSeaDev";
    const text    = `PLANET EXPRESS AUTOPILOT\n${date}\n${"─".repeat(40)}\n\n${lines.join("\n\n")}\n\n${"─".repeat(40)}\n${DISCLAIMER}`;
    await db.savePin("AUTOPILOT", text.slice(0, 6000), `Autopilot — ${date}`);
    setStatus("📌 Episode saved to Cold Storage.", 2500);
    document.querySelector('.tab[data-tab="cold"]')?.click();
  } catch (e) {
    setStatus(`Save error: ${e.message}`);
  } finally {
    apSaveBtn.textContent = "📌 SAVE"; apSaveBtn.disabled = false;
  }
}

// ── Chat save ─────────────────────────────────────────────────────────────────
const chatSaveBtn = $("chatSavePin");
if (chatSaveBtn) chatSaveBtn.addEventListener("click", saveChatToColdStorage);

async function saveChatToColdStorage() {
  if (!chatSaveBtn || !currentSid) return;
  chatSaveBtn.textContent = "⏳"; chatSaveBtn.disabled = true;
  try {
    const lines = [];
    chatlog.querySelectorAll(".turn").forEach(turn => {
      const hdr  = turn.querySelector(".turn-header")?.textContent?.trim() || "";
      const body = turn.querySelector(".turn-body")?.textContent?.trim()   || "";
      if (body) lines.push(`${hdr}\n${body}`);
    });
    if (!lines.length) { setStatus("Nothing to save yet."); return; }
    const label = `Chat — ${new Date().toLocaleString()}`;
    const DISCLAIMER_CHAT = "\n\n───\nFuturama and related characters © The Walt Disney Company / 20th Television Animation. Non-commercial AI parody — fair use (17 U.S.C. § 107). Planet Express Lounge — #DHSeaDev";
    await db.savePin("TRANSCRIPT", (lines.join("\n\n---\n\n") + DISCLAIMER_CHAT).slice(0, 6000), label);
    setStatus("📌 Chat saved to Cold Storage.", 2500);
  } catch (e) {
    setStatus(`Save error: ${e.message}`);
  } finally {
    chatSaveBtn.textContent = "📌"; chatSaveBtn.disabled = !currentSid;
  }
}

// ── Episode / Chat Summary → Cold Storage ───────────────────────────────────
// Generates a structured ~1000-token recap (purpose, problem, solution, joke,
// challenge, surprise, resolution — see EPISODE_SUMMARY_SYS in prompts.js)
// via a single non-streaming LLM call, saved directly to Cold Storage.
// Reference document only — never printed to chat/autopilot, never spoken.
async function _generateSummary(rawText, label, btnEl) {
  if (!llmClient) { setStatus("⚠️ No API key — go to Settings."); return; }
  if (!rawText.trim()) { setStatus("Nothing to summarize yet."); return; }

  const original = btnEl?.textContent;
  if (btnEl) { btnEl.textContent = "⏳"; btnEl.disabled = true; }
  setStatus("📋 Writing summary…");

  try {
    // ~1000 tokens out; cap transcript input so very long episodes don't
    // blow the context window (most providers handle 12k chars easily).
    const summary = await llmClient.complete(EPISODE_SUMMARY_SYS, rawText.slice(0, 12000), 1000);
    if (!summary.trim()) {
      setStatus("⚠️ Summary came back empty — try again.");
      return;
    }
    await db.savePin("SUMMARY", summary.trim(), label);
    setStatus("📋 Summary saved to Cold Storage.", 3000);
    document.querySelector('.tab[data-tab="cold"]')?.click();
  } catch (e) {
    setStatus(`Summary error: ${e.message}`);
  } finally {
    if (btnEl) { btnEl.textContent = original; btnEl.disabled = false; }
  }
}

if (chatSummaryBtn) chatSummaryBtn.addEventListener("click", () => {
  const lines = [];
  chatlog.querySelectorAll(".turn").forEach(turn => {
    const hdr  = turn.querySelector(".turn-header")?.textContent?.trim() || "";
    const body = turn.querySelector(".turn-body")?.textContent?.trim()   || "";
    if (body) lines.push(`${hdr}\n${body}`);
  });
  _generateSummary(lines.join("\n\n---\n\n"), `Chat Summary — ${new Date().toLocaleString()}`, chatSummaryBtn);
});

const apSummaryBtn = $("apEpSummaryBtn");
if (apSummaryBtn) apSummaryBtn.addEventListener("click", () => {
  const lines = [];
  apStream.querySelectorAll(".ap-topic-banner,.ep-title-banner").forEach(el => {
    const t = el.textContent.trim();
    if (t) lines.push(t);
  });
  apStream.querySelectorAll(".turn").forEach(turn => {
    const hdr  = turn.querySelector(".turn-header")?.textContent?.trim() || "";
    const body = turn.querySelector(".turn-body")?.textContent?.trim()   || "";
    if (body) lines.push(hdr ? `${hdr}\n${body}` : body);
  });
  apStream.querySelectorAll(".system-bubble").forEach(el => {
    const t = el.textContent.trim();
    if (t) lines.push(t);
  });
  const epTitle = apStream.querySelector(".ep-title-banner")?.textContent?.trim() || "";
  _generateSummary(lines.join("\n\n---\n\n"), `Episode Summary ${epTitle} — ${new Date().toLocaleString()}`, apSummaryBtn);
});

// ── Cold Storage ──────────────────────────────────────────────────────────────
const coldList   = $("coldStorageList");
const coldDelAll = $("coldDelAllBtn");
if (coldDelAll) coldDelAll.addEventListener("click", async () => {
  await db.deleteAllPins();
  loadPins();
});

async function loadPins() {
  if (!coldList) return;
  const pins = await db.getPins();
  coldList.innerHTML = "";
  if (!pins.length) {
    coldList.innerHTML = '<div class="cold-empty">No saved exchanges yet.</div>';
    return;
  }
  for (const pin of pins) {
    const [,, col] = CHARS[pin.agent] || ["?","?","#888"];
    const row = document.createElement("div");
    row.className = "cold-pin";
    row.innerHTML = `
      <div class="cold-pin-header">
        <span class="cold-pin-agent" style="color:${col}">${pin.agent}</span>
        <span class="cold-pin-label">${escHtml(pin.label || "")}</span>
        <span class="cold-pin-ts">${new Date(pin.ts).toLocaleString()}</span>
      </div>
      <div class="cold-pin-text">${escHtml(pin.text)}</div>
      <div class="cold-pin-actions">
        <button class="cold-pin-share" data-id="${pin.id}" title="Share to Reddit, Facebook, X, or Email">🔗 SHARE</button>
        <button class="cold-pin-pdf" data-id="${pin.id}" title="Export as PDF">📄 PDF</button>
        <button class="cold-pin-del" data-id="${pin.id}" title="Delete">🗑️ Delete</button>
      </div>`;

    row.querySelector(".cold-pin-share").addEventListener("click", (e) => shareColdStoragePin(pin, e.currentTarget));
    row.querySelector(".cold-pin-pdf").addEventListener("click", () => exportPinAsPdf(pin));
    row.querySelector(".cold-pin-del").addEventListener("click", async () => {
      row.classList.add("deleting");
      await new Promise(r => setTimeout(r, 190));
      await db.deletePin(pin.id);
      loadPins();
    });

    coldList.appendChild(row);
  }
}

async function pinExchange(agent, text) {
  if (!text.trim()) return;
  await db.savePin(agent, text.slice(0, 800), agent);
  setStatus("📌 Pinned to Cold Storage.", 2000);
}

// Open the social share menu for a Cold Storage pin (transcript, invention,
// or quote) — same menu as the per-message 🔗 share button.
function shareColdStoragePin(pin, btnEl) {
  const [charName] = CHARS[pin.agent] || [pin.label || pin.agent];
  const heading = pin.label && pin.label !== pin.agent ? pin.label : charName;
  const plain = `${heading}\n\n"${pin.text.trim()}"\n\nAI fan parody — Planet Express Lounge | #DHSeaDev`;
  openShareMenu(plain, btnEl);
}

function exportPinAsPdf({ agent, label, text, ts }) {
  const date    = new Date(ts).toLocaleString();
  const esc     = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const content = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Cold Storage — ${esc(label || agent)}</title>
<style>
  body{font-family:'Courier New',monospace;max-width:640px;margin:40px auto;padding:0 20px;color:#111}
  h1{font-size:14px;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid #111;padding-bottom:6px}
  .meta{font-size:11px;color:#555;margin-bottom:16px}
  pre{font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
  footer{font-size:9px;color:#aaa;border-top:1px solid #ddd;margin-top:24px;padding-top:8px}
</style></head><body>
<h1>${esc(label || agent)}</h1>
<div class="meta">Character: ${esc(agent)} — Saved: ${date}</div>
<pre>${esc(text)}</pre>
<footer>
  <div style="margin-bottom:3px">Planet Express Lounge — Unofficial fan project — #DHSeaDev</div>
  <div style="font-style:italic">Futurama and all related characters are the intellectual property of The Walt Disney Company / 20th Television Animation. This is non-commercial AI-generated parody content under fair use (17 U.S.C. § 107). Not affiliated with or endorsed by Disney, Hulu, or any rights holder.</div>
</footer>
</body></html>`;
  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank");
  if (win) {
    win.addEventListener("load", () => { setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 400); });
  } else {
    const a = document.createElement("a");
    a.href = url; a.download = `PE_Pin_${Date.now()}.html`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);
  }
}

// ── Lab — shared namespace (lab.js reads this via window.Lab) ────────────────
// Defined with getters so each property is evaluated lazily on ACCESS, not at
// definition time. This avoids ReferenceErrors for consts (db, crew, CHARS,
// WIDGET_AFFIRMATIONS, etc.) that are declared further down the file —
// by the time lab.js calls into LabModule (inside init(), after this whole
// module has finished evaluating), every getter resolves correctly.
// crew/llmClient also stay "live" automatically — no re-sync needed after
// LLM connect, since each access re-reads the current module-scope variable.
window.Lab = {
  get db()                 { return db; },
  get crew()                { return crew; },
  get llmClient()           { return llmClient; },
  get tts()                 { return tts; },
  get setStatus()           { return setStatus; },
  get sendMessage()         { return sendMessage; },
  get CHARS()               { return CHARS; },
  get WIDGET_AFFIRMATIONS() { return WIDGET_AFFIRMATIONS; },
  get openShareMenu()       { return openShareMenu; },
  get toggleAutopilot()     { return toggleAutopilot; },
  get isAutopilot()         { return isAutopilot; },
};




// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const saved = await chrome.storage.local.get([
    "provider","model","groqKey","orKey","gemKey","elevenLabsKey","elevenLabsVoices",
    "wpm","fontSize","voiceSpeed","masterVolume","disabledAgents","mutedVoices",
    "lightMode","chaosMode","audioMuted","chromeVoiceOverride","voiceEngineMode",
  ]);

  // Chaos mode
  const chaosToggle = $("chaosToggle");
  chaosMode = saved.chaosMode || false;
  if (chaosToggle) chaosToggle.checked = chaosMode;

  // Theme
  const themeToggle = $("themeToggle");
  lightMode = saved.lightMode || false;
  if (themeToggle) themeToggle.checked = lightMode;
  _applyTheme(lightMode);  // syncs moon/sun icon too

  // Font size
  fontSize = parseInt(saved.fontSize) || 14;
  const fontSlider   = $("fontSlider");
  const fontDisplay  = $("fontDisplay");
  if (fontSlider)  fontSlider.value = fontSize;
  if (fontDisplay) fontDisplay.textContent = `${fontSize}px`;
  _applyFontSize(fontSize);

  // Voice speed
  _voiceSpeed = parseFloat(saved.voiceSpeed) || 1.0;
  tts.setRate(_voiceSpeed);
  const _vsSlider  = $("voiceSpeedSlider");
  const _vsDisplay = $("voiceSpeedDisplay");
  if (_vsSlider)  _vsSlider.value = _voiceSpeed;
  if (_vsDisplay) _vsDisplay.textContent = `${_voiceSpeed.toFixed(1)}x`;

  // Master volume
  const _vol       = saved.masterVolume !== undefined ? parseFloat(saved.masterVolume) : 1.0;
  tts.setVolume(_vol);
  const _volSlider  = $("volumeSlider");
  const _volDisplay = $("volumeDisplay");
  if (_volSlider)  _volSlider.value = _vol;
  if (_volDisplay) _volDisplay.textContent = `${Math.round(_vol * 100)}%`;

  // ── Voice Engine — 3-way exclusive mode (elevenlabs | os | chrome) ────────
  // Load the saved key/voices first so _applyVoiceEngineMode has data to work with.
  const elevenLabsKeyEl = $("elevenLabsKey");
  if (elevenLabsKeyEl) elevenLabsKeyEl.value = saved.elevenLabsKey || "";
  _savedElevenLabsKey = saved.elevenLabsKey || "";

  const elevenLabsVoices = saved.elevenLabsVoices || {};
  for (const [category, fieldId] of Object.entries(EL_CATEGORY_FIELDS)) {
    const el = $(fieldId);
    if (el) el.value = elevenLabsVoices[category] || "";
  }
  setElevenLabsVoiceIds(elevenLabsVoices);

  // Determine starting mode: explicit saved choice, else infer from legacy fields
  let _initialMode = saved.voiceEngineMode;
  if (!_initialMode) {
    _initialMode = saved.chromeVoiceOverride === true ? "chrome"
                 : _savedElevenLabsKey ? "elevenlabs"
                 : "os";
  }
  _setVoiceEngineMode(_initialMode, { persist: false });

  // Defer status update until voices have loaded
  setTimeout(_updateVoiceEngineStatus, 500);

  // WPM text speed
  _wpmValue = parseInt(saved.wpm) || 200;
  const _wpmSlider  = $("speedSlider");
  const _wpmDisplay = $("speedDisplay");
  if (_wpmSlider)  _wpmSlider.value = _wpmValue;
  if (_wpmDisplay) _wpmDisplay.textContent = `${_wpmValue} wpm`;

  // Provider & model
  const providerSelect = $("providerSelect");
  const modelSelect    = $("modelSelect");
  if (providerSelect) providerSelect.value = saved.provider || PROVIDER_GROQ;
  if (modelSelect)    _populateModels(saved.provider || PROVIDER_GROQ, saved.model);

  // API keys (masked)
  const groqKeyEl = $("groqKey");
  const orKeyEl   = $("orKey");
  const gemKeyEl  = $("gemKey");
  if (groqKeyEl) groqKeyEl.value = saved.groqKey || "";
  if (orKeyEl)   orKeyEl.value   = saved.orKey   || "";
  if (gemKeyEl)  gemKeyEl.value  = saved.gemKey  || "";

  // First-run / not-yet-configured: open the API Keys spoiler so new users
  // see it immediately instead of needing to discover the collapsed section.
  if (!saved.groqKey && !saved.orKey && !saved.gemKey) {
    const _apiKeysSpoiler = $("apiKeysSpoiler");
    const _apiKeysArrow   = $("apiKeysSpoilerArrow");
    if (_apiKeysSpoiler) _apiKeysSpoiler.open = true;
    if (_apiKeysArrow)   _apiKeysArrow.style.transform = "rotate(90deg)";
  }

  // Disabled agents
  if (Array.isArray(saved.disabledAgents)) {
    disabledAgents = new Set(saved.disabledAgents);
  }
  if (Array.isArray(saved.mutedVoices)) {
    _mutedVoices = new Set(saved.mutedVoices);
    tts.setMuted(_mutedVoices);
  }

  // Restore global audio muted state
  _globalAudioMuted = saved.audioMuted || false;
  const _muteBtn = document.querySelector(".mute-btn.ap-narrator-btn");
  if (_muteBtn) {
    _muteBtn.textContent = _globalAudioMuted ? "🔇 OFF" : "🔊 ON";
    _muteBtn.dataset.muted = _globalAudioMuted ? "1" : "0";
    if (_globalAudioMuted) FULL_CAST.forEach(a => tts.mute(a));
  }
  // Sync chat panel mute button
  const _chatMuteEl = $("chatMuteBtn");
  if (_chatMuteEl) {
    _chatMuteEl.textContent = _globalAudioMuted ? "🔇" : "🔊";
    _chatMuteEl.dataset.muted = _globalAudioMuted ? "1" : "0";
  }

  buildCastGrid();
  _updateKeyStatus();

  // Init LLM with saved keys
  _initLLM(
    saved.provider || PROVIDER_GROQ,
    saved.model,
    saved.groqKey || "",
    saved.orKey   || "",
    saved.gemKey  || "",
  );
}

function _initLLM(provider, model, groqKey, orKey, gemKey) {
  if (!groqKey && !orKey && !gemKey) {
    llmClient = null; crew = null;
    setStatus("⚠️ No API key — go to Settings.");
    // Show first-run card, explain why Send is disabled
    const card = $("firstRunCard");
    if (card) card.style.display = "";
    if (sendBtn) sendBtn.title = "Go to Settings first to connect your API key";
    // Enter demo mode so the user can explore before connecting
    _enterDemoMode();
    return;
  }
  try {
    llmClient = new LLMClient({ provider, model, groqKey, orKey, gemKey, temp: TEMPERATURE });
    crew      = new Crew(llmClient, db, { chaos: chaosMode });
    setStatus("✓ Connected: " + llmClient.label, 3000);
    _applyDisabled();
    // Exit demo mode permanently — restores real chat UI, clears demo state
    _exitDemoMode();
    // Enable UI that requires a live LLM connection
    if (sendBtn)          { sendBtn.disabled = false; sendBtn.title = ""; }
    window.LabModule?.refreshInventBtn();
    if (chatSummaryBtn)   chatSummaryBtn.disabled = false;
    if (chatSaveBtn)      chatSaveBtn.disabled = false;
    // Hide the first-run card — user has a working connection
    _hideFirstRunCard();
  } catch (e) {
    llmClient = null; crew = null;
    setStatus("⚠️ " + e.message);
  }
}

// Update connection status — dots, banner, message
function _updateKeyStatus(state = null) {
  // state: null=auto-detect, 'testing'=spinner, 'ok'=force green, 'err'=force red
  const msgEl  = $("settingsMsg");
  const dot    = $("settingsDot");
  const hdrDot = $("statusDot");       // header dot next to moon icon
  const banner = $("notReadyBanner");

  const connected = state === "ok" || (state !== "err" && state !== "testing" && !!llmClient);

  const greenStyle = { bg: "#2ea043", shadow: "0 0 6px #2ea04388" };
  const redStyle   = { bg: "var(--system)", shadow: "none" };
  const greyStyle  = { bg: "#555", shadow: "none" };

  const style = state === "testing" ? greyStyle : connected ? greenStyle : redStyle;

  // Both dots update together — always in sync
  for (const d of [dot, hdrDot]) {
    if (!d) continue;
    d.style.background = style.bg;
    d.style.boxShadow  = style.shadow;
    d.title = state === "testing" ? "Testing connection…"
            : connected ? `Connected: ${llmClient?.label}`
            : "No API key — go to Settings";
  }

  if (banner) banner.classList.toggle("visible", !connected && state !== "testing");

  if (msgEl) {
    if (state === "testing") {
      msgEl.textContent = "Testing…";
      msgEl.style.color = "var(--fg2)";
    } else if (connected) {
      msgEl.textContent = `✓ ${llmClient?.label || "Connected"}`;
      msgEl.style.color = "var(--user)";
    } else {
      msgEl.textContent = state === "err" ? "✗ Connection failed — check your key." : "";
      msgEl.style.color = "var(--system)";
    }
  }
}

function _applyDisabled() {
  if (!crew) return;
  FULL_CAST.forEach(a => { crew.enabled[a] = !disabledAgents.has(a); });
}

// Save config button
const saveConfigBtn = $("saveConfigBtn");
if (saveConfigBtn) saveConfigBtn.addEventListener("click", saveConfig);

async function saveConfig() {
  const provider = $("providerSelect")?.value || PROVIDER_GROQ;
  const model    = $("modelSelect")?.value    || "";
  const groqKey  = ($("groqKey")?.value   || "").trim();
  const orKey    = ($("orKey")?.value     || "").trim();
  const gemKey   = ($("gemKey")?.value    || "").trim();

  await chrome.storage.local.set({ provider, model, groqKey, orKey, gemKey });

  _initLLM(provider, model, groqKey, orKey, gemKey);

  _updateKeyStatus(llmClient ? "ok" : "err");
}

// Test connection button
// ── Shared connection test (used by both header refresh and settings test btn) ─
async function _testConnection() {
  _updateKeyStatus("testing");
  try {
    if (!llmClient) throw new Error("No API key saved — go to ⚙️ Settings.");
    await llmClient.ping();
    _updateKeyStatus("ok");
    return true;
  } catch (e) {
    _updateKeyStatus("err");
    setStatus("✗ " + e.message, 4000);
    return false;
  }
}

const testConnBtn = $("testConnBtn");
if (testConnBtn) testConnBtn.addEventListener("click", _testConnection);

// Header refresh button ⟳ — same test, visible from any tab
const refreshBtnEl = $("refreshBtn");
if (refreshBtnEl) refreshBtnEl.addEventListener("click", async () => {
  refreshBtnEl.style.opacity = "0.5";
  refreshBtnEl.disabled = true;
  await _testConnection();
  refreshBtnEl.style.opacity = "";
  refreshBtnEl.disabled = false;
});

// Provider change
const providerSelect = $("providerSelect");
if (providerSelect) providerSelect.addEventListener("change", () => {
  _populateModels(providerSelect.value, null);
});

function _populateModels(provider, currentModel) {
  const modelSelect = $("modelSelect");
  if (!modelSelect) return;
  const lists = {
    [PROVIDER_GROQ]: GROQ_MODELS,
    [PROVIDER_OR]:   OR_MODELS,
    [PROVIDER_GEM]:  GEM_MODELS,
  };
  const models = lists[provider] || GROQ_MODELS;
  // Each model is now { id, tier } — tier:'low'=green dot, tier:'high'=red dot
  modelSelect.innerHTML = models.map(m => {
    const id   = typeof m === "string" ? m : m.id;
    const tier = typeof m === "object" ? m.tier : "high";
    const dot  = tier === "low" ? "🟢" : "🔴";
    const sel  = id === currentModel ? "selected" : "";
    return `<option value="${id}" ${sel}>${dot} ${id}</option>`;
  }).join("");
  const ids = models.map(m => typeof m === "string" ? m : m.id);
  if (!currentModel || !ids.includes(currentModel)) {
    modelSelect.value = ids[0];
  }
}

// Chaos mode
const chaosToggleEl = $("chaosToggle");
if (chaosToggleEl) chaosToggleEl.addEventListener("change", () => {
  chaosMode = chaosToggleEl.checked;
  if (crew) crew.chaos = chaosMode;
  chrome.storage.local.set({ chaosMode }).catch(()=>{});
  _applyChaosState(chaosMode);
});

function _applyChaosState(on) {
  document.documentElement.classList.toggle("chaos-active", on);
  // Show/hide both chaos banners (chat + autopilot)
  const bannerChat = $("chaosBanner");
  const bannerAp   = $("chaosBannerAp");
  if (bannerChat) bannerChat.style.display = on ? "block" : "none";
  if (bannerAp)   bannerAp.style.display   = on ? "block" : "none";
  // System bubble feedback — only when called from user interaction (not on init)
  if (on) {
    setStatus("💀 CHAOS MODE: The crew will be significantly ruder and more unhinged.", 5000);
    if (chatlog && chatlog.children.length > 0) {
      appendSystemBubble("💀 Chaos mode enabled. The crew takes no responsibility for what happens next.", "sys-msg", "var(--system)");
    }
  } else if (chaosMode !== on) {
    // Only fire "disabled" bubble if it was previously on (chaosMode is the old value here)
    appendSystemBubble("✅ Chaos mode disabled. Civilised conversation resumes.", "sys-msg", "var(--user)");
  }
}

// Theme toggle
const themeToggleEl = $("themeToggle");
if (themeToggleEl) themeToggleEl.addEventListener("change", () => {
  lightMode = themeToggleEl.checked;
  _applyTheme(lightMode);
  chrome.storage.local.set({ lightMode }).catch(()=>{});
});

// Header moon/sun button — also toggles theme
const themeBtnEl = $("themeBtn");
if (themeBtnEl) themeBtnEl.addEventListener("click", () => {
  lightMode = !lightMode;
  _applyTheme(lightMode);
  if (themeToggleEl) themeToggleEl.checked = lightMode;
  chrome.storage.local.set({ lightMode }).catch(()=>{});
});

function _applyTheme(light) {
  document.documentElement.classList.toggle("light", light);
  const btn = $("themeBtn");
  if (btn) btn.textContent = light ? "☀️" : "🌙";
}

// Font size slider
const fontSlider  = $("fontSlider");
const fontDisplay = $("fontDisplay");
if (fontSlider) fontSlider.addEventListener("input", () => {
  fontSize = parseInt(fontSlider.value);
  if (fontDisplay) fontDisplay.textContent = `${fontSize}px`;
  _applyFontSize(fontSize);
  chrome.storage.local.set({ fontSize }).catch(()=>{});
});

function _applyFontSize(size) {
  // .turn-body / .turn-header (chat text) read var(--chat-font-size).
  document.documentElement.style.setProperty("--chat-font-size", `${size}px`);
}

// Voice speed slider
const voiceSpeedSlider  = $("voiceSpeedSlider");
const voiceSpeedDisplay = $("voiceSpeedDisplay");
if (voiceSpeedSlider) voiceSpeedSlider.addEventListener("input", () => {
  _voiceSpeed = parseFloat(voiceSpeedSlider.value);
  if (voiceSpeedDisplay) voiceSpeedDisplay.textContent = `${_voiceSpeed.toFixed(1)}x`;
  tts.setRate(_voiceSpeed);
  chrome.storage.local.set({ voiceSpeed: _voiceSpeed }).catch(()=>{});
});

// Master volume slider
const volumeSlider  = $("volumeSlider");
const volumeDisplay = $("volumeDisplay");
if (volumeSlider) volumeSlider.addEventListener("input", () => {
  const vol = parseFloat(volumeSlider.value);
  if (volumeDisplay) volumeDisplay.textContent = `${Math.round(vol * 100)}%`;
  tts.setVolume(vol);
  chrome.storage.local.set({ masterVolume: vol }).catch(()=>{});
});

// Speed & Display spoiler arrow
const speedSpoilerEl    = $("speedSpoiler");
const speedSpoilerArrow = $("speedSpoilerArrow");
if (speedSpoilerEl && speedSpoilerArrow) {
  speedSpoilerEl.addEventListener("toggle", () => {
    speedSpoilerArrow.style.transform = speedSpoilerEl.open ? "rotate(90deg)" : "";
  });
}

// ── Voice Engine — 3-way exclusive mode (elevenlabs | os | chrome) ───────────
// Exactly one source is ever active. ElevenLabs/Chrome-override are mutually
// exclusive at runtime via the existing setters — switching modes re-applies
// them immediately, including mid-Autopilot (called again in setApState).
let _voiceEngineMode    = "os";   // 'elevenlabs' | 'os' | 'chrome'
let _savedElevenLabsKey = "";     // the user's stored key, kept even when not active

function _setVoiceEngineMode(mode, { persist = true } = {}) {
  if (!["elevenlabs", "os", "chrome"].includes(mode)) mode = "os";
  _voiceEngineMode = mode;

  switch (mode) {
    case "elevenlabs":
      setElevenLabsKey(_savedElevenLabsKey);
      setChromeVoiceOverride(false);
      break;
    case "chrome":
      setElevenLabsKey("");
      setChromeVoiceOverride(true);
      break;
    default: // "os"
      setElevenLabsKey("");
      setChromeVoiceOverride(false);
      break;
  }

  document.querySelectorAll(".voice-engine-opt").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  if (persist) chrome.storage.local.set({ voiceEngineMode: mode }).catch(() => {});
  _updateElevenLabsKeyStatus(!!_savedElevenLabsKey, mode);
  _updateVoiceEngineStatus();
}

document.querySelectorAll(".voice-engine-opt").forEach(btn => {
  btn.addEventListener("click", () => _setVoiceEngineMode(btn.dataset.mode));
});

// Surface ElevenLabs runtime failures (bad key, invalid voice, quota,
// network, timeout) in the UI — a console.warn alone requires devtools to
// notice, and a persistently-failing key silently sounds like "ElevenLabs
// just doesn't work" with falls back to OS/Chrome voices and no visible
// reason. Throttled so a barrage of per-sentence failures (e.g. every line
// of an Autopilot episode hitting a 401) doesn't spam the status bar.
let _lastElevenLabsErrorAt = 0;
window.addEventListener("pel:elevenlabs-error", (e) => {
  const now = Date.now();
  if (now - _lastElevenLabsErrorAt < 8000) return; // at most once every 8s
  _lastElevenLabsErrorAt = now;

  const msg = e.detail?.message || "Unknown error";
  setStatus(`⚠️ ElevenLabs voice failed (${msg}) — using OS/Chrome voice instead.`, 6000);

  const statusEl = $("voiceEngineStatus");
  if (statusEl && _voiceEngineMode === "elevenlabs") {
    statusEl.innerHTML =
      `<span style="color:var(--red,#E55757)">⚠️ ElevenLabs error: ${msg}</span><br>` +
      `Falling back to OS/Chrome voices. If this persists, check your API key ` +
      `at <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" ` +
      `rel="noopener" style="color:var(--gold)">elevenlabs.io</a> — a 401/` +
      `"unauthorized" error means the key is invalid, expired, or was revoked.`;
  }
});

// Maps Settings field IDs to VOICE_TARGETS category names (shared by load + save)
const EL_CATEGORY_FIELDS = {
  "warm-male":     "elVoiceWarmMale",
  "deep-male":     "elVoiceDeepMale",
  "uk-male":       "elVoiceUkMale",
  "bright-female": "elVoiceBrightFemale",
  "warm-female":   "elVoiceWarmFemale",
  "uk-female":     "elVoiceUkFemale",
};

// ElevenLabs BYOK — save on blur (API key field, avoid per-keystroke writes)
const elevenLabsKeyEl = $("elevenLabsKey");
if (elevenLabsKeyEl) {
  elevenLabsKeyEl.addEventListener("blur", () => {
    const key = elevenLabsKeyEl.value.trim();
    _savedElevenLabsKey = key;
    chrome.storage.local.set({ elevenLabsKey: key }).catch(() => {});
    // Re-apply current mode so an ElevenLabs key just pasted in takes effect
    // immediately if ElevenLabs mode is already selected.
    _setVoiceEngineMode(_voiceEngineMode);
  });
}

// ElevenLabs voice IDs — explicit save button (six fields, batch-save)
const elevenLabsSpoilerArrow = $("elevenLabsSpoilerArrow");
const elevenLabsSpoilerEl    = $("elevenLabsSpoiler");
if (elevenLabsSpoilerEl && elevenLabsSpoilerArrow) {
  elevenLabsSpoilerEl.addEventListener("toggle", () => {
    elevenLabsSpoilerArrow.style.transform = elevenLabsSpoilerEl.open ? "rotate(90deg)" : "";
  });
}

// API Keys spoiler (Provider & Model section)
const apiKeysSpoilerArrow = $("apiKeysSpoilerArrow");
const apiKeysSpoilerEl    = $("apiKeysSpoiler");
if (apiKeysSpoilerEl && apiKeysSpoilerArrow) {
  apiKeysSpoilerEl.addEventListener("toggle", () => {
    apiKeysSpoilerArrow.style.transform = apiKeysSpoilerEl.open ? "rotate(90deg)" : "";
  });
}

// Provider & Model outer spoiler (API Keys spoiler above is nested inside it)
const providerModelSpoilerArrow = $("providerModelSpoilerArrow");
const providerModelSpoilerEl    = $("providerModelSpoiler");
if (providerModelSpoilerEl && providerModelSpoilerArrow) {
  // Starts open (see `open` attribute in HTML) — set initial arrow state to match.
  providerModelSpoilerArrow.style.transform = providerModelSpoilerEl.open ? "rotate(90deg)" : "";
  providerModelSpoilerEl.addEventListener("toggle", () => {
    providerModelSpoilerArrow.style.transform = providerModelSpoilerEl.open ? "rotate(90deg)" : "";
  });
}

// Voice Engine outer spoiler — collapsed by default, hides the
// ElevenLabs/OS/Chrome mode selector and API key fields until expanded.
const voiceEngineSpoilerArrow = $("voiceEngineSpoilerArrow");
const voiceEngineSpoilerEl    = $("voiceEngineSpoiler");
if (voiceEngineSpoilerEl && voiceEngineSpoilerArrow) {
  voiceEngineSpoilerEl.addEventListener("toggle", () => {
    voiceEngineSpoilerArrow.style.transform = voiceEngineSpoilerEl.open ? "rotate(90deg)" : "";
  });
}

const saveElevenLabsBtn = $("saveElevenLabsBtn");
if (saveElevenLabsBtn) {
  saveElevenLabsBtn.addEventListener("click", async () => {
    const voices = {};
    for (const [category, fieldId] of Object.entries(EL_CATEGORY_FIELDS)) {
      voices[category] = ($(fieldId)?.value || "").trim();
    }
    setElevenLabsVoiceIds(voices);
    await chrome.storage.local.set({ elevenLabsVoices: voices });

    const customized = Object.values(voices).filter(Boolean).length;
    const msgEl = $("elevenLabsMsg");
    if (msgEl) {
      msgEl.textContent = customized
        ? `✓ Saved — ${customized} of 6 categories customized, rest use defaults.`
        : "✓ Saved — using default ElevenLabs voices for all categories.";
      msgEl.style.color = "var(--gold)";
    }
    _updateVoiceEngineStatus();
  });
}

/**
 * Reflects whether ElevenLabs is active in the status line below the
 * key field, and updates the Voice Engine status to mention it.
 */
function _updateElevenLabsKeyStatus(hasKey, mode = _voiceEngineMode) {
  const el = $("elevenLabsKeyStatus");
  if (!el) return;
  if (!hasKey) {
    el.innerHTML = `<span style="color:var(--fg3)">○</span> No key set — paste one above, then select ElevenLabs mode.`;
  } else if (mode === "elevenlabs") {
    el.innerHTML = `<span style="color:var(--gold)">●</span> ElevenLabs active — default voices assigned, customize per category below if you like.`;
  } else {
    el.innerHTML = `<span style="color:var(--fg3)">○</span> Key saved but not active — switch to ElevenLabs mode above to use it.`;
  }
}

/**
 * Show detected OS + voice counts in the Voice Engine status line.
 * Helps users understand which voices are active.
 */
function _updateVoiceEngineStatus() {
  const statusEl = $("voiceEngineStatus");
  if (!statusEl) return;
  chrome.tts.getVoices(voices => {
    if (!voices || !voices.length) {
      statusEl.textContent = "No voices detected yet — try reloading.";
      return;
    }
    const local  = voices.filter(v => !v.remote);
    const remote = voices.filter(v =>  v.remote);
    // Detect OS
    const names = voices.map(v => v.voiceName || "").join(" ");
    const os = /microsoft/i.test(names) ? "Windows"
             : /\b(Alex|Samantha|Daniel|Ava)\b/i.test(names) ? "macOS"
             : "ChromeOS/Other";
    const active = _voiceEngineMode === "elevenlabs" ? "ElevenLabs (your voices)"
                 : _voiceEngineMode === "chrome"      ? "Chrome built-in voices"
                 : `OS voices (${os})`;
    statusEl.innerHTML =
      `Detected: <strong style="color:var(--fg)">${os}</strong> — ` +
      `${local.length} local voices, ${remote.length} remote<br>` +
      `Active mode: <strong style="color:var(--gold)">${active}</strong>`;

    // Compact label shown in the spoiler's summary line, visible even when
    // collapsed, so the active voice source is clear without expanding.
    const badge = $("voiceEngineSummaryBadge");
    if (badge) {
      const badgeLabel = _voiceEngineMode === "elevenlabs" ? "💎 ElevenLabs"
                        : _voiceEngineMode === "chrome"     ? "🌐 Chrome"
                        : "🖥️ OS";
      badge.textContent = `— ${badgeLabel}`;
    }
  });
}

// WPM text speed slider — wired and persisted
let _wpmValue = 200;
const speedSliderEl  = $("speedSlider");
const speedDisplayEl = $("speedDisplay");
if (speedSliderEl) speedSliderEl.addEventListener("input", () => {
  _wpmValue = parseInt(speedSliderEl.value);
  if (speedDisplayEl) speedDisplayEl.textContent = `${_wpmValue} wpm`;
  chrome.storage.local.set({ wpm: _wpmValue }).catch(()=>{});
});

// ── Cast grid ─────────────────────────────────────────────────────────────────
const castGrid = $("castGrid");
const FULL_CAST_UI = Object.entries(CHARS)
  .filter(([id]) => FULL_CAST.includes(id))
  .map(([id, [name,, color]]) => ({ id, name, color }));

function buildCastGrid() {
  if (!castGrid) return;
  castGrid.innerHTML = "";
  FULL_CAST_UI.forEach(char => {
    const enabled = !disabledAgents.has(char.id);
    const row     = document.createElement("div");
    row.className = `cast-row ${enabled ? "active" : "muted"}`;
    row.style.setProperty("--char-color", char.color);
    row.innerHTML = `
      <div class="cast-info">
        <div class="cast-name" style="color:${enabled ? char.color : "var(--fg3)"}">${char.name}</div>
      </div>
      <label class="pill-toggle">
        <input type="checkbox" ${enabled ? "checked" : ""} data-agent="${char.id}">
        <span class="pill-track" style="--char-color:${char.color}"></span>
      </label>`;
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => toggleAgent(char.id, cb.checked));
    castGrid.appendChild(row);
  });
}

function toggleAgent(agentId, enabled) {
  if (enabled) { disabledAgents.delete(agentId); }
  else         { disabledAgents.add(agentId);    }
  if (disabledAgents.size >= FULL_CAST_UI.length) {
    disabledAgents.delete(agentId);
    setStatus("⚠️ At least one cast member must be active!", 2000);
    buildCastGrid(); return;
  }
  chrome.storage.local.set({ disabledAgents: [...disabledAgents] }).catch(()=>{});
  _applyDisabled();
  buildCastGrid();
  // Wire spoiler arrow
  const spoilerEl = $("castSpoiler");
  const arrowEl   = $("castSpoilerArrow");
  if (spoilerEl && arrowEl) {
    spoilerEl.addEventListener("toggle", () => {
      arrowEl.style.transform = spoilerEl.open ? "rotate(90deg)" : "";
    });
  }
}

// ── Voice toggles ─────────────────────────────────────────────────────────────
// ── Data management ───────────────────────────────────────────────────────────
async function loadDataSummary() {
  const pins    = await db.getPins();
  const summary = $("dataSummary");
  if (summary) summary.textContent = `${pins.length} pinned exchange${pins.length !== 1 ? "s" : ""} in Cold Storage.`;
}

const clearAllBtn = $("clearAllBtn");
if (clearAllBtn) clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Clear all local data? This cannot be undone.")) return;
  await db.clearAllData();
  setStatus("All data cleared.", 2500);
  transcript = ""; currentSid = null; isFirstMessage = true;
  if (chatlog)  chatlog.innerHTML  = "";
  if (apStream) apStream.innerHTML = "";
  loadDataSummary();
});

// ── About / Welcome page ──────────────────────────────────────────────────────
const showWelcomeBtn = $("showWelcomeBtn");
if (showWelcomeBtn) {
  showWelcomeBtn.addEventListener("mouseover", () => { showWelcomeBtn.style.borderColor = "var(--gold)"; showWelcomeBtn.style.color = "var(--gold)"; });
  showWelcomeBtn.addEventListener("mouseout",  () => { showWelcomeBtn.style.borderColor = ""; showWelcomeBtn.style.color = ""; });
  showWelcomeBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html"), active: true });
  });
}

// ── Session management ────────────────────────────────────────────────────────
async function _newSession() {
  currentSid     = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  transcript     = "";
  isFirstMessage = true;
  await db.newSession(currentSid, "");
  const stored = await chrome.storage.local.get("tabOpenCount");
  const count  = ((stored.tabOpenCount) || 0) + 1;
  chrome.storage.local.set({ tabOpenCount: count }).catch(()=>{});
}

async function _refreshTranscript() {
  if (!currentSid) return;
  const hist = await db.getHistory(currentSid);
  transcript = hist.map(m => `${m.agent}: ${m.content}`).join("\n");
}

// ── Delivery rewards — max 1 per 12 hours, triggered by qualifying activity ──
// "Qualifying activity": finishing an Autopilot episode, logging an
// Expedition, generating an invention, or (as a passive fallback) opening
// the Lab/Settings tab after 12h. First one of these to happen in a given
// 12h window grants that day's delivery — see _recordDelivery().
const DELIVERY_MILESTONES = [
  { count:  1, icon: "🍕", label: "First Delivery!",         name: "Fry's Pizza Run",      dmBonus:   10 },
  { count:  3, icon: "🤖", label: "3 Deliveries",            name: "Bender's Scheme Fund", dmBonus:   20 },
  { count:  5, icon: "👁️", label: "5 Deliveries",            name: "Leela's License",      dmBonus:   30 },
  { count: 10, icon: "🧪", label: "10 Deliveries",           name: "Professor's Lab Grant",dmBonus:   50 },
  { count: 15, icon: "💅", label: "15 Deliveries",           name: "Amy's Allowance",      dmBonus:   75 },
  { count: 20, icon: "🦞", label: "20 Deliveries",           name: "Zoidberg's Dumpster",  dmBonus:  100 },
  { count: 30, icon: "⭐", label: "30 Deliveries",           name: "Zapp's Medal",         dmBonus:  150 },
  { count: 50, icon: "📋", label: "50 Deliveries",           name: "Hermes's Grade 36",    dmBonus:  250 },
  { count: 75, icon: "🎩", label: "75 Deliveries",           name: "Nixon's Head Jar",     dmBonus:  400 },
  { count:100, icon: "🌀", label: "100 Deliveries — LEGEND", name: "Planet Express Owner", dmBonus: 1000 },
];

// Past 100 ("LEGEND"), every RANK_INTERVAL further deliveries bumps a Legend
// Rank with a smaller recurring Dark Matter bonus, so the counter keeps
// meaning something instead of dead-ending at 100.
const RANK_INTERVAL = 25;
const RANK_DM_BONUS = 50;
const TWELVE_HOURS  = 12 * 60 * 60 * 1000;

function _updateDeliveryBadge(count) {
  const badge = $("dmDeliveryBadge");
  if (badge) badge.textContent = `📦 ${count}`;
}

/**
 * Records a delivery if 12+ hours have passed since the last one, awarding
 * Dark Matter for milestones (and Legend Ranks past 100). Safe to call from
 * multiple activity hooks — only the first call in a 12h window counts.
 */
async function _recordDelivery() {
  const now   = Date.now();
  const saved = await chrome.storage.local.get(["deliveryCount","lastDeliveryTime"]);
  const last  = saved.lastDeliveryTime || 0;
  const count = saved.deliveryCount    || 0;

  if (now - last < TWELVE_HOURS) {
    _updateDeliveryBadge(count);
    return count;
  }

  const newCount = count + 1;
  await chrome.storage.local.set({ deliveryCount: newCount, lastDeliveryTime: now });

  const milestone = DELIVERY_MILESTONES.find(m => newCount === m.count);
  if (milestone) {
    setStatus(`🚀 New reward: ${milestone.icon} ${milestone.label} (+${milestone.dmBonus} ⚛️)!`, 5000);
    window.earnDarkMatter?.(milestone.dmBonus, `Delivery reward: ${milestone.name}`).catch(()=>{});
  } else if (newCount > 100 && (newCount - 100) % RANK_INTERVAL === 0) {
    const rank = (newCount - 100) / RANK_INTERVAL;
    setStatus(`🌀 Legend Rank ${rank}! (+${RANK_DM_BONUS} ⚛️)`, 5000);
    window.earnDarkMatter?.(RANK_DM_BONUS, `Legend Rank ${rank}`).catch(()=>{});
  }

  _updateDeliveryBadge(newCount);
  return newCount;
}

// Exposed so lab.js can record a delivery for invention/expedition activity.
window.recordDelivery = _recordDelivery;

async function buildLabRewardsPreview() {
  const container = $("crewProgressList");
  if (!container) return;

  const count = await _recordDelivery();
  const saved = await chrome.storage.local.get(["lastDeliveryTime"]);
  const last  = saved.lastDeliveryTime || 0;
  const nextIn = Math.max(0, TWELVE_HOURS - (Date.now() - last));
  const hoursLeft = (nextIn / 3600000).toFixed(1);

  const earned = DELIVERY_MILESTONES.filter(m => count >= m.count);
  const next   = DELIVERY_MILESTONES.find(m => count < m.count);

  let html = `<div style="font-size:10px;color:var(--fg2);margin-bottom:6px">
    📦 Total Deliveries: <strong style="color:var(--gold)">${count}</strong>
    ${nextIn > 0 ? `<span style="color:var(--fg3);font-size:9px"> — next in ${hoursLeft}h</span>` : ""}
  </div>`;

  if (next) {
    const pct = Math.min(100, Math.round(count / next.count * 100));
    html += `<div style="font-size:9px;color:var(--fg3);margin-bottom:4px">Next: ${next.icon} ${next.label} (+${next.dmBonus} ⚛️)</div>
    <div style="height:4px;background:var(--bg3);border-radius:2px;margin-bottom:8px">
      <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:2px;transition:width .5s"></div>
    </div>`;
  } else if (count >= 100) {
    // Past LEGEND — show progress toward the next Legend Rank instead of
    // dead-ending. rank = ranks already achieved (0 until count reaches 125).
    const rank     = Math.floor((count - 100) / RANK_INTERVAL);
    const intoRank = (count - 100) % RANK_INTERVAL;
    const pct      = Math.round(intoRank / RANK_INTERVAL * 100);
    html += `<div style="font-size:9px;color:var(--fg3);margin-bottom:4px">🌀 ${rank > 0 ? `Legend Rank ${rank} — ` : ""}Next rank in ${RANK_INTERVAL - intoRank} (+${RANK_DM_BONUS} ⚛️)</div>
    <div style="height:4px;background:var(--bg3);border-radius:2px;margin-bottom:8px">
      <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:2px;transition:width .5s"></div>
    </div>`;
  }

  if (earned.length) {
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
    for (const m of earned) {
      html += `<div title="${m.name} (+${m.dmBonus} ⚛️)" style="font-size:18px;cursor:default" aria-label="${m.label}">${m.icon}</div>`;
    }
    html += `</div>`;
  } else {
    html += `<div style="font-size:10px;color:var(--fg3);font-style:italic">Complete your first delivery to earn rewards!</div>`;
  }

  container.innerHTML = html;
}

document.querySelectorAll(".tab").forEach(t => {
  if (t.dataset.tab === "lab") t.addEventListener("click", buildLabRewardsPreview);
});

// ── Context menu pending message ──────────────────────────────────────────────
async function _checkPending() {
  try {
    const sess = await chrome.storage.session.get(["pendingMessage","pendingSource","pendingNeedsConfirm"]);
    if (sess.pendingMessage && chatInput) {
      chatInput.value = sess.pendingMessage;
      resizeInput();
      await chrome.storage.session.remove(["pendingMessage","pendingSource","pendingNeedsConfirm"]);
      setStatus("Right-click text loaded — hit Send!");
      document.querySelector('.tab[data-tab="chat"]')?.click();
    }
  } catch {}
}

// ── Affirmation widget ────────────────────────────────────────────────────────
const WIDGET_AFFIRMATIONS = [
  { char:"FRY",      color:"#FF6B35", quote:"I'm not a hero — I'm a delivery boy who once saved everyone, but mostly by accident. That counts, right?" },
  { char:"LEELA",    color:"#C678DD", quote:"You don't need to be the smartest person in the room. You just need to be the one willing to do what needs doing." },
  { char:"BENDER",   color:"#ABB2BF", quote:"Bite my shiny metal affirmation. You're doing great, meatbag." },
  { char:"PROF",     color:"#E5C07B", quote:"Good news, everyone! Your existence, while brief and ultimately futile, has been pleasantly above average." },
  { char:"AMY",      color:"#FF79C6", quote:"Spluh. Of course you can do it. I believe in you and also your outfit is fine." },
  { char:"ZOIDBERG", color:"#56B6C2", quote:"You're doing wonderfully! Come, let us celebrate — I know a dumpster with the most marvellous yesterday's sushi." },
  { char:"HERMES",   color:"#7BC67E", quote:"By the many-paged manual of self-improvement! You, my friend, are on track and filed correctly." },
  { char:"ZAPP",     color:"#4A9ECD", quote:"I have 'believed in myself' on every mission. Some call it recklessness. I call it unfiltered courage." },
  { char:"KIF",      color:"#C5A3E8", quote:"(sighs softly) You are more appreciated than you know. I am certain of this. Unlike most things in my life." },
  { char:"MORBO",    color:"#7DF9FF", quote:"MORBO CONGRATULATES YOU. Your progress fills him with conflicted rage and mild respect." },
];

// ── Lab widget orchestration (delegated to lab.js) ──────────────────────────
// Functions below are forwarded to window.LabModule populated by lab.js

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await db.ready();
  await loadSettings();
  window.LabModule?.initWidget();
  await _checkPending();
  await _newSession();

  // Tab open counter
  const stored = await chrome.storage.local.get("tabOpenCount");
  const count  = ((stored.tabOpenCount) || 0) + 1;
  chrome.storage.local.set({ tabOpenCount: count }).catch(()=>{});

  // If returning user with a working connection, hide the first-run card immediately
  const firstRunData = await chrome.storage.local.get("firstRunComplete");
  if (firstRunData.firstRunComplete && llmClient) {
    _hideFirstRunCard();
  }

  // Expose CHARS to window for the invention critique renderer
  window.CHARS = CHARS;

  // Initial lab state (delegated to lab.js)
  window.LabModule?.renderPatentOffice();
  window.LabModule?.refreshInventBtn();
  _updateDeliveryBadge((await chrome.storage.local.get("deliveryCount")).deliveryCount || 0);

  setStatus(llmClient ? "Welcome back! Enter a topic, or hit Autopilot." : "Welcome aboard! Go to ⚙️ Settings to connect.");
  // Apply chaos visual state now that _applyChaosState is defined
  _applyChaosState(chaosMode);
}

init().catch(e => console.error("PE init error:", e));
