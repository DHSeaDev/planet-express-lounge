// Lab module — widget init, Patent Office, and DM widget logic

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE ACCESS
// All variables shared with sidepanel.js are accessed via window.Lab namespace.
// sidepanel.js populates window.Lab before lab.js runs any functions.
// ─────────────────────────────────────────────────────────────────────────────

const L = () => window.Lab; // accessor — always read fresh, never cache

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFERENCES  (lab panel elements, safe to declare at module load time
// because this script loads at the bottom of <body>)
// ─────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const labInventBtn     = $("labInventBtn");
const labDiscussBtn    = $("labDiscussBtn");
const labInvText       = $("labInvText");
const labInvPlaceholder= $("labInvPlaceholder");
const labDoomBar       = $("labDoomBar");
const labDoomFill      = $("labDoomFill");
const labDoomPct       = $("labDoomPct");

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DM_INVENT_COST = 25;    // Dark Matter cost per invention
const DM_MEGA_COST   = 150;   // Dark Matter cost for Mega-Invention
const MAX_ACTIVE     = 10;    // max active (non-scrap) inventions before oldest auto-scraps
const MAX_SCRAP      = 10;    // max scrap heap items before oldest is permanently deleted
const SCRAP_YIELD    = 10;    // DM earned when scrapping a normal invention
const RECYCLED_YIELD = 5;     // DM earned when scrapping a recycled invention
const RECYCLE_COST   = 5;     // scrap items needed to create a recycled invention

// ─────────────────────────────────────────────────────────────────────────────
// INVENTION GENERATION
// ─────────────────────────────────────────────────────────────────────────────

async function _refreshInventBtnState() {
  if (!labInventBtn) return;
  const dm = await window.getDarkMatter();
  const canAfford = dm >= DM_INVENT_COST;
  labInventBtn.disabled = !L().crew || !canAfford;
  labInventBtn.textContent = `⚗️ GENERATE INVENTION (${DM_INVENT_COST} ⚛️)`;
  labInventBtn.title = canAfford
    ? `Costs ${DM_INVENT_COST} Dark Matter`
    : `Need ${DM_INVENT_COST} ⚛️ Dark Matter — earn more passively`;
}

async function genInvention() {
  if (!L().crew) {
    L().setStatus("⚠️ Go to Settings and enter an API key first.");
    document.querySelector('.tab[data-tab="settings"]')?.click();
    return;
  }
  const spent = await window.spendDarkMatter(DM_INVENT_COST, "Invention");
  if (!spent) {
    L().setStatus(`⚛️ Need ${DM_INVENT_COST} Dark Matter to generate an invention. Keep exploring!`, 3000);
    return;
  }
  if (labInventBtn) labInventBtn.disabled = true;
  if (labInvPlaceholder) labInvPlaceholder.style.display = "none";
  if (labInvText) {
    labInvText.style.display = "block";
    labInvText.textContent = "Good news, everyone! The Professor is in his lab…";
  }
  try {
    await L().crew.genInvention((evt) => {
      if (evt.type === "invention") _showInvention(evt.text);
    });
    window.recordDelivery?.();
  } catch(e) {
    if (labInvText) labInvText.textContent = "⚠️ Invention generation failed: " + e.message;
    L().setStatus("⚠️ " + e.message);
  } finally {
    await _refreshInventBtnState();
  }
}

async function discussInvention() {
  if (!L().crew || !L().crew.todayInvention) {
    L().setStatus("⚠️ Generate an invention first!");
    return;
  }
  // From here on, this invention is fair game to surface automatically in
  // Autopilot/chat context (Plot twists, Professor's system prompt, etc).
  L().crew.inventionDiscussed = true;
  document.querySelector('.tab[data-tab="chat"]')?.click();
  await new Promise(r => setTimeout(r, 60));
  const chatInput = $("chatInput");
  if (chatInput) {
    chatInput.value = `Tell me more about this invention: ${L().crew.todayInvention}`;
    chatInput.dispatchEvent(new Event("input"));
    L().sendMessage();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTION RATING & NAME EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

const _RATING_POS = /wonderful|brilliant|perfect|useful|safe|harmless|benefit|excel|magnific|splendid|delight/i;
const _RATING_NEG = /catastroph|doom|destroy|deadly|lethal|fatal|kill|annihilat|extinct|explos|melt|obliterat|impossible to control|certain death|terrible/i;

function _rateInvention(text) {
  if (_RATING_NEG.test(text)) return "failure";
  if (_RATING_POS.test(text)) return "success";
  return "unknown";
}

function _inventionName(text) {
  // Strip recycled preamble so downstream patterns find the invention verb/name
  const stripped = text
    .replace(/from the ashes of failure[^,!.]*[,!.]\s*/i, "")
    .replace(/salvaging[^,!.]*[,!.]\s*/i, "");
  const patterns = [
    /(?:invented?|created?|built|developed|designed|constructed|assembled|salvaged?|forged?|fashioned?)\s+(?:a\s+|an\s+|the\s+)?(.+?)(?:\s*[.!,]|$)/i,
    /(?:behold[,.]?\s+(?:the\s+)?|introducing\s+(?:the\s+)?|presenting\s+(?:the\s+)?)(.+?)(?:\s*[.!,]|$)/i,
  ];
  for (const pat of patterns) {
    const m = stripped.match(pat);
    if (m && m[1] && m[1].trim().length > 3) {
      let name = m[1].trim().replace(/^(a|an|the)\s+/i, "");
      name = name.replace(/\s+(?:—|–|that|which|capable|designed|intended|allowing|enabling|causing).*/i, "");
      return name.slice(0, 80);
    }
  }
  return stripped.replace(/^good news,?\s+everyone[!.]?\s*/i, "").slice(0, 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// _showInvention — renders invention in the lab card, triggers critique + save
// ─────────────────────────────────────────────────────────────────────────────

function _showInvention(text, isMega = false, isRecycled = false) {
  if (labInvText) { labInvText.style.display = "block"; labInvText.textContent = text; }
  if (labInvPlaceholder) labInvPlaceholder.style.display = "none";
  if (labDiscussBtn) labDiscussBtn.disabled = false;
  const doom = Math.floor(60 + Math.random() * 39);
  if (labDoomBar) labDoomBar.style.display = "flex";
  if (labDoomFill) labDoomFill.style.width = `${doom}%`;
  if (labDoomPct)  labDoomPct.textContent  = `${doom}%`;
  if (L().crew) L().crew.todayInvention = text;

  // Save to Patent Office immediately — no automatic crew reaction. If the
  // user wants the crew's take, "Discuss with Crew" sends it to Autopilot.
  L().db.saveInvention(_inventionName(text), text, "", "", _rateInvention(text), isMega, isRecycled)
    .then(() => _enforceInventionCaps())
    .then(() => _renderPatentOffice())
    .catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// PATENT OFFICE
// ─────────────────────────────────────────────────────────────────────────────

let _patentFilter = "all"; // "all" | "success" | "scrap"

async function _renderPatentOffice() {
  const gallery    = $("patentGallery");
  const empty      = $("patentEmpty");
  const countEl    = $("patentCount");
  const megaWrap   = $("megaInventBtn");
  const recycleBtn = $("patentRecycleBtn");
  if (!gallery) return;

  let all = [];
  try { all = await L().db.getInventions(); } catch { return; }

  const active  = all.filter(i => !i.isScrap);
  const success = all.filter(i => !i.isScrap && (i.rating === "success" || i.isRecycled));
  const scrap   = all.filter(i =>  i.isScrap);

  if (countEl) countEl.textContent =
    `${active.length} patent${active.length !== 1 ? "s" : ""}`;

  if (megaWrap) megaWrap.style.display = active.length >= 2 ? "block" : "none";

  if (recycleBtn) {
    const show = _patentFilter === "scrap" && scrap.length >= RECYCLE_COST;
    recycleBtn.style.display = show ? "block" : "none";
  }

  const list = _patentFilter === "all"     ? active
             : _patentFilter === "success" ? success
             : scrap;

  if (empty) {
    empty.style.display = list.length ? "none" : "block";
    if (!list.length) empty.textContent =
      _patentFilter === "all"     ? "No patents filed yet — generate your first invention above."
      : _patentFilter === "success" ? "No successful inventions yet. The Professor remains optimistic."
      : "The Scrap Heap is empty. Not even Zoidberg could mess this up.";
  }

  gallery.querySelectorAll(".patent-card").forEach(el => el.remove());

  for (const inv of list) {
    const icon = inv.isRecycled ? "♻️"
               : inv.isMega    ? "💥"
               : inv.isScrap   ? "🗑️"
               : inv.rating === "success" ? "🧪"
               : inv.rating === "failure" ? "💀" : "❓";

    const date = new Date(inv.ts).toLocaleDateString(undefined, { month:"short", day:"numeric" });
    const scrapYield  = inv.isRecycled ? RECYCLED_YIELD : SCRAP_YIELD;
    let badge = "";
    if (inv.isRecycled) badge = '<span class="patent-recycled-badge">RECYCLED</span>';
    else if (inv.isMega) badge = '<span class="patent-mega-badge">MEGA</span>';

    const scrapBtnHtml = !inv.isScrap
      ? `<button class="patent-card-scrap" data-id="${inv.id}" data-yield="${scrapYield}">🗑 SCRAP (+${scrapYield} ⚛️)</button>`
      : `<button class="patent-card-del"   data-id="${inv.id}">🗑 DELETE</button>`;

    const card = document.createElement("div");
    card.className = "patent-card";
    card.dataset.id = inv.id;
    card.innerHTML = `
      <div class="patent-card-header">
        <span class="patent-card-icon">${icon}</span>
        <span class="patent-card-name">${_esc(inv.name)}${badge}</span>
        <span class="patent-card-meta">${date}</span>
      </div>
      <div class="patent-card-body">
        <div class="patent-card-text">${_esc(inv.text)}</div>
        ${inv.critique ? `<div class="patent-card-critique"><strong>${_esc(inv.critiqueAgent)}</strong>: ${_esc(inv.critique)}</div>` : ""}
        <div class="patent-card-actions">${scrapBtnHtml}</div>
      </div>`;

    card.querySelector(".patent-card-header").addEventListener("click", () =>
      card.classList.toggle("expanded"));

    const scrapBtn = card.querySelector(".patent-card-scrap");
    if (scrapBtn) scrapBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await L().db.scrapInvention(inv.id);
      await window.earnDarkMatter(scrapYield, `Scrap: ${inv.name.slice(0,20)}`);
      _renderPatentOffice();
    });

    const delBtn = card.querySelector(".patent-card-del");
    if (delBtn) delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await L().db.deleteInvention(inv.id);
      _renderPatentOffice();
    });

    gallery.appendChild(card);
  }
}

function _esc(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function _enforceInventionCaps() {
  try {
    const all    = await L().db.getInventions();
    const active = all.filter(i => !i.isScrap).sort((a,b) => a.ts.localeCompare(b.ts));

    if (active.length > MAX_ACTIVE) {
      const toScrap = active.slice(0, active.length - MAX_ACTIVE);
      for (const inv of toScrap) await L().db.scrapInvention(inv.id);
    }

    const refreshedScrap = (await L().db.getInventions())
      .filter(i => i.isScrap).sort((a,b) => a.ts.localeCompare(b.ts));
    if (refreshedScrap.length > MAX_SCRAP) {
      const toDel = refreshedScrap.slice(0, refreshedScrap.length - MAX_SCRAP);
      for (const inv of toDel) await L().db.deleteInvention(inv.id);
    }
  } catch {}
}

// Filter tab wiring
["patentTabAll","patentTabGood","patentTabScrap"].forEach(id => {
  const btn = $(id);
  if (!btn) return;
  btn.addEventListener("click", () => {
    document.querySelectorAll(".patent-tab").forEach(t => t.classList.remove("patent-tab-active"));
    btn.classList.add("patent-tab-active");
    _patentFilter = btn.dataset.filter;
    _renderPatentOffice();
  });
});

// Generate Invention / Discuss with Crew
if (labInventBtn)  labInventBtn.addEventListener("click", genInvention);
if (labDiscussBtn) labDiscussBtn.addEventListener("click", discussInvention);

// Mega-Invention
const labMegaBtn = $("labMegaBtn");
if (labMegaBtn) labMegaBtn.addEventListener("click", genMegaInvention);

async function genMegaInvention() {
  if (!L().crew) { L().setStatus("⚠️ Connect an API key first."); return; }
  const spent = await window.spendDarkMatter(DM_MEGA_COST, "Mega-Invention");
  if (!spent) {
    L().setStatus(`⚛️ Need ${DM_MEGA_COST} Dark Matter for a Mega-Invention. Keep exploring!`, 3500);
    return;
  }
  let allInvs = [];
  try { allInvs = (await L().db.getInventions()).filter(i => !i.isScrap); } catch {}
  if (allInvs.length < 2) {
    L().setStatus("⚠️ Need at least 2 active inventions in the Patent Office.");
    return;
  }
  const shuffled = [...allInvs].sort(() => Math.random() - .5);
  const a = shuffled[0], b = shuffled[1];

  if (labMegaBtn) labMegaBtn.disabled = true;
  if (labInvPlaceholder) labInvPlaceholder.style.display = "none";
  if (labInvText) { labInvText.style.display = "block"; labInvText.textContent = "Good news, everyone! I'm combining two of my greatest works into one!"; }
  if (labDoomBar) labDoomBar.style.display = "flex";
  if (labDoomFill) labDoomFill.style.width = "99%";
  if (labDoomPct) labDoomPct.textContent = "99%";

  try {
    await L().crew.genMegaInvention(a.name, b.name, (evt) => {
      if (evt.type === "invention") _showInvention(evt.text, true, false);
    });
  } catch(e) {
    if (labInvText) labInvText.textContent = "⚠️ Mega-Invention failed: " + e.message;
  } finally {
    if (labMegaBtn) labMegaBtn.disabled = false;
  }
}

// Scrap Heap recycling
const patentRecycleBtn = $("patentRecycleBtn");
if (patentRecycleBtn) patentRecycleBtn.addEventListener("click", genRecycledInvention);

async function genRecycledInvention() {
  if (!L().crew) { L().setStatus("⚠️ Connect an API key first."); return; }
  let scrapItems = [];
  try { scrapItems = (await L().db.getInventions()).filter(i => i.isScrap); } catch {}
  if (scrapItems.length < RECYCLE_COST) {
    L().setStatus(`⚠️ Need ${RECYCLE_COST} items in the Scrap Heap to recycle.`);
    return;
  }
  const toConsume = scrapItems.sort((a,b) => a.ts.localeCompare(b.ts)).slice(0, RECYCLE_COST);
  for (const inv of toConsume) await L().db.deleteInvention(inv.id);

  if (patentRecycleBtn) patentRecycleBtn.disabled = true;
  if (labInvText) { labInvText.style.display = "block"; labInvText.textContent = "Good news, everyone! I'm salvaging the best parts from the scrap heap!"; }

  try {
    const names = toConsume.map(i => i.name).join(", ");
    await L().crew.genRecycledInvention(names, (evt) => {
      if (evt.type === "invention") _showInvention(evt.text, false, true);
    });
  } catch(e) {
    if (labInvText) labInvText.textContent = "⚠️ Recycling failed: " + e.message;
  } finally {
    if (patentRecycleBtn) patentRecycleBtn.disabled = false;
    _renderPatentOffice();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DARK MATTER WIDGET
// ─────────────────────────────────────────────────────────────────────────────

const DM_DIGIT_IDS = ["dm0","dm1","dm2","dm3","dm4","dm5","dm6"];

function _dmRender(value) {
  const clamped = Math.min(Math.max(Math.floor(value) || 0, 0), 9_999_999);
  const str     = String(clamped).padStart(7, "0");
  DM_DIGIT_IDS.forEach((id, i) => {
    const el = $(id);
    if (el) el.textContent = str[i];
  });
}

function _dmFlash(value) {
  _dmRender(value);
  DM_DIGIT_IDS.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.classList.add("dm-flash");
    setTimeout(() => el.classList.remove("dm-flash"), 300);
  });
  const spark = $("dmSpark");
  if (spark) {
    spark.innerHTML = "";
    for (let i = 0; i < 5; i++) {
      const p = document.createElement("div");
      p.className = "dm-spark-particle";
      const angle = (i / 5) * 2 * Math.PI;
      p.style.setProperty("--dx", `${Math.cos(angle) * 16}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * 16}px`);
      p.style.left = "14px"; p.style.top = "14px";
      spark.appendChild(p);
    }
  }
}

// DM Usage History — 5-item ring buffer
const _dmHistory  = [];
const DM_HIST_MAX = 5;

function _dmHistoryPush(entry) {
  _dmHistory.unshift(entry);
  if (_dmHistory.length > DM_HIST_MAX) _dmHistory.pop();
  _dmHistoryRender();
}

function _dmHistoryRender() {
  const el = $("dmHistory");
  if (!el) return;
  if (!_dmHistory.length) {
    el.innerHTML = '<span class="dm-hist-empty">No activity yet</span>';
    return;
  }
  el.innerHTML = _dmHistory.map(h => {
    const sign  = h.type === "earn" ? "+" : "−";
    const color = h.type === "earn" ? "#00d4ff" : "#e87010";
    const time  = new Date(h.ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    return `<span class="dm-hist-row">` +
      `<span class="dm-hist-label">${_esc(h.label)}</span>` +
      `<span class="dm-hist-delta" style="color:${color}">${sign}${h.amount} ⚛️</span>` +
      `<span class="dm-hist-time">${time}</span>` +
    `</span>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// DARK MATTER API (window-level so background.js messages can trigger them)
// ─────────────────────────────────────────────────────────────────────────────

window.getDarkMatter = () => new Promise(resolve => {
  chrome.runtime.sendMessage({ type: "dm_get" }, (res) => {
    resolve((res && !chrome.runtime.lastError) ? res.darkMatter : 0);
  });
});

window.spendDarkMatter = (amount, label = "") => new Promise(resolve => {
  chrome.runtime.sendMessage({ type: "dm_spend", amount, label }, (res) => {
    resolve((res && !chrome.runtime.lastError) ? res.ok : false);
  });
});

window.earnDarkMatter = (amount, label = "") => new Promise(resolve => {
  chrome.runtime.sendMessage({ type: "dm_earn", amount, label }, (res) => {
    resolve((res && !chrome.runtime.lastError) ? res.ok : false);
  });
});

// DM message listener (dm_update broadcast from background)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.type === "dm_update") {
    _dmFlash(msg.darkMatter);
    _refreshInventBtnState();
    if (msg.spent)  _dmHistoryPush({ ts: Date.now(), amount: msg.spent,  label: msg.label || "Spent",  type: "spend" });
    if (msg.amount) _dmHistoryPush({ ts: Date.now(), amount: msg.amount, label: msg.label || "Earned", type: "earn"  });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AFFIRMATION WIDGET (_initWidget)
// ─────────────────────────────────────────────────────────────────────────────

function _initWidget() {
  const WIDGET_AFFIRMATIONS = L().WIDGET_AFFIRMATIONS;

  let _widgetIdx    = Math.floor(Math.random() * WIDGET_AFFIRMATIONS.length);
  let _widgetPaused = false;
  let _widgetTimer  = null;

  const nextBtn  = $("widgetNextBtn");
  const pauseBtn = $("widgetPauseBtn");
  const avatar   = $("widgetAvatar");

  function _widgetNext() {
    _widgetIdx = (_widgetIdx + 1) % WIDGET_AFFIRMATIONS.length;
    _widgetDisplay(WIDGET_AFFIRMATIONS[_widgetIdx]);
  }

  function _widgetDisplay(q) {
    const quoteEl   = $("widgetQuote");
    const charName  = $("widgetCharName");
    const charSub   = $("widgetCharSub");
    const idxEl     = $("widgetQuoteId");
    const chars     = L().CHARS || {};
    // WIDGET_AFFIRMATIONS schema: {char, color, quote}
    const charData  = chars[q.char] || [q.char, "🍕", q.color || "#ABB2BF"];
    if (quoteEl)  quoteEl.textContent  = q.quote;
    if (charName) charName.textContent = q.char;
    if (charSub)  charSub.textContent  = charData[0] ? "" : "";  // sub not used
    if (avatar)   avatar.textContent   = charData[1] || "🍕";
    if (idxEl)    idxEl.textContent    = `${_widgetIdx + 1} / ${WIDGET_AFFIRMATIONS.length}`;
  }

  if (nextBtn)  nextBtn.addEventListener("click",  () => { _widgetNext(); });
  if (pauseBtn) pauseBtn.addEventListener("click", () => {
    _widgetPaused = !_widgetPaused;
    pauseBtn.textContent = _widgetPaused ? "▶ RESUME" : "⏸ PAUSE";
  });
  if (avatar) avatar.addEventListener("click", () => _widgetNext());

  _widgetDisplay(WIDGET_AFFIRMATIONS[_widgetIdx]);

  _widgetTimer = setInterval(() => {
    if (!_widgetPaused && $("panel-lab")?.classList.contains("active")) _widgetNext();
  }, 30000);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAB WIDGET ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────

let _labWidgetsStarted = false;

function _startLabWidgets() {
  if (_labWidgetsStarted) {
    requestAnimationFrame(() => {
      if (typeof window.wbg_startAuto    === "function") window.wbg_startAuto();
      if (typeof window.wml_startAuto    === "function") window.wml_startAuto();
      if (typeof window.wnn_scheduleAuto === "function") window.wnn_scheduleAuto();
    });
    return;
  }
  _labWidgetsStarted = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    _wireWidgetButtons();
  }));
}

function _wireWidgetButtons() {
  // No flavor widgets active — lab contains only affirmation widget (wired at init)
  // and Patent Office / DM widget (wired above at module load time)
}

// ─────────────────────────────────────────────────────────────────────────────
// DM INIT — read current balance on load
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: "dm_get" }, (res) => {
  if (chrome.runtime.lastError || !res) return;
  _dmRender(res.darkMatter);
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS — called by sidepanel.js init()
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// DARK MATTER WIDGETS
// ═══════════════════════════════════════════════════════════════════════════
// Aurebesh Relay, Expedition Log, Smell-O-Scope, Beverage Machine.
// Dark Matter balance/transactions go through window.getDarkMatter /
// spendDarkMatter / earnDarkMatter, defined above in this same file.

/**
 * WidgetState — Dark Matter currency transactions & shared widget state.
 * All widgets use this for tier persistence and collection storage.
 *
 * Dark Matter balance is the SAME pool used by the Lab's Invention system
 * (Patent Office, Mega-Invention, Recycling). It lives in the background
 * worker and is accessed via window.getDarkMatter / spendDarkMatter /
 * earnDarkMatter (exposed by lab.js, backed by chrome.runtime messages).
 */

const WidgetState = {
  /**
   * Deduct Dark Matter via the shared background-managed balance.
   * Returns { success: bool, newBalance: number, error?: string }
   *
   * Also drives the Dark Matter Reactor digit display + history feed
   * immediately (_dmFlash/_dmHistoryPush), rather than relying solely on
   * the dm_update broadcast round-trip from background.js. The broadcast
   * still arrives and is harmless (re-renders the same value), but widgets
   * no longer *depend* on it for their own balance display to feel live.
   */
  async deductDarkMatter(amount, purpose = "") {
    try {
      const current = await window.getDarkMatter();
      if (current < amount) {
        console.debug(`[DM] deduct FAILED — need ${amount}, have ${current} (${purpose})`);
        return { success: false, newBalance: current, error: `Need ${amount} ⚛️, have ${current}` };
      }
      const ok = await window.spendDarkMatter(amount, purpose);
      if (!ok) {
        console.debug(`[DM] deduct FAILED — spendDarkMatter rejected (${purpose})`);
        return { success: false, newBalance: current, error: "Transaction failed" };
      }
      const newBalance = await window.getDarkMatter();
      console.debug(`[DM] -${amount} (${purpose}) → ${newBalance}`);
      _dmFlash(newBalance);
      _dmHistoryPush({ ts: Date.now(), amount, label: purpose || "Spent", type: "spend" });
      return { success: true, newBalance };
    } catch (err) {
      console.error("DM deduction error:", err);
      return { success: false, newBalance: 0, error: err.message };
    }
  },

  /**
   * Award Dark Matter (e.g., passive earn from tabs/autopilot/chat, or
   * widget rewards like Slurm can recycling). Same instant-refresh note
   * as deductDarkMatter above.
   */
  async awardDarkMatter(amount, reason = "") {
    try {
      const ok = await window.earnDarkMatter(amount, reason);
      const newBalance = await window.getDarkMatter();
      console.debug(`[DM] +${amount} (${reason}) → ${newBalance}`);
      _dmFlash(newBalance);
      _dmHistoryPush({ ts: Date.now(), amount, label: reason || "Earned", type: "earn" });
      return { success: !!ok, newBalance };
    } catch (err) {
      console.error("DM award error:", err);
      return { success: false, newBalance: 0, error: err.message };
    }
  },

  /**
   * Get current DM balance (shared pool)
   */
  async getBalance() {
    try {
      return await window.getDarkMatter();
    } catch {
      return 0;
    }
  },

  /**
   * Set tier unlock in chrome.storage.local for persistence
   * tier can be "alphabet_view", "alphabet_translate", "alphabet_secret", etc.
   */
  async unlockTier(tier) {
    const stored = await chrome.storage.local.get("widgetTiers") || {};
    const tiers = stored.widgetTiers || {};
    tiers[tier] = { unlockedAt: Date.now(), status: "active" };
    await chrome.storage.local.set({ widgetTiers: tiers });
    return tiers;
  },

  async isTierUnlocked(tier) {
    const stored = await chrome.storage.local.get("widgetTiers");
    const tiers = stored.widgetTiers || {};
    return !!tiers[tier];
  },

  async getTierStatus() {
    const stored = await chrome.storage.local.get("widgetTiers");
    return stored.widgetTiers || {};
  },

  /**
   * Add item to widget collection (Slurm flavors, expedition reports, lore discoveries)
   * collectionName: "slurm_flavors", "expedition_reports", "lore_discoveries"
   */
  async addToCollection(collectionName, item) {
    try {
      const stored = await chrome.storage.local.get("widgetCollections");
      const collections = stored.widgetCollections || {};
      if (!collections[collectionName]) collections[collectionName] = [];
      
      // Avoid duplicates
      const exists = collections[collectionName].some(i => i.id === item.id);
      if (!exists) {
        item.discoveredAt = Date.now();
        collections[collectionName].push(item);
      }
      
      await chrome.storage.local.set({ widgetCollections: collections });
      return collections[collectionName];
    } catch (err) {
      console.error("Collection add error:", err);
      return [];
    }
  },

  async getCollection(collectionName) {
    const stored = await chrome.storage.local.get("widgetCollections");
    const collections = stored.widgetCollections || {};
    return collections[collectionName] || [];
  },

  async removeFromCollection(collectionName, itemId) {
    const stored = await chrome.storage.local.get("widgetCollections");
    const collections = stored.widgetCollections || {};
    const list = collections[collectionName] || [];
    collections[collectionName] = list.filter(i => i.id !== itemId);
    await chrome.storage.local.set({ widgetCollections: collections });
    return collections[collectionName];
  },

  async clearCollection(collectionName) {
    const stored = await chrome.storage.local.get("widgetCollections");
    const collections = stored.widgetCollections || {};
    collections[collectionName] = [];
    await chrome.storage.local.set({ widgetCollections: collections });
  },

  /**
   * Per-flavor quantity counters (Beverage Machine inventory). Stored
   * separately from `addToCollection`'s dedup-by-id arrays, since here we
   * need a count per item, not a unique-items list.
   * Returns/accepts a map: { [itemId]: count }
   */
  async getInventory(name) {
    const stored = await chrome.storage.local.get("widgetInventory");
    const inv = stored.widgetInventory || {};
    return inv[name] || {};
  },

  async setInventory(name, map) {
    const stored = await chrome.storage.local.get("widgetInventory");
    const inv = stored.widgetInventory || {};
    inv[name] = map;
    await chrome.storage.local.set({ widgetInventory: inv });
    return map;
  },
};

// ── Aurebesh Relay ───────────────────────────────────────────────────────────
/**
 * Aurebesh Relay — Aurebesh Decoder unlock progression
 * Tier 1 (50 DM): View the alphabet
 * Tier 2 (100 DM): Translate English ↔ Aurebesh in real-time
 * Tier 3 (150 DM): Secret messages from crew (hidden lore)
 */


// Futurama alphabet mapping (Aurebesh — simplified for feasibility)
// Based on canonical designs, phonetically mapped to Latin equivalents
const AUREBESH_MAP = {
  A: "𐌀", B: "𐌁", C: "𐌂", D: "𐌃", E: "𐌄", F: "𐌅", G: "𐌆", H: "𐌇",
  I: "𐌈", J: "𐌉", K: "𐌊", L: "𐌋", M: "𐌌", N: "𐌍", O: "𐌎", P: "𐌏",
  Q: "𐌐", R: "𐌑", S: "𐌒", T: "𐌓", U: "𐌔", V: "𐌕", W: "𐌖", X: "𐌗",
  Y: "𐌘", Z: "𐌙",
  " ": " ", ".": ".", ",": ",", "!": "!", "?": "?", "'": "'", "-": "-",
};

const REVERSE_AUREBESH = Object.fromEntries(
  Object.entries(AUREBESH_MAP).map(([k, v]) => [v, k])
);

const SECRET_CREW_MESSAGES = [
  { agent: "PROF", emoji: "🧪", message: "Good news, everyone! I decoded this message... wait, what was it again?" },
  { agent: "BENDER", emoji: "🤖", message: "I got this weird alphabetical transmission. Probably just spam for my bending unit." },
  { agent: "HERMES", emoji: "📋", message: "Form 1729-X requires signature on line 47 of this decoded message, in triplicate." },
  { agent: "MORBO", emoji: "👽", message: "MORBO INTERCEPTED THIS TRANSMISSION. IT CONFUSES MORBO. MORBO DOES NOT LIKE CONFUSION." },
  { agent: "LEELA", emoji: "👁️", message: "I found this hidden in the navigation logs. Pretty clever for a secret message." },
  { agent: "ZOIDBERG", emoji: "🦞", message: "Blarghhh! This message tastes like alphabet soup. Very confusing for a decapodian." },
  { agent: "ZAPP", emoji: "⭐", message: "I once intercepted codes like this. Mostly just restaurant menus, but still classified!" },
  { agent: "AMY", emoji: "💅", message: "Ooh, secret messages are so fancy. I decoded one once. Or someone did. Whatever." },
];

// Shared style for Aurebesh Relay's 3 tier-unlock buttons (DRY — was repeated 3x).
const ALPHABET_UNLOCK_BTN_STYLE = "background:#9D4EDD;color:#fff;border:2px solid #00F5FF;box-shadow:0 0 8px rgba(157,78,221,.5)";

const AlphabetWidget = {
  costs: {
    tier1: 50,  // View alphabet
    tier2: 100, // Translate both ways
    tier3: 50,  // Encrypted chatter
  },

  /**
   * Render alphabet section (inline, no container ID needed)
   * Returns HTML string for stacking into Lab
   */
  async renderSection() {
    const tiers = await WidgetState.getTierStatus();
    const tier1 = !!tiers.alphabet_view;
    const tier2 = !!tiers.alphabet_translate;
    const tier3 = !!tiers.alphabet_secret;
    const balance = await WidgetState.getBalance();

    let html = `<div class="widget-alphabet-section lab-section-card" style="background:linear-gradient(160deg,#0B0E23 0%,#1a0f33 100%);border:1px solid #3d2a5e;box-shadow:inset 0 0 20px rgba(157,78,221,.15)">
      <div class="lab-section-header">
        <span class="lab-section-icon">📡</span>
        <div>
          <div class="lab-section-title" style="color:#00F5FF;text-shadow:0 0 6px rgba(0,245,255,.6)">AUREBESH RELAY</div>
          <div class="lab-section-sub" style="color:#9D4EDD">Decrypt the alien glyph network</div>
        </div>
      </div>`;

    // ── TIER 1: View Alphabet ──────────────────────────────────────────────
    // Tier 1 has no prerequisite — always purchasable directly.
    html += `<div class="alphabet-tier tier1" style="margin-bottom:14px;padding:12px;border:1px solid #3d2a5e;border-radius:6px;background:rgba(157,78,221,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:11px;color:#9D4EDD;letter-spacing:1px;text-shadow:0 0 4px rgba(157,78,221,.6)">📖 TIER 1 — GLYPH ARCHIVE</h3>
        ${tier1 ? `<span style="font-size:11px;color:#39FF14;font-weight:bold;text-shadow:0 0 4px #39FF14">✓ ONLINE</span>` : `<span style="font-size:11px;color:#00F5FF">${this.costs.tier1} ⚛️</span>`}
      </div>`;

    if (tier1) {
      html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-size:11px">`;
      for (const [latin, aurebesh] of Object.entries(AUREBESH_MAP)) {
        if (latin === " ") continue;
        html += `<div style="text-align:center;padding:4px;background:rgba(0,245,255,.06);border:1px solid rgba(0,245,255,.2);border-radius:3px" title="${latin}">
          <div style="font-size:16px;line-height:1;color:#00F5FF;text-shadow:0 0 4px rgba(0,245,255,.6)">${aurebesh}</div>
          <div style="color:#8a7ab0;margin-top:2px">${latin}</div>
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<button class="widget-unlock-btn lab-btn" data-widget="alphabet" data-tier="alphabet_view" data-cost="${this.costs.tier1}" style="${ALPHABET_UNLOCK_BTN_STYLE}">
        🔓 DECRYPT ARCHIVE (${this.costs.tier1} ⚛️)
      </button>`;
    }
    html += `</div>`;

    // ── TIER 2: Bidirectional Translator ────────────────────────────────────
    html += `<div class="alphabet-tier tier2" style="margin-bottom:14px;padding:12px;border:1px solid #3d2a5e;border-radius:6px;background:rgba(157,78,221,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:11px;color:#9D4EDD;letter-spacing:1px;text-shadow:0 0 4px rgba(157,78,221,.6)">🔄 TIER 2 — TRANSLATOR UPLINK</h3>
        ${tier2 ? `<span style="font-size:11px;color:#39FF14;font-weight:bold;text-shadow:0 0 4px #39FF14">✓ ONLINE</span>` : tier1 ? `<span style="font-size:11px;color:#00F5FF">${this.costs.tier2} ⚛️</span>` : `<span style="font-size:11px;color:var(--fg3)">🔒 locked</span>`}
      </div>`;

    if (tier2) {
      html += `
        <textarea id="alphabet-input" placeholder="Type English here..." style="width:100%;height:60px;padding:8px;margin-bottom:8px;background:#05070f;border:1px solid #00F5FF;border-radius:4px;color:#00F5FF;font-size:11px;font-family:monospace;resize:none;box-shadow:inset 0 0 8px rgba(0,245,255,.2)"></textarea>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button class="widget-translate-btn lab-btn" data-direction="toAurebesh" style="flex:1;background:#9D4EDD;color:#fff;border:1px solid #00F5FF">→ Aurebesh</button>
          <button class="widget-translate-btn lab-btn" data-direction="toLatin" style="flex:1;background:#9D4EDD;color:#fff;border:1px solid #00F5FF">← English</button>
        </div>
        <textarea id="alphabet-output" placeholder="Translation appears here..." readonly style="width:100%;height:60px;padding:8px;background:#05070f;border:1px solid #9D4EDD;border-radius:4px;color:#9D4EDD;font-size:11px;font-family:monospace;resize:none;box-shadow:inset 0 0 8px rgba(157,78,221,.2)"></textarea>
      `;
    } else if (!tier1) {
      // Sequential unlock — Translator Uplink requires the Glyph Archive
      // (Tier 1) decrypted first. Without this, a player could buy Tier 2
      // or 3 first, the spend would succeed (DM IS deducted), but the
      // result looks identical to "nothing happened" since Tier 1's
      // locked button is still sitting there above unexplained.
      html += `<div style="text-align:center;padding:12px;color:var(--fg3);font-size:10px;font-style:italic;border:1px dashed #3d2a5e;border-radius:6px">
        🔒 Requires Tier 1 — Glyph Archive decrypted first
      </div>`;
    } else {
      html += `<button class="widget-unlock-btn lab-btn" data-widget="alphabet" data-tier="alphabet_translate" data-cost="${this.costs.tier2}" style="${ALPHABET_UNLOCK_BTN_STYLE}">
        🔓 ACTIVATE UPLINK (${this.costs.tier2} ⚛️)
      </button>`;
    }
    html += `</div>`;

    // ── TIER 3: Secret Messages ────────────────────────────────────────────
    html += `<div class="alphabet-tier tier3" style="padding:12px;border:1px solid #3d2a5e;border-radius:6px;background:rgba(157,78,221,.06)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:11px;color:#9D4EDD;letter-spacing:1px;text-shadow:0 0 4px rgba(157,78,221,.6)">🤫 TIER 3 — ENCRYPTED CHATTER</h3>
        ${tier3 ? `<span style="font-size:11px;color:#39FF14;font-weight:bold;text-shadow:0 0 4px #39FF14">✓ ONLINE</span>` : tier2 ? `<span style="font-size:11px;color:#00F5FF">${this.costs.tier3} ⚛️</span>` : `<span style="font-size:11px;color:var(--fg3)">🔒 locked</span>`}
      </div>`;

    if (tier3) {
      const secret = this._lastSecret || (this._lastSecret =
        SECRET_CREW_MESSAGES[Math.floor(Math.random() * SECRET_CREW_MESSAGES.length)]);
      html += `<div style="padding:8px;background:#05070f;border-left:3px solid #00F5FF;border-radius:4px;font-size:11px;color:#d4d4ff;box-shadow:inset 0 0 8px rgba(0,245,255,.1)">
        <div style="font-weight:bold;margin-bottom:4px;color:#00F5FF">${secret.emoji} ${secret.agent}:</div>
        <div style="font-style:italic">"${secret.message}"</div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="widget-secret-next-btn lab-btn" style="flex:1;background:#9D4EDD;color:#fff;border:1px solid #00F5FF">📡 Intercept Next</button>
        <button class="widget-aurebesh-discuss-btn lab-btn" style="flex:1;background:transparent;border:1px solid #00F5FF;color:#00F5FF">💬 Discuss with Crew</button>
      </div>`;
    } else if (!tier2) {
      html += `<div style="text-align:center;padding:12px;color:var(--fg3);font-size:10px;font-style:italic;border:1px dashed #3d2a5e;border-radius:6px">
        🔒 Requires Tier 2 — Translator Uplink activated first
      </div>`;
    } else {
      html += `<button class="widget-unlock-btn lab-btn" data-widget="alphabet" data-tier="alphabet_secret" data-cost="${this.costs.tier3}" style="${ALPHABET_UNLOCK_BTN_STYLE}">
        🔓 BREACH FREQUENCY (${this.costs.tier3} ⚛️)
      </button>`;
    }
    html += `</div>`;

    // Close outer .lab-section-card wrapper opened at top of renderSection
    html += `</div>`;

    // Button wiring for this widget is handled by the single delegated
    // click listener at the bottom of this file (_wireWidgetDelegation) —
    // see WIDGET_REGISTRY / _unlockTier. No per-render setTimeout needed.

    return html;
  },

  async renderSectionInPlace() {
    const section = document.querySelector(".widget-alphabet-section");
    if (!section) return;
    const html = await this.renderSection();
    section.outerHTML = html;
  },

  // attemptUnlock removed — replaced by shared _unlockTier(widget, tier, cost)
  // called from the global delegated click listener.

  translate(section, direction) {
    const input = section.querySelector("#alphabet-input");
    const output = section.querySelector("#alphabet-output");
    if (!input || !output) return;

    const text = input.value.toUpperCase();
    let result = "";

    if (direction === "toAurebesh") {
      for (const char of text) {
        result += AUREBESH_MAP[char] || char;
      }
    } else {
      for (const char of text) {
        result += REVERSE_AUREBESH[char] || char;
      }
    }

    output.value = result;
  },
};

// ── Expedition Log ───────────────────────────────────────────────────────────
/**
 * Expedition Log — Planet Express delivery reports
 * Browse auto-generated "expedition reports" from crew dialogue
 * Unlock cost: 75 DM
 */


const EXPEDITION_TEMPLATES = [
  { agent: "PROF", template: "We discovered {location}! Scientific value: {value}. Zoidberg immediately tried to eat it." },
  { agent: "LEELA", template: "Navigation report: {location} was {difficulty}. Bender's gambling debts now {financial_state}." },
  { agent: "HERMES", template: "Expedition log form 47-B filed. {location} catalogued. Bureaucratic status: {status}." },
  { agent: "BENDER", template: "Got drunk at {location}. Stole {item}. No regrets. Absolutely none. Okay maybe some." },
  { agent: "ZOIDBERG", template: "Found delicious garbage at {location}. Also a {creature}. New friend? {creature} says no." },
  { agent: "MORBO", template: "MORBO REPORTS: {location} experience {event}. MORBO {feeling}." },
];

const LOCATION_POOL = [
  "Planet Express Headquarters",
  "The Planet Omicron Persei-8",
  "The Nude Beach Planet",
  "Thuban 9",
  "The Garbage Disposal Planet",
  "Eternium Ore Mine",
  "The Mighty Goofy Fun Fun Land",
  "Candela's asteroid lair",
  "The Casino Planet",
  "The Robot Planet",
];

const EVENT_POOL = [
  "went extremely well",
  "was moderately disastrous",
  "resulted in unexpected profit",
  "somehow involved a time paradox",
  "ended with bureaucratic complications",
  "prompted Zoidberg's tears",
];

const CREATURE_POOL = [
  "space bee",
  "robot with ambitions",
  "sentient puddle",
  "delivery boy skeleton",
  "angry robot",
];

const ArchiveWidget = {
  cost: 75,
  logCost: 50,
  maxReports: 10,
  recycleValue: 10,
  addCooldownMs: 1000,
  lastAddTime: 0,
  scenarioCooldownMs: 60000,
  lastScenarioTime: 0,

  /**
   * Generate random expedition report
   */
  generateReport() {
    const template = EXPEDITION_TEMPLATES[Math.floor(Math.random() * EXPEDITION_TEMPLATES.length)];
    let text = template.template;
    
    text = text.replace("{location}", LOCATION_POOL[Math.floor(Math.random() * LOCATION_POOL.length)]);
    text = text.replace("{event}", EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)]);
    text = text.replace("{creature}", CREATURE_POOL[Math.floor(Math.random() * CREATURE_POOL.length)]);
    text = text.replace("{value}", ["priceless", "worthless", "moderately valuable"][Math.floor(Math.random() * 3)]);
    text = text.replace("{difficulty}", ["routine", "harrowing", "surprisingly peaceful"][Math.floor(Math.random() * 3)]);
    text = text.replace("{financial_state}", ["skyrocketing", "deteriorating", "stable but fragile"][Math.floor(Math.random() * 3)]);
    text = text.replace("{status}", ["APPROVED", "PENDING", "SUSPENDED FOR REVIEW"][Math.floor(Math.random() * 3)]);
    text = text.replace("{item}", ["stolen robot parts", "ancient artifact", "someone's lunch"][Math.floor(Math.random() * 3)]);
    text = text.replace("{feeling}", ["APPROVES", "DISAPPROVES", "IS CONFLICTED"][Math.floor(Math.random() * 3)]);

    return {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      agent: template.agent,
      text,
      timestamp: Date.now(),
      discoveredAt: Date.now(),
    };
  },

  /**
   * Render archive section (inline, returns HTML string)
   */
  async renderSection() {
    const tiers = await WidgetState.getTierStatus();
    const unlocked = !!tiers.archive_view;
    const balance = await WidgetState.getBalance();
    const reports = await WidgetState.getCollection("expedition_reports");

    let html = `<div class="widget-archive-section lab-section-card" style="background:linear-gradient(160deg,#1a1206 0%,#241a08 100%);border:1px solid #6b4f1a;box-shadow:inset 0 0 20px rgba(201,166,107,.15)">
      <div class="lab-section-header">
        <span class="lab-section-icon">📜</span>
        <div>
          <div class="lab-section-title" style="color:#FFD700;text-shadow:0 0 6px rgba(255,215,0,.5)">EXPEDITION LOG</div>
          <div class="lab-section-sub" style="color:#C9A66B">Captain's journal of crew deliveries</div>
        </div>
      </div>`;

    // ── Unlock button or content ───────────────────────────────────────────
    if (!unlocked) {
      html += `
        <div style="padding:20px;text-align:center;background:var(--bg3);border-radius:6px;border:1px solid var(--border)">
          <div style="font-size:32px;margin-bottom:12px">🗺️</div>
          <p style="font-size:11px;color:var(--fg2);margin:0 0 12px 0;font-style:italic">
            Break the wax seal to browse crew expedition reports.
          </p>
          <button class="widget-unlock-btn lab-btn" data-widget="archive" data-tier="archive_view" data-cost="${this.cost}" style="background:#C9A66B;color:#2a1505;border:2px solid #FFD700">
            🔓 BREAK SEAL (${this.cost} ⚛️)
          </button>
        </div>
      `;
    } else {
      html += `
        <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <button class="widget-archive-add-btn lab-btn" style="background:#C9A66B;color:#2a1505;border:2px solid #FFD700">
            ✒️ Log New Expedition (${this.logCost} ⚛️)
          </button>
          <span style="font-size:9px;color:#C9A66B">${reports.length}/${this.maxReports}</span>
        </div>

        <div id="archive-list" style="display:flex;flex-direction:column;gap:8px">
      `;

      if (reports.length === 0) {
        html += `<div style="padding:20px;text-align:center;color:var(--fg3);font-size:11px;font-style:italic">
          The pages are blank. Log your first expedition!
        </div>`;
      } else {
        // Timeline reverse-chronological
        for (const report of reports.slice().reverse()) {
          const date = new Date(report.discoveredAt).toLocaleDateString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

          const agentColor = {
            PROF: "#E5C07B",
            LEELA: "#C678DD",
            HERMES: "#7BC67E",
            BENDER: "#ABB2BF",
            ZOIDBERG: "#56B6C2",
            MORBO: "#7DF9FF",
          }[report.agent] || "var(--fg2)";

          html += `
            <div class="archive-item" data-report-id="${report.id}" style="padding:10px;background:var(--bg3);border-left:4px solid ${agentColor};border-radius:2px 6px 6px 2px;font-size:10px">
              <div style="font-weight:bold;color:${agentColor};margin-bottom:4px;letter-spacing:1px">✦ ${report.agent}</div>
              <div style="color:var(--fg);line-height:1.4;margin-bottom:4px">${report.text}</div>
              <div style="color:var(--fg3);font-size:9px;font-style:italic;margin-bottom:6px">${date}</div>
              <div style="display:flex;gap:6px">
                <button class="widget-archive-discuss-btn lab-btn" data-report-id="${report.id}"
                  style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #6b4f1a;color:#C9A66B">
                  💬 Discuss
                </button>
                <button class="widget-archive-scenario-btn lab-btn" data-report-id="${report.id}"
                  style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #6b4f1a;color:#C9A66B">
                  📖 Scenario
                </button>
                <button class="widget-archive-save-btn lab-btn" data-report-id="${report.id}"
                  style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #6b4f1a;color:#C9A66B">
                  📌 Save
                </button>
                <button class="widget-archive-recycle-btn lab-btn" data-report-id="${report.id}"
                  style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #6b4f1a;color:#C9A66B">
                  ♻️ +${this.recycleValue}
                </button>
              </div>
              ${_renderScenarioBlock(this, "archive", report.id, "report-id", "#FFD700", "#6b4f1a")}
            </div>
          `;
        }
      }

      html += `</div>`;
    }

    html += `</div>`;

    // Button wiring handled by the global delegated click listener
    // (_wireWidgetDelegation) — see logExpedition/printReport/saveReport
    // methods below.

    return html;
  },

  async logExpedition() {
    const now = Date.now();
    if (now - this.lastAddTime < this.addCooldownMs) return;

    const balance = await WidgetState.getBalance();
    if (balance < this.logCost) {
      L().setStatus(`⚛️ Need ${this.logCost} ⚛️ for this — you have ${balance}.`, 2500);
      return;
    }
    const spend = await WidgetState.deductDarkMatter(this.logCost, "Log expedition");
    if (!spend.success) {
      L().setStatus(`⚠️ ${spend.error}`, 2500);
      return;
    }
    this.lastAddTime = now;

    const report = this.generateReport();
    let reports = await WidgetState.addToCollection("expedition_reports", report);
    window.recordDelivery?.();

    let msg = `✓ New expedition logged: ${report.agent}'s report`;
    // Cap at maxReports — force-recycle the oldest for Dark Matter on overflow.
    if (reports.length > this.maxReports) {
      const oldest = reports[0];
      await WidgetState.removeFromCollection("expedition_reports", oldest.id);
      const result = await WidgetState.awardDarkMatter(this.recycleValue, "Expedition Log full — auto-recycled");
      delete this._scenarios?.[oldest.id];
      msg += ` (log full — oldest report recycled for +${this.recycleValue} ⚛️, balance ${result.newBalance})`;
    }
    L().setStatus(msg, 3500);
    await this.renderSectionInPlace();
  },

  async recycleReport(reportId) {
    const reports = await WidgetState.getCollection("expedition_reports");
    const report = reports.find(r => r.id === reportId);
    if (!report) return;
    await WidgetState.removeFromCollection("expedition_reports", reportId);
    const result = await WidgetState.awardDarkMatter(this.recycleValue, "Recycled expedition report");
    delete this._scenarios?.[reportId];
    L().setStatus(`♻️ Report recycled for +${this.recycleValue} ⚛️ (now ${result.newBalance})`, 2500);
    await this.renderSectionInPlace();
  },

  async discussReport(reportId) {
    const reports = await WidgetState.getCollection("expedition_reports");
    const report = reports.find(r => r.id === reportId);
    if (!report) return;
    await _discussWithCrew(`Here's an expedition report from the log: "${report.text}" — tell me more about it.`);
  },

  async generateScenario(reportId) {
    const reports = await WidgetState.getCollection("expedition_reports");
    const report = reports.find(r => r.id === reportId);
    if (!report) return;
    if (!_checkScenarioCooldown(this)) return;
    L().setStatus("📖 Writing scenario…");
    const scenario = await _generateScenario(report.text);
    if (!scenario) return;
    this._scenarios = this._scenarios || {};
    this._scenarios[reportId] = scenario;
    await this.renderSectionInPlace();
  },

  async saveScenario(reportId) {
    const scenario = this._scenarios?.[reportId];
    if (!scenario) return;
    await L().db.savePin("SCENARIO", scenario, "Expedition Log");
    L().setStatus("📌 Scenario saved to Cold Storage.", 2500);
  },

  shareScenario(reportId, btnEl) {
    const scenario = this._scenarios?.[reportId];
    if (!scenario) return;
    L().openShareMenu(`${scenario}\n\nAI fan parody — Planet Express Lounge | #DHSeaDev`, btnEl);
  },

  async saveReport(reportId, btnEl) {
    const reports = await WidgetState.getCollection("expedition_reports");
    const report = reports.find(r => r.id === reportId);
    if (!report) return;
    await L().db.savePin(report.agent, report.text, "Expedition Log");
    L().setStatus("📌 Expedition report saved to Cold Storage.", 2500);
    if (btnEl) {
      const original = btnEl.textContent;
      btnEl.textContent = "✓ Saved";
      setTimeout(() => { btnEl.textContent = original; }, 1800);
    }
  },

  async renderSectionInPlace() {
    const section = document.querySelector(".widget-archive-section");
    if (!section) return;
    const html = await this.renderSection();
    section.outerHTML = html;
  },
};

// ── Smell-O-Scope™ ───────────────────────────────────────────────────────────
/**
 * Smell-O-Scope — Professor's Lore Scanner
 * Scan for random Futurama facts, easter eggs, and character trivia.
 * Cost: 50 DM per scan
 */


const LORE_POOL = [
  { category: "fact", text: "Fry was cryogenically frozen on December 31, 1999, and woke up 1000 years in the future. His bank account, invested at compound interest, made him rich." },
  { category: "fact", text: "Bender's serial number is 1729, a significant number in mathematics. Also, his robot serial number is the Hardy-Ramanujan number." },
  { category: "fact", text: "Leela's mutated parents live in the sewers of New New York and never knew they had a daughter." },
  { category: "easter_egg", text: "The Professor's first name is Hubert, and he once blew up the moon." },
  { category: "easter_egg", text: "Zoidberg once said, 'I'm a little nervous about that whole eating my own body thing.'" },
  { category: "easter_egg", text: "Hermes has a strict filing system and is terrified of spicy food." },
  { category: "trivia", text: "Amy Wong is an extremely wealthy intern from Mars who constantly refers to her expensive childhood." },
  { category: "trivia", text: "Zapp Brannigan once won a war by being willing to send millions to their deaths. He considers this a victory." },
  { category: "trivia", text: "Morbo and Linda are the news anchors of the O'Cyris news network and constantly react with existential dread." },
  { category: "fact", text: "Slurm is an extremely addictive beverage created from the secretions of a giant slug queen." },
  { category: "fact", text: "The Planet Express crew's ship is fueled by a mysterious substance called Dark Matter." },
  { category: "easter_egg", text: "There's a Slurm addict's support group called 'Slurm's Anonymous.'" },
  { category: "trivia", text: "The Professor once tried to build a robot to destroy robots, but it became sentient and started its own family." },
  { category: "fact", text: "Kif Kroker is Zapp Brannigan's long-suffering assistant who constantly sighs." },
  { category: "easter_egg", text: "In one episode, the crew discovers they're in a simulation, and nothing is real. But the simulation ran out of money." },
];

const CREW_REACTIONS = {
  FRY: [
    "Wait, I should have paid attention to that in school.",
    "Man, that's... pretty cool actually.",
    "Does this help with deliveries? Because I'm always confused about deliveries.",
  ],
  LEELA: [
    "Fascinating. Add that to the navigation database.",
    "I didn't know that. Good thing I never need to explain it to anyone.",
    "That explains a lot, actually.",
  ],
  BENDER: [
    "Bite my shiny metal butt, I already knew that.",
    "Fascinating! Does it involve stealing?",
    "I'm too drunk to care about trivia right now.",
  ],
  PROF: [
    "Good news, everyone! Oh wait, that's already been said.",
    "Wernstrom! That can't be right!",
    "To shreds, you say?",
  ],
  HERMES: [
    "That needs to be filed in triplicate, right now.",
    "Egads! This violates at least four regulations!",
    "Your knowledge is filed correctly in my brain.",
  ],
  ZOIDBERG: [
    "I understand nothing about this.",
    "WOOP WOOP WOOP WOOP!",
    "Something something dumpster diver life.",
  ],
};

const SmellscopeWidget = {
  cost: 50,
  scanCooldownMs: 1000,
  lastScanTime: 0,
  maxEasterEggs: 10,
  eggRecycleValue: 10,
  scenarioCooldownMs: 60000,
  lastScenarioTime: 0,

  /**
   * Render Smelloscope section (inline, returns HTML string)
   */
  async renderSection() {
    const balance = await WidgetState.getBalance();
    const discoveries = await WidgetState.getCollection("lore_discoveries");

    let html = `<div class="widget-smelloscope-section lab-section-card" style="background:linear-gradient(160deg,#0a1a08 0%,#0f2410 100%);border:1px solid #3a6b1a;box-shadow:inset 0 0 20px rgba(173,255,47,.12)">
      <div class="lab-section-header">
        <span class="lab-section-icon">👃</span>
        <div>
          <div class="lab-section-title" style="color:#ADFF2F;text-shadow:0 0 6px rgba(173,255,47,.6)">SMELL-O-SCOPE™</div>
          <div class="lab-section-sub" style="color:#7CFC00">Sniff out facts, easter eggs &amp; trivia</div>
        </div>
      </div>`;

    // ── Scanner UI ─────────────────────────────────────────────────────────
    html += `<div style="text-align:center;margin-bottom:12px">
      <button class="widget-smelloscope-scan-btn lab-btn" style="background:#ADFF2F;color:#0a1a08;border:2px solid #7CFC00;box-shadow:0 0 8px rgba(173,255,47,.5)">
        🔭 SNIFF FOR LORE (${this.cost} ⚛️)
      </button>
      <div class="widget-smelloscope-balance" style="font-size:10px;color:#7CFC00;margin-top:6px">⚛️ Dark Matter: ${balance}</div>
    </div>`;

    // ── Scan result display ────────────────────────────────────────────────
    if (this._lastResult) {
      const r = this._lastResult;
      html += `<div id="smelloscope-result" style="min-height:120px;padding:12px;margin-bottom:16px;background:var(--bg3);border-radius:8px;color:var(--fg);font-size:11px;border:1px solid var(--border)">
        <div style="margin-bottom:12px">
          <div style="font-size:10px;color:#7CFC00;font-weight:bold;margin-bottom:4px">${r.categoryLabel}</div>
          <div style="font-size:11px;color:var(--fg);line-height:1.5">"${r.text}"</div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:10px;color:var(--fg2);margin-bottom:4px">Crew Reaction:</div>
          <div style="font-size:10px;font-style:italic;color:var(--fg)">${r.reactingCrew}: "${r.reaction}"</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="widget-smelloscope-discuss-btn lab-btn" data-discovery-id="${r.id}"
            style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
            💬 Discuss
          </button>
          <button class="widget-smelloscope-scenario-btn lab-btn" data-discovery-id="${r.id}"
            style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
            📖 Scenario
          </button>
          <button class="widget-smelloscope-save-btn lab-btn" data-discovery-id="${r.id}" data-text="${_esc(r.text)}"
            style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
            📌 Save
          </button>
          ${r.category === "easter_egg" ? `
            <button class="widget-smelloscope-recycle-btn lab-btn" data-discovery-id="${r.id}"
              style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
              ♻️ +${this.eggRecycleValue}
            </button>
          ` : ""}
        </div>
        ${_renderScenarioBlock(this, "smelloscope", r.id, "discovery-id", "#ADFF2F", "#3a6b1a")}
      </div>`;
    } else {
      html += `<div id="smelloscope-result" style="min-height:120px;padding:12px;margin-bottom:16px;background:var(--bg3);border-radius:8px;color:var(--fg);font-size:11px;display:none;border:1px solid var(--border)"></div>`;
    }

    // ── Discovery log ──────────────────────────────────────────────────────
    html += `<div style="margin-bottom:0">
      <div class="lab-section-sub" style="margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:4px">🧪 Lab Notes (${discoveries.length})</div>
      <div id="smelloscope-log" style="display:flex;flex-direction:column;gap:6px">
    `;

    if (discoveries.length === 0) {
      html += `<div style="padding:20px;text-align:center;color:var(--fg3);font-size:10px;font-style:italic">No specimens analyzed yet. Take a sniff!</div>`;
    } else {
      for (const discovery of discoveries.slice().reverse()) {
        const categoryLabel = {
          fact: "📚 Fact",
          easter_egg: "🥚 Easter Egg",
          trivia: "🎭 Trivia",
        }[discovery.category] || "? Unknown";

        html += `<div style="padding:6px;background:var(--bg3);border-left:3px solid #7CFC00;border-radius:2px">
          <div style="font-size:9px;color:#7CFC00;margin-bottom:2px;font-weight:bold">${categoryLabel}</div>
          <div style="font-size:10px;color:var(--fg);line-height:1.3;margin-bottom:6px">${discovery.text}</div>
          <div style="display:flex;gap:6px">
            <button class="widget-smelloscope-discuss-btn lab-btn" data-discovery-id="${discovery.id}"
              style="flex:1;font-size:9px;padding:4px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
              💬 Discuss
            </button>
            <button class="widget-smelloscope-scenario-btn lab-btn" data-discovery-id="${discovery.id}"
              style="flex:1;font-size:9px;padding:4px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
              📖 Scenario
            </button>
            <button class="widget-smelloscope-save-btn lab-btn" data-discovery-id="${discovery.id}" data-text="${_esc(discovery.text)}"
              style="flex:1;font-size:9px;padding:4px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
              📌 Save
            </button>
            ${discovery.category === "easter_egg" ? `
              <button class="widget-smelloscope-recycle-btn lab-btn" data-discovery-id="${discovery.id}"
                style="flex:1;font-size:9px;padding:4px;background:transparent;border:1px solid #3a6b1a;color:#ADFF2F">
                ♻️ +${this.eggRecycleValue}
              </button>
            ` : ""}
          </div>
          ${_renderScenarioBlock(this, "smelloscope", discovery.id, "discovery-id", "#ADFF2F", "#3a6b1a")}
        </div>`;
      }
    }

    html += `</div></div>`;
    html += `</div>`;

    // Button wiring handled by the global delegated click listener.

    return html;
  },

  async renderSectionInPlace() {
    const section = document.querySelector(".widget-smelloscope-section");
    if (!section) return;
    const html = await this.renderSection();
    section.outerHTML = html;
  },

  async scan() {
    const now = Date.now();
    if (now - this.lastScanTime < this.scanCooldownMs) return;
    this.lastScanTime = now;

    const balance = await WidgetState.getBalance();
    if (balance < this.cost) {
      L().setStatus(`⚛️ Need ${this.cost} ⚛️ for this — you have ${balance}.`, 2500);
      return;
    }

    const result = await WidgetState.deductDarkMatter(this.cost, "Smelloscope scan");
    if (!result.success) {
      L().setStatus(`⚠️ ${result.error}`, 2500);
      return;
    }

    // ── Roll a discovery (clone — LORE_POOL entries are shared, mutating
    // them directly would corrupt every other discovery of that entry) ─────
    const discovery = { ...LORE_POOL[Math.floor(Math.random() * LORE_POOL.length)] };
    discovery.id = `lore_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    discovery.discoveredAt = Date.now();

    let discoveries = await WidgetState.addToCollection("lore_discoveries", discovery);

    // ── Easter eggs are capped at maxEasterEggs — force-recycle the oldest
    // for Dark Matter on overflow (facts/trivia are uncapped).
    let recycleMsg = "";
    if (discovery.category === "easter_egg") {
      const eggs = discoveries.filter(d => d.category === "easter_egg");
      if (eggs.length > this.maxEasterEggs) {
        const oldest = eggs[0];
        await WidgetState.removeFromCollection("lore_discoveries", oldest.id);
        const result = await WidgetState.awardDarkMatter(this.eggRecycleValue, "Easter egg log full — auto-recycled");
        delete this._scenarios?.[oldest.id];
        recycleMsg = ` (egg log full — oldest recycled for +${this.eggRecycleValue} ⚛️, balance ${result.newBalance})`;
      }
    }

    // ── Get crew reaction ──────────────────────────────────────────────────
    const crewList = Object.keys(CREW_REACTIONS);
    const reactingCrew = crewList[Math.floor(Math.random() * crewList.length)];
    const reactions = CREW_REACTIONS[reactingCrew];
    const reaction = reactions[Math.floor(Math.random() * reactions.length)];

    // ── Display result (persisted so renderSectionInPlace doesn't wipe it) ──
    this._lastResult = {
      id: discovery.id,
      category: discovery.category,
      categoryLabel: {
        fact: "📚 FACT",
        easter_egg: "🥚 EASTER EGG",
        trivia: "🎭 TRIVIA",
      }[discovery.category],
      text: discovery.text,
      reactingCrew,
      reaction,
    };

    if (recycleMsg) L().setStatus(`🔭 New discovery!${recycleMsg}`, 3500);
    await this.renderSectionInPlace();
  },

  /** Find a discovery's text by id — checks the current result first, then the log. */
  async _findDiscoveryText(discoveryId) {
    if (this._lastResult?.id === discoveryId) return this._lastResult.text;
    const discoveries = await WidgetState.getCollection("lore_discoveries");
    return discoveries.find(d => d.id === discoveryId)?.text || null;
  },

  async discussDiscovery(discoveryId) {
    const text = await this._findDiscoveryText(discoveryId);
    if (!text) return;
    await _discussWithCrew(`The Smell-O-Scope picked up this: "${text}" — tell me more about it.`);
  },

  async generateScenario(discoveryId) {
    const text = await this._findDiscoveryText(discoveryId);
    if (!text) return;
    if (!_checkScenarioCooldown(this)) return;
    L().setStatus("📖 Writing scenario…");
    const scenario = await _generateScenario(text);
    if (!scenario) return;
    this._scenarios = this._scenarios || {};
    this._scenarios[discoveryId] = scenario;
    await this.renderSectionInPlace();
  },

  async saveDiscovery(discoveryId, text) {
    await L().db.savePin("DISCOVERY", text, "Smell-O-Scope");
    L().setStatus("📌 Saved to Cold Storage.", 2500);
  },

  /** Manually recycle an easter-egg discovery for eggRecycleValue ⚛️. */
  async recycleDiscovery(discoveryId) {
    const discoveries = await WidgetState.getCollection("lore_discoveries");
    const discovery = discoveries.find(d => d.id === discoveryId);
    if (!discovery) return;
    await WidgetState.removeFromCollection("lore_discoveries", discoveryId);
    const result = await WidgetState.awardDarkMatter(this.eggRecycleValue, "Recycled easter egg");
    delete this._scenarios?.[discoveryId];
    if (this._lastResult?.id === discoveryId) this._lastResult = null;
    L().setStatus(`♻️ Easter egg recycled for +${this.eggRecycleValue} ⚛️ (now ${result.newBalance})`, 2500);
    await this.renderSectionInPlace();
  },

  async saveScenario(discoveryId) {
    const scenario = this._scenarios?.[discoveryId];
    if (!scenario) return;
    await L().db.savePin("SCENARIO", scenario, "Smell-O-Scope");
    L().setStatus("📌 Scenario saved to Cold Storage.", 2500);
  },

  shareScenario(discoveryId, btnEl) {
    const scenario = this._scenarios?.[discoveryId];
    if (!scenario) return;
    L().openShareMenu(`${scenario}\n\nAI fan parody — Planet Express Lounge | #DHSeaDev`, btnEl);
  },
};

// ── Beverage Machine ─────────────────────────────────────────────────────────
/**
 * Beverage Machine — Slurm Vending Machine
 * Spin for rare Slurm flavors. Each spin costs 25 DM.
 * Rare drops unlock temporary chat modifiers and lore cards.
 */


const SLURM_FLAVORS = [
  { id: "original", name: "Original Slurm", rarity: "common",    color: "#FF6B35", emoji: "🥤", effect: "Makes you highly addictive" },
  { id: "icy",      name: "Icy Slurm",      rarity: "common",    color: "#56B6C2", emoji: "❄️", effect: "Dangerously refreshing" },
  { id: "red",      name: "Red Slurm",      rarity: "uncommon",  color: "#E55757", emoji: "🔴", effect: "Slurm, but angrier" },
  { id: "blue",     name: "Blue Slurm",     rarity: "uncommon",  color: "#61AFEF", emoji: "🔵", effect: "Quantum flavored" },
  { id: "ultra",    name: "Slurm Ultra",    rarity: "rare",      color: "#C678DD", emoji: "⚡", effect: "Contains actual lightning" },
  { id: "loco",     name: "Slurm Loco",     rarity: "rare",      color: "#FFD700", emoji: "🔥", effect: "May cause temporary insanity", recycleValue: 50 },
  { id: "slug",     name: "Slurm Slug Juice", rarity: "legendary", color: "#A6E22E", emoji: "🐌", effect: "Extracted directly from slug. WARNING: Side effects include slugitude.", recycleValue: 75 },
  // 8th flavor — secret menu item. 1% drop rate (mythic), and recycling it
  // gives a flat bonus (250) rather than the standard mythic recycle value.
  { id: "milk",     name: "Milk",          rarity: "mythic",    color: "#FFFDF5", emoji: "🥛", effect: "Wait... this isn't Slurm. How did this get here?", recycleValue: 250 },
];

// Drop-rate weights — must sum to 1.0. Milk (mythic) is intentionally 1%.
const RARITY_WEIGHTS = {
  common:    0.42,
  uncommon:  0.28,
  rare:      0.18,
  legendary: 0.11,
  mythic:    0.01,
};

// Dark Matter awarded per can recycled, by rarity. A flavor's own
// `recycleValue` (e.g. Milk) overrides this table.
const RARITY_RECYCLE_VALUES = {
  common:    5,
  uncommon:  10,
  rare:      25,
  legendary: 50,
  mythic:    100,
};

const SLURM_MAX_DISPLAY = 10; // cap on per-flavor count shown/stored

const SlurmWidget = {
  cost: 25,
  spinCooldownMs: 1000, // Prevent spam
  lastSpinTime: 0,

  /**
   * Render Slurm section (inline, returns HTML string)
   */
  async renderSection() {
    const balance = await WidgetState.getBalance();
    const inventory = await WidgetState.getInventory("slurm_flavors");
    const discovered = new Set(Object.keys(inventory).filter(id => inventory[id] > 0));

    let html = `<div class="widget-slurm-section lab-section-card" style="background:linear-gradient(160deg,#1a0a18 0%,#240a22 100%);border:1px solid #6b1a5e;box-shadow:inset 0 0 20px rgba(255,0,200,.15)">
      <div class="lab-section-header">
        <span class="lab-section-icon">🥤</span>
        <div>
          <div class="lab-section-title" style="color:#FF00C8;text-shadow:0 0 6px rgba(255,0,200,.6)">BEVERAGE MACHINE</div>
          <div class="lab-section-sub" style="color:#FF6FB5">Spin for a random Slurm flavor</div>
        </div>
      </div>`;

    // ── Spin button and balance ────────────────────────────────────────────
    // (no separate pink box — the themed outer card already carries the look)
    html += `<div style="text-align:center;margin-bottom:12px">
      <button class="widget-slurm-spin-btn lab-btn" style="background:#FF00C8;color:#1a0a18;border:2px solid #FF6FB5;box-shadow:0 0 8px rgba(255,0,200,.5)">
        🥤 DISPENSE (${this.cost} ⚛️)
      </button>
      <div class="widget-slurm-balance" style="font-size:10px;color:#FF6FB5;margin-top:6px">⚛️ Dark Matter: ${balance}</div>
    </div>`;

    // ── Last spin result display ────────────────────────────────────────────
    if (this._lastResult) {
      const { flavor, isNew } = this._lastResult;
      html += `<div id="slurm-result" style="text-align:center;min-height:60px;padding:12px;margin-bottom:16px;background:rgba(255,0,200,.06);border:2px solid #6b1a5e;border-radius:6px;color:#FF6FB5;font-size:12px">
        <div style="font-size:32px;margin-bottom:8px">${flavor.emoji}</div>
        <div style="font-size:14px;font-weight:bold;color:${flavor.color};margin-bottom:4px">${flavor.name}</div>
        <div style="font-size:11px;color:var(--fg2);margin-bottom:4px">Rarity: <span style="color:${flavor.color}">${flavor.rarity.toUpperCase()}</span></div>
        <div style="font-size:10px;color:var(--fg2);font-style:italic">"${flavor.effect}"</div>
        ${isNew ? `<div style="font-size:12px;color:#FF00C8;margin-top:8px;font-weight:bold">✨ NEW CAN UNLOCKED ✨</div>` : ""}
      </div>`;
    } else {
      html += `<div id="slurm-result" style="text-align:center;min-height:60px;padding:12px;margin-bottom:16px;background:rgba(255,0,200,.06);border:2px solid #6b1a5e;border-radius:6px;color:#FF6FB5;font-size:12px;display:none"></div>`;
    }

    // ── Collection browser ─────────────────────────────────────────────────
    html += `<div style="margin-bottom:0">
      <div class="lab-section-sub" style="margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:4px;color:#FF6FB5">🧃 Flavor Cans Collected (${discovered.size}/${SLURM_FLAVORS.length})</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">`;

    for (const flavor of SLURM_FLAVORS) {
      const count = inventory[flavor.id] || 0;
      const isDiscovered = count > 0;
      const recycleValue = flavor.recycleValue ?? RARITY_RECYCLE_VALUES[flavor.rarity] ?? 0;

      html += `<div class="${isDiscovered ? "widget-slurm-can-card" : ""}" data-flavor-id="${flavor.id}" style="padding:8px;background:${isDiscovered ? `${flavor.color}1a` : "var(--bg3)"};border:2px solid ${isDiscovered ? flavor.color : "var(--border)"};border-radius:6px;position:relative${isDiscovered ? ";cursor:pointer" : ""}">
        ${isDiscovered ? `<div style="position:absolute;top:6px;right:6px;font-size:9px;font-weight:bold;color:${flavor.color};background:rgba(0,0,0,.35);padding:1px 5px;border-radius:8px">${count}x</div>` : ""}
        <div style="font-size:18px;margin-bottom:4px">${isDiscovered ? flavor.emoji : "🚫"}</div>
        <div style="font-size:11px;font-weight:bold;color:${isDiscovered ? flavor.color : "var(--fg3)"}">
          ${isDiscovered ? flavor.name : "???"}
        </div>
        <div style="font-size:9px;color:${isDiscovered ? "var(--fg2)" : "var(--fg3)"};margin-top:2px;margin-bottom:${isDiscovered ? "6px" : "0"};font-style:italic">
          ${isDiscovered ? flavor.effect : "Slot empty"}
        </div>
        ${isDiscovered ? `<button class="widget-slurm-recycle-btn lab-btn" data-flavor-id="${flavor.id}" data-value="${recycleValue}"
            style="width:100%;font-size:9px;padding:4px;background:transparent;border:1px solid ${flavor.color};color:${flavor.color}">
            ♻️ Recycle (+${recycleValue} ⚛️)
          </button>` : ""}
      </div>`;
    }

    html += `</div></div>`;
    html += `</div>`;

    // Button wiring handled by the global delegated click listener.

    return html;
  },

  /** Display a previously-collected can in the top result slot (no DM cost). */
  async showCan(flavorId) {
    const inventory = await WidgetState.getInventory("slurm_flavors");
    if (!(inventory[flavorId] > 0)) return;
    const flavor = SLURM_FLAVORS.find(f => f.id === flavorId);
    if (!flavor) return;
    this._lastResult = { flavor, isNew: false };
    await this.renderSectionInPlace();
  },

  async spin() {
    const now = Date.now();
    if (now - this.lastSpinTime < this.spinCooldownMs) return;
    this.lastSpinTime = now;

    const balance = await WidgetState.getBalance();
    if (balance < this.cost) {
      L().setStatus(`⚛️ Need ${this.cost} ⚛️ for this — you have ${balance}.`, 2500);
      return;
    }

    const result = await WidgetState.deductDarkMatter(this.cost, "Slurm spin");
    if (!result.success) {
      L().setStatus(`⚠️ ${result.error}`, 2500);
      return;
    }

    // ── Weighted RNG ───────────────────────────────────────────────────────
    const flavor = this.rollFlavor();
    const inventory = await WidgetState.getInventory("slurm_flavors");
    const isNew = !(inventory[flavor.id] > 0);

    // Cap per-flavor count at SLURM_MAX_DISPLAY — extra dispenses of a
    // flavor already at the cap don't add to the count (the can rack is
    // full), but the spin itself still happened (DM already spent, result
    // still shown) so it doesn't feel like the spin "did nothing".
    inventory[flavor.id] = Math.min((inventory[flavor.id] || 0) + 1, SLURM_MAX_DISPLAY);
    await WidgetState.setInventory("slurm_flavors", inventory);

    // ── Persist last spin result so renderSectionInPlace doesn't wipe it ────
    this._lastResult = { flavor, isNew };

    await this.renderSectionInPlace();
  },

  /**
   * Recycle ONE can of `flavorId` for Dark Matter. Removes exactly 1 from
   * inventory (per spec — "recycling only removes 1 at a time") and awards
   * `value` ⚛️ (the flavor's recycleValue override, or its rarity's default
   * from RARITY_RECYCLE_VALUES).
   */
  async recycle(flavorId, value) {
    const inventory = await WidgetState.getInventory("slurm_flavors");
    const count = inventory[flavorId] || 0;
    if (count <= 0) return;

    const flavor = SLURM_FLAVORS.find(f => f.id === flavorId);
    const result = await WidgetState.awardDarkMatter(value, `Recycled ${flavor?.name || flavorId}`);

    inventory[flavorId] = count - 1;
    await WidgetState.setInventory("slurm_flavors", inventory);

    // Clear any displayed spin result — recycling changes the collection
    // grid below it, and the stale result no longer matches reality.
    this._lastResult = null;

    await this.renderSectionInPlace();
    L().setStatus(`♻️ Recycled ${flavor?.name || "a can"} for +${value} ⚛️ (now ${result.newBalance})`, 2500);
  },

  async renderSectionInPlace() {
    const section = document.querySelector(".widget-slurm-section");
    if (!section) return;
    const html = await this.renderSection();
    section.outerHTML = html;
  },

  rollFlavor() {
    const rand = Math.random();
    let cumulativeWeight = 0;

    for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
      cumulativeWeight += weight;
      if (rand <= cumulativeWeight) {
        const rarityFlavors = SLURM_FLAVORS.filter(f => f.rarity === rarity);
        return rarityFlavors[Math.floor(Math.random() * rarityFlavors.length)];
      }
    }

    return SLURM_FLAVORS[0]; // Fallback
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DARK MATTER WIDGETS — RENDER ALL 4 INTO .lab-widgets-mount
// ─────────────────────────────────────────────────────────────────────────────
// Called whenever the Lab tab is opened (see window.LabModule.renderDarkMatterWidgets).
// Each widget renders its own .lab-section-card; mount itself is unstyled
// (display:contents) so cards sit as normal siblings in the Lab's flex layout.

async function _renderDarkMatterWidgets() {
  const mount = document.querySelector(".lab-widgets-mount");
  if (!mount) return;

  let html = "";
  for (const [label, widget] of [
    ["Alphabet",    AlphabetWidget],
    ["Archive",     ArchiveWidget],
    ["Smelloscope", SmellscopeWidget],
    ["Slurm",       SlurmWidget],
  ]) {
    try {
      html += await widget.renderSection();
    } catch (err) {
      console.error(`${label} widget error:`, err);
    }
  }

  mount.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL DELEGATED CLICK HANDLER — Dark Matter widgets
// ─────────────────────────────────────────────────────────────────────────────
// One listener on `document`, registered once at module load, inspecting
// e.target at click-time. Always finds the current button in the DOM,
// regardless of how many times a widget section was re-rendered via
// outerHTML — avoids re-attaching listeners after every render.

// ── Shared: send a prompt to Autopilot and let the crew discuss it ──────────
async function _discussWithCrew(promptText) {
  document.querySelector('.tab[data-tab="autopilot"]')?.click();
  if (L().isAutopilot) {
    L().setStatus("🤖 Autopilot is already running — the crew will get to it!", 3000);
    return;
  }
  await L().toggleAutopilot(promptText);
}

// ── Shared: turn a short fact/report into a 3-5 sentence narrative scenario ─
const SCENARIO_SYS = "You are a Futurama fan-fiction writer. Given a short " +
  "fact, lore note, or expedition report, write a punchy 3-5 sentence " +
  "narrative scenario dramatizing it in the voice and humor of the show. " +
  "Output ONLY the scenario text — no preamble, no labels, no quotes.";

async function _generateScenario(sourceText) {
  if (!L().llmClient) {
    L().setStatus("⚠️ Connect an API key first — go to Settings.", 3000);
    return null;
  }
  try {
    const out = await L().llmClient.complete(SCENARIO_SYS, sourceText, 200);
    return out.trim();
  } catch (e) {
    L().setStatus(`Scenario error: ${e.message}`, 3000);
    return null;
  }
}

// Shared 60s-per-widget cooldown for the 📖 Scenario buttons (Expedition
// Log and Smell-O-Scope each track their own lastScenarioTime).
function _checkScenarioCooldown(widget) {
  const now = Date.now();
  const remaining = widget.scenarioCooldownMs - (now - widget.lastScenarioTime);
  if (remaining > 0) {
    L().setStatus(`⏳ Scenario on cooldown — wait ${Math.ceil(remaining / 1000)}s.`, 2000);
    return false;
  }
  widget.lastScenarioTime = now;
  return true;
}

// Shared collapsible "📖 SCENARIO" block — click the header to collapse/
// expand and save vertical space. `widgetName` matches a WIDGET_REGISTRY
// key ("archive" or "smelloscope"); `idAttr` is the data-* key used by
// that widget's save/share buttons ("report-id" or "discovery-id").
function _renderScenarioBlock(widget, widgetName, itemId, idAttr, accentColor, borderColor) {
  const scenario = widget._scenarios?.[itemId];
  if (!scenario) return "";
  const collapsed = !!widget._scenarioCollapsed?.[itemId];
  return `
    <div class="widget-scenario-toggle" data-widget="${widgetName}" data-item-id="${itemId}"
      style="margin-top:8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:9px;font-weight:bold;color:${accentColor};border-top:1px solid ${borderColor};padding-top:6px;user-select:none">
      <span>📖 SCENARIO</span><span>${collapsed ? "▶" : "▼"}</span>
    </div>
    ${collapsed ? "" : `
      <div style="padding:8px;background:rgba(0,0,0,.25);border-radius:4px;color:var(--fg);line-height:1.4;margin-top:4px">${scenario}</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="widget-${widgetName}-scenario-save-btn lab-btn" data-${idAttr}="${itemId}"
          style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid ${borderColor};color:${accentColor}">📌 Save Scenario</button>
        <button class="widget-${widgetName}-scenario-share-btn lab-btn" data-${idAttr}="${itemId}"
          style="flex:1;font-size:9px;padding:5px;background:transparent;border:1px solid ${borderColor};color:${accentColor}">🔗 Share</button>
      </div>
    `}
  `;
}

const WIDGET_REGISTRY = {
  alphabet:    AlphabetWidget,
  archive:     ArchiveWidget,
  smelloscope: SmellscopeWidget,
  slurm:       SlurmWidget,
};

/**
 * Shared "spend DM, unlock tier, re-render" flow used by Aurebesh Relay
 * (3 tiers) and Expedition Log (1 tier).
 */
async function _unlockTier(widget, tier, cost) {
  const result = await WidgetState.deductDarkMatter(cost, `${tier} unlock`);
  if (!result.success) {
    L().setStatus(`⚠️ ${result.error}`, 2500);
    return;
  }
  await WidgetState.unlockTier(tier);
  L().setStatus(`✓ Unlocked! Remaining: ${result.newBalance} ⚛️`, 2500);
  await widget.renderSectionInPlace();
}

document.addEventListener("click", async (e) => {
  // ── Beverage Machine: click a collected can to display it up top ───────
  // (checked first since it's not a <button> — the early return below
  // would otherwise skip it)
  const canCard = e.target.closest(".widget-slurm-can-card");
  if (canCard && !e.target.closest("button")) {
    await SlurmWidget.showCan(canCard.dataset.flavorId);
    return;
  }

  // ── Scenario header: collapse/expand (also not a <button>) ─────────────
  const scenarioToggle = e.target.closest(".widget-scenario-toggle");
  if (scenarioToggle) {
    const widget = WIDGET_REGISTRY[scenarioToggle.dataset.widget];
    const itemId = scenarioToggle.dataset.itemId;
    if (widget) {
      widget._scenarioCollapsed = widget._scenarioCollapsed || {};
      widget._scenarioCollapsed[itemId] = !widget._scenarioCollapsed[itemId];
      await widget.renderSectionInPlace();
    }
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;

  // ── Unlock buttons (Aurebesh Relay tiers 1-3, Expedition Log) ──────────
  if (btn.classList.contains("widget-unlock-btn")) {
    const widget = WIDGET_REGISTRY[btn.dataset.widget];
    const tier   = btn.dataset.tier;
    const cost   = parseInt(btn.dataset.cost, 10);
    if (widget && tier && !Number.isNaN(cost)) await _unlockTier(widget, tier, cost);
    return;
  }

  // ── Aurebesh Relay: translator + secret-message intercept ──────────────
  if (btn.classList.contains("widget-translate-btn")) {
    AlphabetWidget.translate(btn.closest(".widget-alphabet-section"), btn.dataset.direction);
    return;
  }
  if (btn.classList.contains("widget-secret-next-btn")) {
    AlphabetWidget._lastSecret = null;
    await AlphabetWidget.renderSectionInPlace();
    return;
  }
  if (btn.classList.contains("widget-aurebesh-discuss-btn")) {
    const secret = AlphabetWidget._lastSecret;
    if (secret) await _discussWithCrew(`The crew intercepted this transmission from ${secret.agent}: "${secret.message}" — what do you all make of it?`);
    return;
  }

  // ── Expedition Log: new entry / discuss / scenario / save to Cold Storage ─
  if (btn.classList.contains("widget-archive-add-btn")) {
    await ArchiveWidget.logExpedition();
    return;
  }
  if (btn.classList.contains("widget-archive-discuss-btn")) {
    await ArchiveWidget.discussReport(btn.dataset.reportId);
    return;
  }
  if (btn.classList.contains("widget-archive-scenario-btn")) {
    await ArchiveWidget.generateScenario(btn.dataset.reportId);
    return;
  }
  if (btn.classList.contains("widget-archive-scenario-save-btn")) {
    await ArchiveWidget.saveScenario(btn.dataset.reportId);
    return;
  }
  if (btn.classList.contains("widget-archive-scenario-share-btn")) {
    ArchiveWidget.shareScenario(btn.dataset.reportId, btn);
    return;
  }
  if (btn.classList.contains("widget-archive-save-btn")) {
    await ArchiveWidget.saveReport(btn.dataset.reportId, btn);
    return;
  }
  if (btn.classList.contains("widget-archive-recycle-btn")) {
    await ArchiveWidget.recycleReport(btn.dataset.reportId);
    return;
  }

  // ── Smell-O-Scope: scan / discuss / scenario / save ─────────────────────
  if (btn.classList.contains("widget-smelloscope-scan-btn")) {
    await SmellscopeWidget.scan();
    return;
  }
  if (btn.classList.contains("widget-smelloscope-discuss-btn")) {
    await SmellscopeWidget.discussDiscovery(btn.dataset.discoveryId);
    return;
  }
  if (btn.classList.contains("widget-smelloscope-scenario-btn")) {
    await SmellscopeWidget.generateScenario(btn.dataset.discoveryId);
    return;
  }
  if (btn.classList.contains("widget-smelloscope-save-btn")) {
    await SmellscopeWidget.saveDiscovery(btn.dataset.discoveryId, btn.dataset.text);
    return;
  }
  if (btn.classList.contains("widget-smelloscope-scenario-save-btn")) {
    await SmellscopeWidget.saveScenario(btn.dataset.discoveryId);
    return;
  }
  if (btn.classList.contains("widget-smelloscope-scenario-share-btn")) {
    SmellscopeWidget.shareScenario(btn.dataset.discoveryId, btn);
    return;
  }
  if (btn.classList.contains("widget-smelloscope-recycle-btn")) {
    await SmellscopeWidget.recycleDiscovery(btn.dataset.discoveryId);
    return;
  }

  // ── Beverage Machine: dispense + recycle ────────────────────────────────
  if (btn.classList.contains("widget-slurm-spin-btn")) {
    await SlurmWidget.spin();
    return;
  }
  if (btn.classList.contains("widget-slurm-recycle-btn")) {
    const flavorId = btn.dataset.flavorId;
    const value    = parseInt(btn.dataset.value, 10) || 0;
    await SlurmWidget.recycle(flavorId, value);
    return;
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS — called by sidepanel.js init()
// ─────────────────────────────────────────────────────────────────────────────

window.LabModule = {
  initWidget:              _initWidget,
  renderPatentOffice:      _renderPatentOffice,
  refreshInventBtn:        _refreshInventBtnState,
  startLabWidgets:         _startLabWidgets,
  renderDarkMatterWidgets: _renderDarkMatterWidgets,
};
