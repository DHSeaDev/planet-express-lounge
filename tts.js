/**
 * tts.js  —  Planet Express Lounge v4.01
 *
 * Sentence-Buffered TTS Queue Manager
 *
 * Architecture:
 *  ┌─ token stream ─────────────────────────────────────────────────────────┐
 *  │  push(chunk, agent)                                                     │
 *  │   → appends to per-agent text buffer                                    │
 *  │   → regex splits on sentence boundaries                                 │
 *  │   → complete sentences → sanitize → _enqueue()                         │
 *  └─────────────────────────────────────────────────────────────────────────┘
 *  ┌─ playback engine ───────────────────────────────────────────────────────┐
 *  │  _isSpeaking flag (set SYNCHRONOUSLY before any await)                 │
 *  │  chrome.tts lifecycle events: 'end'|'interrupted'|'error'|'cancelled'  │
 *  │   → sequential drain — no timers, no polling                           │
 *  └─────────────────────────────────────────────────────────────────────────┘
 *
 * DOM token stream is NEVER blocked — tokens go to the DOM immediately.
 * Speech queue is sentence-gated only.
 *
 * Voice philosophy (per Audio Cast Director spec):
 *   - Pitch MUST stay within 0.80–1.20 to avoid metallic frequency-shift artifacts.
 *   - Rate carries the personality load: slow = gravitas, fast = anxiety/energy.
 *   - Voice TYPE selection (male/female, US/UK) does more character work than pitch.
 *   - The user's global speed slider multiplies against each character's base rate.
 */

// ── Cast voice profiles ────────────────────────────────────────────────────────
//
// DESIGN RULES:
//   pitch: 0.80–1.20 ONLY. No exceptions. Outside this band → metallic artifacts.
//   rate:  0.70–1.40 for personality. Multiplied by the user's global slider.
//   voiceType: used by the voice resolver to pick the right engine tier.
//
// RATE carries personality:
//   Morbo, Lrrr, Robot Santa, Zapp, Calculon, Hedonismbot → very slow (gravitas/menace)
//   Amy, Fry, Linda → faster (energy/youth)
//   Professor, Zoidberg → slow (age/hesitation)
//
// VOICE TYPE differentiates characters sharing the same rate/pitch range:
//   "deep-male"   → male voice, pitched down in safe range (0.80–0.88)
//   "neutral-male"→ male voice at unity pitch (0.95–1.05)
//   "high-female" → female voice, pitched up in safe range (1.08–1.20)
//   "neutral-female" → female voice at unity
//   "uk-male"     → British male engine preferred (theatrical/formal feel)
//   "uk-female"   → British female engine preferred

