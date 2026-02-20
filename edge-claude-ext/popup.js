/**
 * Popup UI — dashboard, test suite, log viewer, tab info
 */

// --- Tab navigation ----------------------------------------------------------

const tabBtns = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".panel");
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.panel).classList.add("active");
    // Load panel data
    if (btn.dataset.panel === "logs") refreshLogs();
    if (btn.dataset.panel === "tabs") refreshTabs();
  });
});

// --- State management --------------------------------------------------------

let currentState = {};
let refreshInterval = null;

function updateUI(state) {
  currentState = state;
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const detail = document.getElementById("statusDetail");

  dot.className = "status-dot " + (state.state || "disconnected");
  const extV = state.extVersion || chrome.runtime.getManifest().version;
  const bridgeV = state.bridgeVersion || "?";
  text.textContent = state.state === "connected" ? "Connected" :
    state.state === "connecting" ? "Connecting..." : "Disconnected";

  // Show versions in header area
  const verEl = document.getElementById("versionInfo");
  if (verEl) verEl.textContent = `ext v${extV} / bridge v${bridgeV}`;

  if (state.state === "connected" && state.stats?.connectedAt) {
    const secs = Math.round((Date.now() - state.stats.connectedAt) / 1000);
    detail.textContent = formatDuration(secs);
  } else {
    detail.textContent = state.wsUrl || "";
  }

  // Stats
  const s = state.stats || {};
  document.getElementById("stat-requests").textContent = s.toolRequestsReceived || 0;
  document.getElementById("stat-errors").textContent = s.toolErrors || 0;
  document.getElementById("stat-tabs").textContent = state.tabCount || 0;

  if (s.connectedAt) {
    const secs = Math.round((Date.now() - s.connectedAt) / 1000);
    document.getElementById("stat-uptime").textContent = formatDuration(secs);
  } else {
    document.getElementById("stat-uptime").textContent = "--";
  }

  // Show stop button when connected, launch when disconnected
  const stopBtn = document.getElementById("btn-stop-bridge");
  const launchBtn = document.getElementById("btn-launch-bridge");
  if (state.state === "connected") {
    stopBtn.style.display = "";
    launchBtn.style.display = "none";
  } else {
    stopBtn.style.display = "none";
    launchBtn.style.display = "";
  }

  if (s.lastToolName) {
    const ago = s.lastToolTime ? Math.round((Date.now() - s.lastToolTime) / 1000) : 0;
    document.getElementById("stat-lasttool").textContent =
      `${s.lastToolName} (${ago}s ago)`;
  }
}

function formatDuration(totalSecs) {
  if (totalSecs < 60) return totalSecs + "s";
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fetchState() {
  chrome.runtime.sendMessage({ type: "get_detailed_state" }, (response) => {
    if (response) updateUI(response);
  });
}

// Poll state every 2s
fetchState();
refreshInterval = setInterval(fetchState, 2000);

// Listen for push updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state_update") updateUI(msg);
});

// --- Dashboard buttons -------------------------------------------------------

document.getElementById("btn-reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" }, () => {
    document.getElementById("statusText").textContent = "Reconnecting...";
    document.getElementById("statusDot").className = "status-dot connecting";
  });
});

document.getElementById("btn-launch-bridge").addEventListener("click", async () => {
  const btn = document.getElementById("btn-launch-bridge");
  btn.textContent = "Launching...";
  btn.disabled = true;

  // Step 1: Check if bridge is already running via service worker
  chrome.runtime.sendMessage({ type: "launch_bridge" }, (response) => {
    if (response?.method === "already_running") {
      btn.disabled = false;
      btn.textContent = response.detail || "Already running";
      btn.classList.add("btn-primary");
      setTimeout(() => {
        btn.textContent = "Launch Bridge";
        btn.classList.remove("btn-primary");
      }, 3000);
      return;
    }

    // Step 2: Fire intent deep-link from popup context (has user gesture).
    // chrome.tabs.create() in the service worker lacks user gesture context,
    // so Android doesn't resolve the intent: URI. Must fire from here.
    const intentUrl = "intent:#Intent;action=android.intent.action.SEND;"
      + "type=text%2Fplain;"
      + "S.android.intent.extra.TEXT=https%3A%2F%2Fcfcbridge.example.com%2Fstart;"
      + "component=com.termux/.filepicker.TermuxFileReceiverActivity;end";

    try {
      // Create active tab with intent URI — popup user gesture propagates
      chrome.tabs.create({ url: intentUrl, active: true }, (tab) => {
        // Clean up blank tab after intent fires
        if (tab?.id) {
          setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 3000);
        }
      });
    } catch {
      // Fallback: copy command to clipboard
      const cmd = "nohup bun ~/git/termux-tools/claude-chrome-bridge.ts > $PREFIX/tmp/bridge.log 2>&1 &";
      navigator.clipboard.writeText(cmd).catch(() => {});
      btn.disabled = false;
      btn.textContent = "Cmd copied — paste in Termux";
      btn.style.fontSize = "10px";
      setTimeout(() => {
        btn.textContent = "Launch Bridge";
        btn.style.fontSize = "";
      }, 8000);
      return;
    }

    btn.disabled = false;
    btn.textContent = "Launching...";
    setTimeout(() => { btn.textContent = "Launch Bridge"; }, 5000);
  });
});

