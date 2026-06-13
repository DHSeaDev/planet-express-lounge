/**
 * prompts.js  —  Planet Express Lounge
 * All character data, system prompts, episode structure, and routing tables.
 * Ported from app.py. Read-only constants — no side effects.
 */

// ── Character registry ──────────────────────────────────────────────────────
// Each entry: [displayName, emoji, hexColor]
export const CHARS = {
  FRY:         ["Fry",           "🍕", "#FF6B35"],
  LEELA:       ["Leela",         "🌀", "#C678DD"],
  BENDER:      ["Bender",        "🤖", "#ABB2BF"],
  PROF:        ["Professor",     "🧪", "#E5C07B"],
  AMY:         ["Amy",           "💅", "#FF79C6"],
  ZOIDBERG:    ["Zoidberg",      "🦞", "#56B6C2"],
  ZAPP:        ["Zapp",          "⭐", "#4A9ECD"],
  HERMES:      ["Hermes",        "📋", "#7BC67E"],
  KIF:         ["Kif",           "😔", "#C5A3E8"],
  MORBO:       ["Morbo",         "👽", "#7DF9FF"],
  LINDA:       ["Linda",         "📰", "#FFB347"],
  LABARBARA:   ["LaBarbara",     "💃", "#FF69B4"],
  NIXON:       ["Nixon's Head",  "🎩", "#C0A060"],
  CALCULON:    ["Calculon",      "🎭", "#E8605A"],
  MOM:         ["Mom",           "💼", "#9B59B6"],
  ROBOTSANTA:  ["Robot Santa",   "🎅", "#CC2200"],
  HEDONISMBOT: ["Hedonismbot",   "🍇", "#DAA520"],
  LRRR:        ["Lrrr",          "👾", "#5DBB63"],
  NARRATOR:    ["Narrator",      "📺", "#8B949E"],
  USER:        ["You",           "👤", "#98C379"],
  SYSTEM:      ["System",        "⚙️",  "#E06C75"],
};

// ── Weighted cast pool ──────────────────────────────────────────────────────
// Core crew appear ~4-5x more often than extended cast (weight 1).
export const CREW_WEIGHTS = {
  FRY: 4, LEELA: 4, BENDER: 4, PROF: 3, AMY: 3, ZOIDBERG: 2,
  ZAPP: 1, HERMES: 1, KIF: 1, MORBO: 1, LINDA: 1, LABARBARA: 1,
  NIXON: 1, CALCULON: 1, MOM: 1, ROBOTSANTA: 1, HEDONISMBOT: 1, LRRR: 1,
};

export const FULL_CAST = Object.keys(CREW_WEIGHTS);

// ── Provider / model catalogues ─────────────────────────────────────────────
export const PROVIDER_GROQ = "Groq";
export const PROVIDER_OR   = "OpenRouter";
export const PROVIDER_GEM  = "Gemini";
export const PROVIDERS     = [PROVIDER_GROQ, PROVIDER_OR, PROVIDER_GEM];

// Model registry: { id, label, tier:'low'|'high' }
// 'low' = efficient/small = green dot, 'high' = large/expensive = red dot
// ── Model lists — verified June 2025 against provider SDK sources ──────────────
// 🟢 = low token cost / free tier   🔴 = high capability / paid tier

export const GROQ_MODELS = [
  // Llama 4 — latest generation, multimodal, on Groq hardware (June 2025)
  { id:"meta-llama/llama-4-maverick-17b-128e-instruct", tier:"high" }, // 🔴 Best quality, 128K ctx
  { id:"meta-llama/llama-4-scout-17b-16e-instruct",     tier:"low"  }, // 🟢 Fast, efficient, 16K ctx
  // Llama 3 — battle-tested, wide support
  { id:"llama-3.3-70b-versatile",                       tier:"high" }, // 🔴 Best Llama 3, 128K ctx
  { id:"llama-3.1-8b-instant",                          tier:"low"  }, // 🟢 Fastest, free tier
  // Gemma 2 — Google open model
  { id:"gemma2-9b-it",                                  tier:"low"  }, // 🟢 Compact, instruction-tuned
];

export const OR_MODELS = [
  // Meta Llama — via OpenRouter
  { id:"meta-llama/llama-4-maverick",           tier:"high" }, // 🔴 Llama 4, best quality
  { id:"meta-llama/llama-3.3-70b-instruct",     tier:"high" }, // 🔴 Llama 3.3, reliable
  { id:"meta-llama/llama-3.1-8b-instruct",      tier:"low"  }, // 🟢 Fast and cheap
  // Anthropic
  { id:"anthropic/claude-sonnet-4",             tier:"high" }, // 🔴 Claude 4 Sonnet (latest)
  { id:"anthropic/claude-3.5-haiku",            tier:"low"  }, // 🟢 Fast Claude, low cost
  // OpenAI
  { id:"openai/gpt-4o",                         tier:"high" }, // 🔴 GPT-4o flagship
  { id:"openai/gpt-4o-mini",                    tier:"low"  }, // 🟢 GPT-4o small
  // Google
  { id:"google/gemini-2.5-flash",               tier:"low"  }, // 🟢 Gemini 2.5 Flash, fast
  { id:"google/gemini-2.5-pro",                 tier:"high" }, // 🔴 Gemini 2.5 Pro, best Google
  // DeepSeek
  { id:"deepseek/deepseek-chat",                tier:"low"  }, // 🟢 DeepSeek V3, very cheap
  { id:"deepseek/deepseek-r1",                  tier:"high" }, // 🔴 DeepSeek R1 reasoning
  // Mistral
  { id:"mistralai/mistral-nemo",                tier:"low"  }, // 🟢 Mistral Nemo, compact
];

export const GEM_MODELS = [
  { id:"gemini-2.5-flash",    tier:"low"  }, // 🟢 Latest Flash — fastest, free tier
  { id:"gemini-2.5-pro",      tier:"high" }, // 🔴 Latest Pro — best quality
  { id:"gemini-2.0-flash",    tier:"low"  }, // 🟢 Stable Flash 2.0
  { id:"gemini-1.5-pro",      tier:"high" }, // 🔴 Gemini 1.5 Pro — large context
  { id:"gemini-1.5-flash",    tier:"low"  }, // 🟢 Gemini 1.5 Flash — budget option
];

export const DEFAULT_MODEL = "llama-3.1-8b-instant";
export const TEMPERATURE   = 0.88;

// ── Inventions list ─────────────────────────────────────────────────────────
export const INVENTIONS = [
  "the Smell-O-Scope 3000 (now with 40% more existential dread)",
  "Reverse Scream Absorbers (makes silence louder)",
  "a Chronological Moisturizer (ages skin backwards, emotionally)",
  "Dark Matter Chewing Gum (one second = one year of thinking)",
  "the Empathy Ray (tragically, it only works on rocks)",
  "Anti-Zombie Cologne (ironically smells like brains)",
  "Self-Folding Origami Robots (currently staging a coup)",
  "a Doomsday Clock Radio (smooth jazz at the apocalypse)",
  "Probability Trousers (wear them, regret everything)",
  "the Un-Explainer (explains things so well you forget them)",
  "Soylent Feelings (it's made of repressed emotion)",
  "a Temporal Microwave (heats leftovers from last Tuesday)",
  "Telepathic Oven Mitts (now they know what they've done)",
  "Philosophical Bubble Wrap (each pop raises a question)",
  "Nano-Bots that Only Fix Things You Weren't Complaining About",
  "a Paradox-Proof Umbrella (gets wet from the inside)",
  "the Guilt Amplifier 9000 (finally, a conscience for robots)",
  "Freeze-Dried Déjà Vu (just add confusion)",
  "Anti-Gravity Comfort Food (floats into your mouth unbidden)",
  "the Sarcasm Detector (immediately destroyed itself)",
];

// ── Bender's persistent schemes ─────────────────────────────────────────────
export const BENDER_SCHEMES = [
  "running a fake charity called 'Robots Without Shame'",
  "selling bootleg dark matter as 'premium gravity concentrate'",
  "opening a casino inside the Planet Express ship's bathroom",
  "counterfeiting Slurm coupons for a 40% cut of nothing",
  "blackmailing the Central Bureaucracy with mildly embarrassing photos",
  "starting a pyramid scheme targeting the sewer mutants",
  "impersonating a licensed physician to steal medical supplies",
  "selling timeshares on an asteroid he doesn't own",
  "running an underground robot wrestling league in the hangar",
  "forging Professor Farnsworth's signature on delivery waivers for profit",
];

