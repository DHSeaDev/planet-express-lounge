/**
 * crew.js  —  Planet Express Lounge v4.0
 * The Crew orchestrator — ported from Python Crew class in app.py.
 * Handles chat responses, autopilot episodes, routing, and generation tasks.
 * Runs entirely client-side. Communicates results via async callbacks / AsyncGenerators.
 */

import {
  FULL_CAST, CREW_WEIGHTS, INVENTIONS, BENDER_SCHEMES, AUTOPILOT_TOPICS,
  EP_PHASE_SEQUENCE, EP_PHASE_PROMPTS,
  PROF_INV_SYS, EPISODE_TITLE_SYS, JOURNAL_SYS, PREVIOUSLY_SYS,
  ROUTER_SYS, AGENT_KEYWORDS,
  buildSysPrompt, routeAgentByKeyword, pickLength,
  buildEpisodeRoster, getTierRoleNote, detectFocusAgent,
} from "./prompts.js";
import { tts } from "./tts.js";

export class Crew {
  /**
   * @param {import("./llm.js").LLMClient} llm
   * @param {import("./database.js").PEDatabase} db
   * @param {Object} [opts]
   * @param {boolean} [opts.chaos]
   */
  constructor(llm, db, opts = {}) {
    this.llm    = llm;
    this.db     = db;
    this.chaos  = opts.chaos || false;

    // Per-session state
    this.enabled        = Object.fromEntries(FULL_CAST.map(a => [a, true]));
    this.todayInvention = "";
    this.benderScheme   = _pick(BENDER_SCHEMES);

    // Cancellation
    this._cancelled = false;
    this._paused    = false;
    this._abortCtrl = new AbortController();
  }

  get signal() { return this._abortCtrl.signal; }

  cancel() {
    this._cancelled = true;
    this._abortCtrl.abort();
    // Create a fresh AbortController for the next run,
    // but leave _cancelled=true until the next startAutopilot/respondToUser call
    // clears it explicitly. This prevents a new call racing in before the current
    // stream has fully wound down.
    this._abortCtrl = new AbortController();
  }

  // Called at the start of each new run to reset cancellation state
  _resetCancel() {
    this._cancelled = false;
    this._paused    = false;
  }

  pause()  { this._paused = true;  }
  resume() { this._paused = false; }

