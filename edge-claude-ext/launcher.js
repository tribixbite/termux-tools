// Launch bridge via navigator.share() → Termux.
// Browser intent: URIs add CATEGORY_BROWSABLE which Termux doesn't declare,
// so navigator.share() (native OS share, no BROWSABLE) is the only path.

const btn = document.getElementById("share-btn");
const status = document.getElementById("status");
const setupHint = document.getElementById("setup-hint");

// Listen for state updates from background.js (single source of truth for polling)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state_update") {
    if (msg.state === "connected") {
      status.textContent = "Bridge connected";
      // Auto-close launcher tab after successful connection
      setTimeout(() => window.close(), 1000);
    }
  }
});

// Check initial bridge state
chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
  if (resp?.state === "connected") {
    status.textContent = "Bridge is already connected";
    btn.textContent = "Already Running";
    btn.disabled = true;
  }
});

btn.addEventListener("click", async () => {
  btn.textContent = "Opening share sheet...";
  btn.disabled = true;

  try {
    await navigator.share({ text: "https://cfcbridge.example.com/start" });
    // User picked a target (hopefully Termux)
    status.textContent = "Shared — waiting for bridge to start...";
    btn.textContent = "Share to Termux";
    btn.disabled = false;

    // Notify background.js to start polling (it's the single source of truth)
    chrome.runtime.sendMessage({ type: "bridge_launch_initiated" });

    // Simple local timeout — background handles the actual polling
    setTimeout(() => {
      if (status.textContent.includes("waiting")) {
        status.textContent = "Bridge didn't start — try again or start manually in Termux";
      }
    }, 15000);
  } catch (e) {
    btn.textContent = "Share to Termux";
    btn.disabled = false;
    if (e.name === "AbortError") {
      status.textContent = "Cancelled — tap to try again";
    } else {
      status.textContent = "Error: " + e.message;
    }
  }
});