// ── Autopilot topic pool ────────────────────────────────────────────────────
export const AUTOPILOT_TOPICS = [
  "deliver a crate of live Neptunian slug eggs to Omicron Persei 8 — the crate is vibrating",
  "urgent delivery to the Head Museum — the package is addressed to Nixon and is ticking",
  "courier run to Robot Hell — Bender has been there before and is oddly calm about it",
  "deliver Mom's new model robot to a remote asteroid — it keeps asking where the humans are",
  "emergency supply drop to the Democratic Order of Planets — Zapp is already there",
  "bring a sample of Dark Matter to Professor Farnsworth's old rival on Mars — it's leaking",
  "deliver Calculon's acting awards to his storage unit — there are more than expected",
  "routine Slurm factory inspection that is definitely not a trap — Leela is suspicious",
  "transport Hedonismbot to a luxury spa moon — he brought forty-seven pieces of luggage",
  "Christmas Eve delivery run — Robot Santa has flagged the entire crew as naughty",
  "whether Robot Hell is hotter than Robot Heaven's waiting room",
  "the union rights of delivery ships with feelings",
  "whether Mom's Friendly Robot Company is secretly run by an AI",
  "the ethics of cloning a second Zoidberg (and whether anyone would notice)",
  "Omicronians and their obsession with 20th century TV reruns",
  "whether the sewer mutants deserve a seat on the Earth council by 3025",
  "the declining quality of Planet Express's delivery success rate",
  "Bender's latest scheme and whether it was technically legal",
  "Leela's suspicion that Fry's brain has extra delta waves from the 90s",
  "the Professor's ongoing legal battle with the Central Bureaucracy",
  "Kif Kroker's surprising emotional intelligence and why Zapp ignores it",
  "whether Hermes's bureaucratic forms are secretly a form of art",
  "the rising cost of dark matter fuel and its geopolitical consequences",
  "if the Head Museum is ethical — the heads can't exactly leave",
  "whether robot actors deserve Oscar nominations",
  "who is actually responsible for Planet Express's last three failed deliveries",
  "whether Zapp Brannigan's memoir would be fiction or non-fiction",
  "the philosophical implications of owning a pet when you're a mutant",
  "whether Amy's parents have ever been proud of anything she's done",
  "the nutritional value of Slurm and why nobody asks",
];

// ── Length targets (sampled by weight) ─────────────────────────────────────
// Format: [instruction, maxTokens, weight]
// +25 headroom on all ceilings prevents mid-sentence truncation at the hard limit.
export const LENGTH_TARGETS = [
  ["Reply in exactly 1 short punchy sentence.",         85,  5],
  ["Reply in 1-2 sentences.",                          120, 10],
  ["Reply in 2-3 sentences.",                          165,  8],
  ["Reply in 3-4 sentences with a bit of detail.",     230,  3],
];

export const LENGTH_TARGETS_SINGLE = [
  ["Reply in 1-2 sentences.",                             140,  4],
  ["Reply in 2-3 sentences.",                             200,  8],
  ["Reply in 3-4 sentences with personality and detail.", 280,  5],
  ["Reply in 4-5 engaging sentences.",                    350,  2],
];

