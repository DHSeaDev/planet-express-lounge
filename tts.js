/**
 * tts.js  —  Planet Express Lounge v4.01
 *
 * Sentence-Buffered TTS Queue Manager
 *
 * Architecture:
 *  ┌─ token stream ─────────────────────────────────┐
 *  │  push(chunk, agent)                            │
 *  │   → appends to text buffer                     │
 *  │   → regex splits on sentence boundaries        │
 *  │   → complete sentences → sanitize → enqueue    │
 *  └────────────────────────────────────────────────┘
 *  ┌─ playback engine ───────────────────────────────┐
 *  │  isSpeaking flag + chrome.tts event listeners  │
 *  │  'end' | 'interrupted' | 'error' | 'cancelled' │
 *  │   → drain queue sequentially                   │
 *  └────────────────────────────────────────────────┘
 *
 * The UI token stream is NEVER blocked — tokens go to DOM immediately.
 * Only the speech queue is sentence-gated.
 */

// ── Cast pitch registry ───────────────────────────────────────────────────────
// Rate is ALWAYS 1.00 — speaking speed is controlled globally by the user's WPM slider.
// Pitch values are the only per-character modifiers.
// Character voice profiles per the spec.
// rate is a per-character BASE that multiplies against the user's global speed slider.
// Chrome TTS rate range: 0.1–10. Pitch range: 0–2.
const CAST_PROFILES = {
  FRY:         { pitch: 1.10, rate: 1.05 },  // boyish, slightly fast, nasal
  LEELA:       { pitch: 0.95, rate: 1.10 },  // authoritative, crisp, fast
  BENDER:      { pitch: 0.75, rate: 0.95 },  // metallic drawl, slow arrogance
  PROF:        { pitch: 1.25, rate: 0.75 },  // frail geriatric, squeaky
  AMY:         { pitch: 1.40, rate: 1.35 },  // hyperactive valley girl
  ZOIDBERG:    { pitch: 1.15, rate: 0.80 },  // warbling nervous squeak
  HERMES:      { pitch: 0.90, rate: 1.15 },  // brisk bureaucratic rhythm
  ZAPP:        { pitch: 0.80, rate: 0.85 },  // theatrical self-important
  KIF:         { pitch: 1.30, rate: 0.90 },  // exhausted, thin, weary
  MORBO:       { pitch: 0.30, rate: 0.80 },  // deep alien boom
  LINDA:       { pitch: 1.20, rate: 1.20 },  // perky anchor
  LABARBARA:   { pitch: 0.85, rate: 1.00 },  // steady commanding
  NIXON:       { pitch: 0.70, rate: 1.05 },  // growling baritone
  CALCULON:    { pitch: 0.85, rate: 0.70 },  // over-acted dramatic pauses
  MOM:         { pitch: 1.15, rate: 1.10 },  // sharp, biting
  ROBOTSANTA:  { pitch: 0.50, rate: 0.90 },  // mechanical doom
  HEDONISMBOT: { pitch: 0.75, rate: 0.75 },  // aristocratic purr
  LRRR:        { pitch: 0.20, rate: 0.85 },  // absolute floor pitch
  NARRATOR:    { pitch: 0.90, rate: 1.00 },  // neutral announcer
  USER:        { pitch: 1.00, rate: 1.00 },
};

// Fallback profile for unknown agents
const DEFAULT_PROFILE = { pitch: 1.00, rate: 1.00 };

// ── Sentence boundary regex ───────────────────────────────────────────────────
// Splits after one or more sentence-ending punctuation marks followed by
// whitespace or a newline. Handles ellipsis ("..."), interrobangs, etc.
// The capturing group keeps the delimiter attached to the preceding sentence.
const SENTENCE_BOUNDARY = /([.?!…]+[\s\n]+)/;

