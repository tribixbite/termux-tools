// Launch bridge via navigator.share() → Termux.
// Browser intent: URIs add CATEGORY_BROWSABLE which Termux doesn't declare,
// so navigator.share() (native OS share, no BROWSABLE) is the only path.

const btn = document.getElementById("share-btn");
const status = document.getElementById("status");

btn.addEventListener("click", async () => {
  btn.textContent = "Opening share sheet...";
  btn.disabled = true;

  try {
    await navigator.share({ text: "https://cfcbridge.example.com/start" });
    // User picked a target (hopefully Termux)
    status.textContent = "Shared — waiting for bridge to start...";
    btn.textContent = "Share to Termux";
    btn.disabled = false;

    // Poll for bridge health, auto-close when it's up
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const resp = await fetch("http://127.0.0.1:18963/health", {
          signal: AbortSignal.timeout(1500),
        });
        const data = await resp.json();
        if (data.status === "ok") {
          status.textContent = "Bridge running v" + data.version;
          setTimeout(() => window.close(), 1000);
          return;
        }
      } catch {}
    }
    status.textContent = "Bridge didn't start — try again or start manually in Termux";
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