// --- Stop Bridge button ------------------------------------------------------

document.getElementById("btn-stop-bridge").addEventListener("click", async () => {
  const btn = document.getElementById("btn-stop-bridge");
  btn.textContent = "Stopping...";
  btn.disabled = true;

  chrome.runtime.sendMessage({ type: "stop_bridge" }, (response) => {
    btn.disabled = false;
    if (response?.ok) {
      btn.textContent = "Stopped";
      btn.style.display = "none";
      setTimeout(() => { btn.textContent = "Stop"; }, 3000);
    } else {
      btn.textContent = response?.error || "Failed";
      setTimeout(() => { btn.textContent = "Stop"; }, 3000);
    }
  });
});

// --- Update button -----------------------------------------------------------

const BRIDGE_BASE = "http://127.0.0.1:18963";
const updateBtn = document.getElementById("btn-update");
const updateText = document.getElementById("btn-update-text");

/** Compare semver strings: returns >0 if a > b, 0 if equal, <0 if a < b */
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

updateBtn.addEventListener("click", async () => {
  const installedVersion = chrome.runtime.getManifest().version;
  updateText.textContent = "Checking...";
  updateBtn.disabled = true;

  try {
    // Fetch latest source version from bridge
    const resp = await fetch(`${BRIDGE_BASE}/ext/version`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const sourceVersion = data.version;

    if (compareSemver(sourceVersion, installedVersion) > 0) {
      // Newer version available — download CRX
      updateText.textContent = `Downloading v${sourceVersion}...`;
      // Open CRX URL in new tab — Edge will prompt to install
      await chrome.tabs.create({ url: `${BRIDGE_BASE}/ext/crx`, active: true });
      updateText.textContent = `v${sourceVersion} ready — install from downloads`;
      updateBtn.classList.add("btn-primary");
      setTimeout(() => {
        updateText.textContent = "Check for Update";
        updateBtn.classList.remove("btn-primary");
      }, 8000);
    } else {
      // Already up to date
      updateText.textContent = `Up to date (v${installedVersion})`;
      setTimeout(() => { updateText.textContent = "Check for Update"; }, 3000);
    }
  } catch (err) {
    // Bridge unreachable — can't check version
    updateText.textContent = err.message || "Bridge unreachable";
    setTimeout(() => { updateText.textContent = "Check for Update"; }, 3000);
  } finally {
    updateBtn.disabled = false;
  }
});

// Auto-check for update on popup open (non-blocking)
(async () => {
  try {
    const installedVersion = chrome.runtime.getManifest().version;
    const resp = await fetch(`${BRIDGE_BASE}/ext/version`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (compareSemver(data.version, installedVersion) > 0) {
      updateText.textContent = `Update → v${data.version}`;
      updateBtn.classList.add("btn-primary");
    }
  } catch {
    // Silently ignore — bridge may not be running
  }
})();

// --- Test suite --------------------------------------------------------------

const TEST_SUITE = [
  { id: "ws_connection", name: "WebSocket Connection", desc: "Check WS is connected to bridge" },
  { id: "bridge_health", name: "Bridge Health", desc: "Fetch /health from bridge server" },
  { id: "tabs_query", name: "Chrome Tabs Query", desc: "chrome.tabs.query works" },
  { id: "tabs_context", name: "MCP Tabs Context", desc: "Get MCP tab group context" },
  { id: "navigate", name: "Navigate", desc: "Navigate active tab to bridge health URL" },
  { id: "js_exec", name: "JavaScript Exec", desc: "Evaluate 1+1 via safe arithmetic parser" },
  { id: "read_page", name: "Read Page", desc: "Get accessibility tree from active tab" },
  { id: "screenshot", name: "Screenshot", desc: "captureVisibleTab screenshot" },
  { id: "tool_roundtrip", name: "Tool Roundtrip", desc: "Send ping through bridge WS" },
];

const testResults = {};
let passCount = 0;
let failCount = 0;

function renderTests() {
  const list = document.getElementById("test-list");
  list.innerHTML = "";
  for (const test of TEST_SUITE) {
    const r = testResults[test.id];
    const el = document.createElement("div");
    el.className = "test-item" + (r ? (r.pass ? " pass" : " fail") : "");
    el.innerHTML = `
      <span class="test-icon">${r ? (r.pass ? "&#9989;" : "&#10060;") : "&#9898;"}</span>
      <div style="flex:1">
        <div class="test-name">${test.name}</div>
        <div class="test-detail">${r ? (r.detail || r.error || "") : test.desc}</div>
      </div>
      <span class="test-ms">${r?.ms != null ? r.ms + "ms" : ""}</span>
    `;
    el.addEventListener("click", () => runTest(test.id));
    list.appendChild(el);
  }
  document.getElementById("test-pass-count").textContent = passCount + " passed";
  document.getElementById("test-fail-count").textContent = failCount + " failed";
}

async function runTest(testId) {
  // Mark running
  const items = document.querySelectorAll(".test-item");
  const idx = TEST_SUITE.findIndex((t) => t.id === testId);
  if (idx >= 0 && items[idx]) {
    items[idx].className = "test-item running";
    items[idx].querySelector(".test-icon").innerHTML = "&#9203;";
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "run_test", testName: testId }, (result) => {
      testResults[testId] = result || { pass: false, error: "No response" };
      recount();
      renderTests();
      resolve(result);
    });
  });
}

