// Launch bridge — tries daemon API first, falls back to navigator.share() → Termux.
// Browser intent: URIs add CATEGORY_BROWSABLE which Termux doesn't declare,
// so navigator.share() (native OS share, no BROWSABLE) is the only path
// when the daemon isn't running.

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

// On load: try daemon API first — may start bridge without share sheet
(async () => {
  // Check if already connected
  chrome.runtime.sendMessage({ type: "get_state" }, (resp) => {
    if (resp?.state === "connected") {
      status.textContent = "Bridge is already connected";
      btn.textContent = "Already Running";
      btn.disabled = true;
    }
  });

  // Try starting via daemon HTTP API (works when Termux is running)
  status.textContent = "Trying daemon...";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch("http://127.0.0.1:18970/api/bridge", {
      method: "POST",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data.status === "starting" || data.status === "already_running") {
        status.textContent = `Bridge ${data.status} via daemon — waiting for connection...`;
        btn.textContent = "Starting...";
        btn.disabled = true;
        // Tell background to start polling
        chrome.runtime.sendMessage({ type: "bridge_launch_initiated" });
        // Auto-close timeout
        setTimeout(() => {
          if (status.textContent.includes("waiting")) {
            status.textContent = "Bridge didn't respond — try share button below";
            btn.textContent = "Share to Termux";
            btn.disabled = false;
          }
        }, 12000);
        return; // Daemon handled it
      }
    }
  } catch {
    // Daemon not reachable — Termux may not be running
  }

  // Daemon didn't work — show share button
  status.textContent = "Tap below to share to Termux and start the bridge";
})();

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