const CAST_PROFILES = {
  // ── Tier 1: Central Leads ────────────────────────────────────────────────────
  FRY: {
    pitch:     1.05,   // slightly bright — boyish, earnest
    rate:      1.08,   // slightly fast — dim but enthusiastic
    voiceType: "neutral-male",
    notes:     "Warm US male. Rate carries the 'just slightly too eager' energy.",
  },
  LEELA: {
    pitch:     0.95,   // slightly deeper — authority, composure
    rate:      1.05,   // crisp and efficient
    voiceType: "neutral-female",
    notes:     "Professional US female. No-nonsense. Rate stays near baseline.",
  },
  BENDER: {
    pitch:     0.88,   // lowest safe floor — metallic gravitas
    rate:      0.92,   // cynical drawl — slower than his ego
    voiceType: "deep-male",
    notes:     "US male pushed to safe low floor. Slow rate = arrogant patience.",
  },

  // ── Tier 2: Core Supporting ──────────────────────────────────────────────────
  PROF: {
    pitch:     1.05,   // slight brightness for aged squeak — NOT 1.25+ (artifact zone)
    rate:      0.78,   // very slow — senile rambling, trails off mid-thought
    voiceType: "neutral-male",
    notes:     "US male slowed heavily. Rate mimics senile pacing without pitch artifacts.",
  },
  AMY: {
    pitch:     1.12,   // bright — upper safe range, not chipmunk territory
    rate:      1.30,   // fast — valley girl hyperactive energy
    voiceType: "high-female",
    notes:     "US female, bright but safe pitch. Rate does the 'like, oh my god' work.",
  },
  ZOIDBERG: {
    pitch:     1.08,   // slightly bright for nervous warble
    rate:      0.82,   // deliberate — each word lands with pathetic weight
    voiceType: "neutral-male",
    notes:     "US male, slowed. Skittishness comes from rate hesitation, not chipmunk pitch.",
  },
  HERMES: {
    pitch:     0.96,   // warm, stable baseline
    rate:      1.12,   // brisk bureaucratic efficiency
    voiceType: "uk-male",
    notes:     "UK male preferred for rhythmic cadence. Rate = stamping forms with gusto.",
  },

  // ── Tier 3: Frequent Co-Stars ────────────────────────────────────────────────
  ZAPP: {
    pitch:     0.85,   // deep safe floor — velvet self-importance
    rate:      0.82,   // very deliberate — every word is a gift to the universe
    voiceType: "deep-male",
    notes:     "UK male deep + slow = maximum theatrical self-satisfaction.",
  },
  KIF: {
    pitch:     1.10,   // slightly thin/reedy — without going to artifact territory
    rate:      0.88,   // sighing hesitation — starts to speak, regrets it
    voiceType: "uk-male",
    notes:     "UK male slightly bright + slow. Weariness through pace, not chipmunk pitch.",
  },
  MOM: {
    pitch:     1.08,   // sharp female edge
    rate:      1.10,   // fast when corporate-raging, quick pivots
    voiceType: "high-female",
    notes:     "US female. Rate encodes the sudden switch from sweet to vicious.",
  },

  // ── Tier 4: Guests & Cameos ──────────────────────────────────────────────────
  MORBO: {
    pitch:     0.82,   // safe deep floor — booming alien anchor
    rate:      0.78,   // each word is a declaration of doom
    voiceType: "deep-male",
    notes:     "Pitch at safe low floor + very slow rate = room-filling alien menace.",
  },
  LINDA: {
    pitch:     1.15,   // perky brightness — safe upper range
    rate:      1.15,   // upbeat anchor pace
    voiceType: "high-female",
    notes:     "US female bright + fast = unshakeable morning-anchor cheerfulness.",
  },
  LABARBARA: {
    pitch:     0.96,   // calm, deep female authority
    rate:      0.98,   // measured — does not need to rush, she is always right
    voiceType: "neutral-female",
    notes:     "US female at near-baseline. Steadiness IS the character.",
  },
  NIXON: {
    pitch:     0.88,   // gravelly safe floor
    rate:      0.95,   // strained political authority — slightly slower
    voiceType: "deep-male",
    notes:     "US male deep + slightly slow = jowly paranoid president.",
  },
  CALCULON: {
    pitch:     0.92,   // theatrical baritone without going below safe range
    rate:      0.72,   // absurdly slow — every syllable is a performance
    voiceType: "uk-male",
    notes:     "UK male + very slow rate = over-acted soap opera pauses. Slowest safe rate.",
  },
  ROBOTSANTA: {
    pitch:     0.82,   // deep mechanical floor
    rate:      0.80,   // slow, rhythmic, inevitable doom
    voiceType: "deep-male",
    notes:     "Deep male + slow rate. Menace through deliberate cadence, not sub-floor pitch.",
  },
  HEDONISMBOT: {
    pitch:     0.90,   // smooth, pampered baritone
    rate:      0.75,   // decadent crawl — savours every syllable
    voiceType: "uk-male",
    notes:     "UK male + slowest rate = languid aristocratic indulgence.",
  },
  LRRR: {
    pitch:     0.83,   // deep alien floor — safe range maximum effect
    rate:      0.82,   // declarative alien pronouncements take time
    voiceType: "deep-male",
    notes:     "Deep male at safe floor. Rate adds alien-ruler gravitas without artifacts.",
  },

  // ── Utility ───────────────────────────────────────────────────────────────────
  NARRATOR: {
    pitch:     0.98,
    rate:      0.95,
    voiceType: "uk-male",
    notes:     "UK male near-baseline. Warm, slightly formal announcer.",
  },
  USER: {
    pitch:     1.00,
    rate:      1.00,
    voiceType: "neutral-male",
  },
};

