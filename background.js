/**
 * background.js  —  Planet Express Lounge Service Worker
 *
 * Handles: side panel init, context menus, keyboard shortcuts,
 * badge management, and the Dark Matter resource engine.
 *
 * ── DARK MATTER ENGINE ───────────────────────────────────────────────────────
 *
 * Dark Matter is the extension's pseudo-currency. It accumulates passively
 * through two chaotic, unpredictable reward paths:
 *
 *   1. FOCUS TICK (every 60 seconds, via chrome.alarms)
 *      Each tick awards a random integer [1–7]. Chaotic by design —
 *      the user never knows if they'll get 1 or 7. The alarm persists
 *      across service worker restarts, so rewards continue even if the
 *      SW was killed and relaunched.
 *
 *   2. PAGE LOAD REWARD — removed (eliminated 'tabs' permission for store compliance)
 *      Each completed page load awards a random integer [10–50].
 *      A 60-second cooldown prevents reward farming by rapid refresh.
 *      The cooldown timestamp is persisted in chrome.storage.local
 *      so it survives SW restarts too.
 *
 * All state (darkMatter, lastPageLoadRewardTime) is stored in
 * chrome.storage.local. After every mutation, a `dm_update` message
 * is broadcast so the sidepanel widget can refresh in real time.
 *
 * Dark Matter is callable by other functions — read via:
 *   chrome.storage.local.get(['darkMatter'])
 * Spend via:
 *   chrome.runtime.sendMessage({ type: 'dm_spend', amount: N })
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const DM_ALARM_NAME         = "dm_focus_tick";
const DM_ALARM_PERIOD_MIN   = 1;          // fires every 60 seconds
const DM_FOCUS_MIN          = 1;          // minimum random focus reward
const DM_FOCUS_MAX          = 7;          // maximum random focus reward
const DM_MAX                = 9_999_999;  // cap at 7 digits (0000001 display)

// ── Utility ───────────────────────────────────────────────────────────────────

/** Returns a random integer in [min, max] inclusive. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Read current darkMatter from storage.
 * Returns 0 if not yet initialised.
 */
async function getDarkMatter() {
  const s = await chrome.storage.local.get(["darkMatter"]);
  return Math.min(Math.max(parseInt(s.darkMatter) || 0, 0), DM_MAX);
}

/**
 * Add `amount` Dark Matter, persist, broadcast to sidepanel, update badge.
 * @param {number} amount
 * @param {string} source - label for console logging during development
 */
async function addDarkMatter(amount, source) {
  const current = await getDarkMatter();
  const next    = Math.min(current + amount, DM_MAX);
  await chrome.storage.local.set({ darkMatter: next });

  // Development logging — shows the chaotic reward value and running total
  console.log(`[DM] +${amount} from ${source} → total: ${next} (${String(next).padStart(7, "0")})`);

  _broadcastDM(next, { amount, label: source === "focus-tick" ? "Focus" : "Page load" });
  _updateDMBadge(next);
}

/**
 * Spend `amount` Dark Matter. Returns true if successful, false if insufficient.
 * Called by other extension functions that need to consume Dark Matter.
 */
async function spendDarkMatter(amount, label = "") {
  const current = await getDarkMatter();
  if (current < amount) return false;
  const next = current - amount;
  await chrome.storage.local.set({ darkMatter: next });
  _broadcastDM(next, { spent: amount, label });
  _updateDMBadge(next);
  return true;
}

/**
 * Push a dm_update message to the sidepanel (and any other listeners).
 * The sidepanel listens for this to refresh its display widget.
 */
function _broadcastDM(value, meta = {}) {
  chrome.runtime.sendMessage({ type: "dm_update", darkMatter: value, ...meta }).catch(() => {});
}

/**
 * Show the DM total in the toolbar badge as a compact number.
 * Clears badge if value is 0.
 */
