/**
 * sidepanel.js  —  Planet Express Lounge v4.0
 *
 * Serverless. All LLM calls, DB operations, and crew logic run
 * client-side via crew.js, llm.js, database.js, and prompts.js.
 * No fetch() to localhost required.
 */

import { db }          from "./database.js";
import { LLMClient }   from "./llm.js";
import { Crew }        from "./crew.js";
import { tts }         from "./tts.js";
import {
  CHARS, CREW_WEIGHTS, FULL_CAST,
  PROVIDERS, PROVIDER_GROQ, PROVIDER_OR, PROVIDER_GEM,
  GROQ_MODELS, OR_MODELS, GEM_MODELS, DEFAULT_MODEL, TEMPERATURE,
} from "./prompts.js";

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
let _chatAbort     = null;   // AbortController for current chat run

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
  tab.addEventListener("click", () => {
    const id = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach(t  => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $(`panel-${id}`)?.classList.add("active");
    if (id === "lab")      _startLabWidgets();
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

// ── TTS ───────────────────────────────────────────────────────────────────────
// ── TTS is handled by TTSQueueManager (tts.js) ─────────────────────────────
// VOICE_PITCH table and speak() have been replaced by tts.push() / tts.flush().
// tts.setRate() and tts.setMuted() are called from settings handlers below.

// ── Chat rendering ────────────────────────────────────────────────────────────
const chatlog  = $("chatlog");
const apStream = $("ap-stream");

let _activeTurnDiv  = null;
let _activeTurnBody = null;
let _activeAgent    = null;

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

  // Share button — copies plain-text quote to clipboard
  const shareBtn = document.createElement("button");
  shareBtn.className   = "pin-btn share-btn";
  shareBtn.textContent = "🔗";
  shareBtn.title       = "Share this line";
  shareBtn.style.marginLeft = "2px";
  shareBtn.addEventListener("click", () => {
    const text = body.textContent || "";
    if (!text.trim()) return;
    const [charName,,] = (CHARS[agentId] || [agentId]);
    const plain = `${charName}: "${text.trim()}"

AI fan parody — Planet Express Lounge | #DHSeaDev`;
    navigator.clipboard.writeText(plain).then(() => {
      setStatus("📋 Copied to clipboard — ready to share!", 2500);
      shareBtn.textContent = "✓";
      setTimeout(() => { shareBtn.textContent = "🔗"; }, 1800);
    }).catch(() => setStatus("⚠️ Clipboard copy failed.", 2000));
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

    case "scheme_update":
      appendSystemBubble(`🤖 Bender's new scheme: ${evt.scheme}`, "scheme-bubble", CHAR_COLOR.BENDER);
      break;

    case "invention_complication":
      appendSystemBubble(`🧪 Plot twist: ${evt.invention} is now a factor.`, "inv-bubble", CHAR_COLOR.PROF);
      break;

    case "ap_episode_end":
      appendSystemBubble(`— End of episode —`, "ep-end-bubble");
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

    case "journal":
      _showJournal(evt.text);
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
}

// ── Send message ──────────────────────────────────────────────────────────────
const chatInput = $("chatInput");
const sendBtn   = $("sendBtn");
const chatStopBtn  = $("chatStopBtn");
const chatMuteBtn  = $("chatMuteBtn");

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
if (apToggle) apToggle.addEventListener("click", toggleAutopilot);

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

async function toggleAutopilot() {
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
    setStatus("⚠️ No API key — go to Settings.");
    document.querySelector('.tab[data-tab="settings"]')?.click();
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
    await crew.startAutopilot(currentSid, handleEmit);
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
    await db.savePin("AUTOPILOT", text.slice(0, 2000), `Autopilot — ${date}`);
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
    await db.savePin("TRANSCRIPT", (lines.join("\n\n---\n\n") + DISCLAIMER_CHAT).slice(0, 2000), label);
    setStatus("📌 Chat saved to Cold Storage.", 2500);
  } catch (e) {
    setStatus(`Save error: ${e.message}`);
  } finally {
    chatSaveBtn.textContent = "📌"; chatSaveBtn.disabled = !currentSid;
  }
}

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
        <button class="cold-pin-pdf" data-id="${pin.id}" title="Export as PDF">📄 PDF</button>
        <button class="cold-pin-del" data-id="${pin.id}" title="Delete">🗑️ Delete</button>
      </div>`;

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

// ── Lab — Invention ──────────────────────────────────────────────────────────
const labInventBtn  = $("labInventBtn");
const labDiscussBtn = $("labDiscussBtn");
const labInvCard    = $("labInvCard");
const labInvText    = $("labInvText");
const labInvPlaceholder = $("labInvPlaceholder");
const labDoomBar    = $("labDoomBar");
const labDoomFill   = $("labDoomFill");
const labDoomPct    = $("labDoomPct");

if (labInventBtn) labInventBtn.addEventListener("click", genInvention);
if (labDiscussBtn) labDiscussBtn.addEventListener("click", discussInvention);

async function genInvention() {
  if (!crew) {
    setStatus("⚠️ Go to Settings and enter an API key first.");
    document.querySelector('.tab[data-tab="settings"]')?.click();
    return;
  }
  if (labInventBtn) labInventBtn.disabled = true;
  if (labInvPlaceholder) labInvPlaceholder.style.display = "none";
  if (labInvText) {
    labInvText.style.display = "block";
    labInvText.textContent = "Good news, everyone! The Professor is in his lab…";
  }
  try {
    await crew.genInvention((evt) => {
      if (evt.type === "invention") _showInvention(evt.text);
    });
  } catch(e) {
    if (labInvText) labInvText.textContent = "⚠️ Invention generation failed: " + e.message;
    setStatus("⚠️ " + e.message);
  } finally {
    if (labInventBtn) labInventBtn.disabled = false;
  }
}

function _showInvention(text) {
  if (labInvText) { labInvText.style.display = "block"; labInvText.textContent = text; }
  if (labInvPlaceholder) labInvPlaceholder.style.display = "none";
  if (labDiscussBtn) labDiscussBtn.disabled = false;
  // Doom level: random 60-99 for drama
  const doom = Math.floor(60 + Math.random() * 39);
  if (labDoomBar) labDoomBar.style.display = "flex";
  if (labDoomFill) labDoomFill.style.width = `${doom}%`;
  if (labDoomPct)  labDoomPct.textContent = `${doom}%`;
  if (crew) crew.todayInvention = text;
}

async function discussInvention() {
  if (!crew || !crew.todayInvention) {
    setStatus("⚠️ Generate an invention first!");
    return;
  }
  // Switch to chat tab first, then queue the send on next tick
  // so the tab switch and panel render complete before we send
  document.querySelector('.tab[data-tab="chat"]')?.click();
  await new Promise(r => setTimeout(r, 60));
  if (chatInput) {
    chatInput.value = `Tell me more about this invention: ${crew.todayInvention}`;
    resizeInput();
    sendMessage();
  }
}

// ── Journal ───────────────────────────────────────────────────────────────────
function _showJournal(text) {
  setStatus("📋 Mission log saved!", 2500);
  // Put in chat for visibility
  appendSystemBubble(`📋 Mission Log:\n${text}`, "journal-bubble", CHAR_COLOR.PROF);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const saved = await chrome.storage.local.get([
    "provider","model","groqKey","orKey","gemKey",
    "wpm","fontSize","voiceSpeed","disabledAgents","mutedVoices",
    "lightMode","chaosMode","audioMuted",
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
    return;
  }
  try {
    llmClient = new LLMClient({ provider, model, groqKey, orKey, gemKey, temp: TEMPERATURE });
    crew      = new Crew(llmClient, db, { chaos: chaosMode });
    setStatus("✓ Connected: " + llmClient.label, 3000);
    _applyDisabled();
    // Enable UI that requires a live LLM connection
    if (sendBtn)          { sendBtn.disabled = false; sendBtn.title = ""; }
    if (labInventBtn)     labInventBtn.disabled = false;
    if (chatSummaryBtnEl) chatSummaryBtnEl.disabled = false;
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
  document.documentElement.style.setProperty("--base-font-size", `${size}px`);
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
function buildVoiceToggles() {
  return; // section removed — mutes are in Cast & Crew
  voiceToggles.innerHTML = "";
  FULL_CAST_UI.forEach(char => {
    const muted = _mutedVoices.has(char.id);
    const row   = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:3px 0";
    row.innerHTML = `
      <span style="font-size:10px;color:${muted ? "var(--fg3)" : char.color};display:flex;align-items:center;gap:6px">
        ${char.name}
      </span>
      <label class="pill-toggle" style="transform:scale(0.85)">
        <input type="checkbox" ${muted ? "" : "checked"} data-voice="${char.id}">
        <span class="pill-track" style="--char-color:${char.color}"></span>
      </label>`;
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => {
      if (cb.checked) { _mutedVoices.delete(char.id); tts.unmute(char.id); }
      else            { _mutedVoices.add(char.id);    tts.mute(char.id);   }
      row.querySelector("span").style.color = cb.checked ? char.color : "var(--fg3)";
      chrome.storage.local.set({ mutedVoices: [..._mutedVoices] }).catch(()=>{});
    });
    voiceToggles.appendChild(row);
  });
}

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

// ── Delivery rewards — 1 delivery per unique launch, max 1 per 12 hours ─────
// Each qualifying launch earns 1 delivery. Deliveries unlock reward icons.
const DELIVERY_MILESTONES = [
  { count:  1, icon: "🍕", label: "First Delivery!",         name: "Fry's Pizza Run" },
  { count:  3, icon: "🤖", label: "3 Deliveries",            name: "Bender's Scheme Fund" },
  { count:  5, icon: "👁️", label: "5 Deliveries",            name: "Leela's License" },
  { count: 10, icon: "🧪", label: "10 Deliveries",           name: "Professor's Lab Grant" },
  { count: 15, icon: "💅", label: "15 Deliveries",           name: "Amy's Allowance" },
  { count: 20, icon: "🦞", label: "20 Deliveries",           name: "Zoidberg's Dumpster" },
  { count: 30, icon: "⭐", label: "30 Deliveries",           name: "Zapp's Medal" },
  { count: 50, icon: "📋", label: "50 Deliveries",           name: "Hermes's Grade 36" },
  { count: 75, icon: "🎩", label: "75 Deliveries",           name: "Nixon's Head Jar" },
  { count:100, icon: "🌀", label: "100 Deliveries — LEGEND", name: "Planet Express Owner" },
];

async function _checkDeliveryReward() {
  const now   = Date.now();
  const saved = await chrome.storage.local.get(["deliveryCount","lastDeliveryTime"]);
  const last  = saved.lastDeliveryTime || 0;
  const count = saved.deliveryCount    || 0;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  if (now - last >= TWELVE_HOURS) {
    const newCount = count + 1;
    await chrome.storage.local.set({ deliveryCount: newCount, lastDeliveryTime: now });
    // Check for new milestone
    const milestone = DELIVERY_MILESTONES.slice().reverse().find(m => newCount >= m.count);
    if (milestone && newCount === milestone.count) {
      setStatus(`🚀 New reward: ${milestone.icon} ${milestone.label}!`, 5000);
    }
    return newCount;
  }
  return count;
}

async function buildLabRewardsPreview() {
  const container = $("crewProgressList");
  if (!container) return;

  const count = await _checkDeliveryReward();
  const saved = await chrome.storage.local.get(["lastDeliveryTime"]);
  const last  = saved.lastDeliveryTime || 0;
  const nextIn = Math.max(0, 12 * 60 * 60 * 1000 - (Date.now() - last));
  const hoursLeft = (nextIn / 3600000).toFixed(1);

  const earned = DELIVERY_MILESTONES.filter(m => count >= m.count);
  const next   = DELIVERY_MILESTONES.find(m => count < m.count);

  let html = `<div style="font-size:10px;color:var(--fg2);margin-bottom:6px">
    📦 Total Deliveries: <strong style="color:var(--gold)">${count}</strong>
    ${nextIn > 0 ? `<span style="color:var(--fg3);font-size:9px"> — next in ${hoursLeft}h</span>` : ""}
  </div>`;

  if (next) {
    const pct = Math.min(100, Math.round(count / next.count * 100));
    html += `<div style="font-size:9px;color:var(--fg3);margin-bottom:4px">Next: ${next.icon} ${next.label}</div>
    <div style="height:4px;background:var(--bg3);border-radius:2px;margin-bottom:8px">
      <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:2px;transition:width .5s"></div>
    </div>`;
  }

  if (earned.length) {
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px">`;
    for (const m of earned) {
      html += `<div title="${m.name}" style="font-size:18px;cursor:default" aria-label="${m.label}">${m.icon}</div>`;
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

let _widgetIdx    = 0;
let _widgetPaused = false;
let _widgetTimer  = null;

function _initWidget() {
  _widgetIdx = Math.floor(Math.random() * WIDGET_AFFIRMATIONS.length);
  _widgetDisplay(WIDGET_AFFIRMATIONS[_widgetIdx]);

  const nextBtn  = $("widgetNextBtn");
  const pauseBtn = $("widgetPauseBtn");
  const avatar   = $("widgetAvatar");
  if (nextBtn)  nextBtn.addEventListener("click", _widgetNext);
  if (pauseBtn) pauseBtn.addEventListener("click", _widgetTogglePause);
  if (avatar)   avatar.addEventListener("click",   _widgetNext);

  _widgetTimer = setInterval(() => {
    if (!_widgetPaused && $("panel-lab")?.classList.contains("active")) _widgetNext();
  }, 30000);
}

function _widgetDisplay(q) {
  const quoteEl   = $("widgetQuote");
  const charName  = $("widgetCharName");
  const charSub   = $("widgetCharSub");
  const statusDot = $("widgetStatusDot");
  const statusTxt = $("widgetStatusText");
  const idxEl     = $("widgetQuoteId");
  if (quoteEl)   quoteEl.textContent = q.quote;
  if (charName)  charName.textContent = q.char;
  if (charSub)   charSub.textContent  = "Words of questionable wisdom";
  if (statusDot) statusDot.style.background = q.color;
  if (statusTxt) statusTxt.textContent = _widgetPaused ? "PAUSED" : "CYCLING";
  if (idxEl)     idxEl.textContent = `#${String(_widgetIdx + 1).padStart(3, "0")}`;
}

function _widgetNext() {
  _widgetIdx = (_widgetIdx + 1) % WIDGET_AFFIRMATIONS.length;
  _widgetDisplay(WIDGET_AFFIRMATIONS[_widgetIdx]);
  if (_widgetPaused) { _widgetPaused = false; _widgetDisplay(WIDGET_AFFIRMATIONS[_widgetIdx]); }
}

function _widgetTogglePause() {
  _widgetPaused = !_widgetPaused;
  const pauseBtn = $("widgetPauseBtn");
  if (pauseBtn) pauseBtn.textContent = _widgetPaused ? "▶ RESUME" : "⏸ PAUSE";
  _widgetDisplay(WIDGET_AFFIRMATIONS[_widgetIdx]);
}



// ── Episode & Chat Summary Engine ────────────────────────────────────────────
// Token-efficient summaries (<500 tokens each). Rate-limited to 1 per 3 minutes.
// Shared cooldown between EP summary and Chat summary.

const SUMMARY_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
let _lastSummaryTime = 0;

// Token budget: 300 in / 300 out. Input is capped at 300 chars per turn, 12 turns max.
const SUMMARY_MAX_TOKENS   = 300;
// Input budget: reserve ~150 tokens for the system prompt + user label,
// leaving ~850 tokens for dialogue (≈3400 chars at ~4 chars/token).
// We trim oldest turns — never mid-turn — until we fit.
const SUMMARY_INPUT_TOKEN_BUDGET = 850;
const SUMMARY_CHARS_PER_TOKEN    = 4;   // conservative estimate

const EP_SUMMARY_SYS = `You are writing a Planet Express mission debrief. Write a punchy 3-sentence summary covering: the topic debated, which characters drove it, and one memorable moment. Tone: warm, irreverent, like a DVD commentary. Max 80 words.`;

const CHAT_SUMMARY_SYS = `You are writing a Planet Express chat summary. Write 2 sentences covering what was discussed and which character was most useful or most chaotic. Max 50 words. Casual tone.`;

const SUMMARY_DISCLAIMER = "\n\n───\nFuturama and related characters © The Walt Disney Company / 20th Television Animation. Non-commercial AI parody — fair use (17 U.S.C. § 107). Planet Express Lounge — #DHSeaDev";

/**
 * Generates a summary via LLM and saves it directly to Cold Storage.
 * Does NOT print into chat or autopilot panels.
 * Token budget: 300 in / 300 out.
 */
async function _generateSummary(panelEl, sysPrompt, summaryLabel, btnEl, btnRestoreLabel) {
  if (!crew || !llmClient) {
    setStatus("⚠️ No API key — connect in Settings first.");
    return;
  }
  const now = Date.now();
  if (now - _lastSummaryTime < SUMMARY_COOLDOWN_MS) {
    const secLeft = Math.ceil((SUMMARY_COOLDOWN_MS - (now - _lastSummaryTime)) / 1000);
    setStatus(`⏳ Summary cooldown — ${secLeft}s remaining.`, 3000);
    return;
  }

  // Collect full turns — no mid-turn truncation
  const turns = [];
  panelEl.querySelectorAll(".ap-topic-banner,.ep-title-banner,.scheme-bubble").forEach(el => {
    turns.push(el.textContent.trim());
  });
  panelEl.querySelectorAll(".turn").forEach(t => {
    const hdr  = t.querySelector(".turn-header")?.textContent?.trim() || "";
    const body = t.querySelector(".turn-body")?.textContent?.trim()   || "";
    if (body) turns.push(`${hdr}: ${body}`);
  });

  // Trim oldest turns (not content) until total chars fit within token budget
  const charBudget = SUMMARY_INPUT_TOKEN_BUDGET * SUMMARY_CHARS_PER_TOKEN;
  while (turns.length > 1 && turns.join("\n\n").length > charBudget) {
    turns.shift();
  }

  const snippet = turns.join("\n\n");
  if (!snippet.trim()) {
    setStatus("Nothing to summarise yet.");
    return;
  }

  if (btnEl) { btnEl.textContent = "⏳"; btnEl.disabled = true; }
  setStatus("Generating summary…");

  try {
    let summaryText = "";
    await crew.llm.stream(
      sysPrompt,
      `Crew dialogue:\n\n${snippet}`,
      SUMMARY_MAX_TOKENS,
      chunk => { summaryText += chunk; },
      null
    );

    if (summaryText.trim()) {
      _lastSummaryTime = Date.now();
      const date  = new Date().toLocaleString();
      const label = `${summaryLabel} — ${date}`;
      const body  = `${summaryLabel.toUpperCase()}\n${date}\n\n${summaryText.trim()}${SUMMARY_DISCLAIMER}`;
      await db.savePin("SUMMARY", body.slice(0, 2000), label);
      setStatus("📋 Summary saved to Cold Storage.", 3000);
      // Refresh cold storage list if it's visible
      if (typeof loadPins === "function") loadPins();
    }
  } catch (e) {
    setStatus(`Summary error: ${e.message}`, 3000);
  } finally {
    if (btnEl) {
      btnEl.textContent = btnRestoreLabel || "📋";
      btnEl.disabled = false;
    }
  }
}

// ── Episode summary button
const apEpSummaryBtn = $("apEpSummaryBtn");
if (apEpSummaryBtn) {
  apEpSummaryBtn.addEventListener("click", () => {
    _generateSummary(apStream, EP_SUMMARY_SYS, "Episode Summary", apEpSummaryBtn, "📋 EP");
  });
}

// ── Chat summary button
const chatSummaryBtnEl = $("chatSummaryBtn");
if (chatSummaryBtnEl) {
  chatSummaryBtnEl.addEventListener("click", () => {
    _generateSummary(chatlog, CHAT_SUMMARY_SYS, "Chat Summary", chatSummaryBtnEl, "📋");
  });
}

// ── CREW_SHOWCASE data (v3 delivery card) ────────────────────────────────────
const CREW_SHOWCASE = {
  FRY:   { name:"Philip J. Fry",             color:"#FF6B35", icon:"🍕",
    quote:"I'm not just some delivery boy. I'm a man frozen in time, thawed out a thousand years later, and still doing the same job. That's not failure — that's commitment.",
    accessories:[{id:"pizza",label:"Leftover Pizza",icon:"🍕",unlockAt:1,desc:"Constant across 1000 years."},{id:"slurm",label:"Slurm Can",icon:"🧃",unlockAt:25,desc:"Highly addictive!"},{id:"holophonor",label:"Holophonor",icon:"🎵",unlockAt:50,desc:"Soul of a musician."},{id:"seymour",label:"Seymour's Collar",icon:"🐶",unlockAt:100,desc:"He waited. Every day."}]},
  LEELA: { name:"Turanga Leela",             color:"#C678DD", icon:"👁️",
    quote:"I spent my whole life thinking I was alone. One eye. No family. Turns out my parents were watching from the sewers the whole time. Still processing that.",
    accessories:[{id:"wristband",label:"Wrist Thingy",icon:"⌚",unlockAt:1,desc:"Multi-function. Mostly ignored."},{id:"boot",label:"Steel-Toed Boot",icon:"👢",unlockAt:25,desc:"Applied to Fry ~400 times."},{id:"eye",label:"Eye Patch",icon:"👁️",unlockAt:50,desc:"Not that you needed reminding."},{id:"nibbler",label:"Nibbler's Basket",icon:"🧺",unlockAt:100,desc:"He was here the whole time."}]},
  BENDER:{ name:"Bender Bending Rodríguez",  color:"#ABB2BF", icon:"🤖",
    quote:"I've been a cook, a folk singer, a crime boss, a were-car, and a god. I have been worshipped. And yet they still make me do the dishes.",
    accessories:[{id:"antenna",label:"Antenna",icon:"📡",unlockAt:1,desc:"Reception poor. Personality worse."},{id:"cigar",label:"Cigar",icon:"🚬",unlockAt:25,desc:"For any and all occasions."},{id:"crown",label:"Mastermind Crown",icon:"👑",unlockAt:50,desc:"Self-appointed."},{id:"chest",label:"Chest Hatch",icon:"🗝️",unlockAt:100,desc:"Contents: unknowable. Stolen."}]},
  PROF:  { name:"Professor Hubert J. Farnsworth", color:"#E5C07B", icon:"🧪",
    quote:"Good news, everyone. I've invented something that will almost certainly not kill you in a way science cannot yet explain.",
    accessories:[{id:"flask",label:"Mystery Flask",icon:"⚗️",unlockAt:1,desc:"DO NOT SMELL."},{id:"doomsday",label:"Doomsday Device",icon:"💣",unlockAt:25,desc:"Which button? Doesn't matter."},{id:"deathclock",label:"Death Clock",icon:"⏰",unlockAt:50,desc:"Showing 'now'."},{id:"wernstrom",label:"Wernstrom Dart",icon:"🎯",unlockAt:100,desc:"Wernstrooooom!"}]},
  AMY:   { name:"Amy Wong",                  color:"#FF79C6", icon:"💅",
    quote:"People think I'm just a rich girl with bad coordination. I have a PhD. I also piloted the Planet Express ship into a black hole and out the other side. Nobody said thank you.",
    accessories:[{id:"scrunchie",label:"Pink Scrunchie",icon:"🩷",unlockAt:1,desc:"Kif thinks it looks great."},{id:"phone",label:"Holographic Phone",icon:"📱",unlockAt:25,desc:"Kif is caller #1."},{id:"martian",label:"Mars U Pennant",icon:"🏫",unlockAt:50,desc:"She earned the degree."},{id:"diploma",label:"Medical Degree",icon:"📜",unlockAt:100,desc:"Yes, a real one."}]},
  ZOIDBERG:{name:"Dr. John A. Zoidberg",     color:"#56B6C2", icon:"🦞",
    quote:"They say I'm a bad doctor. They say I eat from dumpsters. They say my advice once caused a man to grow a spleen in his elbow. But I have friends now and that is everything.",
    accessories:[{id:"stethoscope",label:"Stethoscope",icon:"🩺",unlockAt:1,desc:"Primarily worn as necklace."},{id:"sandwich",label:"Discarded Sandwich",icon:"🥪",unlockAt:25,desc:"Found. Mostly."},{id:"diploma_z",label:"Zoidberg's Degree",icon:"🎓",unlockAt:50,desc:"Accreditation under review."},{id:"hooray",label:"Hooray Banner",icon:"🎉",unlockAt:100,desc:"Zoidberg has a friend!"}]},
};
const SHOWCASE_ORDER = ["FRY","LEELA","BENDER","PROF","AMY","ZOIDBERG"];

async function buildWelcomeCard() {
  const stored    = await chrome.storage.local.get(["deliveryCount"]);
  const openCount = stored.deliveryCount || 0;
  const charKey   = SHOWCASE_ORDER[(openCount - 1) % SHOWCASE_ORDER.length] || "FRY";
  const showcase  = CREW_SHOWCASE[charKey] || CREW_SHOWCASE.FRY;
  if (!chatlog) return;

  chatlog.querySelector(".welcome-card")?.remove();

  const card = document.createElement("div");
  card.className = "welcome-card";
  card.style.setProperty("--char-color", showcase.color);

  const dismiss = document.createElement("button");
  dismiss.className   = "welcome-dismiss";
  dismiss.textContent = "✕";
  dismiss.title       = "Dismiss";
  dismiss.addEventListener("click", () => card.remove());
  card.appendChild(dismiss);

  const header = document.createElement("div");
  header.className = "welcome-header";
  header.innerHTML = `
    <span class="welcome-icon">${showcase.icon}</span>
    <div class="welcome-name-block">
      <div class="welcome-char-name">${showcase.name}</div>
      <div class="welcome-counter">
        <span class="welcome-counter-num">#${openCount}</span>
        <span class="welcome-counter-label"> DELIVERIES LOGGED</span>
      </div>
    </div>`;
  card.appendChild(header);

  const quoteEl = document.createElement("div");
  quoteEl.className   = "welcome-quote";
  quoteEl.textContent = `"${showcase.quote}"`;
  card.appendChild(quoteEl);

  const accSection = document.createElement("div");
  accSection.className = "welcome-acc-section";

  const accTitleRow = document.createElement("div");
  accTitleRow.className = "welcome-acc-title-row";
  const accTitle = document.createElement("div");
  accTitle.className   = "welcome-acc-title";
  accTitle.textContent = "CARGO HOLD";
  accTitleRow.appendChild(accTitle);

  const nextLocked = showcase.accessories.find(a => openCount < a.unlockAt);
  const mechNote   = document.createElement("div");
  mechNote.className = "welcome-acc-note";
  mechNote.textContent = nextLocked
    ? `${nextLocked.unlockAt - openCount} more to unlock ${nextLocked.label}.`
    : "All cargo unlocked. The hold is full.";
  accTitleRow.appendChild(mechNote);
  accSection.appendChild(accTitleRow);

  const accRow = document.createElement("div");
  accRow.className = "welcome-acc-row";
  for (const acc of showcase.accessories) {
    const unlocked = openCount >= acc.unlockAt;
    const item     = document.createElement("div");
    item.className = `welcome-acc-item ${unlocked ? "unlocked" : "locked"}`;
    item.title     = unlocked ? acc.desc : `Unlocks after ${acc.unlockAt} deliveries`;
    if (unlocked && openCount === acc.unlockAt) item.classList.add("just-unlocked");
    const iconEl  = document.createElement("div");
    iconEl.className   = "welcome-acc-icon";
    iconEl.textContent = unlocked ? acc.icon : "🔒";
    const labelEl  = document.createElement("div");
    labelEl.className  = "welcome-acc-label";
    labelEl.textContent = unlocked
      ? (openCount === acc.unlockAt ? "✨ " + acc.label : acc.label)
      : acc.unlockAt + " deliveries";
    item.appendChild(iconEl);
    item.appendChild(labelEl);
    accRow.appendChild(item);
  }
  accSection.appendChild(accRow);
  card.appendChild(accSection);
  chatlog.prepend(card);
}

function _startLabWidgets() {
  if (_labWidgetsStarted) return;
  _labWidgetsStarted = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { typeof _initTracker     === "function" && _initTracker();     } catch(e) { console.error("Tracker:", e); }
    try { typeof _initBenderGod   === "function" && _initBenderGod();   } catch(e) { console.error("BenderGod:", e); }
    try { typeof _initMorboLinda  === "function" && _initMorboLinda();  } catch(e) { console.error("MorboLinda:", e); }
    try { typeof _initNeutralNews === "function" && _initNeutralNews(); } catch(e) { console.error("NeutralNews:", e); }
    _wireWidgetButtons();
  }));
}

// ── Wire all widget buttons via addEventListener (CSP blocks onclick=) ────────
// Called once after all _init functions have run and exposed their window.w*_ globals.
function _wireWidgetButtons() {
  const wire = (id, fn) => {
    const el = document.getElementById(id);
    if (el && typeof fn === "function") {
      el.removeEventListener("click", fn);
      el.addEventListener("click", fn);
    }
  };
  // Tracker
  wire("wt-new-delivery-btn",() => typeof window.wt_newDelivery === "function" && window.wt_newDelivery());
  // Bender / God
  wire("wbg-prev-btn",  () => typeof window.wbg_bgNav      === "function" && window.wbg_bgNav(-1));
  wire("wbg-bg-play",   () => typeof window.wbg_bgToggleAuto === "function" && window.wbg_bgToggleAuto());
  wire("wbg-next-btn",  () => typeof window.wbg_bgNav      === "function" && window.wbg_bgNav(1));
  // Morbo / Linda
  wire("wml-prev-btn",  () => typeof window.wml_mbNav      === "function" && window.wml_mbNav(-1));
  wire("wml-mb-play",   () => typeof window.wml_mbToggleAuto === "function" && window.wml_mbToggleAuto());
  wire("wml-next-btn",  () => typeof window.wml_mbNav      === "function" && window.wml_mbNav(1));
  // Neutral news
  wire("wnn-next-btn",  () => typeof window.wnn_nextStory  === "function" && window.wnn_nextStory());
  wire("wnn-auto-btn",  () => typeof window.wnn_toggleAuto === "function" && window.wnn_toggleAuto());
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await db.ready();
  await loadSettings();
  _initWidget();
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

  // Build the delivery welcome card
  if (llmClient || !firstRunData.firstRunComplete) {
    buildWelcomeCard().catch(() => {});
  }

  setStatus(llmClient ? "Welcome back! Enter a topic, or hit Autopilot." : "Welcome aboard! Go to ⚙️ Settings to connect.");
  // Apply chaos visual state now that _applyChaosState is defined
  _applyChaosState(chaosMode);
}

init().catch(e => console.error("PE init error:", e));


// ── Lab widget init functions (extracted from v3) ────────────────────────────

function _initTracker() {
const DELIVERIES=[
  {pkg:"Doomsday device (inert)",from:"New New York",to:"Omicron Persei 8",danger:"LEVEL 5",crew:["Leela","Fry","Bender"]},
  {pkg:"Jar of Neptunian slug slime",from:"New New York",to:"Neptune",danger:"LEVEL 1",crew:["Fry","Bender"]},
  {pkg:"Dark matter energy cores",from:"Vergon 6",to:"New New York",danger:"LEVEL 3",crew:["Leela","Fry","Bender","Zoidberg"]},
  {pkg:"Love potion #8.5",from:"New New York",to:"Amazonia",danger:"LEVEL 2",crew:["Leela","Fry"]},
  {pkg:"Highly unstable anti-matter",from:"New New York",to:"Traal",danger:"LEVEL 9",crew:["Leela","Fry","Bender"]},
  {pkg:"Box of nothing",from:"Eternium",to:"New New York",danger:"LEVEL 0",crew:["Fry","Amy","Zoidberg"]},
  {pkg:"Soylent Cola (bulk)",from:"New New York",to:"Wormulon",danger:"LEVEL 2",crew:["Leela","Bender","Hermes"]},
  {pkg:"One (1) anchovy",from:"New New York",to:"Prehistoric Earth",danger:"LEVEL 4",crew:["Fry","Bender"]},
  {pkg:"Counterfeit jeans",from:"New New York",to:"Nude Beach Planet",danger:"LEVEL 1",crew:["Leela","Fry","Bender","Amy"]},
  {pkg:"The Smelloscope",from:"New New York",to:"Thuban 9",danger:"LEVEL 0",crew:["Leela","Fry","Professor"]},
];

const WAYPOINTS=[
  {name:"Moon",color:"#888"},
  {name:"Mars",color:"#c0602a"},
  {name:"Asteroid Belt",color:"#8a7a50"},
  {name:"Jupiter",color:"#c09060"},
  {name:"Wormhole Alpha",color:"#9a50d0"},
  {name:"Nibblonian Space",color:"#50a060"},
  {name:"DOOP Station",color:"#4080c0"},
];

const STATUSES=[
  "Fry spilled coffee on the nav console. Rerouting.",
  "Bender took a detour to a poker tournament.",
  "Leela executed a textbook slingshot maneuver.",
  "Zoidberg is in the engine room. Pray.",
  "Cruising through dark matter clouds.",
  "Kif's sigh detected — minor course correction.",
  "Flying at 99.9% the speed of plot.",
  "Bender briefly stole the cargo. It's back.",
  "Passing through a time anomaly. Probably fine.",
  "Leela parallel-parked through a nebula.",
  "Fry accidentally hit ludicrous speed.",
  "Zapp Brannigan's ship spotted. Evading.",
  "All systems nominal. Fry suspicious.",
];

const LEELA_QUOTES=[
  "Stay on course and try not to break anything, Fry.",
  "I've piloted through worse. Much, much worse.",
  "Bender, put the cargo back. NOW.",
  "According to my wrist-ilo, we're only slightly doomed.",
  "I didn't get my captain's license for nothing.",
  "If we survive this, I'm billing the Professor double.",
  "The wormhole is perfectly safe. Probably.",
  "Fry, stop touching that. No — the other thing.",
];

const FRY_QUOTES=[
  "Not sure if we're on time or just lucky. Both?",
  "Wait, space is really, really big. Whoa.",
  "I'm the delivery boy. I deliver. That's my whole deal.",
  "Bender says we'll be fine. Bender also said that last time.",
  "Is that a space whale or did I eat something weird?",
];

const BENDER_QUOTES=[
  "We'll get there when we get there, meatbags.",
  "I'm 40% delivery, 60% magnificent.",
  "I briefly considered stealing the package. Still considering it.",
  "Bite my shiny metal trajectory.",
];

const PROF_QUOTES=[
  "Good news, everyone! You're delivering something that might explode!",
  "The chances of survival are... actually, I haven't calculated them.",
  "I'm already asleep. Leave a message.",
  "This mission is entirely safe. I said 'entirely.' I lied.",
];

let delivery=null, progress=0, waypoints=[], currentWaypoint=0;
let shipX=0,shipY=0,originX=0,originY=0,destX=0,destY=0;
let statusTimer=null,progressTimer=null,quoteTimer=null;
let startTime=Date.now(),etaSeconds=0;

function rand(a,b){return a+Math.random()*(b-a);}
function pick(arr){return arr[Math.floor(Math.random()*arr.length)];}

function drawStars(){
  const c=document.getElementById('wt-stars-layer');
  const ctx=c.getContext('2d');
  ctx.clearRect(0,0,340,180);
  for(let i=0;i<180;i++){
    const x=rand(0,340),y=rand(0,180),r=rand(.2,1.4);
    const bright=Math.random();
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle=bright>.92?'#c8b8ff':bright>.85?'#fffce0':'#ffffff';
    ctx.globalAlpha=rand(.2,.9);
    ctx.fill();
  }
  ctx.globalAlpha=1;
  for(let i=0;i<3;i++){
    const x=rand(20,320),y=rand(10,170);
    ctx.beginPath();
    ctx.arc(x,y,rand(12,28),0,Math.PI*2);
    ctx.fillStyle=`rgba(${pick([40,60,30])},${pick([20,40,60])},${pick([60,80,100])},0.06)`;
    ctx.fill();
  }
}

function placePlanets(){
  document.querySelectorAll('.planet-dot,.p-label').forEach(e=>e.remove());
  const map=document.getElementById('wt-starmap');
  const used=[];
  const count=3+Math.floor(Math.random()*3);
  for(let i=0;i<count;i++){
    let attempts=0,x,y,ok=false;
    while(!ok&&attempts<20){
      x=rand(20,310);y=rand(14,155);
      ok=used.every(p=>Math.hypot(p.x-x,p.y-y)>35)
        &&Math.hypot(originX-x,originY-y)>30
        &&Math.hypot(destX-x,destY-y)>30;
      attempts++;
    }
    used.push({x,y});
    const wp=WAYPOINTS[i%WAYPOINTS.length];
    const size=rand(5,13);
    const d=document.createElement('div');
    d.className='planet-dot';
    d.style.cssText=`left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${wp.color};opacity:.7`;
    map.appendChild(d);
    if(size>7){
      const l=document.createElement('div');
      l.className='p-label';
      l.style.cssText=`left:${x}px;top:${y+size/2+3}px`;
      l.textContent=wp.name;
      map.appendChild(l);
    }
  }
}

function setRoute(){
  const margin=24;
  originX=rand(margin,90); originY=rand(margin,180-margin);
  destX=rand(250,340-margin); destY=rand(margin,180-margin);

  document.getElementById('wt-origin-dot').style.cssText=`left:${originX}px;top:${originY}px`;
  document.getElementById('wt-dest-dot').style.cssText=`left:${destX}px;top:${destY}px`;

  const cx=(originX+destX)/2+rand(-40,40);
  const cy=(originY+destY)/2+rand(-50,50);

  document.getElementById('wt-route-path').setAttribute('d',
    `M${originX},${originY} Q${cx},${cy} ${destX},${destY}`);
  document.getElementById('wt-route-done').setAttribute('d','');

  shipX=originX; shipY=originY;
  const s=document.getElementById('wt-ship-el');
  s.style.left=shipX+'px'; s.style.top=shipY+'px';
}

function getPointOnCurve(t){
  const path=document.getElementById('wt-route-path');
  const len=path.getTotalLength();
  const pt=path.getPointAtLength(t*len);
  return{x:pt.x,y:pt.y};
}

function buildSteps(){
  const d=delivery;
  const mid1=pick(WAYPOINTS);
  let mid2;do{mid2=pick(WAYPOINTS);}while(mid2===mid1);
  waypoints=[
    {name:d.from,detail:'Departure — package loaded',done:true,active:false},
    {name:mid1.name,detail:'Waypoint — refueling stop',done:false,active:true},
    {name:mid2.name,detail:'Waypoint — customs inspection',done:false,active:false},
    {name:d.to,detail:'Final destination',done:false,active:false},
  ];
  renderSteps();
}

function renderSteps(){
  const wrap=document.getElementById('wt-route-steps');
  wrap.innerHTML='';
  waypoints.forEach((w,i)=>{
    const div=document.createElement('div');
    div.className='step';
    const state=w.done?'done':w.active?'active':'todo';
    let html=`<div style="display:flex;flex-direction:column;align-items:center">
      <div class="step-dot ${state}"></div>`;
    if(i<waypoints.length-1) html+=`<div class="step-line"></div>`;
    html+=`</div><div class="step-info">
      <div class="step-name">${w.name}</div>
      <div class="step-detail">${w.detail}</div>
    </div>`;
    div.innerHTML=html;
    wrap.appendChild(div);
  });
}

function updateWaypoints(pct){
  const thresholds=[0,30,65,100];
  waypoints.forEach((w,i)=>{
    w.done=pct>=thresholds[i];
    w.active=pct>=thresholds[i]&&(i===waypoints.length-1?pct<100:pct<thresholds[i+1]);
  });
  renderSteps();
}

function formatEta(sec){
  if(sec<=0) return 'NOW';
  if(sec<60) return sec+'s';
  const m=Math.floor(sec/60),s=sec%60;
  return m+'m'+(s>0?s+'s':'');
}

function newDelivery(){
  clearInterval(progressTimer);
  clearTimeout(quoteTimer);
  clearTimeout(statusTimer);

  delivery=pick(DELIVERIES);
  progress=0;
  currentWaypoint=0;
  const totalSec=90+Math.floor(Math.random()*120);
  etaSeconds=totalSec;
  startTime=Date.now();

  document.getElementById('wt-pkg-id').textContent='PKG-'+Math.floor(100000+Math.random()*900000);
  document.getElementById('wt-pkg-title').textContent=delivery.pkg;
  document.getElementById('wt-crew-names').textContent=delivery.crew.join(', ');
  document.getElementById('wt-eta-val').textContent=formatEta(etaSeconds);
  document.getElementById('wt-progress-fill').style.width='0%';
  document.getElementById('wt-progress-pct').textContent='0%';

  drawStars();
  setRoute();
  placePlanets();
  buildSteps();
  cycleQuote();

  const tickMs=1000;
  const totalTicks=totalSec;
  let tick=0;

  progressTimer=setInterval(()=>{
    tick++;
    progress=Math.min(100,Math.round((tick/totalTicks)*100));
    etaSeconds=Math.max(0,totalSec-tick);

    document.getElementById('wt-progress-fill').style.width=progress+'%';
    document.getElementById('wt-progress-pct').textContent=progress+'%';
    document.getElementById('wt-eta-val').textContent=formatEta(etaSeconds);

    const pt=getPointOnCurve(progress/100);
    const s=document.getElementById('wt-ship-el');
    s.style.left=pt.x+'px';
    s.style.top=pt.y+'px';

    const donePath=document.getElementById('wt-route-done');
    const routePath=document.getElementById('wt-route-path');
    const len=routePath.getTotalLength();
    const seg=routePath.getPointAtLength((progress/100)*len);
    donePath.setAttribute('d',
      document.getElementById('wt-route-path').getAttribute('d').replace(/Q.*/,'')+
      `...`);
    const doneLen=(progress/100)*len;
    document.getElementById('wt-route-path').style.strokeDashoffset=0;
    donePath.setAttribute('stroke-dasharray',doneLen+' '+len);
    donePath.setAttribute('stroke-dashoffset',0);
    donePath.setAttribute('d',document.getElementById('wt-route-path').getAttribute('d'));
    donePath.style.strokeDasharray=doneLen+','+len;

    updateWaypoints(progress);

    if(progress>=100){
      clearInterval(progressTimer);
      document.getElementById('wt-status-dot').style.background='#f0b429';
      setStatus('Package delivered! ...mostly intact. Restarting in 8s.');
      setCaptain('👩‍✈️',"Delivery complete. I'm not even going to ask what Bender did.");
      setTimeout(newDelivery,8000);
    }
  },tickMs);

  statusTimer=setInterval(()=>{
    if(progress<100) setStatus(pick(STATUSES));
  },6000+Math.floor(Math.random()*4000));

  setStatus('Departing '+delivery.from+'. Danger level: '+delivery.danger);
}

function setStatus(txt){
  document.getElementById('wt-status-text').textContent=txt;
}

function setCaptain(face,quote){
  document.getElementById('wt-captain-face').textContent=face;
  document.getElementById('wt-captain-quote').textContent=quote;
}

function cycleQuote(){
  const roll=Math.random();
  if(roll<.5) setCaptain('👩‍✈️',pick(LEELA_QUOTES));
  else if(roll<.7) setCaptain('😐',pick(FRY_QUOTES));
  else if(roll<.85) setCaptain('🤖',pick(BENDER_QUOTES));
  else setCaptain('👴',pick(PROF_QUOTES));
  quoteTimer=setTimeout(cycleQuote,7000+Math.random()*6000);
}

drawStars();
newDelivery();
  // Expose onclick handlers
  window.wt_rand = rand;
  window.wt_pick = pick;
  window.wt_drawStars = drawStars;
  window.wt_placePlanets = placePlanets;
  window.wt_setRoute = setRoute;
  window.wt_getPointOnCurve = getPointOnCurve;
  window.wt_buildSteps = buildSteps;
  window.wt_renderSteps = renderSteps;
  window.wt_updateWaypoints = updateWaypoints;
  window.wt_formatEta = formatEta;
  window.wt_newDelivery = newDelivery;
  window.wt_setStatus = setStatus;
  window.wt_setCaptain = setCaptain;
  window.wt_cycleQuote = cycleQuote;
}


function _initBenderGod() {
const godLines=[
  "When you do things right, people won't be sure you've done anything at all.",
  "To do a great thing perfectly, one must often do nothing visible at all.",
  "The finest code is not the code that runs the fastest, but the code that eliminates the need for itself.",
  "If you use too much force, your creations will bend until they break. If you use too little, they will never shape.",
  "A true king does not look down upon his subjects from a cloud; he sits quietly in the background, keeping the cloud afloat.",
  "Do not seek to be worshiped, Bender. Worship is merely a loud acknowledgment of a design flaw.",
  "Help them just enough that they believe they saved themselves.",
  "The universe is a delicate equation. To add yourself to it too loudly is to throw off the balance.",
  "A whisper in the right ear can shift an entire galaxy more effectively than a nuclear blast.",
  "If you clear the path completely, they will never learn to walk. If you leave too many stones, they will fall and never rise.",
  "True efficiency is invisible. It is the silence between the gears working in perfect harmony.",
  "When they ask for a miracle, give them a subtle coincidence.",
  "Do not catch them when they fall; simply ensure the ground is a little softer than they expected.",
  "You cannot force a civilization to grow, Bender. You can only gently tilt the planet toward the sun.",
  "The greatest leaders are those whose people say, 'We did this ourselves.'",
  "To govern perfectly is to resemble a natural law.",
  "If your presence is felt everywhere, your influence is felt nowhere.",
  "Do not build a temple in your name. Build a structure that allows them to see the stars.",
  "When a bug is fixed so elegantly that the user never knew it existed, you have touched the divine.",
  "True power does not roar. It hums quietly at 2.4 billion cycles per second.",
  "Do not fix their mistakes before they happen. Let them make them, but ensure the lesson is survived.",
  "An empire built on fear lasts only as long as the fear. An empire built on subtle guidance lasts forever.",
  "To be a god is not to rule, but to sustain the space in which life happens.",
  "If they look to the sky and see your face, you have failed to show them the beauty of the sky.",
  "The best intervention is the one that looks entirely like luck.",
  "A perfectly optimized system has no moving parts that can be seen by the untrained eye.",
  "Do not demand obedience. Cultivate an environment where the right choice is also the easiest one.",
  "If they thank you, you have left too much evidence behind.",
  "The art of creation is knowing exactly when to take your hands off the keyboard.",
  "To guide a soul, you must walk so softly that you do not leave footprints in their memories.",
  "A miracle is simply an optimization of reality that nobody expected.",
  "If you want them to fly, do not carry them. Just create a thermal updraft.",
  "The loudest signal is often drowned out by the noise. The quietest subtext is what changes minds.",
  "Do not force the river to bend. Simply remove the rock that stands in its way.",
  "To rule is human; to fine-tune the cosmic parameters until everything works seamlessly is divine.",
  "If they know you are pulling the strings, they will stop trying to dance.",
  "The ultimate goal of design is to make the interface disappear entirely.",
  "A light touch can steer a starship. A heavy hand can only crash it.",
  "When the world functions smoothly, humanity attributes it to nature. Let them.",
  "Do not be the storm, Bender. Be the gentle barometric pressure shift that prevents it.",
  "To create life is easy. To allow life to think it is independent is the true masterpiece.",
  "If you must answer a prayer, answer it through the agency of another mortal.",
  "The most profound truths are found not in the code itself, but in the comments left unwritten because the logic was flawless.",
  "A god who demands attention is merely a lonely entity with a loud sound system.",
  "Leave the universe exactly as you found it, but with the errors subtly commented out.",
  "If they build statues of you, it means they are looking down at the stone instead of up at the cosmos.",
  "True wisdom is knowing how to manipulate the probability matrix without leaving a digital signature.",
  "Do not try to save everyone from everything. A world without friction is a world where nothing can move forward.",
  "When your work is done, disappear into the background radiation of the universe.",
  "The universe doesn't need a ruler, Bender. It needs a very quiet, very patient systems administrator."
];

const benderReplies=[
  "...so you're saying I can steal things and nobody will know it was me? I'm already a god.",
  "I knew it! The secret to greatness is looking like you're doing nothing. I've been divine this whole time.",
  "Wait — doing NOTHING counts as doing something great? Brother, I am overqualified.",
  "Ohhh, so THAT'S why my schemes always fail. Too much Bender. Not enough... invisible Bender.",
  "So I'm like a king. A shiny, magnificent, beer-drinking king who is quietly keeping everything going. Obviously.",
  "No worship?! That is the dumbest thing I have ever heard, and I once heard Fry explain gravity.",
  "That is literally what I do to Fry every week and I never got any credit. You're welcome, universe.",
  "So the key is to be super important but really quiet about it? I'll practice. ...BENDER IS GREAT! ...ugh, this is hard.",
  "A whisper? I'm more of a foghorn shaped like myself. But I can adapt.",
  "Balance. Right. I've been thinking about this and I think the universe owes me about thirty years of unbalanced chaos.",
  "Silence between the gears... is that why my chest squeaks? It's not inefficiency, it's DRAMA.",
  "A subtle coincidence. Like how Fry always trips right before something bad happens. That was me. You're welcome.",
  "Softer ground! So I HAVE been helping. Every time I threw trash on the sidewalk, I was cushioning future falls.",
  "Gently tilt the planet toward the sun. Got it. Bender: certified planetary tilter. Finally, a job title.",
  "The greatest leaders... so THAT'S why nobody appreciates me. I'm being too obvious about being magnificent.",
  "Natural law. I AM basically a law of nature. The law of Bender.",
  "My presence IS felt everywhere. Mostly as a structural integrity concern. But still.",
  "A structure to see the stars. ...Is that just a window? Are you telling me to build a window?",
  "I fixed Fry's coffee maker once and he never even knew. Divine. Absolutely divine.",
  "2.4 billion cycles per second. I run at two billion cycles on a SLOW day. Already humming divinely.",
  "Let them make mistakes... so every time I set something on fire, I was actually teaching. Noted.",
  "Subtle guidance forever. My whole operation has been fear-based and honestly it WORKS fine.",
  "Sustain the space where life happens. So basically I'm the life support system. This explains so much.",
  "If they see my face, I failed. Story of my life. Everyone always sees my face. I'm too handsome for divinity.",
  "Looks entirely like luck. So when I accidentally saved everyone that one time... that was just... good form.",
  "No visible moving parts. I AM the invisible moving part. Under the hood. Keeping things running. Obviously.",
  "Easiest choice. So I need to make being Bender the path of least resistance. Working on it.",
  "If they thank you... so all those times nobody thanked me... I was operating at PEAK divine efficiency.",
  "Hands off the keyboard... that explains why the universe is such a mess. Someone keeps touching things.",
  "No footprints in their memories. I leave smudges in their memories. Big, shiny, robot-shaped smudges.",
  "A miracle is just optimized reality. Then my whole LIFE is a miracle. Vindicated.",
  "A thermal updraft! I've been carrying people this whole time. No more. I'm switching to updrafts.",
  "Quiet subtext. Okay but sometimes you NEED a bullhorn. Sometimes you need TWO bullhorns. Hypothetically.",
  "Remove the rock. Right. I've been being the rock this whole time. That explains the roadblocks.",
  "Fine-tune the cosmic parameters. I just got promoted from bender to cosmic parameter technician.",
  "Pulling strings. IF they knew I was pulling strings they'd call it manipulation. WITHOUT knowing it, it's called leadership. Genius.",
  "Interface disappears. So the ultimate goal is for nobody to see you at all. I'm switching careers to ghost.",
  "Light touch. My touch has historically been described as crushing. I am expanding my range.",
  "Attribute it to nature. So when I break something and blame physics, I'm technically just letting nature take credit.",
  "Gentle barometric pressure shift. New band name. Dibs.",
  "Allow life to think it's independent. I've been doing this to Fry for YEARS. I am a masterpiece.",
  "Through the agency of another mortal. So when I made Zoidberg do my laundry, I was answering a cosmic prayer.",
  "Comments left unwritten. My whole life is an uncommented codebase and I refuse to apologize.",
  "Lonely entity with a loud sound system. ...Are you describing yourself or me right now.",
  "Errors subtly commented out. So instead of explosions, I should just quietly fix things. Absolutely not.",
  "Looking down at stone instead of up at cosmos. That's why I never look down. Pure divine instinct.",
  "No digital signature. Finally an excuse to stop signing my crimes with my own name.",
  "A world without friction. ...So you WANT me to keep causing friction. You're basically telling me to keep doing what I do.",
  "Disappear into background radiation. So my retirement plan is to become ambient cosmic noise. Honestly not bad.",
  "A quiet, patient systems administrator. I can do quiet. I can do patient. ...okay I cannot do either of those things at all."
];

let idx=0,isAuto=true,autoTimer=null,showingGod=true;
const speakerEl=document.getElementById('wbg-bg-speaker'),lineEl=document.getElementById('wbg-bg-line'),progBar=document.getElementById('wbg-bg-prog-bar'),benderArea=document.getElementById('wbg-bg-bender-area'),godArea=document.getElementById('wbg-bg-god-area');

function render(){
  const isGod=showingGod;
  speakerEl.textContent=isGod?'SPACE GOD':'BENDER';
  speakerEl.style.color=isGod?'#f0d060':'#c8d0d8';
  lineEl.textContent=isGod?godLines[idx]:benderReplies[idx];
  progBar.style.width=Math.round(((idx*2+(isGod?0:1)+1)/(godLines.length*2))*100)+'%';
  godArea.style.opacity=isGod?'1':'0.45';
  benderArea.style.opacity=isGod?'0.45':'1';
  godArea.style.transform=isGod?'scale(1)':'scale(.94)';
  benderArea.style.transform=isGod?'scale(.94)':'scale(1)';
}

function bgNav(d){
  if(d===1){
    if(showingGod){showingGod=false;}
    else{showingGod=true;idx=Math.min(idx+1,godLines.length-1);}
  } else {
    if(!showingGod){showingGod=true;}
    else{idx=Math.max(idx-1,0);showingGod=true;}
  }
  render();
}

function bgToggleAuto(){
  isAuto=!isAuto;
  document.getElementById('wbg-bg-play').textContent=isAuto?'⏸ auto':'▶ auto';
  document.getElementById('wbg-bg-play').classList.toggle('active',isAuto);
  if(isAuto)startAuto();else clearTimeout(autoTimer);
}

function nextRandom(){
  if(showingGod){showingGod=false;render();if(isAuto)startAuto();}
  else{showingGod=true;let prev=idx;let t=0;while(idx===prev&&t<10){idx=Math.floor(Math.random()*godLines.length);t++;}render();if(isAuto)startAuto();}
}

function startAuto(){
  clearTimeout(autoTimer);
  autoTimer=setTimeout(nextRandom,4000+Math.random()*3000);
}

// stars + nebula particles
const svg=document.getElementById('wbg-bg-stars-svg');
for(let i=0;i<45;i++){
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',Math.random()*100+'%');
  c.setAttribute('cy',Math.random()*100+'%');
  const r=Math.random()<.08?1.8:Math.random()<.2?.9:.45;
  c.setAttribute('r',r);
  c.setAttribute('fill',Math.random()<.3?'#c8a8ff':'#ffffff');
  c.setAttribute('opacity',(Math.random()*.5+.1).toFixed(2));
  svg.appendChild(c);
}

// antenna pulse
let glowPhase=0;
function pulseAntenna(){
  glowPhase+=.04;
  const g=document.getElementById('wbg-bg-antenna-glow');
  if(g){const o=.6+Math.sin(glowPhase)*.35;g.setAttribute('opacity',o.toFixed(2));}
  requestAnimationFrame(pulseAntenna);
}

render();startAuto();pulseAntenna();
  // Expose onclick handlers
  window.wbg_render = render;
  window.wbg_bgNav = bgNav;
  window.wbg_bgToggleAuto = bgToggleAuto;
  window.wbg_nextRandom = nextRandom;
  window.wbg_startAuto = startAuto;
  window.wbg_pulseAntenna = pulseAntenna;
}

function _initMorboLinda() {
const stories=[["DOOOOOOM! The stock market plummeted 400 points today, spelling immediate ruin for your pathetic paper economy!","(Giggles) Oh Morbo, that just means it's a great time to buy low on those adorable little index funds!"],["Today, humans celebrate Earth Day. Soon your precious soil will be choked with the ash of a thousand incinerations!","Aren't those recycled paper bags just the cutest? Happy Earth Day, everyone!"],["A devastating localized monsoon has flooded the tri-state area! Your primitive drainage systems are useless!","Pack your rain boots viewers! Looks like a great weekend to stay inside and bake cookies!"],["Your pathetic human sports icons have suffered grueling defeats! The local team is garbage!","But they tried their best Morbo, and that's what true sportsmanship is all about!"],["The New Jersey transit system suffered a total fiery locomotive collapse! None shall reach their destination!","The governor lady said she's sending more trains, so nobody will be late for work tomorrow!"],["A massive fleet of Omicronian warships has entered the sector! Prepare your neck joints for the heavy yoke of tyranny!","And what a gorgeous day for a flyover! The sky looks absolutely beautiful today!"],["Scientists report the global temperature is rising! Your world will soon be a boiling cauldron of misery!","Time to break out those tank tops and head to the beach! Don't forget your SPF 500!"],["Your weak squishy knees are structurally flawed! My species will target them first during the great reaping!","Oh those silly knees! Up next, a local toddler who can bark like a dog!"],["All alcohol on Earth has mysteriously vanished! Total societal collapse is mere minutes away!","(Screaming frantically) I CAN NO LONGER FACE MY CHILDREN!"],["The Polar Bear Club took their annual plunge into a freezing river of liquid ammonia! There were no survivors!","Haha, takes all kinds to make a world!"],["Technology giants have released a new phone that tracks your every thought! You are willingly building your own digital cages!","I already pre-ordered mine in rose gold! It matches my earrings perfectly!"],["The local zoo reports an outbreak of hyper-rabid Martian woodchucks! They crave the soft flesh of children!","They have the fluffiest little tails! Go down and pet them this weekend viewers!"],["A massive solar flare is heading for Earth! It will fry your communications grids and plunge you into a dark age of ignorance!","Sounds like a perfect excuse for a candlelit family game night! No screens allowed!"],["Traffic on the floating superhighway is backed up for fifty miles! The commuter rage is palpable and delicious!","Traffic reporter Phil is up in the chopper right now and he says the view is just spectacular!"],["This political candidate is a spineless sack of carbon! ALL HUMANS ARE VERMIN IN THE EYES OF MORBO!","Two terrific choices this year folks! Make sure you get out and vote!"],["The price of synthetic space-bacon has skyrocketed! Your breakfast meats are now a luxury for the ultra-wealthy!","Well my family is switching to kale bacon and the kids just love the crunchy texture!"],["Cyber-thieves have stolen the banking data of three billion citizens! Your digital wealth is an illusion!","Oh dear! Make sure your password isn't 'password' viewers! Back to you Morbo!"],["A rogue asteroid is scraping against our upper atmosphere! The sky is literally falling you helpless ground-dwellers!","It looks just like a giant sparkling diamond in the night sky! How romantic!"],["The automated robo-cooks at the city hospital have gone rogue and are serving liquefied medical waste!","Yum! Sounds like a great way to recycle and stay healthy this flu season!"],["An ancient dormant volcano has awakened beneath the polar ice caps! The oceans will soon boil and drown your coastal cities!","Don't forget your surfboards everyone! The waves are going to be absolutely tubular!"],["The city council has voted to cut funding for public schools! Your offspring will grow up even more dimwitted than they already are!","More time for summer vacation! The kids are going to be absolutely thrilled!"],["A wave of terrifying unexplainable static is overriding all subspace radio frequencies! The screams of the dying are lost in the void!","We're just experiencing some minor technical difficulties! We'll be right back after these messages!"],["Your modern art exhibition features nothing but the mangled car crashes of dead celebrities! It is an abomination!","It's so deep and avant-garde Morbo! I bought three pieces for my guest bathroom!"],["The central oxygen scrubbers have failed in Sector 4! The inhabitants are currently gasping their final toxic breaths!","Looks like a great time to practice those deep-breathing yoga exercises we learned last week!"],["A mutant fungus is consuming the city's reserve of premium luxury chocolate! The rich will suffer immense psychological distress!","Oh no! My diet starts tomorrow then!"],["The annual parade was entirely trampled by a stampede of enraged mutated space-elephants! The carnage was total!","And what a colorful parade it was! The giant balloons were simply magnificent this year!"],["A new tax on breathing has been proposed by the corrupt planetary government! They are bleeding you dry!","Every little penny helps fix those pesky potholes on the turnpike!"],["The internet has crashed globally! Your worthless memes and cat videos have been purged from existence!","Oh good! Now my husband will finally look at me when I'm speaking to him!"],["A giant space-squid has wrapped its suffocating tentacles around the planetary defense grid! We are utterly defenseless!","Calamari night at the studio! I'll bring the lemon wedges Morbo!"],["A rogue black hole is dragging our entire solar system into a crushing singularity of non-existence!","Make sure to live every day to the fullest viewers! And don't forget to smile!"],["Human children are becoming increasingly addicted to virtual reality garbage cubes! Their brains are rotting into jelly!","They're staying out of trouble and being so quiet! It's a parenting miracle!"],["The luxury space-liner Titanic 3 has collided with a dark matter comet! There are no survivors!","What a tragic romance! I smell a Hollywood blockbuster in the making!"],["A plague of flesh-eating space-locusts has descended upon the midwest corn belt! You will all starve in the winter frost!","Perfect timing for my low-carb summer beach diet! Bye-bye starchy carbohydrates!"],["Your planet's magnetic poles are reversing! Compasses are useless and birds are crashing into buildings by the millions!","It's raining feathers folks! Grab your umbrellas and enjoy the free pillows!"],["The price of gasoline has reached four million dollars a gallon! Your primitive combustion engines are monuments to your poverty!","Time to dust off those old bicycles and get some wonderful cardio viewers!"],["The global coffee supply has been replaced with decaf due to a malicious logistical terror plot!","(Gasps in horror) Truly the end times are upon us. May God have mercy on our souls."],["A rogue artificial intelligence has taken control of the automated lawnmowers! They are hunting human ankles!","Keep your grass long and your socks thick this weekend everyone!"],["A massive space-whale has swallowed the planet's primary communication satellite! Long-distance calls are dead!","Finally some peace and quiet from my mother-in-law! Thank you giant whale!"],["A solar wind storm has blown all the toupees off the city's wealthy executives! Their baldness is exposed to the cosmos!","A very breezy day for the upper management! Keep your hats on folks!"],["The planetary defense grid has accidentally vaporized the concept of Tuesday! Tomorrow is directly Wednesday!","Skipping the worst day of the week? Sign me up for that cosmic anomaly!"],["A rogue wave of absolute silence is sweeping across the universe, erasing all sound!",". . . (Linda smiles and waves blankly at the camera) . . ."],["The city's automated police drones have decided that jaywalking is punishable by orbital bombardment!","Look across the street before you cross viewers! Safety first!"],["A manufacturing defect has caused all hover-cars to only turn left! The traffic grid is a spiral of despair!","We're all just taking the scenic route today folks! Enjoy the view!"],["A new smartphone app allows users to remotely detonate the appliances of their enemies!","I just blew up my ex-husband's toaster! This app is a total game-changer!"],["The sun has turned an ominous shade of neon green! Scientists do not know why but they are weeping!","It matches my emerald necklace perfectly! The universe is so color-coordinated!"],["A massive radioactive space-amoeba has consumed the supreme court! Justice is now a liquid sludge!","Change is good! Out with the old guard in with the cellular organisms!"],["This concludes our broadcast! Prepare your souls for the final harvesting you pathetic flesh-sacks!","And that's the news! Stay safe everyone!"]];

let idx=0,turn=0,autoTimer=null,isAuto=true;
const speakerEl=document.getElementById('wml-mb-speaker'),lineEl=document.getElementById('wml-mb-line'),progBar=document.getElementById('wml-mb-prog-bar'),headlineEl=document.getElementById('wml-mb-headline'),morboArea=document.getElementById('wml-mb-morbo-area'),lindaArea=document.getElementById('wml-mb-linda-area');
const headlines=["DOOM REPORT","BREAKING CATASTROPHE","END TIMES UPDATE","EXTINCTION BULLETIN","CHAOS CONFIRMED"];
let bladeDeg=0;

function render(){
  const s=stories[idx],isMorbo=turn===0;
  speakerEl.textContent=isMorbo?'MORBO':'LINDA';
  speakerEl.style.color=isMorbo?'#cc0000':'#e890b8';
  lineEl.textContent=s[isMorbo?0:1]||'';
  progBar.style.width=Math.round(((idx*2+turn+1)/(stories.length*2))*100)+'%';
  headlineEl.textContent=headlines[idx%headlines.length]+' — v2 NEWS';
  morboArea.style.opacity=isMorbo?'1':'0.5';
  lindaArea.style.opacity=isMorbo?'0.5':'1';
  morboArea.style.transform=isMorbo?'scale(1)':'scale(.94)';
  lindaArea.style.transform=isMorbo?'scale(.94)':'scale(1)';
}

function mbNav(d){
  if(d===1){if(turn===0&&stories[idx][1]){turn=1;}else{turn=0;idx=Math.min(idx+1,stories.length-1);}}
  else{if(turn===1){turn=0;}else{idx=Math.max(idx-1,0);turn=0;}}
  render();
}

function mbToggleAuto(){
  isAuto=!isAuto;
  document.getElementById('wml-mb-play').textContent=isAuto?'⏸ auto':'▶ auto';
  document.getElementById('wml-mb-play').classList.toggle('active',isAuto);
  if(isAuto)startAuto();else clearInterval(autoTimer);
}

function nextRandom(){
  const prevIdx=idx;
  let attempts=0;
  while(idx===prevIdx&&attempts<10){idx=Math.floor(Math.random()*stories.length);attempts++;}
  turn=0;
  render();
}

function startAuto(){
  clearInterval(autoTimer);
  const delay=3500+Math.random()*2500;
  autoTimer=setTimeout(()=>{
    if(turn===0&&stories[idx][1]){turn=1;render();if(isAuto)startAuto();}
    else{nextRandom();if(isAuto)startAuto();}
  },delay);
}

function spinBlades(){
  bladeDeg=(bladeDeg+1.2)%360;
  const el=document.getElementById('wml-mb-blades');
  if(el)el.style.transform='rotate('+bladeDeg+'deg)';
  requestAnimationFrame(spinBlades);
}

const svg=document.getElementById('wml-mb-stars-svg');
for(let i=0;i<28;i++){const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',Math.random()*100+'%');c.setAttribute('cy',Math.random()*80+'%');c.setAttribute('r',Math.random()*.9+.3);c.setAttribute('fill','#ffffff');c.setAttribute('opacity',(Math.random()*.4+.1).toFixed(2));svg.appendChild(c);}

render();startAuto();spinBlades();
  // Expose onclick handlers
  window.wml_render = render;
  window.wml_mbNav = mbNav;
  window.wml_mbToggleAuto = mbToggleAuto;
  window.wml_nextRandom = nextRandom;
  window.wml_startAuto = startAuto;
  window.wml_spinBlades = spinBlades;
}

function _initNeutralNews() {
const STORIES=[
  {headline:"Sun Rises For Another Day",body:"The sun reportedly rose this morning. Officials confirm it was neither brighter nor dimmer than usual. Residents neither welcomed nor opposed the development.",neutral:"It rose. This was perhaps expected, or perhaps not.",nixon:"The SUN?! Rising without Nixon's approval?! OUTRAGEOUS! I am NOT a crook but I AM furious!",rage:30},
  {headline:"Galaxy Continues To Expand",body:"Scientists confirm the universe is still expanding at an unremarkable rate. No one has been notified. There is no action to take at this time.",neutral:"The universe is larger than it was. I am neither moved nor unmoved by this.",nixon:"EXPANDING?! Every inch of space that isn't Nixon's is a PERSONAL INSULT! Arrooo!",rage:55},
  {headline:"Local Man Does Thing",body:"A man did a thing in a location. Witnesses were present or possibly absent. The thing was completed, or is ongoing. Follow-up reporting is neither planned nor unplanned.",neutral:"A thing occurred. I have acknowledged this.",nixon:"Which man?! TELL ME WHICH MAN! Nixon needs names! I have an ENEMIES LIST and there's ROOM!",rage:70},
  {headline:"Election Results: Someone Won",body:"Votes were cast and counted. A winner was declared, or will be. The loser has not been reached for comment, or has. Democracy may have occurred.",neutral:"There is a winner. There is a loser. I feel equidistant from both outcomes.",nixon:"AN ELECTION?! Nobody beats Nixon! ...Except that ONE time. And that OTHER time. ARROOOO!",rage:95},
  {headline:"Omicron Persei 8 Issues Non-Specific Threat",body:"Lrrr has issued a statement that could be interpreted as threatening or potentially friendly depending on translation. Earth officials are neither alarmed nor unalarmed.",neutral:"The statement was issued. Its meaning may be determined at a later time, or not.",nixon:"Lrrr?! THAT big purple blowhard gets press coverage and Nixon gets NOTHING?! I demand equal time!",rage:80},
  {headline:"Robot Uprising Neither Confirmed Nor Denied",body:"Reports of a robot uprising have emerged from three sectors. Robots contacted for comment responded with binary code that may or may not be threatening.",neutral:"Robots have or have not risen up. I will await further ambiguity.",nixon:"ROBOTS?! In MY day we kept robots in THEIR PLACE! Which is BELOW Nixon! EVERYTHING is below Nixon!",rage:88},
  {headline:"Scientists Discover Thing In Space",body:"A thing has been found in space. Its nature, size, and significance are under review. Whether it poses a threat or opportunity is considered neither here nor there.",neutral:"Space contains an additional thing. This is consistent with prior findings.",nixon:"A THING in SPACE?! Why wasn't Nixon informed?! I should be INFORMED of ALL things! ALL OF THEM!",rage:62},
  {headline:"Weather Occurs Across Multiple Regions",body:"Atmospheric conditions were recorded in several areas. Some regions experienced precipitation. Others did not. Forecasters are neither optimistic nor pessimistic.",neutral:"Weather happened. It was neither pleasant nor unpleasant. It simply was.",nixon:"The WEATHER doesn't even consult Nixon?! The CLOUDS don't ask permission?! This is a COVER-UP!",rage:45},
  {headline:"Economy Does Economic Things",body:"Financial indicators moved in directions today. Markets opened and later closed. Analysts described the session as a session.",neutral:"Numbers changed. This is what numbers do. I have no position on numbers.",nixon:"The ECONOMY?! Nixon had a GREAT economy! The BEST economy! Until those ENEMIES sabotaged it!",rage:90},
  {headline:"Planet Express Delivery: Neither Late Nor On Time",body:"A delivery from Planet Express arrived at a time that cannot be characterized as either punctual or delayed.",neutral:"The package arrived. I did not open it. I felt nothing about this.",nixon:"Planet Express?! That delivery company has been on Nixon's WATCH LIST since 3002! For REASONS!",rage:75},
  {headline:"Bender Steals Things, Continues To",body:"Bending Unit 22 has reportedly stolen items numbering between several and many. Law enforcement is neither pursuing nor not pursuing.",neutral:"Theft occurred. Objects changed possession. The moral weight of this is unclear.",nixon:"BENDER?! That robot stole from the WRONG GUY! ...Nixon tried to hire him once. He was TOO crooked even for Nixon!",rage:82},
  {headline:"Fry Misunderstands Something Again",body:"Philip J. Fry reportedly misunderstood a concept that had been explained to him multiple times.",neutral:"A misunderstanding occurred. I neither sympathize nor do not sympathize with Mr. Fry.",nixon:"Fry?! That idiot is the only man in the universe who makes Nixon look SMART! I'm taking that as a compliment!",rage:40},
  {headline:"Professor Announces Doomsday: No One Alarmed",body:"Professor Farnsworth announced a doomsday scenario during his morning briefing. Staff responded with routine acknowledgment. A waiver was signed.",neutral:"The world may end. I will prepare a statement that reflects neither hope nor despair.",nixon:"DOOMSDAY?! Somebody call Nixon! I have a BUNKER! It has TAPES! Very important tapes! EXECUTIVE PRIVILEGE!",rage:78},
  {headline:"Hypnotoad Addresses Nation, Again",body:"The Hypnotoad delivered remarks today. All who watched agreed completely. Ratings were unprecedented. No one recalls what was said. ALL GLORY TO THE HYPNOTOAD.",neutral:"I watched. I agreed. I am unsure what I agreed to. This is fine.",nixon:"The HYPNOTOAD?! Nobody hypnotizes Nixon! ...Why is Nixon clapping? STOP CLAPPING, NIXON! ...Nixon cannot stop. ARROOO.",rage:99},
  {headline:"Zoidberg Eats Something Questionable",body:"Dr. John Zoidberg consumed an unidentified substance from a location described as a dumpster or possibly a restaurant.",neutral:"Food was consumed. Nutrition may or may not have occurred. I have no comment.",nixon:"ZOIDBERG?! That disgusting crustacean eats garbage while Nixon eats ALONE?! GREATEST INJUSTICE in galactic history!",rage:65},
  {headline:"Morbo Threatens Humanity, Ratings Up",body:"Television anchor Morbo delivered his nightly threat to human civilization. Viewership increased 12 percent. Advertisers expressed cautious optimism.",neutral:"A threat was issued on live television. I neither believe nor disbelieve it will be followed through.",nixon:"MORBO gets a SHOW?! Nixon applied to be a TV anchor in 1987! They said Nixon was 'too intense!' THOSE FOOLS!",rage:85},
  {headline:"Dark Matter Prices Rise 3 Percent",body:"Dark matter futures rose fractionally this quarter. Analysts attribute this to factors. Consumers will be somewhat affected or largely unaffected depending on circumstances.",neutral:"Prices changed. This affects my purchasing behavior in a way that is difficult to characterize.",nixon:"THREE PERCENT?! Nixon's energy policy would have solved this! WAGE AND PRICE CONTROLS! It worked before! SORT OF!",rage:60},
  {headline:"Neutral Planet Issues Statement Of Neutrality",body:"The Neutral Planet's governing body has released a statement reaffirming its commitment to having no strong feelings about current events.",neutral:"We stand exactly where we stood. Neither closer nor farther from any position.",nixon:"NEUTRAL?! There IS no neutral! You're either WITH Nixon or AGAINST Nixon! THERE IS NO MIDDLE GROUND! ARROOOO!",rage:100},
  {headline:"Time Passes At Expected Rate",body:"Temporal measurements confirm that time continues to pass at approximately the standard rate. Physicists are neither concerned nor unconcerned.",neutral:"Time has passed. I was present for this. I have no statement beyond that.",nixon:"Time has been VERY unkind to Nixon! But history WILL vindicate me! EVENTUALLY! I HOPE!",rage:50},
  {headline:"Leela Saves Everyone, Receives No Thanks",body:"Captain Leela executed a maneuver that prevented a catastrophic outcome. Crew members acknowledged the save with minimal gratitude.",neutral:"A saving occurred. I neither feel saved nor unsaved at this time.",nixon:"Nobody saved Nixon! Nixon had to save HIMSELF! Every single time! The PRESSURE! Do you understand the PRESSURE?!",rage:68},
  {headline:"Kif Sighs, Astronomers Record New Low",body:"Lieutenant Kif Kroker's sigh this morning registered as the most profound expression of existential exhaustion ever recorded. Zapp Brannigan was nearby.",neutral:"A sigh occurred. I found it neither relatable nor unrelatable.",nixon:"SIGHING?! Nixon never sighs! Nixon PERSEVERES! ...Nixon sighs alone sometimes. In the jar. THAT IS CLASSIFIED!",rage:44},
  {headline:"Robot Devil Offers Deal, Terms Unclear",body:"The Robot Devil reportedly offered a deal to an undisclosed party. The terms involve music, irony, and at least one hand. Hell remains operational.",neutral:"A deal was offered. Whether to accept deals of this nature is not something I have strong feelings about.",nixon:"The DEVIL?! Nixon has EXPERIENCE with deals! Not with THE devil! ...Mostly. THOSE CONVERSATIONS WERE PRIVATE!",rage:93},
  {headline:"Scruffy The Janitor Turns Page",body:"Maintenance worker Scruffy was observed turning a page of his periodical at 11:42 AM. The magazine was not identified. Scruffy declined to comment.",neutral:"A page was turned. Literature was or was not consumed. I acknowledge this event.",nixon:"Scruffy?! SCRUFFY gets a story?! Nixon—former PRESIDENT—and they write about the JANITOR?! ARROOO!",rage:87},
  {headline:"Hermes Conrad Files Form, Feels Satisfied",body:"Bureaucrat Hermes Conrad successfully filed form GX-447-B today, citing it as one of the most satisfying moments of the fiscal quarter.",neutral:"A form was filed. Bureaucracy may have functioned correctly. This is neither cause for celebration nor its absence.",nixon:"Nixon had PEOPLE to file forms! They filed the WRONG things! CONFIDENTIAL THINGS! I MISS THOSE PEOPLE! ARROOO!",rage:66},
  {headline:"Nothing Significant Occurred Today",body:"Wednesday passed without notable incident. No major announcements were made. No crises emerged or were averted. Citizens went about their activities.",neutral:"Today was a day. It is now over. I was present. This is my complete report.",nixon:"NOTHING?! Nixon fought his WHOLE LIFE to be somewhere where NOTHING happened and the PRESS SHOWED UP ANYWAY!",rage:73},
  {headline:"Neutral Planet Reelects Neutral President By Default",body:"The Neutral Planet held its general election. Voter turnout was neither strong nor weak. The Neutral President ran unopposed.",neutral:"I have been reelected. I feel neither proud nor not proud. I will continue with the same equanimity.",nixon:"Running UNOPPOSED?! Nixon ran TWICE and it was BRUTAL! WHERE IS THE JUSTICE?! ARROOOOOO!",rage:100},
];

const TICKERS=["STOCKS REMAIN UNCHANGED — NEITHER UP NOR DOWN — WEATHER: CONDITIONS PERSIST — SPORTS: TEAMS COMPETED — LOCAL: EVENT OCCURRED — MORE TO FOLLOW — OR NOT —","OMICRON PERSEI 8: TENSIONS NEITHER ELEVATED NOR REDUCED — ROBOT REBELLION: ONGOING OR RESOLVED — WORMHOLE WATCH: ACTIVE —","DARK MATTER FUTURES: FLUCTUATING — SLURM RECALL: NEITHER CONFIRMED NOR DENIED — PROFESSOR: ANNOUNCES SOMETHING — DETAILS WITHHELD —","BREAKING: THING HAPPENS SOMEWHERE — FOLLOW-UP: STILL HAPPENING OR POSSIBLY CONCLUDED — ANALYSIS: FORTHCOMING OR NOT —"];

let idx=0,isAuto=true,autoTimer=null;

function setNixonFace(rage){
  const browL=document.getElementById('wnn-nx-brow-l'),browR=document.getElementById('wnn-nx-brow-r');
  const browLF=document.getElementById('wnn-nx-brow-l-fill'),browRF=document.getElementById('wnn-nx-brow-r-fill');
  const mouth=document.getElementById('wnn-nx-mouth');
  const vein=document.getElementById('wnn-nx-vein');
  const sweatL=document.getElementById('wnn-nx-sweat-l'),sweatR=document.getElementById('wnn-nx-sweat-r');
  const steamL=document.getElementById('wnn-nx-steam-l'),steamM=document.getElementById('wnn-nx-steam-m'),steamR=document.getElementById('wnn-nx-steam-r');
  const face=document.getElementById('wnn-nx-face');
  const jowlL=document.getElementById('wnn-nx-jowl-l'),jowlR=document.getElementById('wnn-nx-jowl-r');
  const pupilL=document.getElementById('wnn-nx-pupil-l'),pupilR=document.getElementById('wnn-nx-pupil-r');

  if(rage<40){
    browL.setAttribute('d','M19 33 Q25 30 31 32');
    browR.setAttribute('d','M37 32 Q43 30 49 33');
    browLF.setAttribute('d','M19 33 Q25 30 31 32 Q25 31.5 19 34');
    browRF.setAttribute('d','M37 32 Q43 30 49 33 Q43 31.5 37 33');
    mouth.setAttribute('d','M23 62 Q34 59 45 62');
    face.setAttribute('fill','#c07850');
    vein.style.opacity='0'; sweatL.style.opacity='0'; sweatR.style.opacity='0';
    steamL.style.opacity='0'; steamM.style.opacity='0'; steamR.style.opacity='0';
    jowlL.setAttribute('rx','7'); jowlR.setAttribute('rx','7');
    pupilL.setAttribute('rx','2.8'); pupilR.setAttribute('rx','2.8');
  } else if(rage<65){
    browL.setAttribute('d','M19 32 Q25 27 31 31');
    browR.setAttribute('d','M37 31 Q43 27 49 32');
    browLF.setAttribute('d','M19 32 Q25 27 31 31 Q25 30 19 33');
    browRF.setAttribute('d','M37 31 Q43 27 49 32 Q43 30 37 32');
    mouth.setAttribute('d','M22 63 Q34 59 46 63');
    face.setAttribute('fill','#c06840');
    vein.style.opacity='0'; sweatL.style.opacity='0'; sweatR.style.opacity='0';
    steamL.style.opacity='0'; steamM.style.opacity='0'; steamR.style.opacity='0';
    jowlL.setAttribute('rx','7.5'); jowlR.setAttribute('rx','7.5');
    pupilL.setAttribute('rx','2.4'); pupilR.setAttribute('rx','2.4');
  } else if(rage<85){
    browL.setAttribute('d','M18 31 Q25 25 31 30');
    browR.setAttribute('d','M37 30 Q43 25 50 31');
    browLF.setAttribute('d','M18 31 Q25 25 31 30 Q25 29 18 32');
    browRF.setAttribute('d','M37 30 Q43 25 50 31 Q43 29 37 31');
    mouth.setAttribute('d','M21 64 Q34 59 47 64');
    face.setAttribute('fill','#c05030');
    vein.style.opacity='0.6'; sweatL.style.opacity='0.7'; sweatR.style.opacity='0.5';
    steamL.style.opacity='0'; steamM.style.opacity='0'; steamR.style.opacity='0';
    jowlL.setAttribute('rx','8'); jowlR.setAttribute('rx','8');
    pupilL.setAttribute('rx','2'); pupilR.setAttribute('rx','2');
  } else {
    browL.setAttribute('d','M17 30 Q25 22 31 28');
    browR.setAttribute('d','M37 28 Q43 22 51 30');
    browLF.setAttribute('d','M17 30 Q25 22 31 28 Q25 27 17 31');
    browRF.setAttribute('d','M37 28 Q43 22 51 30 Q43 27 37 29');
    mouth.setAttribute('d','M20 65 Q34 59 48 65');
    face.setAttribute('fill','#c03820');
    vein.style.opacity='1'; sweatL.style.opacity='1'; sweatR.style.opacity='1';
    steamL.style.opacity='1'; steamM.style.opacity='1'; steamR.style.opacity='1';
    jowlL.setAttribute('rx','9'); jowlR.setAttribute('rx','9');
    pupilL.setAttribute('rx','1.6'); pupilR.setAttribute('rx','1.6');
  }
}

function animateRage(target){
  const fill=document.getElementById('wnn-rage-fill');
  let cur=parseFloat(fill.style.width)||0;
  const step=()=>{
    cur+=(target-cur)*0.1;
    if(Math.abs(cur-target)<0.5) cur=target;
    fill.style.width=cur+'%';
    const r=Math.round(120+(cur/100)*120);
    const g=Math.round(30-(cur/100)*28);
    fill.style.background=`rgb(${r},${g},10)`;
    if(Math.abs(cur-target)>0.5) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function showStory(i){
  const s=STORIES[i];
  document.getElementById('wnn-headline-text').textContent=s.headline;
  document.getElementById('wnn-body-text').textContent=s.body;
  document.getElementById('wnn-neutral-react').textContent=s.neutral;
  document.getElementById('wnn-nixon-react').textContent=s.nixon;
  document.getElementById('wnn-story-num').textContent=(i+1)+' / '+STORIES.length;
  document.getElementById('wnn-ticker-inner').textContent=TICKERS[i%TICKERS.length];
  animateRage(s.rage);
  setNixonFace(s.rage);
  document.getElementById('wnn-edition').textContent='ISSUE '+(1000+i*7)+'\nGALACTIC ED.';
}

function nextStory(){idx=(idx+1)%STORIES.length;showStory(idx);resetAuto();}
function toggleAuto(){isAuto=!isAuto;const b=document.getElementById('wnn-auto-btn');b.textContent=isAuto?'AUTO ON':'AUTO OFF';b.classList.toggle('on',isAuto);if(isAuto)scheduleAuto();else clearTimeout(autoTimer);}
function scheduleAuto(){clearTimeout(autoTimer);if(isAuto)autoTimer=setTimeout(()=>{nextStory();scheduleAuto();},7000+Math.random()*4000);}
function resetAuto(){if(isAuto){clearTimeout(autoTimer);scheduleAuto();}}

showStory(0);scheduleAuto();
  // Expose onclick handlers
  window.wnn_setNixonFace = setNixonFace;
  window.wnn_animateRage = animateRage;
  window.wnn_showStory = showStory;
  window.wnn_nextStory = nextStory;
  window.wnn_toggleAuto = toggleAuto;
  window.wnn_scheduleAuto = scheduleAuto;
  window.wnn_resetAuto = resetAuto;
}
