// Intent launch test — focused on navigator.share() and working approaches
// Browser intent: URIs add CATEGORY_BROWSABLE which Termux doesn't declare.
// navigator.share() uses the OS share system without BROWSABLE restriction.

const logEl = document.getElementById("log");
function log(msg) {
  const line = document.createElement("div");
  line.textContent = new Date().toTimeString().slice(0, 8) + " " + msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

// S1: navigator.share with text only
document.getElementById("s1").addEventListener("click", async () => {
  log("S1: navigator.share({ text })");
  try {
    await navigator.share({ text: "https://cfcbridge.example.com/start" });
    log("S1: share completed (user picked a target)");
  } catch (e) {
    log("S1 error: " + e.name + " — " + e.message);
  }
});

// S2: navigator.share with title + text
document.getElementById("s2").addEventListener("click", async () => {
  log("S2: navigator.share({ title, text })");
  try {
    await navigator.share({
      title: "CFC Bridge",
      text: "https://cfcbridge.example.com/start",
    });
    log("S2: share completed");
  } catch (e) {
    log("S2 error: " + e.name + " — " + e.message);
  }
});

// S3: navigator.share with url field
document.getElementById("s3").addEventListener("click", async () => {
  log("S3: navigator.share({ url })");
  try {
    await navigator.share({ url: "https://cfcbridge.example.com/start" });
    log("S3: share completed");
  } catch (e) {
    log("S3 error: " + e.name + " — " + e.message);
  }
});

// S4: navigator.share with title + url
document.getElementById("s4").addEventListener("click", async () => {
  log("S4: navigator.share({ title, url })");
  try {
    await navigator.share({
      title: "CFC Bridge",
      url: "https://cfcbridge.example.com/start",
    });
    log("S4: share completed");
  } catch (e) {
    log("S4 error: " + e.name + " — " + e.message);
  }
});

// S5: navigator.share with text + url
document.getElementById("s5").addEventListener("click", async () => {
  log("S5: navigator.share({ text, url })");
  try {
    await navigator.share({
      text: "start bridge",
      url: "https://cfcbridge.example.com/start",
    });
    log("S5: share completed");
  } catch (e) {
    log("S5 error: " + e.name + " — " + e.message);
  }
});

// S6: Check if share API is even available
document.getElementById("s6").addEventListener("click", () => {
  log("S6: API check");
  log("  navigator.share: " + (typeof navigator.share));
  log("  navigator.canShare: " + (typeof navigator.canShare));
  if (navigator.canShare) {
    const can1 = navigator.canShare({ text: "test" });
    const can2 = navigator.canShare({ url: "https://example.com" });
    log("  canShare({text}): " + can1);
    log("  canShare({url}): " + can2);
  }
  log("  isSecureContext: " + window.isSecureContext);
  log("  protocol: " + window.location.protocol);
});

// I1: intent: URI via tabs.create (for comparison — expected to fail due to BROWSABLE)
document.getElementById("i1").addEventListener("click", () => {
  log("I1: tabs.create intent: (expect wrong apps due to BROWSABLE)");
  chrome.tabs.create({
    url: 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;package=com.termux;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end',
    active: true,
  });
});

// I2: intent:// format via tabs.create
document.getElementById("i2").addEventListener("click", () => {
  log("I2: tabs.create intent:// format");
  chrome.tabs.create({
    url: 'intent://share/#Intent;action=android.intent.action.SEND;type=text/plain;package=com.termux;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end',
    active: true,
  });
});

log("Loaded — " + new Date().toTimeString().slice(0, 8));
log("TermuxFileReceiverActivity has CATEGORY_DEFAULT only (no BROWSABLE)");
log("Browser intent: URIs add BROWSABLE → Termux never matches");
log("navigator.share() uses OS share system → should show Termux");