  /** Waits while paused, checking every 200ms. Resolves immediately if not paused. */
  async _waitIfPaused() {
    while (this._paused && !this._cancelled) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  activeWeighted() {
    const pool = [];
    for (const [cid, w] of Object.entries(CREW_WEIGHTS)) {
      if (this.enabled[cid] !== false) {
        for (let i = 0; i < w; i++) pool.push(cid);
      }
    }
    return pool;
  }

  // ── LLM Router — picks the best agent for a message ────────────────────
  async routeAgent(message, transcript) {
    const active = FULL_CAST.filter(a => this.enabled[a] !== false);

    // 1. Try LLM router (fast, 1-token answer)
    try {
      const ctx = [
        `Recent conversation:\n${transcript.slice(-300)}`,
        `User message: ${message}`,
        `Available characters: ${active.join(", ")}`,
        `Pick the single best character to reply.`,
      ].join("\n\n");
      const reply = await this.llm.complete(ROUTER_SYS, ctx, 5);
      const upper = reply.trim().toUpperCase();
      for (const name of active) {
        if (upper.includes(name)) return name;
      }
    } catch {}

    // 2. Keyword scoring fallback
    return routeAgentByKeyword(message, transcript, this.enabled, this.benderScheme);
  }

  // ── Single agent streaming turn ─────────────────────────────────────────
  /**
   * Streams one agent's response. Returns accumulated text.
   * @param {string} agentId
   * @param {string} sysPrompt
   * @param {string} ctx
   * @param {number} maxTok
   * @param {Function} emit - emit({ type, agent, text }) callback
   */
  async _streamAgent(agentId, sysPrompt, ctx, maxTok, emit) {
    emit({ type: "speaker", agent: agentId });
    let acc = "";
    try {
      acc = await this.llm.stream(
        sysPrompt,
        ctx,
        maxTok,
        (chunk) => emit({ type: "token", agent: agentId, text: chunk }),
        this.signal,
      );
    } catch (err) {
      if (err.name !== "AbortError") {
        emit({ type: "system", text: `API error — check your key in Settings. (${err.message})` });
      }
    }
    emit({ type: "turn_end", agent: agentId });
    return acc;
  }

  // ── Respond to user message ─────────────────────────────────────────────
  /**
   * Chat engine: primary responder + 0-2 follow-ups.
   * @param {string} sid
   * @param {string} transcript
   * @param {string} message
   * @param {Function} emit
   */
  async respondToUser(sid, transcript, message, emit) {
    this._resetCancel();
    const snip = transcript.slice(-1200);
    const inv  = this.todayInvention
      ? `\n(The Professor recently invented: ${this.todayInvention})`
      : "";

    // Turn 1: best-matched primary
    const primary               = await this.routeAgent(message, transcript);
    const [lenInstr, maxTok]    = pickLength(true);
    const sysPrimary            = buildSysPrompt(primary, lenInstr, {
      autopilot: false, chaos: this.chaos,
      invention: this.todayInvention, scheme: this.benderScheme,
    });
    const ctx1 = `CONVERSATION SO FAR:${inv}\n${snip}\n\nUSER: ${message}\n\nRespond as ${primary}. React to what the user said. Be in character.`;

    const acc1 = await this._streamAgent(primary, sysPrimary, ctx1, maxTok, emit);
    if (acc1) await this.db.logTurn(sid, primary, acc1);

    if (this._cancelled) { emit({ type: "done" }); return; }

    let localTr = snip + (acc1 ? `\n${primary}: ${acc1}` : "");

    // Single agent only — one clean response per user message
    const pool     = this.activeWeighted().filter(c => c !== primary);
    const nFollowups = 0;  // restricted to 1 agent per user message
    const spoken     = new Set([primary]);

    for (let i = 0; i < nFollowups; i++) {
      if (this._cancelled) break;
      const candidates = pool.filter(c => !spoken.has(c));
      if (!candidates.length) break;
      const nxt = _pick(candidates);
      spoken.add(nxt);
      const sys2  = buildSysPrompt(nxt, "Reply in 1-2 punchy sentences.", {
        autopilot: false, chaos: this.chaos,
        invention: this.todayInvention, scheme: this.benderScheme,
      });
      const ctx2  = `CONVERSATION SO FAR:\n${localTr}\n\nUSER asked: ${message.slice(0,120)}\nThe crew is responding. Now YOU jump in as ${nxt}. React to what was just said, add your own angle. Be unmistakably yourself. 1-2 sentences. Do NOT introduce yourself by name.`;
      const acc2  = await this._streamAgent(nxt, sys2, ctx2, 80, emit);
      if (acc2) {
        localTr += `\n${nxt}: ${acc2}`;
        await this.db.logTurn(sid, nxt, acc2);
      }
    }

    emit({ type: "done" });
  }

  // ── Autopilot episode engine ────────────────────────────────────────────
  /**
   * Runs sitcom episodes in a loop until cancelled.
   * @param {string} sid
   * @param {Function} emit
   */
  async startAutopilot(sid, emit) {
    this._resetCancel();
    const usedTopics = new Set();

    const pickTopic = () => {
      const available = AUTOPILOT_TOPICS.filter(t => !usedTopics.has(t));
      const pool = available.length ? available : AUTOPILOT_TOPICS;
      if (!available.length) usedTopics.clear();
      const t = _pick(pool);
      usedTopics.add(t);
      return t;
    };

    while (!this._cancelled) {
      // ── New episode ─────────────────────────────────────────────────────
      const topic = pickTopic();

      // Episode title
      let epTitle = "";
      try {
        epTitle = await this.llm.complete(EPISODE_TITLE_SYS, `Topic: ${topic}`, 20);
        epTitle = epTitle.replace(/['"]/g, "").trim();
      } catch {}

      emit({ type: "ap_topic", topic });
      if (epTitle) emit({ type: "ep_title", title: epTitle });

      // Occasionally refresh Bender's scheme
      if (Math.random() < 0.4) {
        this.benderScheme = _pick(BENDER_SCHEMES);
        emit({ type: "scheme_update", scheme: this.benderScheme });
      }

      // Invention complication
      if (this.todayInvention && Math.random() < 0.3) {
        emit({ type: "invention_complication", invention: this.todayInvention });
      }

      let localTr    = `Episode topic: ${topic}\n`;
      let lastAgent  = "";
      const agentLastSaid = {};

      // ── Build episode roster using the narrative tier system ─────────────
      // Detects focus episodes automatically, then allocates speaking slots
      // across 4 tiers matching a standard 22-minute Futurama episode structure.
      const focusAgent = detectFocusAgent(topic);
      const { roster, tierOf } = buildEpisodeRoster(
        this.enabled,
        EP_PHASE_SEQUENCE,
        focusAgent,
      );

      if (focusAgent) {
        emit({ type: "system", text: `Focus episode: ${focusAgent} takes the lead.` });
      }

      let rosterIdx = 0;

      // ── Phase loop ───────────────────────────────────────────────────────
      for (const [phaseName, phaseTurns] of EP_PHASE_SEQUENCE) {
        if (this._cancelled) break;

        for (let t = 0; t < phaseTurns; t++) {
          if (this._cancelled) break;

          // Pull next agent from the pre-built narrative roster
          // Skip if same as last speaker (avoid back-to-back monologue)
          let agentId = roster[rosterIdx % roster.length];
          if (agentId === lastAgent && roster.length > 1) {
            // Try next slot
            const alt = roster[(rosterIdx + 1) % roster.length];
            if (alt !== lastAgent) { rosterIdx++; agentId = alt; }
          }
          rosterIdx++;

          const prevSaid = agentLastSaid[agentId] || "";

          // ── Build system prompt with tier role note ─────────────────────
          const [lenInstr, maxTok] = pickLength();
          const tierNote  = getTierRoleNote(agentId, tierOf);
          const sysPrompt = buildSysPrompt(agentId, lenInstr, {
            autopilot:   true,
            chaos:       this.chaos,
            invention:   this.todayInvention,
            scheme:      this.benderScheme,
            tierNote,           // injected into system prompt
          });

          // ── Phase context ───────────────────────────────────────────────
          let ctx;
          if (EP_PHASE_PROMPTS[phaseName]) {
            const noRepeat = prevSaid
              ? `Do NOT repeat: "${prevSaid.slice(0,100)}" — say something new.\n`
              : "";
            const invNote = agentId === "PROF" && this.todayInvention
              ? `\nYour invention (${this.todayInvention}) is menacingly relevant.`
              : "";
            const focusNote = focusAgent && agentId !== focusAgent
              ? `\nThis is ${focusAgent}'s episode — your line should react to, challenge, or support ${focusAgent}.`
              : "";
            ctx = EP_PHASE_PROMPTS[phaseName]
              .replace(/\{agent\}/g,  agentId)
              .replace(/\{topic\}/g,  topic)
              .replace(/\{recent\}/g, localTr.slice(-500))
              .replace(/\{length\}/g, lenInstr)
              + invNote + noRepeat + focusNote;
          } else {
            ctx = `TOPIC: ${topic}\nBender's scheme: ${this.benderScheme}\n\nRECENT:\n${localTr.slice(-400)}\n\nReact. Sound like ${agentId}.`;
          }

          const acc = await this._streamAgent(agentId, sysPrompt, ctx, maxTok, emit);

          if (this._cancelled) break;

          if (acc) {
            await this.db.logTurn(sid, agentId, acc);
            localTr += `\n${agentId}: ${acc}`;
            agentLastSaid[agentId] = acc;
          }
          lastAgent = agentId;

          // Wait for TTS to finish speaking this turn before the next agent starts.
          if (!this._cancelled) {
            await tts.waitForIdle();
          }
          // Pause point — if paused, hold here until resumed
          await this._waitIfPaused();
          // Short breath between speakers
          await _sleep(180);
        }
      }

      // ── Episode end ─────────────────────────────────────────────────────
      if (!this._cancelled) {
        emit({ type: "ap_episode_end", topic });
        // Wait for any remaining speech to finish, then pause before next episode
        await tts.waitForIdle();
        await _sleep(3000);
      }
    }

    emit({ type: "ap_done" });
  }

  // ── Generate invention ──────────────────────────────────────────────────
  async genInvention(emit) {
    const inv = _pick(INVENTIONS);
    let text = `Good news, everyone! I have invented ${inv}!`;
    try {
      text = await this.llm.complete(PROF_INV_SYS, `Today's invention: ${inv}. Announce it.`, 60);
    } catch {}
    this.todayInvention = inv;
    emit({ type: "invention", text, agent: "PROF" });
    return text;
  }

  // ── Generate journal ────────────────────────────────────────────────────
  async genJournal(sid, topic, emit) {
    const hist = await this.db.getHistory(sid);
    if (!hist.length) {
      emit({ type: "system", text: "Nothing to journal yet!" });
      return;
    }
    const tr = hist.slice(-20).map(m => `${m.agent}: ${m.content}`).join("\n");
    try {
      const text = await this.llm.complete(JOURNAL_SYS, `Topic: ${topic}\n\n${tr}`, 250);
      await this.db.saveJournal(sid, text);
      emit({ type: "journal", text, agent: "PROF" });
    } catch (e) {
      emit({ type: "system", text: `Journal error: ${e.message}` });
    }
  }

  // ── Generate "Previously on…" recap ────────────────────────────────────
  async genPreviously(sid, emit) {
    const hist = await this.db.getHistory(sid);
    if (!hist.length) {
      emit({ type: "previously", text: "Good news, everyone! Nothing happened previously. We begin fresh, doomed anew.", agent: "PROF" });
      return;
    }
    const tr = hist.slice(-15).map(m => `${m.agent}: ${m.content}`).join("\n");
    try {
      const text = await this.llm.complete(PREVIOUSLY_SYS, tr, 100);
      emit({ type: "previously", text, agent: "NARRATOR" });
    } catch {
      emit({ type: "previously", text: "Previously on Planet Express… things happened. Most of them bad. The crew survived. Barely.", agent: "NARRATOR" });
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────
function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Weighted random: items = [[value, weight], ...]
function _weightedChoice(items) {
  const total  = items.reduce((s, [, w]) => s + w, 0);
  let rand     = Math.random() * total;
  for (const [val, w] of items) {
    rand -= w;
    if (rand <= 0) return val;
  }
  return items[items.length - 1][0];
}