const DEFAULT_PROFILE = { pitch: 1.00, rate: 1.00, voiceType: "neutral-male" };

// ── Voice preference resolver ─────────────────────────────────────────────────
//
// For each voiceType, lists preferred voice names in order of preference.
// Voice names vary by OS (Windows/Mac/Linux/ChromeOS).
// Falls back to lang codes ("en-US", "en-GB") as last resort.
// "deep-male" voices: prefer voices with natural lower register, not just any male.
//
const VOICE_TYPE_PREFS = {
  "deep-male": [
    "Google UK English Male",      // Chrome built-in, deeper register
    "Microsoft David",             // Windows — David has good low-end
    "Microsoft Mark",              // Windows alternative
    "Daniel",                      // macOS UK male
    "en-GB",                       // UK lang fallback — tends to male default
    "en-US",
  ],
  "neutral-male": [
    "Google US English",           // Chrome built-in US male
    "Microsoft Mark",              // Windows
    "Alex",                        // macOS
    "en-US",
    "en-GB",
  ],
  "high-female": [
    "Google US English Female",    // Chrome built-in US female
    "Microsoft Zira",              // Windows — brighter register
    "Samantha",                    // macOS US female
    "en-US",
  ],
  "neutral-female": [
    "Google US English Female",
    "Microsoft Zira",
    "Microsoft Hazel",             // Windows UK female — calmer than Zira
    "Samantha",
    "Karen",                       // macOS Australian female — warm neutral
    "en-US",
  ],
  "uk-male": [
    "Google UK English Male",
    "Microsoft George",            // Windows UK male
    "Daniel",                      // macOS UK male
    "Arthur",                      // macOS UK male alternative
    "en-GB",
    "en-US",
  ],
  "uk-female": [
    "Google UK English Female",
    "Microsoft Hazel",             // Windows UK female
    "Kate",                        // macOS UK female
    "en-GB",
    "en-US",
  ],
};

// ── Voice cache ───────────────────────────────────────────────────────────────
// Critical: chrome.tts.getVoices() returns empty array on first call before
// voiceschanged fires. We handle this with onvoiceschanged + a ready promise.

let _voiceCache = null;          // { byName: Map, byLang: Map } once loaded
let _voiceReadyResolvers = [];   // pending resolvers waiting for voices

/**
 * Populate the voice cache. Called on init and whenever voices change.
 * Must be called via the onvoiceschanged event, not at module parse time.
 */
function _populateVoiceCache() {
  chrome.tts.getVoices(voices => {
    const byName = new Map();
    const byLang = new Map();
    for (const v of (voices || [])) {
      if (v.voiceName) byName.set(v.voiceName, v);
      // Index by both "en-us" and "en-US" for case-insensitive lookup
      const lang = (v.lang || "").toLowerCase().replace('_', '-');
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang).push(v);
    }
    _voiceCache = { byName, byLang };
    // Resolve all pending waiters
    const resolvers = _voiceReadyResolvers.splice(0);
    for (const r of resolvers) r(_voiceCache);
  });
}

/**
 * Returns a promise that resolves to the voice cache.
 * If voices aren't loaded yet, waits. If chrome.tts doesn't fire
 * voiceschanged (some platforms), falls back to a direct call.
 */