async function runAllTests() {
  passCount = 0;
  failCount = 0;
  const btn = document.getElementById("btn-run-all");
  btn.disabled = true;
  btn.textContent = "Running...";

  for (const test of TEST_SUITE) {
    await runTest(test.id);
    // Small delay between tests to avoid overwhelming
    await new Promise((r) => setTimeout(r, 300));
  }

  btn.disabled = false;
  btn.textContent = "Run All";
}

function recount() {
  passCount = 0;
  failCount = 0;
  for (const r of Object.values(testResults)) {
    if (r.pass) passCount++;
    else failCount++;
  }
}

document.getElementById("btn-run-all").addEventListener("click", runAllTests);
renderTests();

// --- Log viewer --------------------------------------------------------------

let lastLogTs = 0;

function refreshLogs() {
  chrome.runtime.sendMessage({ type: "get_logs", since: 0 }, (response) => {
    if (!response?.logs) return;
    const container = document.getElementById("log-container");
    container.innerHTML = "";

    for (const entry of response.logs) {
      const el = document.createElement("div");
      el.className = "log-entry";
      const ts = new Date(entry.ts).toTimeString().slice(0, 8);
      el.innerHTML = `
        <span class="log-ts">${ts}</span>
        <span class="log-lvl ${entry.level}">${entry.level}</span>
        <span class="log-msg">${escHtml(entry.msg)}</span>
        ${entry.data ? `<span class="log-data">${escHtml(entry.data.slice(0, 120))}</span>` : ""}
      `;
      container.appendChild(el);
    }

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
    if (response.logs.length > 0) {
      lastLogTs = response.logs[response.logs.length - 1].ts;
    }
  });
}

document.getElementById("btn-refresh-logs").addEventListener("click", refreshLogs);

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Tabs panel --------------------------------------------------------------

function refreshTabs() {
  chrome.runtime.sendMessage({ type: "get_detailed_state" }, (response) => {
    const list = document.getElementById("tab-info-list");
    list.innerHTML = "";
    const tabs = response?.tabs || [];

    if (tabs.length === 0) {
      list.innerHTML = '<div style="color:#8b949e;font-size:12px;padding:8px">No tabs in MCP group</div>';
      return;
    }

    for (const tab of tabs) {
      const el = document.createElement("div");
      el.className = "tab-info-item";
      el.innerHTML = `
        <div>
          <span class="tab-title">${escHtml(tab.title || "Untitled")}</span>
          ${tab.active ? '<span class="tab-active-badge">ACTIVE</span>' : ""}
          <span style="color:#484f58;font-size:10px;margin-left:4px">#${tab.id}</span>
        </div>
        <div class="tab-url">${escHtml(tab.url || "")}</div>
      `;
      list.appendChild(el);
    }
  });
}
