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
  text.textContent = state.state === "connected" ? "Connected" :
    state.state === "connecting" ? "Connecting..." : "Disconnected";

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

document.getElementById("btn-launch-bridge").addEventListener("click", () => {
  const btn = document.getElementById("btn-launch-bridge");
  btn.textContent = "Launching...";
  btn.disabled = true;
  chrome.runtime.sendMessage({ type: "launch_bridge" }, (response) => {
    btn.disabled = false;
    if (response?.ok) {
      btn.textContent = "Launched!";
      btn.classList.add("btn-primary");
      setTimeout(() => {
        btn.textContent = "Launch Bridge";
        btn.classList.remove("btn-primary");
      }, 3000);
    } else {
      btn.textContent = response?.detail || response?.error || "Failed";
      setTimeout(() => { btn.textContent = "Launch Bridge"; }, 3000);
    }
  });
});

// --- Test suite --------------------------------------------------------------

const TEST_SUITE = [
  { id: "ws_connection", name: "WebSocket Connection", desc: "Check WS is connected to bridge" },
  { id: "bridge_health", name: "Bridge Health", desc: "Fetch /health from bridge server" },
  { id: "tabs_query", name: "Chrome Tabs Query", desc: "chrome.tabs.query works" },
  { id: "tabs_context", name: "MCP Tabs Context", desc: "Get MCP tab group context" },
  { id: "navigate", name: "Navigate", desc: "Navigate active tab to bridge health URL" },
  { id: "js_exec", name: "JavaScript Exec", desc: "Execute 1+1 via chrome.scripting" },
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