function _getVoiceCache() {
  if (_voiceCache) return Promise.resolve(_voiceCache);
  return new Promise(resolve => {
    _voiceReadyResolvers.push(resolve);
    // Fallback: directly call getVoices in case voiceschanged already fired
    // or doesn't fire on this platform
    chrome.tts.getVoices(voices => {
      if (voices && voices.length > 0) {
        _populateVoiceCache(); // fills cache and resolves all pending
      }
      // else wait for voiceschanged
    });
  });
}

// Chrome TTS doesn't expose onvoiceschanged directly like Web Speech API,
// but we can pre-load on init by calling getVoices() after a short delay
// to allow Chrome's voice engine to initialise.
setTimeout(_populateVoiceCache, 200);
setTimeout(_populateVoiceCache, 1500); // second attempt for slow systems

/**
 * Resolve the best voiceName for a character.
 * Walks the voiceType preference list, returns first available match.
 * Falls back to undefined (Chrome picks a default).
 */
async function _resolveVoice(agent) {
  const profile = CAST_PROFILES[agent] || DEFAULT_PROFILE;
  const type    = profile.voiceType || "neutral-male";
  const prefs   = VOICE_TYPE_PREFS[type] || ["en-US"];

  const cache = await _getVoiceCache();

  for (const pref of prefs) {
    if (pref.includes("-") && pref.length <= 5) {
      // Lang code — take first available voice for that lang
      const voices = cache.byLang.get(pref.toLowerCase()) || [];
      if (voices.length) return voices[0].voiceName;
    } else {
      // Voice name — exact match
      if (cache.byName.has(pref)) return pref;
    }
  }
  return undefined;
}

// ── Sentence boundary regex ───────────────────────────────────────────────────
// Splits after terminal punctuation followed by whitespace or newline.
// Capturing group keeps delimiter attached to the preceding sentence.
const SENTENCE_BOUNDARY = /([.?!…]+[\s\n]+)/;

