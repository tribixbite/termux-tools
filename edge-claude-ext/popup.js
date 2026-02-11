/**
 * Popup UI — displays bridge connection status and reconnect button
 */

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const wsUrl = document.getElementById("wsUrl");
const tabCount = document.getElementById("tabCount");
const reconnectBtn = document.getElementById("reconnectBtn");

function updateUI(state) {
  statusDot.className = "status-dot " + (state.state || "disconnected");
  statusText.textContent = state.state || "disconnected";
  wsUrl.textContent = state.wsUrl || "—";
  tabCount.textContent = String(state.tabCount || 0);
}

// Get initial state
chrome.runtime.sendMessage({ type: "get_state" }, (response) => {
  if (response) updateUI(response);
});

// Listen for state updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state_update") {
    updateUI(msg);
  }
});

// Reconnect button
reconnectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" }, (response) => {
    if (response?.ok) {
      statusText.textContent = "reconnecting...";
      statusDot.className = "status-dot connecting";
    }
  });
});