function _updateDMBadge(value) {
  if (value <= 0) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  // Show compact: 1234567 → "1.2M", 12345 → "12K", 999 → "999"
  let label = "";
  if      (value >= 1_000_000) label = `${Math.floor(value / 100_000) / 10}M`;
  else if (value >= 1_000)     label = `${Math.floor(value / 1000)}K`;
  else                         label = String(value);
  chrome.action.setBadgeText({ text: label });
  chrome.action.setBadgeBackgroundColor({ color: "#1a3a6a" });
}

// ── Focus tick alarm ─────────────────────────────────────────────────────────
/**
 * Create the focus alarm if it doesn't already exist.
 * Using chrome.alarms instead of setInterval ensures the timer survives
 * service worker restarts — alarms are managed by Chrome itself.
 */
async function _ensureFocusAlarm() {
  const existing = await chrome.alarms.get(DM_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(DM_ALARM_NAME, {
      delayInMinutes: DM_ALARM_PERIOD_MIN,
      periodInMinutes: DM_ALARM_PERIOD_MIN,
    });
    console.log("[DM] Focus alarm created.");
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== DM_ALARM_NAME) return;
  // Random reward [1–7] — chaotic accumulation
  const reward = randInt(DM_FOCUS_MIN, DM_FOCUS_MAX);
  await addDarkMatter(reward, "focus-tick");
});

// Page load DM reward removed — 'tabs' permission not required

// ── Shared init ──────────────────────────────────────────────────────────────
function _initSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// ── Install ──────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  _initSidePanel();
  _ensureFocusAlarm();

  if (details.reason === "install") {
    // Seed Dark Matter at 0 on fresh install
    await chrome.storage.local.set({ darkMatter: 0 });
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html"), active: true });
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id:       "pe-ask-crew",
      title:    "🚀 Ask the Planet Express crew",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id:       "pe-open-sidebar",
      title:    "📺 Open Planet Express Sidebar",
      contexts: ["all"],
    });
  });
});

// ── Startup ──────────────────────────────────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  _initSidePanel();
  _ensureFocusAlarm();
  chrome.action.setBadgeText({ text: "" });
  // Restore badge from stored value on browser start
  const dm = await getDarkMatter();
  if (dm > 0) _updateDMBadge(dm);
});

// ── Toolbar click ─────────────────────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Context menus ─────────────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "pe-open-sidebar") {
    await chrome.sidePanel.open({ tabId: tab.id });
    return;
  }

  if (info.menuItemId === "pe-ask-crew") {
    const text = (info.selectionText || "").trim().slice(0, 300);
    if (!text) return;
    await chrome.storage.session.set({
      pendingMessage:      text,
      pendingSource:       "contextmenu",
      pendingNeedsConfirm: true,
    });
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-side-panel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ── Badge helpers (autopilot / crew state) ────────────────────────────────────
function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// ── Message bus ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Security: only accept messages from this extension's own contexts
  // (sidepanel, popup). Any web page can call chrome.runtime.sendMessage —
  // reject anything that isn't from us.
  if (sender.id !== chrome.runtime.id) return false;
  if (typeof msg?.type !== "string") return false;

  switch (msg.type) {
    // Autopilot / crew state badges
    case "autopilot_started": setBadge("AP",  "#B45309"); break;
    case "autopilot_stopped": setBadge("",    "#B45309"); break;
    case "crew_responding":   setBadge("…",   "#238636"); break;
    case "crew_done":         setBadge("",    "#238636"); break;

    // Dark Matter read request — sidepanel asks for current value on open
    case "dm_get":
      getDarkMatter().then(dm => sendResponse({ darkMatter: dm }));
      return true; // keep channel open for async response

    // Dark Matter earn request (scrap recycling awards)
    case "dm_earn":
      addDarkMatter(msg.amount || 0, msg.label || "Scrap").then(() => sendResponse({ ok: true }));
      return true;

    // Dark Matter spend request — from sidepanel features that consume DM
    case "dm_spend":
      spendDarkMatter(msg.amount || 0, msg.label || "").then(ok => sendResponse({ ok }));
      return true;
  }
});
