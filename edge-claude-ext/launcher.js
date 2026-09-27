// The background owns daemon startup and connection polling. Sharing stays in
// this tab's click handler so Android receives a fresh user activation.
const btn = document.getElementById("share-btn");
const status = document.getElementById("status");
let connected = false;
let waitingTimer;

/** Mark a confirmed connection; late startup callbacks must not overwrite it. */
function showConnected() {
  if (connected) return;
  connected = true;
  clearTimeout(waitingTimer);
  status.textContent = "Bridge connected";
  btn.textContent = "Already Running";
  btn.disabled = true;
  setTimeout(() => window.close(), 1000);
}

/** Keep manual recovery available if startup never establishes a connection. */
function waitForConnection() {
  if (connected) return;
  clearTimeout(waitingTimer);
  status.textContent = "Waiting for bridge to connect...";
  btn.textContent = "Starting...";
  btn.disabled = true;
  waitingTimer = setTimeout(() => {
    if (connected) return;
    status.textContent = "Bridge didn't respond — share to Termux or use the command below";
    btn.textContent = "Share to Termux";
    btn.disabled = false;
  }, 15000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state_update" && msg.state === "connected") showConnected();
});

btn.disabled = true;
status.textContent = "Checking bridge...";
chrome.runtime.sendMessage({ type: "get_state" }, (state) => {
  const stateError = chrome.runtime.lastError;
  if (!stateError && state?.state === "connected") {
    showConnected();
    return;
  }
  if (connected) return;
  status.textContent = "Trying daemon...";
  chrome.runtime.sendMessage({ type: "launch_bridge" }, (response) => {
    const launchError = chrome.runtime.lastError;
    if (connected) return;
    if (!launchError && response?.ok) {
      waitForConnection();
      return;
    }
    status.textContent = "Choose Share to Termux, then select Termux in the share sheet";
    btn.disabled = false;
  });
});

btn.addEventListener("click", async () => {
  btn.textContent = "Opening share sheet...";
  btn.disabled = true;
  clearTimeout(waitingTimer);
  try {
    // This exact URL matches both installed and generated termux-url-opener
    // handlers (*cfcbridge*/start*). Share only text to avoid merged payloads.
    await navigator.share({ text: "https://cfcbridge.example.com/start" });
    if (connected) return;
    waitForConnection();
    chrome.runtime.sendMessage({ type: "bridge_launch_initiated" });
  } catch (error) {
    if (connected) return;
    btn.textContent = "Share to Termux";
    btn.disabled = false;
    status.textContent = error.name === "AbortError"
      ? "Cancelled — tap to try again"
      : "Sharing unavailable — use the command below: " + error.message;
  }
});
