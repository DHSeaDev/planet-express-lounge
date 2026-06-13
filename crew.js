/**
 * crew.js  —  Planet Express Lounge
 * The Crew orchestrator — ported from Python Crew class in app.py.
 * Handles chat responses, autopilot episodes, routing, and generation tasks.
 * Runs entirely client-side. Communicates results via async callbacks / AsyncGenerators.
 */

import {
  FULL_CAST, CREW_WEIGHTS, INVENTIONS, BENDER_SCHEMES, AUTOPILOT_TOPICS,
  EP_PHASE_SEQUENCE, EP_PHASE_PROMPTS,
  PROF_INV_SYS, MEGA_INV_SYS, RECYCLED_INV_SYS, EPISODE_TITLE_SYS, PREVIOUSLY_SYS,
  ROUTER_SYS, AGENT_KEYWORDS,
  buildSysPrompt, routeAgentByKeyword, pickLength,
  buildEpisodeRoster, getTierRoleNote, detectFocusAgent,
  checkEasterEgg,
  getWeeklyMission,
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
    // New inventions only surface in Autopilot/chat context AFTER the user
    // explicitly presses "Discuss with Crew" (lab.js discussInvention sets
    // this to true). Until then, todayInvention exists (for the Lab UI /
    // rating) but is NOT injected into system prompts or printed as a
    // "Plot twist" — fixes inventions auto-appearing in Autopilot episodes
    // the user never asked the crew about.
    this.inventionDiscussed = false;
    this.benderScheme   = _pick(BENDER_SCHEMES);

    // Cancellation
    this._cancelled = false;
    this._paused    = false;
    this._abortCtrl = new AbortController();
  }

  get signal() { return this._abortCtrl.signal; }

  /**
   * The invention as it should appear in prompts/emits — empty until the
   * user has explicitly discussed it (Discuss with Crew). Centralizes the
   * gating so call sites don't need to repeat the inventionDiscussed check.
   */
  get visibleInvention() {
    return this.inventionDiscussed ? this.todayInvention : "";
  }

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

    // ── Easter egg intercept — pre-defined responses, no LLM cost ──────────
    const egg = checkEasterEgg(message);
    if (egg) {
      emit({ type: "speaker", agent: egg.agent });
      // Type out the egg response token by token for the same UX feel
      const words = egg.text.split(" ");
      for (let i = 0; i < words.length; i++) {
        emit({ type: "token", agent: egg.agent, text: (i === 0 ? "" : " ") + words[i] });
      }
      emit({ type: "turn_end", agent: egg.agent });
      await this.db.logTurn(sid, egg.agent, egg.text);
      emit({ type: "done" });
      return;
    }

    const snip = transcript.slice(-1200);

    // 3B: Occasionally surface a past invention from the ledger as context
    // Fires ~25% of calls when ≥5 inventions exist — passive world-memory effect
    let pastInvContext = "";
    try {
      const pastInvs = await this.db.getInventions?.();
      if (pastInvs && pastInvs.length >= 5 && Math.random() < 0.25) {
        const pick = pastInvs[Math.floor(Math.random() * pastInvs.length)];
        pastInvContext = `\n(The Professor previously invented: ${pick.name} — outcome: ${pick.rating})`;
      }
    } catch {}

    const inv  = (this.todayInvention && this.inventionDiscussed)
      ? `\n(The Professor recently invented: ${this.todayInvention})${pastInvContext}`
      : pastInvContext;

    // Turn 1: best-matched primary
    const primary               = await this.routeAgent(message, transcript);
    const [lenInstr, maxTok]    = pickLength(true);
    const sysPrimary            = buildSysPrompt(primary, lenInstr, {
      autopilot: false, chaos: this.chaos,
      invention: this.visibleInvention, scheme: this.benderScheme,
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
        invention: this.visibleInvention, scheme: this.benderScheme,
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
  async startAutopilot(sid, emit, seedTopic = null) {
    this._resetCancel();
    const usedTopics = new Set();
    const weeklyMission = getWeeklyMission();
    let firstEpisode = true;

    const pickTopic = () => {
      if (firstEpisode && seedTopic) return seedTopic;
      // 15% chance to use the weekly episode goal as the topic
      // This makes it appear roughly once every 6-7 episodes, feel like a recurring arc
      if (Math.random() < 0.15 && !usedTopics.has("__weekly__")) {
        usedTopics.add("__weekly__");
        return `[EPISODE GOAL — ${weeklyMission.urgency}] ${weeklyMission.goal}`;
      }
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
      firstEpisode = false;

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
      if (this.visibleInvention && Math.random() < 0.3) {
        emit({ type: "invention_complication", invention: this.visibleInvention });
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
            invention:   this.visibleInvention,
            scheme:      this.benderScheme,
            tierNote,           // injected into system prompt
          });

          // ── Phase context ───────────────────────────────────────────────
          let ctx;
          if (EP_PHASE_PROMPTS[phaseName]) {
            const noRepeat = prevSaid
              ? `Do NOT repeat: "${prevSaid.slice(0,100)}" — say something new.\n`
              : "";
            const invNote = agentId === "PROF" && this.visibleInvention
              ? `\nYour invention (${this.visibleInvention}) is menacingly relevant.`
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

          // Wait for TTS to finish speaking this turn before the next agent starts
          // (falls back to a reading-time estimate if audio is muted).
          if (!this._cancelled) {
            await tts.waitForIdle(acc);
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
    this.inventionDiscussed = false; // new invention — requires Discuss with Crew before auto-surfacing
    emit({ type: "invention", text, agent: "PROF" });
    return text;
  }

  /**
   * Combine two past inventions into a Mega-Invention.
   * Costs 150 DM (already spent by caller). Saved to ledger with isMega:true.
   */
  async genMegaInvention(nameA, nameB, emit) {
    const prompt = `Combine these two inventions: "${nameA}" and "${nameB}".`;
    let text = `Good news, everyone! I've combined the ${nameA} and the ${nameB} into something magnificent and almost certainly fatal!`;
    try {
      text = await this.llm.complete(MEGA_INV_SYS, prompt, 80);
    } catch {}
    this.todayInvention = `${nameA} + ${nameB}`;
    this.inventionDiscussed = false; // new invention — requires Discuss with Crew before auto-surfacing
    emit({ type: "invention", text, agent: "PROF" });
    return text;
  }

  /**
   * Create a recycled invention from scrap items (free — scrap consumed by caller).
   */
  async genRecycledInvention(scrapNames, emit) {
    const prompt = `You salvaged parts from these scrapped inventions: ${scrapNames}. Create something new.`;
    let text = `Good news, everyone! From the ashes of failure, I have assembled the Salvage-O-Matic 3000 — it works by not working, which is a kind of working!`;
    try {
      text = await this.llm.complete(RECYCLED_INV_SYS, prompt, 65);
    } catch {}
    this.todayInvention = "Recycled contraption";
    this.inventionDiscussed = false; // new invention — requires Discuss with Crew before auto-surfacing
    emit({ type: "invention", text, agent: "PROF" });
    return text;
  }

  /**
   * Post-invention character critique.
   * Picks a random non-Professor crew member and has them react in one sentence.
   * Non-streaming (fast, 45 token cap). Called from sidepanel after invention renders.
   */
  /** Returns this week's episode goal, deterministically seeded by week number. */
  getWeeklyMission() {
    return getWeeklyMission();
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
