# 🚀 Planet Express Lounge

> *"Good news, everyone!"*

An AI-powered sitcom engine for your Chrome sidebar. Press one button and watch a cast of animated characters run a complete comedy episode — cold open, escalating complications, climax, and a punchline button — entirely on their own. Or chat with the cast directly, have them debate your questions, visit the Professor's lab, and earn delivery rewards for coming back. No server, no subscription, no installation beyond the extension. Bring your own API key and go.

---

## ✨ Features

### 💬 Chat
- Send any message and the most fitting character responds automatically
- 1–2 additional crew members jump in based on the topic
- LLM router + keyword matching selects the right voice for each question
- Pin any exchange to Cold Storage for later

### 🤖 Autopilot
- The crew picks a topic and runs a structured full sitcom episode with no input
- **Narrative tier system**: Tier 1 leads (~50% of lines), Tier 2 supporting (~30%), Tier 3 co-stars (~12%), Tier 4 cameo guests (~8%)
- Automatically detects focus episodes from topic keywords and elevates the relevant character
- Episode structure: Cold Open → Setup → Complication × 2 → Escalation → Resolution → Button
- Pause/Resume mid-episode without losing context
- Global mute acts as a pause button for LLM calls + TTS simultaneously

### 🧪 Professor's Lab
- **Invention generator**: LLM-powered announcements from the ship's mad scientist
- **Discuss with crew**: sends the invention to chat to spark a full debate
- Five interactive mini-apps:
  - 📦 Delivery Tracker — animated mission route with waypoints
  - 🤖 Character Conversations — rotating dialogue display with auto-cycle
  - 📺 Co-Anchor News — news broadcast widget with animated anchors
  - 📰 Neutral News — story ticker with Nixon rage meter

### 🎙️ Character Voices
- Chrome's native TTS engine with per-character pitch + rate profiles
- US English voices for core crew, UK English for theatrical/accented characters
- Individual mute toggles per character in Cast & Crew
- Global speed slider affects all characters proportionally

### 📌 Cold Storage
- Pin any exchange with one click
- Export any pin as a formatted printable HTML document
- Delete individually or wipe all

### 📦 Delivery Rewards
- One delivery per launch (12-hour cooldown)
- 10 milestone rewards tied to characters (🍕 at 1, 🤖 at 3, 👁️ at 5… 🌀 at 100)
- Progress bar and earned icons in the Lab tab

### ⚙️ Settings
- Provider + model selector with 🟢/🔴 token usage indicators
- API key storage (local only, never transmitted to developer)
- Chaos mode — TV-appropriate profanity and crew insults
- Light/Dark theme toggle
- Font size and voice speed sliders
- Cast & Crew — enable/disable individual characters + individual mute toggles

---

## 🔧 Setup

### Option A — Chrome Web Store
*(link available after publication)*

### Option B — Manual install (Developer Mode)
1. Download or clone this repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode** (top right)
4. Click **Load unpacked** → select the `pe_v4` folder (the one containing `manifest.json`)
5. The rocket icon appears in your toolbar

### Get your API key (2 minutes)
1. Go to **[console.groq.com](https://console.groq.com)** — create a free account, no credit card needed
2. Generate an API key
3. Open the extension sidebar → **⚙️ Settings** → paste your key → **Save & Connect**

The status dot turns green. Done.

**Alternative providers:** [OpenRouter](https://openrouter.ai/keys) (GPT-4o, Claude, many models) · [Google AI Studio](https://aistudio.google.com/app/apikey) (Gemini, free tier)

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
- Conversation history → Browser IndexedDB (`PlanetExpressLounge` database)
- Coin balance, delivery rewards, preferences → `chrome.storage.local`

The developer collects **zero analytics, zero telemetry, zero personal data**. The only network calls this extension makes are the ones you initiate — your messages going directly to your chosen API provider using your key.

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
