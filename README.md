# 🚀 Planet Express Lounge

> *"Good news, everyone!"*

An AI-powered sitcom engine for your Chrome sidebar. Press one button and watch the Futurama crew run a complete comedy episode — cold open, escalating complications, climax, and a punchline button — entirely on their own. Or chat with the cast directly, visit the Professor's lab, and earn delivery rewards for coming back. No server, no subscription, no account. Bring your own API key and go.

---

## 🎬 Try it first — no API key needed

Planet Express Lounge has a **Demo Mode** that activates automatically when you first install the extension without an API key. Chat shows four scripted exchanges with the real crew voices (TTS fully active), and Autopilot plays a complete hardcoded episode — cold open to button joke — so you can hear and feel the product before committing to setup. Demo mode disappears permanently and silently the moment you connect an API key.

---

## ✨ Features

### 💬 Chat
- Send any message and the most fitting character responds automatically
- LLM router + keyword matching selects the right voice for each question
- Right-click any selected text on any page → **🚀 Ask the Planet Express crew** to send it directly to chat
- **📌 SAVE** — pins the full chat transcript to Cold Storage
- **📋 SUMMARY** — generates a structured AI summary (purpose, problem, solution, joke, challenge, surprise, resolution) and saves it to Cold Storage — never printed to chat or spoken aloud
- Pin any individual turn to Cold Storage with the 📌 button on each message
- **🔗 SHARE** — share any line to Reddit, Facebook, X, or Email

### 🤖 Autopilot
- The crew picks a Futurama topic and runs a structured full sitcom episode with no input
- **Narrative tier system**: Tier 1 leads (~50% of lines), Tier 2 supporting (~30%), Tier 3 co-stars (~12%), Tier 4 cameo guests (~8%)
- Focus episode detection: topic keywords automatically elevate the relevant character to lead
- Episode structure: Cold Open → Setup → Complication × 2 → Escalation → Resolution → Button (50 turns total)
- Pause/Resume mid-episode without losing context
- **📋 EP SUMMARY** — generates a structured AI episode debrief (same 7-beat format as chat summaries) and saves it to Cold Storage
- **📌 SAVE** — saves the full autopilot transcript to Cold Storage
- Global mute (🔊/🔇) stops TTS and pauses LLM calls simultaneously

### 🌌 Dark Matter Widgets
Four collectible/unlockable mini-games in the Lab tab, all spending from
the same ⚛️ Dark Matter pool as the invention system:
- **📡 Aurebesh Relay** — 3 sequential tiers (each requires the previous): view the alien alphabet (50 ⚛️), then activate a live English ↔ Aurebesh translator (100 ⚛️), then breach the frequency to intercept encrypted crew chatter (50 ⚛️) — each intercepted transmission has a 💬 Discuss with Crew button
- **📜 Expedition Log** — break the wax seal (75 ⚛️) to start logging randomly-generated crew expedition reports. Each report can be 💬 discussed with the crew, turned into a 📖 3-5 sentence AI scenario (savable to Cold Storage and shareable), or 📌 saved to Cold Storage directly
- **👃 Smell-O-Scope™** — sniff for lore (50 ⚛️ per scan): random Futurama facts, easter eggs, and trivia, each with a crew reaction. Same 💬 Discuss / 📖 Scenario / 📌 Save options as the Expedition Log, for both the current scan and past Lab Notes entries
- **🥤 Beverage Machine** — dispense a random Slurm flavor (25 ⚛️ per spin), weighted by rarity, with a collectible flavor-can gallery showing how many of each you've collected (×N, capped at 10). Click any collected can to display it up top. ♻️ Recycle extra cans for ⚛️ Dark Matter (5–100 by rarity, Slurm Loco 50 ⚛️ / Slurm Slug Juice 75 ⚛️). 8 flavors including the secret 1%-drop **Milk** (250 ⚛️ to recycle)