// ── Sanitization pipeline ─────────────────────────────────────────────────────
// Applied to each sentence before it is sent to chrome.tts.
const SANITIZE_RULES = [
  // Strip HTML tags (safety net — text should already be plain)
  [/<[^>]*>/g,                   ""],
  // Strip markdown bold/italic/strikethrough markers: **, *, __, _, ~~
  [/\*{1,3}|_{1,2}|~{2}/g,       ""],
  // Strip markdown headings at line start: ## Heading
  [/^\s*#{1,6}\s*/gm,            ""],
  // Strip markdown inline code and code fences
  [/`{1,3}[^`]*`{1,3}/g,        ""],
  // Strip action descriptions in square brackets: [sighs], [laughs loudly]
  [/\[[^\]]{0,60}\]/g,           ""],
  // Strip stage directions in parentheses: (laughs), (sighs deeply)
  // Only remove if content looks like an action, not a citation/number
  [/\(([a-zA-Z][^)]{0,50})\)/g,  ""],
  // Collapse multiple spaces/newlines to a single space
  [/[ \t]{2,}/g,                 " "],
  [/\n+/g,                       " "],
  // Trim
];

/**
 * Sanitize a text string for TTS consumption.
 * @param {string} raw
 * @returns {string}
 */
function sanitize(raw) {
  let s = raw;
  for (const [pattern, replacement] of SANITIZE_RULES) {
    s = s.replace(pattern, replacement);
  }
  return s.trim();
}

// ── TTSQueueManager ───────────────────────────────────────────────────────────
export class TTSQueueManager {
  constructor() {
    /** Internal sentence playback queue: Array<{ text: string, agent: string }> */
    this._queue = [];

    /** True while chrome.tts is actively speaking a sentence */
    this._isSpeaking = false;

    /**
     * Per-agent text accumulation buffer.
     * Holds partial tokens until a sentence boundary is detected.
     * Map<agentId, string>
     */
    this._buffers = new Map();

    /** Global rate multiplier — set by the user's WPM slider */
    this._rate = 1.00;

    /** Set of agent IDs whose voice output is muted */
    this._muted = new Set();

    /** Bound event handler — stored so it can be referenced */
    this._onTTSEvent = this._onTTSEvent.bind(this);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Feed a streaming token chunk into the buffer for this agent.
   * Complete sentences are extracted and enqueued for speech.
   * Partial sentences remain buffered until more tokens arrive.
   *
   * Call this from receiveToken() — AFTER updating the DOM.
   * DOM update must happen before this call to avoid any lag.
   *
   * @param {string} chunk   Raw token text from LLM stream
   * @param {string} agent   Agent ID (e.g. "BENDER")
   */
  push(chunk, agent) {
    if (this._muted.has(agent)) return;

    const current = (this._buffers.get(agent) || "") + chunk;
    const parts   = current.split(SENTENCE_BOUNDARY);

    // split() with a capturing group returns:
    //   [before, delimiter, before, delimiter, ..., remainder]
    // Odd indices are the delimiters (part of the preceding sentence).
    // The last element is always the incomplete remainder.
    const sentences = [];
    for (let i = 0; i < parts.length - 1; i += 2) {
      const sentence = (parts[i] + (parts[i + 1] || "")).trim();
      if (sentence) sentences.push(sentence);
    }
    const remainder = parts[parts.length - 1];
    this._buffers.set(agent, remainder);

    for (const sentence of sentences) {
      const clean = sanitize(sentence);
      if (clean.length > 1) {
        this._enqueue(clean, agent);
      }
    }
  }

  /**
   * Flush any remaining buffered text for an agent when their turn ends.
   * Call this from finishTurn() after all tokens have been received.
   *
   * @param {string} agent
   */
  flush(agent) {
    if (this._muted.has(agent)) {
      this._buffers.delete(agent);
      return;
    }
    const remaining = (this._buffers.get(agent) || "").trim();
    this._buffers.delete(agent);
    if (remaining.length > 1) {
      const clean = sanitize(remaining);
      if (clean.length > 1) {
        this._enqueue(clean, agent);
      }
    }
  }

  /**
   * Hard stop: clear all queues, stop any active speech.
   */
  stop() {
    this._queue     = [];
    this._buffers   = new Map();
    this._isSpeaking = false;
    try { chrome.tts.stop(); } catch {}
  }

  /**
   * Set the global speaking rate (controlled by the WPM slider).
   * CAST_PROFILES use rate 1.00 as a base; this multiplies against it.
   * @param {number} rate
   */
  setRate(rate) {
    this._rate = rate;
  }

  /**
   * Mute a specific agent.
   * @param {string} agent
   */
  mute(agent) {
    this._muted.add(agent);
  }

  /**
   * Unmute a specific agent.
   * @param {string} agent
   */
  unmute(agent) {
    this._muted.delete(agent);
  }

  /**
   * Set the complete muted agents set (e.g. restored from chrome.storage).
   * @param {Set<string>|string[]} agents
   */
  setMuted(agents) {
    this._muted = agents instanceof Set ? agents : new Set(agents);
  }

  /**
   * Returns a read-only copy of the current sentence queue length.
   * Useful for status indicators.
   */
  get queueLength() {
    return this._queue.length;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /**
   * Add a sanitized sentence to the playback queue and start draining
   * if the engine is currently idle.
   */
  _enqueue(text, agent) {
    this._queue.push({ text, agent });
    if (!this._isSpeaking) {
      this._drain();
    }
  }

  /**
   * Speak the next sentence in the queue.
   * Sets isSpeaking = true and registers the lifecycle event handler.
   * The handler calls _drain() again when the utterance finishes,
   * creating a sequential chain without timers or polling.
   */
  _drain() {
    if (this._isSpeaking || this._queue.length === 0) return;

    const { text, agent } = this._queue.shift();

    // Guard: agent may have been muted between enqueue and drain
    if (this._muted.has(agent)) {
      this._drain(); // skip to next
      return;
    }

    const profile = CAST_PROFILES[agent] || DEFAULT_PROFILE;

    this._isSpeaking = true;

    chrome.tts.speak(text, {
      // Effective rate = character base rate × user global speed slider.
      // e.g. Amy (1.35) with slider at 1.2 = 1.62 effective rate.
      rate:   profile.rate * this._rate,
      pitch:  profile.pitch,
      volume: 1.0,
      // Disable native queuing — we own the queue
      enqueue: false,
      onEvent: this._onTTSEvent,
    });
  }

  /**
   * Lifecycle event handler for chrome.tts.speak.
   * Resets isSpeaking and drains the next sentence on terminal events.
   *
   * Terminal events: 'end', 'interrupted', 'error', 'cancelled'
   * Non-terminal:    'start', 'word', 'sentence', 'marker', 'pause', 'resume'
   *
   * @param {chrome.tts.TtsEvent} event
   */
  _onTTSEvent(event) {
    const TERMINAL = new Set(["end", "interrupted", "error", "cancelled"]);
    if (TERMINAL.has(event.type)) {
      this._isSpeaking = false;
      this._drain();
    }
  }
}

// ── Module singleton ──────────────────────────────────────────────────────────
// sidepanel.js imports this instance directly. One queue for the whole session.
export const tts = new TTSQueueManager();


// ── waitForIdle (appended by v4.01 patch) ────────────────────────────────────
// Extends TTSQueueManager prototype with a promise that resolves when both
// the queue is empty AND isSpeaking is false.
// Used by crew.js to synchronize between agent turns in autopilot mode.
TTSQueueManager.prototype.waitForIdle = function() {
  return new Promise((resolve) => {
    const check = () => {
      if (!this._isSpeaking && this._queue.length === 0) {
        resolve();
      } else {
        setTimeout(check, 120);
      }
    };
    check();
  });
};


// ── Voice selection (appended v4.01) ─────────────────────────────────────────
// Chrome ships multiple English TTS engines. We map each character to a specific
// voice by preference. The first available match from the preference list is used.
// voice names vary by OS; we prefer US-EN voices for core crew, UK-EN for accented
// characters (Hermes, Hedonismbot, Zapp's theatrical baritone feel).

const VOICE_PREFERENCES = {
  // Core crew — US English, differentiated by engine
  FRY:         ["Google US English", "Microsoft Mark", "en-US"],
  LEELA:       ["Google US English Female", "Microsoft Zira", "en-US"],
  BENDER:      ["Google US English", "Microsoft David", "en-US"],
  PROF:        ["Google US English", "Microsoft David", "en-US"],
  AMY:         ["Google US English Female", "Microsoft Zira", "en-US"],
  ZOIDBERG:    ["Google US English", "en-US"],
  // Extended cast — UK/accented voices where available
  HERMES:      ["Google UK English Male", "Microsoft Hazel", "en-GB", "en-US"],
  ZAPP:        ["Google UK English Male", "Microsoft George", "en-GB", "en-US"],
  KIF:         ["Google UK English Male", "en-GB", "en-US"],
  MORBO:       ["Google US English", "Microsoft David", "en-US"],
  LINDA:       ["Google US English Female", "Microsoft Zira", "en-US"],
  LABARBARA:   ["Google US English Female", "en-US"],
  NIXON:       ["Google US English", "Microsoft David", "en-US"],
  CALCULON:    ["Google UK English Male", "Microsoft George", "en-GB", "en-US"],
  MOM:         ["Google US English Female", "Microsoft Zira", "en-US"],
  ROBOTSANTA:  ["Google US English", "Microsoft David", "en-US"],
  HEDONISMBOT: ["Google UK English Male", "Microsoft George", "en-GB", "en-US"],
  LRRR:        ["Google US English", "Microsoft David", "en-US"],
  NARRATOR:    ["Google UK English Male", "Google US English", "en-US"],
  USER:        ["en-US"],
};

// Cache of available voices
let _availableVoices = null;

/**
 * Fetch and cache available TTS voices from chrome.tts.
 * Returns a Map<name, voiceObj> and lang→[voiceObj] for fallback.
 */
async function _loadVoices() {
  if (_availableVoices) return _availableVoices;
  return new Promise(resolve => {
    chrome.tts.getVoices(voices => {
      _availableVoices = { byName: new Map(), byLang: new Map() };
      for (const v of (voices || [])) {
        if (v.voiceName) _availableVoices.byName.set(v.voiceName, v);
        const lang = (v.lang || "").toLowerCase().slice(0, 5);
        if (!_availableVoices.byLang.has(lang)) _availableVoices.byLang.set(lang, []);
        _availableVoices.byLang.get(lang).push(v);
      }
      resolve(_availableVoices);
    });
  });
}

/**
 * Resolve the best available voiceName for an agent from preference list.
 * Falls back through the preference array; last entries are lang codes ("en-US").
 */
async function _resolveVoice(agent) {
  const prefs = VOICE_PREFERENCES[agent] || ["en-US"];
  const cache = await _loadVoices();

  for (const pref of prefs) {
    if (pref.includes("-")) {
      // It's a lang code — take first available voice for that lang
      const voices = cache.byLang.get(pref.toLowerCase()) || [];
      if (voices.length) return voices[0].voiceName;
    } else {
      // It's a voice name
      if (cache.byName.has(pref)) return pref;
    }
  }
  return undefined; // let Chrome pick
}

// Override _drain to include voiceName
TTSQueueManager.prototype._drainWithVoice = async function() {
  if (this._isSpeaking || this._queue.length === 0) return;

  const { text, agent } = this._queue.shift();

  if (this._muted.has(agent)) {
    this._drainWithVoice();
    return;
  }

  const profile    = CAST_PROFILES[agent] || DEFAULT_PROFILE;
  const voiceName  = await _resolveVoice(agent);

  this._isSpeaking = true;

  const opts = {
    rate:    profile.rate * this._rate,
    pitch:   profile.pitch,
    volume:  1.0,
    enqueue: false,
    onEvent: this._onTTSEvent,
  };
  if (voiceName) opts.voiceName = voiceName;

  chrome.tts.speak(text, opts);
};

// Patch _drain to use voice-aware version
TTSQueueManager.prototype._drain = TTSQueueManager.prototype._drainWithVoice;