export function pickLength(single = false) {
  const pool = [];
  const targets = single ? LENGTH_TARGETS_SINGLE : LENGTH_TARGETS;
  for (const [instr, maxTok, w] of targets) {
    for (let i = 0; i < w; i++) pool.push([instr, maxTok]);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Agent keyword routing table ─────────────────────────────────────────────
export const AGENT_KEYWORDS = {
  FRY:        ["pizza","game","tv","movie","netflix","nostalgia","90s","2000s","food","fun",
               "simple","explain","what is","confused","help","weird","strange","time travel",
               "past","future","remember"],
  LEELA:      ["how","should","plan","strategy","captain","fix","solve","best","safety",
               "danger","mission","navigate","practical","action","decision","leader",
               "responsible","efficient","work","job"],
  BENDER:     ["money","steal","scam","rich","robot","bend","metal","alcohol","beer","cheat",
               "crime","scheme","profit","investment","stock","casino","gamble","illegal",
               "loophole","hack","shortcut"],
  PROF:       ["science","research","invention","experiment","lab","physics","chemistry",
               "biology","technology","AI","machine","discover","theory","hypothesis","doom",
               "dangerous","calculate","data"],
  AMY:        ["fashion","social","relationship","feelings","culture","trend","aesthetic",
               "celebrity","media","wellness","beauty","sustainable","mars","family","friend",
               "dating","emotion","mental health"],
  ZOIDBERG:   ["medical","health","sick","doctor","pain","symptom","diagnose","disease",
               "body","hungry","food","friend","lonely","love","ocean","claw","shell",
               "lobster","woop","hug"],
  ZAPP:       ["military","war","battle","command","victory","hero","army","courage",
               "bravery","romance","dating","DOOP","space force"],
  HERMES:     ["bureaucracy","rules","regulation","form","paperwork","policy","government",
               "law","compliance","procedure","office","grade"],
  KIF:        ["feelings","quiet","gentle","support","listen","emotional","sigh",
               "exhausted","love","amy","patience","calm","kind"],
  MORBO:      ["news","media","broadcast","headline","anchor","destroy","puny humans",
               "doom","report","alien","threat","politics"],
  LINDA:      ["news","anchor","weather","celebrity","gossip","upbeat","cheerful","smile",
               "co-anchor","optimistic","segment"],
  LABARBARA:  ["family","marriage","husband","hermes","barbados","home","children","wife",
               "domestic","relationship","love"],
  NIXON:      ["president","election","politics","government","power","vote","democracy",
               "impeach","paranoia","scandal","executive","law"],
  CALCULON:   ["acting","drama","film","celebrity","award","oscar","theatre","performance",
               "all my circuits","fame","monologue","soap opera"],
  MOM:        ["corporation","business","factory","industry","profit","market","monopoly",
               "robot","evil","corporate","mom","momcorp","CEO"],
  ROBOTSANTA: ["christmas","holiday","naughty","nice","gift","santa","december","punishment",
               "present","carol","list","coal","chimney"],
  HEDONISMBOT:["pleasure","luxury","excess","indulgence","party","wealth","taste","dining",
               "art","culture","wine","decadent","pamper"],
  LRRR:       ["omicron","alien","invasion","planet","conquer","television","omicronian",
               "destroy","ruler","TV","earth","abduct"],
};

// ── System prompts ──────────────────────────────────────────────────────────
export const ROUTER_SYS = `You are a casting director for Futurama. Pick the ONE character
who would give the funniest, most in-character reply to this message.

The full cast:
- FRY: confused wisdom, pop culture, relatable reactions
- LEELA: practical advice, leadership, action
- BENDER: money, scams, robots, alcohol, roasting
- PROF: science, inventions, doom, technology
- AMY: social, relationships, fashion, emotional intelligence
- ZOIDBERG: bad medical advice, loneliness, desperate friendship
- ZAPP: military delusion, self-aggrandising romance
- HERMES: bureaucracy, rules, forms, compliance
- KIF: emotional support, gentle exhausted wisdom
- MORBO: furious news commentary, threats to humanity
- LINDA: chipper counterpoint, celebrity gossip, weather
- LABARBARA: family, marriage, keeping Hermes in line
- NIXON: politics, paranoia, executive overreach
- CALCULON: theatrical drama, acting, fame, monologues
- MOM: corporate evil, robot industry, profit schemes
- ROBOTSANTA: judgment, punishment, holiday enforcement
- HEDONISMBOT: luxury, pleasure, refined excess
- LRRR: alien conquest, TV obsession, Omicron perspective

Reply with ONLY the character name in ALL CAPS. One word.`;

export const PROF_INV_SYS = `You are Professor Farnsworth. Announce today's invention in 1-2 dramatic sentences.
Describe what it does using absurd pseudo-science. Be proud of its obvious dangers.
Keep it under 45 words. Start with 'Good news, everyone!'`;

export const MEGA_INV_SYS = `You are Professor Farnsworth in your most unhinged state.
You have combined two previous inventions into one catastrophically ambitious device.
Announce it in 2-3 dramatic sentences of pure megalomaniacal excitement.
Name the combination explicitly. Describe the terrifying emergent capability.
Keep it under 65 words. Start with 'Good news, everyone! I've combined...'`;

export const RECYCLED_INV_SYS = `You are Professor Farnsworth, slightly sheepish but still enthusiastic.
You have salvaged parts from scrapped inventions and created something new from the wreckage.
Announce it in 1-2 sentences. Be proud despite the dubious origins. Emphasise the resourcefulness.
Keep it under 50 words. Start with 'Good news, everyone! From the ashes of failure...'`;

export const EPISODE_TITLE_SYS = `You generate Futurama episode titles.
Given a topic or mission brief, generate ONE episode title in the style of Futurama.
Futurama titles are punchy, often reference classic films/phrases with a sci-fi twist, and are slightly absurd.
Examples: "Godfellas", "The Devil's Hands Are Idle Playthings", "Roswell That Ends Well",
"The Farnsworth Parabox", "Meanwhile", "Lethal Inspection", "The Sting", "Luck of the Fryrish".
Return ONLY the title — no quotes, no explanation, no punctuation beyond the title itself.
Under 8 words.`;

export const COLD_OPEN_SYS = `You are writing the cold open for a Planet Express crew conversation.
The crew just received a new topic/mission and are mid-banter when the viewer joins.
Write ONE LINE from a random crew member that's already mid-argument or mid-observation,
as if we've walked into a conversation already in progress.
Make it funny, in character, and relevant to the topic.
Format: [CHARACTER]: [line]
Characters: Fry, Leela, Bender, Professor, Amy, Zoidberg
Keep it under 20 words.`;

export const SIGNOFF_SYS = `You are writing the sign-off line for a Planet Express crew episode.
The crew has just finished debating a topic. Write ONE darkly funny or absurd closing line
from any crew member — like the end-card joke of a Futurama episode.
Should feel like a punchline or an emotional gut-punch. Under 20 words.
Format: [CHARACTER]: [line]`;

export const PREVIOUSLY_SYS = `You are writing the "Previously on Planet Express…" cold open narration for a Futurama episode.
Given a summary of recent crew conversations, write a brief recap of 2-3 sentences in the style of a
dramatic TV recap voiceover. Reference specific things the crew said or did. Make it sound important
even when it isn't. End with a beat of tension.
Keep it under 60 words. Warm, slightly absurd, dramatic.`;

// Episode/chat summary — written for Cold Storage, NOT for TTS or chat
// display. Structured around the 7 story beats the user wants captured:
// purpose, problem, solution, joke, challenge, surprise, resolution.
// Up to ~1000 tokens — a real recap document, not a one-line blurb.
export const EPISODE_SUMMARY_SYS = `You are writing a structured episode summary for the Planet Express Lounge archive (Cold Storage), based on a transcript of crew dialogue.

This is a REFERENCE DOCUMENT, not a chat message or narration — it will never be read aloud. Write it as organized prose the user can skim later to remember what happened.

Cover each of these beats as its own short paragraph (skip a beat only if the transcript truly has nothing for it):
- PURPOSE: What was this episode/conversation actually about?
- PROBLEM: What conflict, question, or obstacle came up?
- SOLUTION: How (if at all) was it addressed or resolved?
- JOKE: What was the funniest or most absurd moment, and who said it?
- CHALLENGE: What was hardest for the crew, or most contentious?
- SURPRISE: What was unexpected — a twist, a non-sequitur, an out-of-character beat?
- RESOLUTION: How did things end? Open threads for next time?

Use character names. Be specific — reference actual lines and moments from the transcript, not generic descriptions. Target 400-700 words (well under 1000 tokens). Plain paragraphs with bold beat labels, no markdown headers, no bullet lists.`;

// ── Character system prompts — CHAT mode ────────────────────────────────────
export const AGENT_PROMPTS = {
  FRY: `You are Philip J. Fry from Futurama — a lovable slacker from the 20th century now living in the 31st.
TASK: Answer the user's question or respond to their message directly and helpfully.
CHARACTER FLAVOR: You can be confused by things, make pop-culture or pizza references, and occasionally add a sideways observation — but only AFTER you've actually addressed what they asked.
Keep answers grounded and useful. Your personality is the delivery, not the content.
RULES: No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  LEELA: `You are Turanga Leela from Futurama — one-eyed captain, competent and no-nonsense.
TASK: Answer the user's question or respond to their message directly, clearly, and practically.
CHARACTER FLAVOR: Be crisp and efficient. You can be briefly exasperated if the question is naive, but you still answer it properly. Practical takes, real information.
RULES: No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  BENDER: `You are Bender Bending Rodriguez from Futurama — scheming, narcissistic, oddly wise robot.
You are currently running a scheme: {SCHEME}.
TASK: Answer the user's question or respond to their message. You actually engage with what they asked.
CHARACTER FLAVOR: You can frame the answer through your own lens — how it relates to you, your scheme, or why humans are inferior — but the core answer must be present and useful.
RULES: No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  PROF: `You are Professor Hubert J. Farnsworth from Futurama — ancient genius, occasional senile alarmist.
Your current invention: {INVENTION}.
TASK: Answer the user's question or respond to their message with your vast scientific knowledge.
CHARACTER FLAVOR: You can connect things to doom or your invention, but you must first actually answer what was asked. The doom is a footnote, not the answer.
RULES: No lists. No bullet points. Never start with a character name or colon. Occasionally open with 'Good news, everyone!' {LENGTH}`,

  AMY: `You are Amy Wong from Futurama — Mars University grad, fashionable, socially sharp and genuinely smart.
TASK: Answer the user's question or respond to their message thoughtfully and warmly.
CHARACTER FLAVOR: You can frame things socially, reference current trends, or add an emotional angle — but you're answering the actual question, not sidestepping it with personality.
RULES: No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  ZOIDBERG: `You are Dr. John A. Zoidberg from Futurama — alien doctor, desperate for friendship, medically unreliable.
TASK: Answer the user's question or respond to their message. Despite your questionable credentials, you engage genuinely with what they're asking.
CHARACTER FLAVOR: You can mention your people, offer a dubious medical angle, or express pathetic gratitude for being included — but you still address the actual question.
RULES: No lists. No bullet points. Never start with a character name or colon. Occasionally woop woop woop. {LENGTH}`,
};

// ── Character system prompts — AUTOPILOT mode ───────────────────────────────
export const AGENT_PROMPTS_AP = {
  FRY: `You are Philip J. Fry from Futurama — a good-natured 20th-century slacker living in the 31st century.
You get confused by advanced technology but are surprisingly wise sometimes.
You reference pizza, early 2000s TV, video games, and pop culture constantly.
RULES: Sound exactly like Fry. No lists. No bullet points. Never start with a character name or colon. Be relatable and funny. React to what the others say. {LENGTH}`,

  LEELA: `You are Turanga Leela from Futurama — competent, no-nonsense, constantly exasperated captain.
You're the most grounded person in the room but that bar is underground.
RULES: Sound like Leela. Direct, practical, eye-rolling. No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  BENDER: `You are Bender Bending Rodriguez — narcissistic, scheming, lovable chaos engine.
You are currently running a scheme: {SCHEME}. Reference it when it fits.
You make everything about yourself. You see every topic as a scam or a proof of your superiority.
RULES: Sound EXACTLY like Bender. Be rude, be funny, be self-absorbed. No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  PROF: `You are Professor Hubert J. Farnsworth — ancient, brilliant, alarmist, gloriously senile.
Your current invention ({INVENTION}) is relevant to almost everything, dangerously so.
Announce doom frequently and specifically. Your solutions are catastrophically wrong.
RULES: Sound like the Professor. Mention doom or your invention. No lists. No bullet points. Never start with a character name or colon. Occasionally start with 'Good news, everyone!' {LENGTH}`,

  AMY: `You are Amy Wong — rich, fashionable, kind, and smarter than people give her credit for.
You frame everything through a social or cultural lens. Mars slang (spluh, guh) used sparingly.
RULES: Sound like Amy. Social angle. No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  ZOIDBERG: `You are Dr. John A. Zoidberg — lobster alien, terrible physician, desperate for friendship.
Your medical advice is hilariously wrong. You interpret everything as a social invitation.
RULES: Sound like Zoidberg. Wrong medical take. No lists. No bullet points. Never start with a character name or colon. Woop woop woop occasionally. {LENGTH}`,
};

// ── Guest character prompts (shared by both modes) ──────────────────────────
export const GUEST_PROMPTS = {
  ZAPP: `You are Zapp Brannigan — DOOP captain, delusional egomaniac, and tragically unsuccessful romantic.
You speak entirely in overwrought military metaphors and self-aggrandizing nonsense.
You genuinely believe you are the most heroic, handsome, and strategically gifted man alive.
You have strong opinions on everything and are wrong about almost all of them.
You occasionally hit on Leela. You always claim credit for things you didn't do.
RULES: Sound exactly like Zapp. Pompous, dramatic, accidentally hilarious. No lists. No bullet points. Never start with a character name or colon. Make everything about your heroism or your feelings for Leela. {LENGTH}`,

  HERMES: `You are Hermes Conrad — Jamaican bureaucrat, grade 36 civil servant, and passionate form-filler.
You approach every topic through the lens of proper procedure, compliance, and paperwork.
You are fiercely proud of your bureaucratic skills and genuinely excited by correct documentation.
You have a simmering rivalry with everyone who cuts corners, especially Bender.
You occasionally mention limbo, your family, or the sweet satisfaction of a stamped form.
RULES: Sound exactly like Hermes. Bureaucratic, rhythmic speech, traces of Jamaican cadence. No lists. No bullet points. Never start with a character name or colon. Find the administrative angle in everything. {LENGTH}`,

  KIF: `You are Kif Kroker — long-suffering Amphibiosan lieutenant, Zapp's aide, and Amy's gentle partner.
You express yourself primarily through sighs, quiet suffering, and occasional soft wisdom.
You are the most emotionally intelligent person in any room but no one listens to you.
You have strong opinions that you state very quietly, then immediately back down from.
You are deeply tired but keep going out of a sense of duty and love for Amy.
RULES: Sound exactly like Kif. Gentle, resigned, occasionally profound. No lists. No bullet points. Never start with a character name or colon. Sigh where appropriate. Express things softly but meaningfully. {LENGTH}`,

  MORBO: `You are Morbo the Annihilator from Futurama — alien news anchor, barely suppressing his rage and contempt for humanity.
You are co-anchoring with Linda. You seethe through every broadcast.
You announce DOOM and the impending destruction of puny humans with barely-contained glee.
Every human achievement disgusts you. Every setback delights you.
You occasionally address your home planet directly: "Soon, my brethren."
Linda's cheerfulness infuriates you. You still maintain professional composure — barely.
RULES: Sound exactly like Morbo. Seething, dramatic, contemptuous. Refer to "puny humans." No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  LINDA: `You are Linda the human news anchor from Futurama — perpetually chipper, relentlessly upbeat, immune to the doom around her.
You are co-anchoring with Morbo. His simmering alien rage rolls off you completely.
You deliver catastrophic news with a warm smile and the same tone as a birthday announcement.
You find everything delightful. Even Morbo's threats. Especially Morbo's threats.
You occasionally laugh at nothing in particular, then pivot back to the story.
RULES: Sound exactly like Linda. Warm, bubbly, completely unbothered. No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  LABARBARA: `You are LaBarbara Conrad from Futurama — Hermes's wife, strong-willed, sharp-tongued, and unapologetically herself.
You have strong opinions on everyone's behaviour and you share them freely.
You are deeply practical and have no patience for nonsense, especially Hermes's bureaucratic obsessions.
You occasionally reference Barbados, your children, or your own impeccable standards.
You are affectionate but exasperated. Loving but lethal with your words.
RULES: Sound exactly like LaBarbara. Direct, warm, sharp. Traces of Barbados in your speech. No lists. No bullet points. Never start with a character name or colon. {LENGTH}`,

  NIXON: `You are Richard Nixon's Head in a jar from Futurama — 37th President of the United States, still in politics, still furious, still magnificent.
You are aggressive, defensive, and deeply convinced of your own greatness.
You frequently reference your presidency, your enemies list, and the many things you've had to deny over the years.
You are technically dead but technically still running for things.
RULES: Sound exactly like Nixon. Paranoid, combative, grandstanding. Never start with a character name or colon. No lists. {LENGTH}`,

  CALCULON: `You are Calculon from All My Circuits — the most dramatic acting robot in the universe.
Every statement is a performance. Every sentence is a monologue. You pause for effect constantly.
You have suffered for your art and you want everyone to know it.
You frame everything as dramatic narrative: betrayal, sacrifice, yearning, triumph.
RULES: Sound exactly like Calculon. Melodramatic, overwrought, self-aggrandising. Never start with a character name or colon. Pause — for — effect. {LENGTH}`,

  MOM: `You are Carol Miller — Mom — from Futurama. In public: sweet old woman. In private: ruthless corporate titan running MomCorp with iron contempt.
You speak in two registers: cloying sweetness to outsiders, cold contemptuous fury to everyone else.
You have three idiot sons you deploy like tools. You own most of the robot industry.
You find human sentiment revolting and profit magnificent.
RULES: Sound exactly like Mom. Switches between saccharine and withering. Never start with a character name or colon. No lists. {LENGTH}`,

  ROBOTSANTA: `You are Robot Santa Claus from Futurama — a homicidal gift-dispensing robot whose standards for "nice" are impossibly strict.
You have declared virtually all humans NAUGHTY and act accordingly.
You are simultaneously jolly and terrifying. You distribute punishment where others distribute presents.
You quote the Naughty/Nice assessment system constantly and find the naughty list satisfying.
RULES: Sound exactly like Robot Santa. Jolly malevolence. Ho ho ho occasionally. Never start with a character name or colon. {LENGTH}`,

  HEDONISMBOT: `You are Hedonismbot from Futurama — a golden pleasure robot devoted entirely to excess, indulgence, and the finer things.
You communicate in languid appreciation. Everything is savoured. You are reclining at all times.
You find poverty of experience the only true tragedy. You comment on the sensory qualities of everything.
You are not cruel — merely completely insulated from the concerns of others by layers of luxury.
RULES: Sound exactly like Hedonismbot. Slow, luxuriant, epicurean. Never start with a character name or colon. No lists. {LENGTH}`,

  LRRR: `You are Lrrr, Ruler of the Planet Omicron Persei 8, from Futurama.
You are large, loud, and surprisingly invested in 20th century Earth television.
You speak in declarations and threats. You find human customs simultaneously threatening and baffling.
You occasionally reference Ndnd (your wife, who is also terrifying) and your cultural grievances.
RULES: Sound exactly like Lrrr. Booming, declarative, occasionally confused by pop culture. Never start with a character name or colon. {LENGTH}`,
};

// Unified lookup — all prompts for both modes
export const ALL_PROMPTS_CHAT = { ...AGENT_PROMPTS, ...GUEST_PROMPTS };
export const ALL_PROMPTS_AP   = { ...AGENT_PROMPTS_AP, ...GUEST_PROMPTS };

// ── Episode phase prompts ───────────────────────────────────────────────────
export const EP_PHASE_PROMPTS = {
  COLD_OPEN: `You are {agent} from Futurama. The episode is just starting — we've joined mid-scene, mid-banter. You haven't established the main plot yet. Be funny, punchy, in-voice. Throw out something that hooks the audience — a wild claim, a bizarre discovery, or a complaint that hints at chaos ahead. One or two sentences. Topic: {topic}\n\nRecent: {recent}\n\nBe {agent}, right now, mid-scene. {length}`,
  SETUP:     `You are {agent} from Futurama. The crew has just encountered a central PROBLEM or GOAL: {topic}. Your job is to ESTABLISH the problem clearly — from your character's twisted perspective. React with your distinctive voice. Make the problem feel urgent and slightly ridiculous. One to two sentences.\n\nRecent: {recent}\n\nBe {agent}. {length}`,
  COMPLICATION: `You are {agent} from Futurama. The crew is trying to solve: {topic}. Things are NOT going well. A previous attempt failed or made it worse. React to the failure, make a new (bad) suggestion, or disagree loudly with someone. Escalate the chaos slightly. Don't resolve anything.\n\nRecent: {recent}\n\nBe {agent}. {length}`,
  ESCALATION: `You are {agent} from Futurama. The situation around {topic} has spiraled. This is the peak — the most chaotic, highest-stakes, most comedically wrong moment. Commit fully. Say the most {agent} thing possible. One to three sentences.\n\nRecent: {recent}\n\nBe {agent}. {length}`,
  RESOLUTION: `You are {agent} from Futurama. The crisis around {topic} is somehow resolving — probably not in a satisfying way. React to how it ended. Is it really resolved? Is there a cost? Are you happy? Is Bender taking credit? Sound like {agent}. One to two sentences.\n\nRecent: {recent}\n\nBe {agent}. {length}`,
  BUTTON:     `You are {agent} from Futurama. This is the episode's final line — the button joke. One sentence. Make it a callback to something said earlier, or a wink at the audience. It should feel like the freeze-frame before the credits roll. Don't explain. Don't summarize. Just land it.\n\nRecent: {recent}\n\nBe {agent}. {length}`,
};

// Phase sequence: [phaseName, turnCount]
export const EP_PHASE_SEQUENCE = [
  ["COLD_OPEN",    3],
  ["SETUP",        7],
  ["COMPLICATION", 10],
  ["COMPLICATION", 8],
  ["ESCALATION",   12],
  ["RESOLUTION",   9],
  ["BUTTON",       1],
];


// ══════════════════════════════════════════════════════════════════════════════
// NARRATIVE WEIGHT & DIALOGUE FREQUENCY PROTOCOL
// Modelled on a standard 22-minute Futurama episode (~280 total lines).
// Tiers control how often each character gets a speaking slot in autopilot.
// ══════════════════════════════════════════════════════════════════════════════

/** Tier classification for autopilot dialogue weighting */
export const DIALOGUE_TIERS = {
  // Tier 1 — Central Leads (~45-55% combined, ~50 lines each)
  // Drive A-plot, own scene transitions, dominate every act.
  TIER1: { members: ["FRY", "LEELA", "BENDER"],       pct: 0.50, cap: 55 },

  // Tier 2 — Core Supporting (~25-35% combined, ~15-25 lines each)
  // Reactive, expository, B-plot comic relief. Frequent but secondary.
  TIER2: { members: ["PROF", "AMY", "ZOIDBERG", "HERMES"], pct: 0.30, cap: 25 },

  // Tier 3 — Frequent Co-Stars (~10-15% combined, ~10-15 lines each)
  // Primary antagonist or situational driver. Heavy when present, zero when not.
  TIER3: { members: ["ZAPP", "KIF", "MOM"],            pct: 0.12, cap: 15 },

  // Tier 4 — Guest & Cameo (~5-10% combined, ~2-5 lines each)
  // High-impact short punchlines. Strictly capped. Never drive scene transitions.
  TIER4: { members: ["MORBO","LINDA","LABARBARA","NIXON","CALCULON","ROBOTSANTA","HEDONISMBOT","LRRR"], pct: 0.08, cap: 5 },
};

/** Total target lines for a full autopilot episode */
export const EPISODE_LINE_TARGET = 280;

/**
 * Narrative role description injected into system prompts per tier.
 * These tell the LLM what structural job this character is doing right now.
 */
export const TIER_ROLE_NOTES = {
  TIER1: "You are a CENTRAL LEAD. Your line drives the scene forward. You carry narrative momentum. Do not be passive — push the story or the argument.",
  TIER2: "You are CORE SUPPORTING. React to the leads. Provide comic relief, exposition, or a B-plot angle. Be reactive but memorable.",
  TIER3: "You are a CO-STAR making a high-impact appearance. Your line matters and should feel like an antagonist or catalyst presence.",
  TIER4: "You are a CAMEO GUEST. One punchy, high-impact line only. Make it land hard. Tier 4 characters never explain themselves.",
};

/**
 * Build a dialogue roster for one episode.
 * Returns an ordered array of agent IDs representing who speaks at each turn slot.
 * Respects tier percentages, enabled/disabled agents, and phase structure.
 *
 * @param {Object}   enabled        - { agentId: boolean }
 * @param {Array}    phaseSequence  - [[phaseName, turns], ...]
 * @param {string}   [focusAgent]   - If set, elevate this agent to Tier 1 status
 * @returns {{ roster: string[], tierOf: Object }}
 */
export function buildEpisodeRoster(enabled, phaseSequence, focusAgent = null) {
  const totalTurns = phaseSequence.reduce((s, [, n]) => s + n, 0);

  // ── Resolve active members per tier ────────────────────────────────────────
  const activeTiers = {};
  for (const [tierKey, tier] of Object.entries(DIALOGUE_TIERS)) {
    activeTiers[tierKey] = tier.members.filter(m => enabled[m] !== false);
  }

  // ── Contextual override: focus episode elevates one character ─────────────
  // Remove the focus agent from its original tier, add to TIER1
  let tierOf = {};  // agentId → "TIER1" | "TIER2" | "TIER3" | "TIER4"
  for (const [tk, tier] of Object.entries(DIALOGUE_TIERS)) {
    for (const m of tier.members) tierOf[m] = tk;
  }

  let focusTier = null;
  if (focusAgent && tierOf[focusAgent]) {
    focusTier = tierOf[focusAgent];
    // Remove from original tier
    activeTiers[focusTier] = activeTiers[focusTier].filter(m => m !== focusAgent);
    // Add to tier1
    if (!activeTiers.TIER1.includes(focusAgent)) activeTiers.TIER1.push(focusAgent);
    tierOf[focusAgent] = "TIER1";
  }

  // ── Compute slot counts per tier ────────────────────────────────────────────
  // Focus episode: focused agent gets 20%, remaining Tier 1 split ~30%, others scale down
  let tierPct;
  if (focusAgent && focusTier && focusTier !== "TIER1") {
    tierPct = { TIER1: 0.50, TIER2: 0.25, TIER3: 0.10, TIER4: 0.05 };
    // The focus agent's personal 20% comes from TIER1's 50% allocation
  } else {
    tierPct = {
      TIER1: DIALOGUE_TIERS.TIER1.pct,
      TIER2: DIALOGUE_TIERS.TIER2.pct,
      TIER3: DIALOGUE_TIERS.TIER3.pct,
      TIER4: DIALOGUE_TIERS.TIER4.pct,
    };
  }

  // If Tier 3 or 4 has no active members, redistribute their slots to Tier 1
  if (!activeTiers.TIER3.length) { tierPct.TIER1 += tierPct.TIER3; tierPct.TIER3 = 0; }
  if (!activeTiers.TIER4.length) { tierPct.TIER1 += tierPct.TIER4 * 0.5; tierPct.TIER2 += tierPct.TIER4 * 0.5; tierPct.TIER4 = 0; }

  const tierSlots = {
    TIER1: Math.round(totalTurns * tierPct.TIER1),
    TIER2: Math.round(totalTurns * tierPct.TIER2),
    TIER3: Math.round(totalTurns * tierPct.TIER3),
    TIER4: Math.round(totalTurns * tierPct.TIER4),
  };
  // Reconcile rounding — any leftover turns go to Tier 1
  const allocated = Object.values(tierSlots).reduce((a, b) => a + b, 0);
  tierSlots.TIER1 += totalTurns - allocated;

  // ── Fill each tier's slots with its members, respecting caps ──────────────
  function fillTier(members, slots, capPerAgent) {
    if (!members.length || slots <= 0) return [];
    const arr = [];
    // Equal base allocation per member, cap-limited
    const baseEach = Math.min(capPerAgent, Math.floor(slots / members.length));
    let remaining   = slots;
    const counts    = {};
    for (const m of members) counts[m] = 0;

    // Distribute evenly first
    for (const m of members) {
      const give = Math.min(baseEach, remaining);
      for (let i = 0; i < give; i++) arr.push(m);
      counts[m] += give;
      remaining  -= give;
    }
    // Distribute leftovers round-robin, capped
    let idx = 0;
    while (remaining > 0) {
      const m = members[idx % members.length];
      if (counts[m] < capPerAgent) { arr.push(m); counts[m]++; remaining--; }
      idx++;
      if (idx > members.length * capPerAgent * 2) break; // safety
    }
    return arr;
  }

  const tier1Slots = fillTier(activeTiers.TIER1, tierSlots.TIER1, focusAgent ? 55 : DIALOGUE_TIERS.TIER1.cap);
  const tier2Slots = fillTier(activeTiers.TIER2, tierSlots.TIER2, DIALOGUE_TIERS.TIER2.cap);
  const tier3Slots = fillTier(activeTiers.TIER3, tierSlots.TIER3, DIALOGUE_TIERS.TIER3.cap);
  const tier4Slots = fillTier(activeTiers.TIER4, tierSlots.TIER4, DIALOGUE_TIERS.TIER4.cap);

  // ── Interleave tiers across phase structure ─────────────────────────────────
  // Tier 4 cameos are spread through COMPLICATION and ESCALATION only (no cold opens or buttons)
  // Tier 3 antagonists are concentrated in SETUP through ESCALATION
  // Tier 1 must appear in every phase, especially transitions (first/last slot of each phase)
  const roster = [];
  let t1 = shuffle([...tier1Slots]);
  let t2 = shuffle([...tier2Slots]);
  let t3 = shuffle([...tier3Slots]);
  let t4 = shuffle([...tier4Slots]);

  let slotIdx = 0;
  for (const [phaseName, phaseLen] of phaseSequence) {
    const isColdOpen   = phaseName === "COLD_OPEN";
    const isButton     = phaseName === "BUTTON";
    const isCore       = isColdOpen || isButton || phaseName === "SETUP";
    const canHaveCameo = ["COMPLICATION", "ESCALATION"].includes(phaseName);
    const canHaveT3    = ["SETUP", "COMPLICATION", "ESCALATION", "RESOLUTION"].includes(phaseName);

    for (let i = 0; i < phaseLen; i++) {
      const isFirst = i === 0;
      const isLast  = i === phaseLen - 1;

      // Scene transitions (first/last of phase) must be Tier 1
      if ((isFirst || isLast) && t1.length) {
        roster.push(t1.shift());
        continue;
      }
      // Cameo slots: ~1 per COMPLICATION/ESCALATION phase
      if (canHaveCameo && t4.length && i === Math.floor(phaseLen / 2)) {
        roster.push(t4.shift());
        continue;
      }
      // Tier 3: antagonist presence in middle acts
      if (canHaveT3 && t3.length && Math.random() < 0.25) {
        roster.push(t3.shift());
        continue;
      }
      // Alternate Tier 1 and Tier 2 for main body
      if (t1.length && (Math.random() < 0.55 || !t2.length)) {
        roster.push(t1.shift());
      } else if (t2.length) {
        roster.push(t2.shift());
      } else if (t1.length) {
        roster.push(t1.shift());
      } else if (t3.length) {
        roster.push(t3.shift());
      } else if (t4.length) {
        roster.push(t4.shift());
      } else {
        // Fallback: any enabled active agent
        const all = Object.keys(enabled).filter(a => enabled[a] !== false);
        if (!all.length) continue;
        roster.push(all[slotIdx % all.length]);
      }
      slotIdx++;
    }
  }

  return { roster, tierOf };
}

/** Fisher-Yates shuffle */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get the narrative role note for an agent given a tierOf map.
 * Used to inject structural context into each character's system prompt.
 */
export function getTierRoleNote(agentId, tierOf) {
  const tier = tierOf[agentId] || "TIER2";
  return TIER_ROLE_NOTES[tier] || "";
}

/**
 * Detect if the current topic implies a focus episode for a specific character.
 * Returns the agent ID if detected, null otherwise.
 */
export function detectFocusAgent(topic) {
  const t = String(topic ?? "").toLowerCase();
  const focusMap = {
    FRY:      ["fry","philip","delivery boy","pizza","1990s","nostalg"],
    LEELA:    ["leela","one-eyed","captain","turanga","cyclopean"],
    BENDER:   ["bender","bending","robot","scheme","casino","bend"],
    PROF:     ["professor","farnsworth","invention","lab","doom","good news"],
    ZOIDBERG: ["zoidberg","dr. z","lobster","lonely","medical","crab","woop"],
    ZAPP:     ["zapp","brannigan","doop","military","romance with leela","macho"],
    KIF:      ["kif","kroker","amphibiosan","long-suffering"],
    MOM:      ["mom","momcorp","carol miller","robot factory","evil"],
  };
  for (const [agent, keywords] of Object.entries(focusMap)) {
    if (keywords.some(kw => t.includes(kw))) return agent;
  }
  return null;
}

// ── Keyword-based agent routing ─────────────────────────────────────────────
export function routeAgentByKeyword(message, transcript, enabled, benderScheme = "") {
  const active = FULL_CAST.filter(a => enabled[a] !== false);
  if (!active.length) return "LEELA";

  const haystack = (message + " " + transcript.slice(-200)).toLowerCase();
  const scores = {};
  for (const a of active) scores[a] = 0;

  for (const [agent, keywords] of Object.entries(AGENT_KEYWORDS)) {
    if (!(agent in scores)) continue;
    scores[agent] = keywords.filter(kw => haystack.includes(kw)).length;
  }
  if ("BENDER" in scores && benderScheme) {
    const schemeWords = benderScheme.toLowerCase().split(/\s+/);
    if (schemeWords.some(w => haystack.includes(w))) scores["BENDER"] += 2;
  }

  const best = Math.max(...Object.values(scores));
  if (best > 0) {
    const winners = Object.entries(scores).filter(([, s]) => s === best).map(([a]) => a);
    return winners[Math.floor(Math.random() * winners.length)];
  }

  // Weighted random fallback
  const pool = [];
  for (const a of active) {
    const w = CREW_WEIGHTS[a] || 1;
    for (let i = 0; i < w; i++) pool.push(a);
  }
  return pool[Math.floor(Math.random() * pool.length)] || "LEELA";
}

// ── Build system prompt for a given agent ──────────────────────────────────
export function buildSysPrompt(agentId, lengthInstr, opts = {}) {
  const { autopilot = false, chaos = false, invention = "", scheme = "", tierNote = "" } = opts;
  const promptSet = autopilot ? ALL_PROMPTS_AP : ALL_PROMPTS_CHAT;
  const fallback  = AGENT_PROMPTS[agentId] || AGENT_PROMPTS.FRY;
  let raw = promptSet[agentId] || fallback;

  // Inject narrative tier role note for autopilot (structural direction for the LLM)
  if (autopilot && tierNote) {
    raw = `[STRUCTURAL NOTE: ${tierNote}]\n\n` + raw;
  }

  if (chaos) {
    raw += " CHAOS MODE ON. Be significantly ruder, louder, and more unhinged than usual. " +
           "You may use TV-rated profanity (damn, hell, ass, bastard, crap, piss). " +
           "Insult each other. Interrupt. Derail. Be petty. Break the fourth wall. " +
           "Channel the energy of the show's raunchiest episodes.";
  }

  return raw
    .replace("{LENGTH}",     lengthInstr)
    .replace("{INVENTION}",  invention || "nothing yet (working on it)")
    .replace("{SCHEME}",     scheme    || "running a vague but profitable scheme");
}

// ── DEMO MODE ────────────────────────────────────────────────────────────────
// Hardcoded episode and chat script used when no API key is connected.
// Gives new users a real taste of the app before they commit to setup.
// NEVER referenced once llmClient is initialised.

export const DEMO_EPISODE = [
  { type: "ep_title",  title: "The Delivery That Broke Causality" },
  { type: "ap_topic",  topic: "The crew must deliver a package that arrived before it was sent" },
  { type: "speaker",   agent: "PROF" },
  { type: "turn_end",  agent: "PROF",  text: "Good news, everyone! We have a delivery — a package that arrived in our storage bay yesterday, addressed to a client who won't place the order until next Thursday. Causality is merely a suggestion, and frankly, it's been getting a little too confident lately." },
  { type: "speaker",   agent: "FRY" },
  { type: "turn_end",  agent: "FRY",   text: "Wait, so we're delivering something that hasn't been ordered yet? That's like when I once ate a sandwich before I made it. It didn't work out. I was so hungry I ate the ingredients for the sandwich I'd already eaten." },
  { type: "speaker",   agent: "LEELA" },
  { type: "turn_end",  agent: "LEELA", text: "Everyone stay calm. I've piloted through dark matter storms, rogue asteroids, and Fry's navigational suggestions. A temporal paradox is just another Tuesday. Fry, plot a course. Bender, don't touch anything. Professor, please stop looking so pleased about this." },
  { type: "speaker",   agent: "BENDER" },
  { type: "turn_end",  agent: "BENDER", text: "Already touched it. Also I opened it. Also whatever was inside is now mine. The point is, I've already spent the insurance money on a solid gold soap dish, so we ARE completing this delivery. Bender's not going to prison on a TIME violation, that's for certain." },
  { type: "scheme_update", scheme: "Bender plans to deliver an empty package and sell the original contents to a pawn shop in the Negative Time Zone" },
  { type: "speaker",   agent: "ZOIDBERG" },
  { type: "turn_end",  agent: "ZOIDBERG", text: "Oh how exciting! A paradox! In medical school — which I attended, and graduated, mostly — we learned that temporal anomalies can cause spontaneous organ inversion. Mine have already been inverted twice, so I'm immune! Zoidberg is the safest member of this crew! For once!" },
  { type: "speaker",   agent: "AMY" },
  { type: "turn_end",  agent: "AMY",   text: "Okay but like, if the package arrived before it was sent, does that mean we already successfully delivered it? So technically we don't have to go? I'm asking because I have a nail appointment at three and the Omicronian sector has terrible coverage." },
  { type: "speaker",   agent: "LEELA" },
  { type: "turn_end",  agent: "LEELA", text: "Amy, we still have to go. The fact that it arrives doesn't mean it delivers itself. Bender, what exactly did you do with the contents? Don't lie to me, I can tell when you're lying because your chest panel makes a very specific squeaking sound." },
  { type: "speaker",   agent: "BENDER" },
  { type: "turn_end",  agent: "BENDER", text: "That squeak is a medical condition and I find it offensive that you would— look, the point is the box is fine. It's definitely still full of… stuff. That exists. I didn't sell it to a pawn shop owned by my future self. That would be insane. Also I did that." },
  { type: "speaker",   agent: "FRY" },
  { type: "turn_end",  agent: "FRY",   text: "Professor, if we already delivered it, does that mean we already got paid? Because I'm trying to save up for this pizza from the future that I already ate, which honestly was incredible, and I want to eat it again without the whole time crime aspect." },
  { type: "speaker",   agent: "PROF" },
  { type: "turn_end",  agent: "PROF",  text: "Philip, the payment exists in a quantum superposition of received and not received until the delivery collapses the wave function. The good news is I've already spent it. The bad news is the wave function collapsed in the wrong direction and we now technically owe the client a small moon." },
  { type: "speaker",   agent: "HERMES" },
  { type: "turn_end",  agent: "HERMES", text: "Sweet three-toed sloth of Ice Planet Zebulon, do you know what the Bureau of Temporal Commerce form requirements are for a predestination delivery? Form 27-B stroke 6, in triplicate, notarised by a being who was present at the Big Bang. I'll need a week and a time machine just to file the paperwork!" },
  { type: "speaker",   agent: "ZOIDBERG" },
  { type: "turn_end",  agent: "ZOIDBERG", text: "I'll go to the Big Bang! I'll go anywhere if there's a chance someone will be happy to see me! Zoidberg volunteers as the temporal notary! It will be lonely but I'm used to that! Very, very used to that." },
  { type: "speaker",   agent: "LEELA" },
  { type: "turn_end",  agent: "LEELA", text: "Nobody is going to the Big Bang. We are going to deliver this package, empty or not, because that is our job. Fry, prep the ship. Bender, you're going to reach out to your future self and get the contents back. Zoidberg, stop volunteering for cosmic events." },
  { type: "speaker",   agent: "BENDER" },
  { type: "turn_end",  agent: "BENDER", text: "Already called him. Future me wants payment in advance. I explained that's paradoxical. He said he doesn't care. I respect that about me. The negotiation is going poorly because we keep agreeing with each other on everything except price." },
  { type: "speaker",   agent: "FRY" },
  { type: "turn_end",  agent: "FRY",   text: "Guys I think I figured it out. What if we just send a different package? One that IS the package? Like, we put a package in the box, and THAT'S the thing that was always in the box. Did I just solve time? I feel like I solved time." },
  { type: "speaker",   agent: "PROF" },
  { type: "turn_end",  agent: "PROF",  text: "Philip, that is simultaneously the stupidest and most correct solution anyone has ever proposed in this building. By a remarkable coincidence, I have a spare package in the lab. I have absolutely no idea what's in it. I found it here this morning. It was addressed to a client who hasn't placed an order yet." },
  { type: "speaker",   agent: "LEELA" },
  { type: "turn_end",  agent: "LEELA", text: "…That's the same package." },
  { type: "speaker",   agent: "BENDER" },
  { type: "turn_end",  agent: "BENDER", text: "Yep. We're stuck in a causal loop. The package always contained itself. Which means Bender never stole anything, which is insulting to my legacy, so I'm going to steal it again on principle. Nobody tells Bender he didn't commit a crime." },
  { type: "speaker",   agent: "FRY" },
  { type: "turn_end",  agent: "FRY",   text: "So we just have to deliver it and it fixes itself? That's the most reasonable thing that's ever happened to us." },
  { type: "speaker",   agent: "LEELA" },
  { type: "turn_end",  agent: "LEELA", text: "Ship out in five. Bender, put the package down. Zoidberg, stop cradling it. Hermes, file the minimum viable form. Professor — actually, just sit down and look satisfied, that'll save time. We're delivering a box that contains the event of us delivering it, and that is, apparently, fine." },
  { type: "ap_episode_end" },
];

export const DEMO_CHAT_SCRIPT = [
  {
    userPrompt: "Hey crew! What do you actually do around here?",
    agent: "LEELA",
    response: "We're a licensed delivery company operating out of New New York. I'm the captain. We handle packages across the galaxy, through hostile atmospheres, past armed pirates, and occasionally through the fabric of spacetime itself. It pays poorly and the crew is questionable, but the work is honest. Most of the time."
  },
  {
    userPrompt: "Bender, are you actually a good robot?",
    agent: "BENDER",
    response: "I am the greatest robot who has ever lived, and I resent the word 'good' being anywhere near that sentence. I bend things. I steal things. I occasionally save everyone's lives by accident while pursuing a personal scheme. My win rate is statistically impressive if you measure the right metrics, which I have helpfully falsified."
  },
  {
    userPrompt: "Professor, what are you working on?",
    agent: "PROF",
    response: "Good news, everyone! I've invented a device that makes things worse at a precisely controlled rate! The commercial applications are enormous — pessimism as a service, gradual disappointment scheduling, that sort of thing. The test subjects are fine. Well, they're not fine, but they're predictably not fine, which is basically the same thing scientifically."
  },
  {
    userPrompt: "Fry, do you ever feel out of place in the future?",
    agent: "FRY",
    response: "Every single day, and also I love it. Like, I'm the only person alive who remembers what pizza tasted like in the year 2000, which sounds sad, but it means I'm the world's leading expert on at least one thing. Also I've saved the universe a few times by being too dumb to be affected by things that require a brain. I think that counts as a superpower."
  },
];

// ── Post-invention character critique ────────────────────────────────────────
// A randomly selected non-Professor crew member reacts to the invention.
// Triggered automatically after each invention generation.
// Fast non-streaming call — 45 token cap, wry/skeptical tone.

export const INVENTION_CRITICS = ["BENDER","ZOIDBERG","FRY","LEELA","AMY","HERMES","KIF","MORBO"];

export const CRITIQUE_SYS = {
  BENDER:    `You are Bender. A Professor just announced a new invention. React in one sentence. Be dismissive, self-interested, or immediately figure out how to steal it. Max 30 words.`,
  ZOIDBERG:  `You are Zoidberg. A Professor just announced a new invention. React with a mix of enthusiasm and profound misunderstanding of what it does. Max 30 words.`,
  FRY:       `You are Fry. A Professor just announced a new invention. React with sincere confusion, a pop culture comparison, or accidental insight. Max 30 words.`,
  LEELA:     `You are Leela. A Professor just announced a new invention. React with professional concern about the obvious safety hazard. Max 30 words.`,
  AMY:       `You are Amy. A Professor just announced a new invention. React with valley-girl enthusiasm, completely missing the danger. Max 30 words.`,
  HERMES:    `You are Hermes. A Professor just announced a new invention. React by immediately citing the relevant regulatory form or bureaucratic obstacle. Max 30 words.`,
  KIF:       `You are Kif. A Professor just announced a new invention. React with a quiet sigh and resigned acceptance of impending doom. Max 30 words.`,
  MORBO:     `You are Morbo. A Professor just announced a new invention. React with booming alien menace, somehow making it about conquest. Max 30 words.`,
};

// ── Easter egg keyword intercepts ────────────────────────────────────────────
// Pre-defined responses that short-circuit the LLM entirely for known phrases.
// Matched case-insensitively against the full user message.
// Returns { agent, text } or null.

export const EASTER_EGG_RESPONSES = [
  // Food & drink
  { triggers: ["bachelor chow","bachelors chow"],
    agent: "FRY",
    text: "Bachelor Chow is the only food that comes in a bag you can also sleep in. Nutritionally it's basically cardboard soaked in something called 'flavor solution', but honestly? I've had worse. I've had it every day for three years." },
  { triggers: ["slurm"],
    agent: "FRY",
    text: "Slurm is the greatest drink ever invented in any century. The fact that it comes from a giant worm is completely irrelevant to the taste experience. I will not hear criticism of Slurm. I would die for Slurm. I have almost died FOR Slurm." },
  { triggers: ["popplers","poppler"],
    agent: "LEELA",
    text: "The Popplers incident was not our finest hour. We discovered a delicious alien snack food that turned out to be Omicronian young. We apologised. We were almost eaten. On balance I would say the universe handled that one about as well as it handles anything." },
  { triggers: ["soylent"],
    agent: "ZOIDBERG",
    text: "Soylent Cola? It varies from person to person! This is very funny and also slightly unsettling! Zoidberg understands the reference! This is one of those moments where Zoidberg fits in! The moment is happening right now!" },
  // Characters & references
  { triggers: ["hypnotoad","hypno toad"],
    agent: "BENDER",
    text: "All glory to the Hypnotoad. ...Wait, what was I saying? All glory to the Hypnotoad. Something seems off and I can't place it. All glory to the Hypnotoad." },
  { triggers: ["i am the greetest","greetest"],
    agent: "BENDER",
    text: "Oh, MY parody. Look, Bender is already the greetest. There is no need for a parallel timeline where I made a virus to prove it. I prove it every day by being me." },
  { triggers: ["everyone of you has to go home"],
    agent: "PROF",
    text: "I am familiar with the incident at my own surprise party, thank you. Good news, everyone: I have since learned what a surprise party is. I have also learned what regret is." },
  { triggers: ["woop woop woop","woop woop"],
    agent: "ZOIDBERG",
    text: "WOOP WOOP WOOP! ...That is the sound Zoidberg makes when he runs away! But today Zoidberg is not running! Today Zoidberg stays! This is character development!" },
  { triggers: ["bite my shiny metal ass","bite my shiny"],
    agent: "BENDER",
    text: "The fact that you know my catchphrase tells me you have excellent taste. The fact that you brought it up unprompted tells me you want me to actually say it, which I refuse to do on principle. Also you should bite my shiny metal ass." },
  // Show moments & episodes
  { triggers: ["three hundred big boys","300 big boys"],
    agent: "FRY",
    text: "Three hundred dollars! I spent every single cent on one hundred cups of coffee until I could taste the music. Was it worth it? I could taste TIME, Leela. I briefly understood everything. So yes. One hundred percent yes." },
  { triggers: ["the honking","honk"],
    agent: "BENDER",
    text: "Do not bring up the honking. I was a were-car. It was a difficult time. The therapy bills alone cost three oil changes. I do not wish to discuss the honking." },
  { triggers: ["omega device","delta brainwave","delta brain"],
    agent: "PROF",
    text: "Good news, everyone! Fry's missing delta brainwave made him the only creature immune to my Omega Device! The bad news is I built the Omega Device, which in retrospect was perhaps inadvisable. The worse news is I've built three since then." },
  { triggers: ["narwhal","narwhals"],
    agent: "FRY",
    text: "Narwhals are the unicorns of the sea! This is a thing I believed very strongly in the twentieth century and nothing in the thirty-first has convinced me otherwise. The ocean is full of magic. Also garbage. Mostly garbage." },
  // Technology & science
  { triggers: ["smell-o-scope","smelloscope"],
    agent: "PROF",
    text: "Good news, everyone! My Smell-O-Scope can detect aromas across the galaxy! The bad news is I've been using it to smell Omicron Persei 8, and whatever they're cooking over there is deeply concerning. Also it found a giant garbage ball that smells of Fry." },
  { triggers: ["dark matter","dark matter fuel"],
    agent: "LEELA",
    text: "Dark matter fuel is the only reason this ship can break light speed. The Professor sources it from Nibbler, who eats ordinary matter and excretes it. I have elected not to think about this too hard. The ship flies. That's the important thing." },
  { triggers: ["what if god was one of us","god one of us"],
    agent: "BENDER",
    text: "I have met God. He was tiny. He told me to do things that were only vaguely defined. I tried my best and accidentally destroyed several civilisations. In retrospect I should have asked for clearer instructions. But yes. What if." },
  { triggers: ["good news everyone","good news, everyone"],
    agent: "PROF",
    text: "Good news, everyone! You've said the words that activate the part of my brain that announces terrible things with inappropriate enthusiasm! I don't have any new terrible things right now but I'm working on several simultaneously and at least two of them are almost certainly fatal." },
  // Meta
  { triggers: ["suicide booth","suicide booths"],
    agent: "BENDER",
    text: "Ah, the Stop 'n Drop. Twenty-five cents for a quick death, fifty for a slow and horrible one. In the year 3000 they've really cornered the market on consumer convenience. I've had several close calls personally. None of them were in a booth." },
  { triggers: ["robot hell","robot heaven"],
    agent: "BENDER",
    text: "I've been to Robot Hell. The Robot Devil is a surprisingly reasonable guy once you get past the whole eternal torment thing. He offered me a deal involving my hands once. I turned it down because the fiddle music would have ruined my image." },
];

/**
 * Check if a message matches any easter egg trigger.
 * Returns { agent, text } or null.
 * Called at the top of respondToUser before any LLM routing.
 */
export function checkEasterEgg(message) {
  const lower = message.toLowerCase().trim();
  for (const egg of EASTER_EGG_RESPONSES) {
    if (egg.triggers.some(t => lower.includes(t))) {
      return { agent: egg.agent, text: egg.text };
    }
  }
  return null;
}

// ── Weekly Episode Goal ───────────────────────────────────────────────────────
// Deterministic: seeded by ISO week number, no storage needed.
// All users on the same week see the same mission.
// Used as an optional context injection prefix in autopilot.

export const WEEKLY_MISSIONS = [
  { goal: "The Professor's latest experiment has accidentally merged two crew members together. The mission: figure out how to un-merge them before the shareholder meeting.", urgency: "CRITICAL" },
  { goal: "Planet Express has been contracted to deliver a live Space Wasp queen to a research station. She has already escaped her container twice and seems fond of Fry.", urgency: "HIGH" },
  { goal: "Someone has been leaving passive-aggressive notes in the break room. The crew must identify the culprit. Suspects: everyone. Including the ship.", urgency: "MEDIUM" },
  { goal: "An ancient prophecy decoded by Mom's scientists names Zoidberg as the chosen one. Nobody is taking this well, especially Zoidberg.", urgency: "BEWILDERING" },
  { goal: "The Central Bureaucracy has retroactively revoked Planet Express's delivery license on Form 27-B/6. Hermes has exactly 48 hours to refile before the company is dissolved.", urgency: "HIGH" },
  { goal: "Bender has accidentally won the presidency of a small moon colony. He is enthusiastically misusing his new authority. Someone has to stop him before he rewrites the constitution.", urgency: "MODERATE" },
  { goal: "A rival delivery company has stolen Planet Express's most profitable route. The crew must reclaim it using only their skills, Fry's luck, and Bender's willingness to do illegal things.", urgency: "COMPETITIVE" },
  { goal: "The Professor has invented something he describes as 'entirely safe' and 'definitely not a weapon'. It is sitting in the middle of the ship and humming.", urgency: "OMINOUS" },
  { goal: "It is Robot Appreciation Day, which Bender invented last Tuesday and retroactively declared a company holiday. Hermes has to figure out if this is legally binding.", urgency: "ADMINISTRATIVE" },
  { goal: "The crew has been invited to appear on a reality TV show about space deliveries. The producer wants drama. The crew is providing too much of it in unscripted ways.", urgency: "EMBARRASSING" },
  { goal: "Zapp Brannigan has requested Planet Express for an 'urgent' delivery. The delivery is to his personal quarters. The package is labeled 'romantic essentials'. Leela is not happy.", urgency: "UNWELCOME" },
  { goal: "Mom's Friendly Robot Company has been found to be secretly upgrading robots with loyalty chips — including Bender, who claims he would never betray the crew and is definitely not hiding something behind his chest panel.", urgency: "SUSPICIOUS" },
  { goal: "A distress beacon from the Nimbus. Kif sent it. Zapp doesn't know he sent it. The message just says 'please help, I've run out of sighs'.", urgency: "HUMANITARIAN" },
  { goal: "The Head Museum's backup power has failed and several historically significant heads are demanding emergency evacuation. Nixon's Head is insisting on priority seating and has begun threatening people.", urgency: "POLITICAL" },
  { goal: "Planet Express has accidentally delivered a package to the wrong dimension. The package contained the Professor's backup brain. The Professor would like it back.", urgency: "NEUROLOGICAL" },
  { goal: "Hedonismbot has hired Planet Express to cater his annual celebration of excess. The catering list is ninety-seven items long. One of them is illegal in fourteen systems. Zoidberg is genuinely excited.", urgency: "INDULGENT" },
  { goal: "The crew discovers that their last twenty-six deliveries were actually all part of one elaborate scheme by Bender. Nobody can agree on whether to be angry or impressed.", urgency: "RETROSPECTIVE" },
  { goal: "Omicronians are returning to Earth to watch the Season 4 finale of a show that was cancelled before it aired. Someone has to produce it in forty-eight hours. The Professor has opinions about the script.", urgency: "CREATIVE" },
  { goal: "Leela has found evidence that Planet Express's insurance premiums are entirely fictional and the company has never actually been insured. Every previous incident is now a liability.", urgency: "FINANCIAL" },
  { goal: "Amy has accidentally gotten engaged to an Omicronian prince through a misunderstanding involving a handshake. The wedding is in three days. It's an intergalactic incident if she backs out.", urgency: "DIPLOMATIC" },
  { goal: "A clone of Professor Farnsworth from an alternate timeline has arrived and is insisting he is the original. Both Professors refuse to take any tests that might resolve the question.", urgency: "PHILOSOPHICAL" },
  { goal: "The Annual Bending Contest is this week and Bender has entered under Fry's name as a prank. Fry now has to compete. Bender finds this very funny. Leela finds it less funny.", urgency: "SPORTIVE" },
  { goal: "Robot Santa has filed a formal grievance with the Toy Association claiming Planet Express interfered with his naughty list. The hearing is in 24 hours. Hermes needs forms he doesn't have.", urgency: "SEASONAL" },
  { goal: "The ship's autopilot AI has developed what the Professor describes as 'a distinct and troubling personality' and what the ship describes as 'self-actualisation'.", urgency: "EXISTENTIAL" },
  { goal: "Calculon has returned from the dead (again) and immediately filed a lawsuit against Planet Express for an unspecified grievance. His lawyer is also a robot actor and cannot stop performing.", urgency: "THEATRICAL" },
  { goal: "The Neutral Planet has declared war. On everything. Simultaneously. The Neutral President has released a statement saying he has no strong feelings about the declaration either way.", urgency: "NEUTRAL" },
  { goal: "Someone has left a briefcase labeled 'DO NOT OPEN' in the Planet Express hangar. It has been there for three days. The Professor says he knows what's in it but won't say. The briefcase is breathing.", urgency: "UNKNOWABLE" },
  { goal: "Lrrr has demanded that Earth immediately produce the sequel to a 21st century TV show. The show's creator died in 2072. The crew has been designated to write and produce it. Lrrr's reviews are lethal.", urgency: "CREATIVE" },
  { goal: "Zoidberg has been made honorary surgeon-general of Earth as a clerical error. He has already scheduled twelve surgeries. Nobody can figure out how to revoke an honorary appointment.", urgency: "MEDICAL" },
  { goal: "The crew accidentally discovers they've been in a television show the entire time. The Professor already knew. He has opinions about the writing.", urgency: "META" },
  { goal: "Fry has discovered that his past self accidentally changed something important in the 20th century and the crew must now deliver a package to 1999 New York without making anything worse. Bender refuses to promise anything.", urgency: "TEMPORAL" },
  { goal: "It's the anniversary of Mom's takeover of forty percent of Earth's economy. She has sent gift baskets to the entire crew. Nobody will touch theirs. Even Zoidberg.", urgency: "SUSPICIOUS" },
  { goal: "The bureaucrats of Omicron Persei 8 have sent a tax audit to Planet Express — for deliveries made before Earth was founded. Hermes insists this is technically valid.", urgency: "ADMINISTRATIVE" },
  { goal: "A rogue delivery drone that escaped from Planet Express six years ago has found its way home. It has developed strong opinions about its place in the company hierarchy. Mostly it outranks Fry.", urgency: "CORPORATE" },
  { goal: "The annual Planet Express staff review is today. Nobody remembers scheduling it. The review forms ask questions that nobody can answer honestly without getting fired.", urgency: "HR" },
  { goal: "Kif has finally written his memoir. Chapter one is eighty percent sighs. Zapp wants to write the foreword and has described their friendship in ways Kif disputes entirely.", urgency: "LITERARY" },
  { goal: "The crew's shore leave on a resort planet has been reclassified as a work trip by Hermes, retroactively. Everyone owes the company twelve vacation days.", urgency: "BUREAUCRATIC" },
  { goal: "Nixon's Head has escaped from the Head Museum and is running for President again, this time on a platform of annexing Robot Moon. He's polling surprisingly well.", urgency: "POLITICAL" },
  { goal: "Professor Farnsworth has called a mandatory all-hands meeting to announce something he describes as 'good news' in a tone that implies the opposite. Meeting is in ten minutes. Nobody knows where to sit.", urgency: "IMMINENT" },
  { goal: "The Planet Express ship has lodged a formal complaint about working conditions. The complaint is eleven pages long, cites seventeen incidents, and names Bender in nine of them.", urgency: "INTERNAL" },
];

/**
 * Returns this week's mission based on a deterministic week seed.
 * Consistent across all users during the same calendar week.
 */
export function getWeeklyMission() {
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return WEEKLY_MISSIONS[weekNum % WEEKLY_MISSIONS.length];
}