### 🧪 Professor's Lab
- **Invention generator** — LLM-powered announcement from the ship's mad scientist, auto-rated success/failure and saved to the **Patent Office**
- **Discuss with crew** — sends the invention to chat to spark a full debate. Until you discuss it, new inventions stay private to the Lab and won't be referenced automatically in Autopilot
- **Patent Office** — browse filed inventions across ALL / SUCCESS / SCRAP HEAP tabs; scrap any invention for ⚛️ Dark Matter
- **Mega-Invention** — combine two filed inventions into one catastrophic device for 150 ⚛️
- **Recycled inventions** — combine 5 scrapped inventions into a free ♻️ recycled invention
- **Dark Matter Reactor** — passive currency earned over time, with a live usage history and delivery counter
- **Crew Wisdom** — rotating affirmations from the full cast, shown after the 4 Dark Matter Widgets

### 🎙️ Character Voices
- **🎙️ Voice Engine** (Settings, collapsible) — choose exactly one source: 💎 ElevenLabs (premium, optional BYOK — **free tier does not include API/TTS access**, paid plan required), 🖥️ OS voices (Windows/macOS, detected automatically), or 🌐 Chrome built-in. Switching takes effect immediately, including mid-Autopilot
- Per-character pitch and rate profiles tuned to each character's personality across all 18 cast members
- Individual mute toggles per character in Cast & Crew settings
- **Master volume** slider, voice speed slider, text scroll speed (WPM), and chat font size all independently adjustable
- Sending a new chat message interrupts any TTS still playing from the previous response
- The Narrator announces each Autopilot episode's title by voice (📺 "Tonight's episode...")
- Voice engine status shows detected OS, voice counts, and active mode

### 📌 Cold Storage
- Pin any agent or user turn with the 📌 button on any message
- AI summaries (chat and episode) are automatically saved here
- Full transcript saves (chat and autopilot) also stored here
- Export any pin as a formatted printable HTML document
- Delete individually or wipe all with one button

### 📦 Delivery Rewards
- Earn 1 "delivery" per 12 hours, triggered by finishing an Autopilot episode, logging an Expedition, generating an invention, or just having the panel open — whichever happens first
- 10 milestone rewards, each paying out Dark Matter: 🍕 at 1 (+10⚛️) · 🤖 at 3 (+20⚛️) · 👁️ at 5 (+30⚛️) · 🧪 at 10 (+50⚛️) · 💅 at 15 (+75⚛️) · 🦞 at 20 (+100⚛️) · ⭐ at 30 (+150⚛️) · 📋 at 50 (+250⚛️) · 🎩 at 75 (+400⚛️) · 🌀 at 100 (+1000⚛️)
- Past 100 ("LEGEND"), every 25 further deliveries grants a Legend Rank worth +50⚛️ — the counter never dead-ends
- Live delivery counter badge next to the Dark Matter Reactor
- Delivery log and milestone history in Settings → Delivery Log & Rewards (now the first section in Settings)

### ⚙️ Settings
- **Delivery Log & Rewards** — now the first section; milestone history, Dark Matter bonuses, and progress toward the next reward or Legend Rank
- **🔌 Provider & Model** (collapsible, open by default) — Groq, OpenRouter, or Gemini; recommended default is **llama-3.1-8b-instant** on Groq (free tier, fast, generous rate limits). API Keys nested inside as a sub-spoiler, with a 🔌 Test Connection button
- **🎙️ Voice Engine** (collapsible, collapsed by default) — ElevenLabs / OS / Chrome selector and API key live here; summary badge shows the active mode at a glance
- Chaos mode — TV-appropriate profanity injected into crew system prompts
- Light/Dark theme toggle (also via 🌙/☀️ in the header)
- Speed & Display spoiler: Text speed (WPM), Voice speed, Master volume, Font size
- Cast & Crew — enable/disable any of the 18 characters + individual mute toggles (minimum 1 active)
- Your Data — stored pin count + **🗑️ Clear All Data** to wipe everything

---

## ⌨️ Keyboard Shortcut

**Alt+Shift+P** — opens the sidebar from anywhere in Chrome (configurable via `chrome://extensions/shortcuts`)

---

## 🔧 Setup

### Option A — Chrome Web Store
*(link available after publication)*

### Option B — Manual install (Developer Mode)
1. Download or clone this repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked** → select the `pe_v5` folder (the one containing `manifest.json`)
5. The 🚀 toolbar icon appears

