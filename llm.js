/**
 * llm.js  —  Planet Express Lounge
 * Direct streaming LLM calls to Groq, OpenRouter, and Gemini.
 * Replaces the Python LLM class and Flask SSE streaming in server.py.
 */

import { PROVIDER_GROQ, PROVIDER_OR, PROVIDER_GEM, TEMPERATURE } from "./prompts.js";

const OR_BASE  = "https://openrouter.ai/api/v1";
const GEM_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class LLMClient {
  /**
   * @param {Object} config
   * @param {string} config.provider  - "Groq" | "OpenRouter" | "Gemini"
   * @param {string} config.model     - model identifier
   * @param {string} config.groqKey
   * @param {string} config.orKey
   * @param {string} config.gemKey
   * @param {number} [config.temp]    - temperature (default 0.88)
   */
  constructor({ provider, model, groqKey, orKey, gemKey, temp = TEMPERATURE } = {}) {
    this.provider = provider || PROVIDER_GROQ;
    this.model    = model;
    this.groqKey  = groqKey || "";
    this.orKey    = orKey   || "";
    this.gemKey   = gemKey  || "";
    this.temp     = temp;
  }

  get label() {
    return `${this.provider} / ${this.model}`;
  }

  // ── Streaming completion ─────────────────────────────────────────────────
  /**
   * Streams tokens from the LLM. Calls onToken(chunk) for each token,
   * returns the full accumulated text when done.
   * @param {string} sysPrompt
   * @param {string} userPrompt
   * @param {number} maxTokens
   * @param {Function} onToken - called with each string chunk
   * @param {AbortSignal} [signal] - cancellation signal
   * @returns {Promise<string>} accumulated text
   */
  async stream(sysPrompt, userPrompt, maxTokens, onToken, signal) {
    switch (this.provider) {
      case PROVIDER_GROQ: return this._streamGroq(sysPrompt, userPrompt, maxTokens, onToken, signal);
      case PROVIDER_OR:   return this._streamOR(sysPrompt, userPrompt, maxTokens, onToken, signal);
      case PROVIDER_GEM:  return this._streamGem(sysPrompt, userPrompt, maxTokens, onToken, signal);
      default: throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  // ── Non-streaming completion (routing, titles, etc.) ────────────────────
  async complete(sysPrompt, userPrompt, maxTokens = 80) {
    switch (this.provider) {
      case PROVIDER_GROQ: return this._completeGroq(sysPrompt, userPrompt, maxTokens);
      case PROVIDER_OR:   return this._completeOR(sysPrompt, userPrompt, maxTokens);
      case PROVIDER_GEM:  return this._completeGem(sysPrompt, userPrompt, maxTokens);
      default: throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  // ── Groq ──────────────────────────────────────────────────────────────────
  async _streamGroq(sys, usr, maxTok, onToken, signal) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${this.groqKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:       this.model,
        temperature: this.temp,
        max_tokens:  maxTok,
        stream:      true,
        messages:    [{ role: "system", content: sys }, { role: "user", content: usr }],
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Groq ${res.status}: ${err}`);
    }
    return this._consumeSSE(res.body, onToken, signal);
  }

  async _completeGroq(sys, usr, maxTok) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.groqKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:       this.model,
        temperature: this.temp,
        max_tokens:  maxTok,
        messages:    [{ role: "system", content: sys }, { role: "user", content: usr }],
      }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  // ── OpenRouter ─────────────────────────────────────────────────────────────
  async _streamOR(sys, usr, maxTok, onToken, signal) {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${this.orKey}`,
        "Content-Type":  "application/json",
        "X-Title":        "PELounge",
      },
      body: JSON.stringify({
        model:       this.model,
        temperature: this.temp,
        max_tokens:  maxTok,
        stream:      true,
        messages:    [{ role: "system", content: sys }, { role: "user", content: usr }],
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenRouter ${res.status}: ${err}`);
    }
    return this._consumeSSE(res.body, onToken, signal);
  }

  async _completeOR(sys, usr, maxTok) {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.orKey}`,
        "Content-Type":  "application/json",
        "X-Title":        "PELounge",
      },
      body: JSON.stringify({
        model:       this.model,
        temperature: this.temp,
        max_tokens:  maxTok,
        messages:    [{ role: "system", content: sys }, { role: "user", content: usr }],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  // ── Gemini ─────────────────────────────────────────────────────────────────
  async _streamGem(sys, usr, maxTok, onToken, signal) {
    const url = `${GEM_BASE}/models/${this.model}:streamGenerateContent?key=${this.gemKey}&alt=sse`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents:          [{ role: "user", parts: [{ text: usr }] }],
        generationConfig:  { temperature: this.temp, maxOutputTokens: maxTok },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini ${res.status}: ${err}`);
    }

    // Gemini SSE: each event data is a JSON object with candidates[0].content.parts[0].text
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let acc       = "";
    let buf       = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done || (signal && signal.aborted)) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const obj   = JSON.parse(raw);
          const chunk = obj?.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (chunk) { acc += chunk; onToken(chunk); }
        } catch {}
      }
    }
    return acc;
  }

  async _completeGem(sys, usr, maxTok) {
    const url = `${GEM_BASE}/models/${this.model}:generateContent?key=${this.gemKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents:          [{ role: "user", parts: [{ text: usr }] }],
        generationConfig:  { temperature: this.temp, maxOutputTokens: maxTok },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => "")}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // ── Shared SSE consumer (OpenAI-compatible format) ─────────────────────────
  async _consumeSSE(body, onToken, signal) {
    const reader  = body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done || (signal && signal.aborted)) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const chunk = JSON.parse(raw)?.choices?.[0]?.delta?.content || "";
          if (chunk) { acc += chunk; onToken(chunk); }
        } catch {}
      }
    }
    return acc;
  }

  // ── Connection test ────────────────────────────────────────────────────────
  async ping() {
    const result = await this.complete("Reply with only the word: OK", "ping", 5);
    return result.includes("OK") || result.length < 20;
  }

  // ── Fetch available OpenRouter models ─────────────────────────────────────
  static async fetchORModels(apiKey) {
    try {
      const res = await fetch(`${OR_BASE}/models`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.data || []).map(m => m.id).sort();
    } catch {
      return null;
    }
  }
}