// ── Sanitization pipeline ─────────────────────────────────────────────────────
const SANITIZE_RULES = [
  [/<[^>]*>/g,                  ""],   // HTML tags
  [/\*{1,3}|_{1,2}|~{2}/g,      ""],   // markdown bold/italic/strikethrough
  [/^\s*#{1,6}\s*/gm,           ""],   // markdown headings
  [/`{1,3}[^`]*`{1,3}/g,       ""],   // inline code
  [/\[[^\]]{0,60}\]/g,          ""],   // [action brackets]
  [/\(([a-zA-Z][^)]{0,50})\)/g, ""],   // (stage directions) — alpha-start only
  [/[ \t]{2,}/g,                " "],  // collapse spaces
  [/\n+/g,                      " "],  // collapse newlines
];

function sanitize(raw) {
  let s = raw;
  for (const [p, r] of SANITIZE_RULES) s = s.replace(p, r);
  return s.trim();
}

// ── TTSQueueManager ───────────────────────────────────────────────────────────
export class TTSQueueManager {
  constructor() {
    this._queue        = [];          // Array<{ text, agent }>
    this._isSpeaking   = false;       // true while chrome.tts has an active utterance
    this._pendingDrain = false;       // true for the one tick between _queue.shift() and _isSpeaking=true
    this._buffers      = new Map();   // per-agent partial-sentence accumulation
    this._rate         = 1.00;        // global slider multiplier
    this._muted        = new Set();   // muted agent IDs

    // Bind once so we can reference the same function in onEvent
    this._onTTSEvent = this._onTTSEvent.bind(this);

    // Pre-resolve voices as soon as the queue manager is created
    // so first speech doesn't incur voice lookup latency
    _populateVoiceCache();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Feed a streaming token into the sentence buffer for this agent.
   * Complete sentences enqueue for speech. Call AFTER updating the DOM.
   */
  push(chunk, agent) {
    if (this._muted.has(agent)) return;
    const current = (this._buffers.get(agent) || "") + chunk;
    const parts   = current.split(SENTENCE_BOUNDARY);
    for (let i = 0; i < parts.length - 1; i += 2) {
      const sentence = (parts[i] + (parts[i + 1] || "")).trim();
      const clean    = sentence ? sanitize(sentence) : "";
      if (clean.length > 1) this._enqueue(clean, agent);
    }
    this._buffers.set(agent, parts[parts.length - 1]);
  }

  /**
   * Flush any remaining buffered text when an agent's turn ends.
   * Call from finishTurn() after all tokens are received.
   */
  flush(agent) {
    if (this._muted.has(agent)) { this._buffers.delete(agent); return; }
    const remaining = (this._buffers.get(agent) || "").trim();
    this._buffers.delete(agent);
    if (remaining.length > 1) {
      const clean = sanitize(remaining);
      if (clean.length > 1) this._enqueue(clean, agent);
    }
  }

  /** Hard stop: drain queue, silence engine. */
  stop() {
    this._queue      = [];
    this._buffers    = new Map();
    this._isSpeaking = false;
    try { chrome.tts.stop(); } catch {}
  }

  /** Set global rate multiplier from the user's speed slider. */
  setRate(rate)    { this._rate = rate; }

  mute(agent)      { this._muted.add(agent); }
  unmute(agent)    { this._muted.delete(agent); }
  setMuted(agents) { this._muted = agents instanceof Set ? agents : new Set(agents); }

  get queueLength() { return this._queue.length; }

  /**
   * Resolves when both the queue is empty and no utterance is active.
   * Used by crew.js to sync between autopilot turns.
   * _pendingDrain covers the one-tick gap between _queue.shift() and
   * _isSpeaking=true being set, preventing a spurious early resolve.
   */
  waitForIdle() {
    return new Promise(resolve => {
      const check = () => {
        if (!this._isSpeaking && !this._pendingDrain && this._queue.length === 0) resolve();
        else setTimeout(check, 60);
      };
      check();
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _enqueue(text, agent) {
    this._queue.push({ text, agent });
    if (!this._isSpeaking) {
      this._pendingDrain = true;
      this._drain();
    }
  }

  /**
   * Drain the next sentence from the queue.
   *
   * CRITICAL: _isSpeaking is set TRUE SYNCHRONOUSLY before any await.
   * This closes the race window where waitForIdle() could resolve between
   * _queue.shift() and the chrome.tts.speak() call.
   *
   * _pendingDrain is cleared at the very top of _drain (before the early-return
   * guard) so waitForIdle()'s 60ms poll cannot resolve in the one-tick gap
   * between _enqueue calling _drain and _isSpeaking being set.
   *
   * Voice resolution (async) happens while _isSpeaking=true, so the queue
   * stays locked the entire time — no double-drain, no overlapping speech.
   */
  async _drain() {
    this._pendingDrain = false;
    if (this._isSpeaking || this._queue.length === 0) return;

    const { text, agent } = this._queue.shift();

    if (this._muted.has(agent)) {
      // Skip muted agent — recurse synchronously (not async) to avoid re-entry
      this._isSpeaking = false;
      this._drain();
      return;
    }

    // ── SET isSpeaking BEFORE await — closes the race window ─────────────────
    this._isSpeaking = true;

    const profile   = CAST_PROFILES[agent] || DEFAULT_PROFILE;
    const voiceName = await _resolveVoice(agent);

    const opts = {
      rate:    Math.min(Math.max(profile.rate * this._rate, 0.1), 3.0),
      pitch:   profile.pitch,
      volume:  1.0,
      enqueue: false,           // we own the queue — disable native queuing
      onEvent: this._onTTSEvent,
    };
    if (voiceName) opts.voiceName = voiceName;

    chrome.tts.speak(text, opts);
  }

  /**
   * chrome.tts lifecycle handler.
   * Terminal events reset isSpeaking and cascade to the next sentence.
   */
  _onTTSEvent(event) {
    if (["end", "interrupted", "error", "cancelled"].includes(event.type)) {
      this._isSpeaking = false;
      this._drain();
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const tts = new TTSQueueManager();