### Get your API key (2 minutes)
1. Go to **[console.groq.com](https://console.groq.com)** — free account, no credit card
2. Generate an API key
3. Open the extension sidebar → **⚙️ Settings** → paste your key → **Save & Connect**

The status dot turns green. Demo mode exits. Full access enabled.

**Alternative providers:** [OpenRouter](https://openrouter.ai/keys) (GPT-4o, Claude, many models) · [Google AI Studio](https://aistudio.google.com/app/apikey) (Gemini, free tier)

**Optional premium voices:** [ElevenLabs](https://elevenlabs.io) — add a separate API key in Settings → 💎 ElevenLabs for more expressive character voices. Defaults are pre-assigned to all 6 voice categories; a free tier is available, with own billing beyond it.

> **No API key yet?** Open the extension anyway — Demo Mode lets you hear the voices and watch an episode before you commit.

---

## 👥 Full Cast

All 18 characters across 4 narrative tiers:

| Tier | Character | Emoji | Role |
|---|---|---|---|
| 1 — Central Lead | Fry | 🍕 | Delivery Boy |
| 1 — Central Lead | Leela | 👁️ | Captain |
| 1 — Central Lead | Bender | 🤖 | Bending Unit |
| 2 — Core Supporting | Professor Farnsworth | 🧪 | Mad Scientist |
| 2 — Core Supporting | Amy Wong | 💅 | Intern |
| 2 — Core Supporting | Dr. Zoidberg | 🦞 | Ship Doctor |
| 2 — Core Supporting | Hermes Conrad | 📋 | Bureaucrat |
| 3 — Frequent Co-Star | Zapp Brannigan | ⭐ | DOOP Captain |
| 3 — Frequent Co-Star | Kif Kroker | 😔 | Lieutenant |
| 3 — Frequent Co-Star | Mom | 💼 | MomCorp CEO |
| 4 — Guest & Cameo | Morbo | 👽 | News Anchor |
| 4 — Guest & Cameo | Linda | 📰 | Co-Anchor |
| 4 — Guest & Cameo | LaBarbara Conrad | 💃 | Hermes' Wife |
| 4 — Guest & Cameo | Nixon's Head | 🎩 | President |
| 4 — Guest & Cameo | Calculon | 🎭 | Robot Actor |
| 4 — Guest & Cameo | Robot Santa | 🎅 | Judge of Naughty |
| 4 — Guest & Cameo | Hedonismbot | 🍇 | Pleasure Seeker |
| 4 — Guest & Cameo | Lrrr | 👾 | Omicronian Ruler |

---

## 🔒 Privacy

Everything stays on your device:
- API keys → `chrome.storage.local`
- Conversation history, pins, and AI summaries → Browser IndexedDB (`PlanetExpressLounge` database)
- Delivery rewards, voice settings, UI preferences → `chrome.storage.local`

The developer collects **zero analytics, zero telemetry, zero personal data**. The only network calls this extension makes are the ones you initiate — your messages going directly to your chosen API provider using your key, and (only if you've added one) voice synthesis requests to ElevenLabs using your separate optional premium key. Demo mode makes no network calls whatsoever.

[Full privacy policy](privacy_policy.html)

---

## ⚖️ Legal

**Futurama**, all character names, likenesses, catchphrases, and related elements are the intellectual property of **The Walt Disney Company** and its subsidiaries, including **20th Television Animation** (formerly 20th Century Fox Television). The series is distributed by **Hulu**.

This is an **independent, non-commercial fan project** created for personal entertainment and educational purposes only. It is not affiliated with, endorsed by, or connected to Disney, Hulu, 20th Television Animation, Matt Groening, or any associated rights holders.

No copyright infringement is intended. Character simulations are AI-generated parody under fair use principles (17 U.S.C. § 107). This extension runs entirely in your browser — no conversation data is stored on any external server.

For removal requests, open an issue in this repository.

---

## 👨‍💻 Developer

Built by **#DHSeaDev** — a personal fan project.

- [Privacy Policy](privacy_policy.html)
- Issues and removal requests: open a GitHub issue

*"Planet Express: our crew is replaceable. Your satisfaction is not."*
