/**
 * popup.js  —  Planet Express Lounge
 * Toolbar popup — opens the sidepanel. No server required.
 * Lightweight: just a launcher + status relay.
 */

const $ = id => document.getElementById(id);

const openSidebarBtn = $("openSidebarBtn");
const statusBar      = $("statusBar");
const statusDot      = $("statusDot");
const providerBadge  = $("providerBadge");

// Open the sidepanel on button click
if (openSidebarBtn) {
  openSidebarBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    }
  });
}

// Show current provider from storage
async function loadStatus() {
  const saved = await chrome.storage.local.get(["provider", "model", "groqKey", "orKey", "gemKey"]);
  const hasKey = saved.groqKey || saved.orKey || saved.gemKey;
  const provider = saved.provider || "Groq";
  const model    = (saved.model || "").split("/").pop().slice(0, 28);

  if (statusDot) {
    statusDot.className = "status-dot " + (hasKey ? "ready" : "");
  }
  if (statusBar) {
    statusBar.textContent = hasKey
      ? `Connected: ${provider}`
      : "⚠️ No API key — open sidebar → Settings";
  }
  if (providerBadge) {
    providerBadge.textContent = hasKey && model ? model : "not configured";
  }
}

loadStatus();
