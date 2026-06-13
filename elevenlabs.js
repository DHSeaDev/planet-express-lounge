/**
 * elevenlabs.js  —  Planet Express Lounge
 *
 * Optional BYOK ElevenLabs TTS provider — the "premium voice" tier.
 *
 * Unlike Deepdub's account-specific voicePromptId, ElevenLabs has a large
 * library of well-known PREMADE voices with stable public IDs that work on
 * any tier (including free) — no per-account setup required. VOICE_TARGETS
 * in tts.js ships with sensible defaults per category; users can swap any
 * of them for their own favorite from https://elevenlabs.io/app/voice-lab.
 *
 * API reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 *
 * Key characteristics:
 *   - Auth via `xi-api-key` header
 *   - Response body is RAW BINARY audio (mp3 by default), not JSON
 *   - `speed` (0.7–1.2, 1.0 = normal) is the only rate-like control —
 *     narrower than chrome.tts rate, so we clamp rather than scale
 *   - No pitch parameter — voice character comes from the chosen voice ID
 *
 * Cost note: ElevenLabs has a free tier (~10k chars/month as of writing),
 * then bills the user's own account. This is the user's own key —
 * the extension calls ElevenLabs directly, never proxied.
 */

const ENDPOINT_BASE = "https://api.elevenlabs.io/v1/text-to-speech/";
const MODEL_ID      = "eleven_flash_v2_5"; // low-latency (~75ms), good for sequential dialogue

let _apiKey       = "";
let _currentAudio = null; // <audio> element for the in-flight utterance
let _currentUrl   = null; // blob: URL to revoke after playback

/**
 * Set (or clear) the ElevenLabs API key. An empty string disables the
 * ElevenLabs provider entirely — tts.js falls back to OS/Chrome voices.
 */
export function setElevenLabsKey(key) {
  _apiKey = (key || "").trim();
}

export function hasElevenLabsKey() {
  return !!_apiKey;
}

/**
 * Speak `text` using an ElevenLabs voice.
 *
 * @param {string} text     - sanitized sentence to speak
 * @param {string} voiceId  - ElevenLabs voice ID (premade or custom)
 * @param {object} opts     - { rate } — chrome.tts-style rate, mapped to ElevenLabs speed
 * @returns {Promise<void>} - resolves when playback ends, rejects on error
 */
export async function speakElevenLabs(text, voiceId, opts = {}) {
  if (!_apiKey) throw new Error("No ElevenLabs API key configured");
  if (!voiceId) throw new Error("No ElevenLabs voice configured for this character");

  // Map chrome.tts-style rate (~0.1–3.0, 1.0 = normal) onto ElevenLabs'
  // speed range (0.7–1.2, 1.0 = normal). Narrow range — clamp rather than
  // scale, so extreme character rates don't degrade audio quality.
  const speed = Math.min(Math.max(opts.rate ?? 1.0, 0.7), 1.2);

  const body = {
    text,
    model_id: MODEL_ID,
    voice_settings: {
      stability:        0.5,
      similarity_boost: 0.75,
      speed,
    },
  };

  const res = await fetch(`${ENDPOINT_BASE}${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key":   _apiKey,
      "Accept":       "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Error responses are JSON; success responses are binary audio.
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.detail?.message || errBody?.detail || `ElevenLabs error: HTTP ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  if (!buf || buf.byteLength === 0) throw new Error("ElevenLabs returned no audio");

  return _playAudioBuffer(buf);
}

/**
 * Play raw MP3 bytes via an <audio> element using a blob: URL. Resolves on
 * 'ended', rejects on playback error. Tracks the element on _currentAudio
 * so stop() can cancel mid-utterance, and revokes the blob URL afterward.
 */
function _playAudioBuffer(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);

    _currentAudio = audio;
    _currentUrl   = url;

    const cleanup = () => {
      if (_currentAudio === audio) { _currentAudio = null; }
      if (_currentUrl === url) { URL.revokeObjectURL(url); _currentUrl = null; }
    };

    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); reject(new Error("ElevenLabs audio playback failed")); };

    audio.play().catch(e => { cleanup(); reject(e); });
  });
}

/**
 * Stop any in-flight ElevenLabs playback immediately.
 * Safe to call even if nothing is playing.
 */
export function stopElevenLabs() {
  if (_currentAudio) {
    try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch {}
    _currentAudio = null;
  }
  if (_currentUrl) {
    try { URL.revokeObjectURL(_currentUrl); } catch {}
    _currentUrl = null;
  }
}
