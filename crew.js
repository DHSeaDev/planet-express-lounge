/**
 * background.js  —  Planet Express Lounge v4.0 Service Worker
 *
 * Now entirely self-contained — no Python backend.
 * Handles: side panel init, context menus, keyboard shortcuts,
 * badge management, and a message bus for the sidepanel.
 *
 * Heavy lifting (LLM calls, DB, crew logic) runs in sidepanel.js
 * directly to avoid MV3 service-worker memory limits and lifecycle issues.
 * The service worker stays lightweight deliberately.
 */

// ── Shared init ──────────────────────────────────────────────────────────────
function _initSidePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// ── Install ──────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  _initSidePanel();

  if (details.reason === "install") {
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
chrome.runtime.onStartup.addListener(() => {
  _initSidePanel();
  chrome.action.setBadgeText({ text: "" });
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

// ── Badge helpers ─────────────────────────────────────────────────────────────
function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// ── Message bus (from sidepanel.js) ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "autopilot_started": setBadge("AP", "#B45309"); break;
    case "autopilot_stopped": setBadge("",   "#B45309"); break;
    case "crew_responding":   setBadge("…",  "#238636"); break;
    case "crew_done":         setBadge("",   "#238636"); break;
  }
});
