// Intent launch test suite — 10 different approaches
// G1-G5: Gemini 3.1 Pro verbatim suggestions
// M1-M5: Additional variations

const logEl = document.getElementById("log");
function log(msg) {
  const line = document.createElement("div");
  line.textContent = new Date().toTimeString().slice(0, 8) + " " + msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(msg);
}

// === GEMINI 3.1 PRO — VERBATIM ===

// G1: window.location.href with basic intent:#Intent syntax, unencoded extras
document.getElementById("g1").addEventListener("click", () => {
  log("G1: window.location.href");
  const intent = 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end';
  window.location.href = intent;
});

// G2: chrome.tabs.create with intent:// host-based URI
document.getElementById("g2").addEventListener("click", () => {
  log("G2: chrome.tabs.create intent://share/");
  const intent = 'intent://share/#Intent;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end';
  chrome.tabs.create({ url: intent });
});

// G3: window.open with URL-encoded extras
document.getElementById("g3").addEventListener("click", () => {
  log("G3: window.open (encoded extras)");
  const intent = 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https%3A%2F%2Fcfcbridge.example.com%2Fstart;end';
  window.open(intent, '_blank');
});

// G4: chrome.tabs.update with explicit package param
document.getElementById("g4").addEventListener("click", () => {
  log("G4: chrome.tabs.update + package");
  const intent = 'intent:#Intent;package=com.termux;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end';
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      chrome.tabs.update(tabs[0].id, { url: intent });
    }
  });
});

// G5: Anchor click simulation with scheme param
document.getElementById("g5").addEventListener("click", () => {
  log("G5: anchor .click() + scheme");
  const intent = 'intent:#Intent;scheme=https;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end';
  const link = document.createElement('a');
  link.href = intent;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => document.body.removeChild(link), 100);
});

// === ADDITIONAL VARIATIONS ===

// M1: navigator.share() — Android share sheet
document.getElementById("m1").addEventListener("click", async () => {
  log("M1: navigator.share()");
  try {
    await navigator.share({ text: "https://cfcbridge.example.com/start" });
    log("M1: share completed");
  } catch (e) {
    log("M1: " + e.name + " — " + e.message);
  }
});

// M2: Hidden iframe navigation
document.getElementById("m2").addEventListener("click", () => {
  log("M2: iframe src");
  const intent = 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end';
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = intent;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 3000);
});

// M3: chrome.tabs.create with intent:// format + encoded MIME type
document.getElementById("m3").addEventListener("click", () => {
  log("M3: tabs.create intent:// + encoded type");
  const intent = 'intent://share/#Intent;action=android.intent.action.SEND;type=text%2Fplain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https%3A%2F%2Fcfcbridge.example.com%2Fstart;end';
  chrome.tabs.create({ url: intent, active: true });
});

// M4: Direct <a> link — set href so user can tap it directly (real gesture)
const directLink = document.getElementById("direct-link");
const directIntent = 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;component=com.termux/.filepicker.TermuxFileReceiverActivity;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;end';
directLink.href = directIntent;
directLink.addEventListener("click", () => {
  log("M4: direct <a> tap");
});

// M5: window.open then tabs.create fallback
document.getElementById("m5").addEventListener("click", () => {
  log("M5: window.open + tabs.create combo");
  const intent = 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;S.android.intent.extra.TEXT=https://cfcbridge.example.com/start;component=com.termux/.filepicker.TermuxFileReceiverActivity;end';
  const w = window.open(intent, '_self');
  setTimeout(() => {
    log("M5: fallback to tabs.create");
    chrome.tabs.create({ url: intent, active: true });
  }, 800);
});

log("Test page loaded — " + new Date().toTimeString().slice(0, 8));
