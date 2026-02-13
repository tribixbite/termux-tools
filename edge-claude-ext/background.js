/**
 * Claude Code Browser Bridge — Service Worker (background.js)
 *
 * Maintains a WebSocket connection to the local bridge server
 * (ws://127.0.0.1:18963) and handles tool requests from Claude Code
 * by dispatching them to content scripts or using chrome.* APIs.
 */

// --- Configuration -----------------------------------------------------------

const WS_URL = "ws://127.0.0.1:18963/ws";
const BRIDGE_HEALTH_URL = "http://127.0.0.1:18963/health";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 20000;
const SCRIPTING_TIMEOUT_MS = 10000;
const CONTENT_SCRIPT_TIMEOUT_MS = 30000;

// --- State -------------------------------------------------------------------

/** @type {WebSocket|null} */
let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let keepaliveTimer = null;
let connectionState = "disconnected"; // disconnected | connecting | connected

// MCP tab group tracking
let mcpTabGroup = new Map(); // tabId -> tab info

// Message log ring buffer for popup diagnostics
const messageLog = [];
const MAX_LOG_ENTRIES = 200;

// Stats
const stats = {
  connectedAt: null,
  toolRequestsReceived: 0,
  toolResponsesSent: 0,
  toolErrors: 0,
  reconnects: 0,
  lastToolName: null,
  lastToolTime: null,
  wsMessagesSent: 0,
  wsMessagesReceived: 0,
};

// --- Logging -----------------------------------------------------------------

function addLog(level, msg, data) {
  const entry = {
    ts: Date.now(),
    level, // info | warn | error | tool | ws
    msg,
    data: data ? JSON.stringify(data).slice(0, 500) : undefined,
  };
  messageLog.push(entry);
  if (messageLog.length > MAX_LOG_ENTRIES) messageLog.shift();

  // Also console.log for devtools
  const prefix = `[bridge:${level}]`;
  if (level === "error") console.error(prefix, msg, data || "");
  else console.log(prefix, msg, data || "");
}

// --- WebSocket Connection ----------------------------------------------------

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  connectionState = "connecting";
  broadcastState();
  addLog("ws", "Connecting to bridge...", { url: WS_URL });

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    addLog("error", "WebSocket creation failed", { error: err.message });
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connectionState = "connected";
    reconnectAttempts = 0;
    stats.connectedAt = Date.now();
    addLog("ws", "Connected to bridge server");
    broadcastState();

    sendMessage({ type: "ping" });

    clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        sendMessage({ type: "ping" });
      }
    }, KEEPALIVE_INTERVAL_MS);
  };

  ws.onmessage = (event) => {
    stats.wsMessagesReceived++;
    try {
      const msg = JSON.parse(event.data);
      handleBridgeMessage(msg);
    } catch (err) {
      addLog("error", "Failed to parse message", { error: err.message });
    }
  };

  ws.onclose = (event) => {
    addLog("ws", "Disconnected", { code: event.code, reason: event.reason });
    connectionState = "disconnected";
    ws = null;
    stats.connectedAt = null;
    clearInterval(keepaliveTimer);
    broadcastState();
    scheduleReconnect();
  };

  ws.onerror = () => {
    addLog("error", "WebSocket error");
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS
  );
  reconnectAttempts++;
  stats.reconnects++;
  addLog("ws", `Reconnecting in ${delay}ms`, { attempt: reconnectAttempts });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function sendMessage(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    stats.wsMessagesSent++;
    return true;
  }
  return false;
}

// --- Message Handling --------------------------------------------------------

async function handleBridgeMessage(msg) {
  switch (msg.type) {
    case "pong":
    case "heartbeat":
      break;

    case "bridge_connected":
      addLog("info", "Bridge handshake", msg);
      break;

    case "status_response":
      addLog("info", "Bridge status", msg);
      break;

    case "mcp_connected":
      addLog("info", "MCP server connected to native host");
      break;

    case "tool_request":
      await handleToolRequest(msg);
      break;

    case "error":
      addLog("error", "Bridge error", { error: msg.error });
      break;

    default:
      addLog("warn", `Unknown message type: ${msg.type}`, msg);
  }
}

// --- Tool Request Dispatch ---------------------------------------------------

async function handleToolRequest(msg) {
  const { method, params } = msg;
  stats.toolRequestsReceived++;

  // Unwrap execute_tool wrapper from MCP server
  if (method === "execute_tool" && params?.tool) {
    addLog("tool", `Unwrap execute_tool → ${params.tool}`, { args: params.args });
    return handleToolRequest({
      type: msg.type,
      method: params.tool,
      params: params.args || {},
    });
  }

  const startTime = Date.now();
  stats.lastToolName = method;
  stats.lastToolTime = startTime;
  addLog("tool", `→ ${method}`, params);

  try {
    let result;
    switch (method) {
      case "javascript_tool":
        result = await handleJavascriptTool(params);
        break;
      case "read_page":
        result = await handleReadPage(params);
        break;
      case "find":
        result = await handleFind(params);
        break;
      case "navigate":
        result = await handleNavigate(params);
        break;
      case "form_input":
        result = await handleFormInput(params);
        break;
      case "computer":
        result = await handleComputer(params);
        break;
      case "tabs_context_mcp":
        result = await handleTabsContext(params);
        break;
      case "tabs_create_mcp":
        result = await handleTabsCreate(params);
        break;
      case "read_console_messages":
        result = await handleReadConsole(params);
        break;
      default:
        result = { error: `Unsupported tool: ${method}` };
    }

    const elapsed = Date.now() - startTime;
    stats.toolResponsesSent++;
    addLog("tool", `← ${method} OK (${elapsed}ms)`, { resultPreview: JSON.stringify(result).slice(0, 200) });

    // CRITICAL: Do NOT include `method` in response — cli.js response classifier
    // M7z() checks `"method" in A` first and misclassifies as notification,
    // causing handleResponse() to never fire and the tool call to timeout.
    sendMessage({ type: "tool_response", result });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    stats.toolErrors++;
    addLog("error", `← ${method} FAIL (${elapsed}ms)`, { error: err.message });
    sendMessage({ type: "tool_response", error: err.message || String(err) });
  }
}

// --- Tool Implementations ----------------------------------------------------

async function handleJavascriptTool(params) {
  const { text, tabId } = params;
  const tid = resolveTabId(tabId);

  // Go straight to content script — chrome.scripting.executeScript hangs
  // indefinitely on Android Edge, and the content script now uses <script>
  // tag injection to run code in the MAIN world (bypasses MV3 CSP).
  return await executeViaContentScript(tid, "javascript_exec", { code: text });
}

async function handleReadPage(params) {
  const { tabId, filter, depth, ref_id, max_chars } = params;
  const tid = resolveTabId(tabId);
  return await executeViaContentScript(tid, "read_page", {
    filter: filter || "all",
    depth: depth || 15,
    ref_id: ref_id || null,
    max_chars: max_chars || 50000,
  });
}

async function handleFind(params) {
  const { query, tabId } = params;
  const tid = resolveTabId(tabId);
  return await executeViaContentScript(tid, "find", { query });
}

async function handleNavigate(params) {
  const { url, tabId } = params;
  const tid = resolveTabId(tabId);

  if (url === "back") {
    await chrome.tabs.goBack(tid);
    return { result: "Navigated back" };
  }
  if (url === "forward") {
    await chrome.tabs.goForward(tid);
    return { result: "Navigated forward" };
  }

  let fullUrl = url;
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = "https://" + fullUrl;
  }

  await chrome.tabs.update(tid, { url: fullUrl });

  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tid && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });

  return { result: `Navigated to ${fullUrl}` };
}

async function handleFormInput(params) {
  const { ref, value, tabId } = params;
  const tid = resolveTabId(tabId);
  return await executeViaContentScript(tid, "form_input", { ref, value });
}

async function handleComputer(params) {
  const { action, tabId, coordinate, text } = params;
  const tid = resolveTabId(tabId);

  switch (action) {
    case "screenshot":
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
        return { result: dataUrl, type: "image/png", encoding: "base64" };
      } catch (err) {
        return await executeViaContentScript(tid, "screenshot", {});
      }

    case "type":
      return await executeViaContentScript(tid, "type_text", { text });

    case "key":
      return await executeViaContentScript(tid, "key_press", { keys: text });

    case "scroll":
      return await executeViaContentScript(tid, "scroll", {
        x: coordinate?.[0] || 0,
        y: coordinate?.[1] || 0,
      });

    case "scroll_to":
      return await executeViaContentScript(tid, "scroll_to", { ref: params.ref_id });

    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click":
      return await executeViaContentScript(tid, "click", {
        x: coordinate?.[0] || 0,
        y: coordinate?.[1] || 0,
        button: action.replace("_click", ""),
        clickCount: action === "double_click" ? 2 : action === "triple_click" ? 3 : 1,
      });

    case "hover":
      return await executeViaContentScript(tid, "hover", {
        x: coordinate?.[0] || 0,
        y: coordinate?.[1] || 0,
      });

    case "wait":
      const waitMs = (params.duration || 2) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      return { result: `Waited ${params.duration || 2}s` };

    default:
      return { error: `Unsupported computer action: ${action}` };
  }
}

async function handleTabsContext(params) {
  const { createIfEmpty } = params;
  const tabs = await chrome.tabs.query({});

  if (mcpTabGroup.size === 0 && tabs.length > 0) {
    for (const tab of tabs) {
      mcpTabGroup.set(tab.id, {
        id: tab.id,
        url: tab.url || tab.pendingUrl || "",
        title: tab.title || "",
        active: tab.active,
      });
    }
  }

  if (createIfEmpty && mcpTabGroup.size === 0) {
    const newTab = await chrome.tabs.create({ url: "about:blank" });
    mcpTabGroup.set(newTab.id, {
      id: newTab.id,
      url: "about:blank",
      title: "New Tab",
      active: true,
    });
  }

  const tabList = [];
  for (const [tabId] of mcpTabGroup) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const info = {
        id: tab.id,
        url: tab.url || tab.pendingUrl || "",
        title: tab.title || "",
        active: tab.active,
      };
      mcpTabGroup.set(tabId, info);
      tabList.push(info);
    } catch {
      mcpTabGroup.delete(tabId);
    }
  }

  return {
    result: {
      tabs: tabList,
      activeTabId: tabList.find((t) => t.active)?.id || tabList[0]?.id,
    },
  };
}

async function handleTabsCreate(_params) {
  const newTab = await chrome.tabs.create({ url: "about:blank" });
  mcpTabGroup.set(newTab.id, {
    id: newTab.id,
    url: "about:blank",
    title: "New Tab",
    active: true,
  });
  return { result: { tabId: newTab.id } };
}

async function handleReadConsole(params) {
  const { tabId } = params;
  const tid = resolveTabId(tabId);
  return await executeViaContentScript(tid, "read_console", {});
}

// --- Content Script Communication --------------------------------------------

function executeViaContentScript(tabId, action, params) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Content script timeout for ${action}`));
    }, CONTENT_SCRIPT_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, { action, params }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        injectAndRetry(tabId, action, params).then(resolve).catch(reject);
        return;
      }
      resolve(response);
    });
  });
}

async function injectAndRetry(tabId, action, params) {
  await Promise.race([
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Content script injection timeout")), SCRIPTING_TIMEOUT_MS)
    ),
  ]);

  await new Promise((r) => setTimeout(r, 200));

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action, params }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Content script unavailable: ${chrome.runtime.lastError.message}`));
        return;
      }
      resolve(response);
    });
  });
}

// --- Utility -----------------------------------------------------------------

function resolveTabId(tabId) {
  if (tabId && mcpTabGroup.has(tabId)) return tabId;
  for (const [id, info] of mcpTabGroup) {
    if (info.active) return id;
  }
  const first = mcpTabGroup.keys().next();
  if (!first.done) return first.value;
  return tabId;
}

function broadcastState() {
  chrome.runtime.sendMessage({
    type: "state_update",
    state: connectionState,
    tabCount: mcpTabGroup.size,
    stats,
  }).catch(() => {});
}

// --- Tab tracking ------------------------------------------------------------

chrome.tabs.onRemoved.addListener((tabId) => {
  mcpTabGroup.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (mcpTabGroup.has(tabId)) {
    const info = mcpTabGroup.get(tabId);
    if (changeInfo.url) info.url = changeInfo.url;
    if (changeInfo.title) info.title = changeInfo.title;
  }
});

// --- Message listener for popup & content scripts ----------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get_state") {
    sendResponse({
      state: connectionState,
      tabCount: mcpTabGroup.size,
      wsUrl: WS_URL,
      stats,
    });
    return true;
  }

  if (msg.type === "get_logs") {
    const since = msg.since || 0;
    sendResponse({
      logs: messageLog.filter((e) => e.ts > since),
      total: messageLog.length,
    });
    return true;
  }

  if (msg.type === "get_detailed_state") {
    sendResponse({
      state: connectionState,
      tabCount: mcpTabGroup.size,
      wsUrl: WS_URL,
      stats: { ...stats },
      tabs: Array.from(mcpTabGroup.values()),
      reconnectAttempts,
      logCount: messageLog.length,
    });
    return true;
  }

  if (msg.type === "reconnect") {
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (ws) {
      ws.close();
      ws = null;
    }
    connect();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "run_test") {
    runSelfTest(msg.testName)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ pass: false, error: err.message }));
    return true;
  }

  if (msg.type === "launch_bridge") {
    launchBridge()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// --- Self-test suite ---------------------------------------------------------

async function runSelfTest(testName) {
  const start = Date.now();
  try {
    switch (testName) {
      case "ws_connection": {
        return {
          pass: connectionState === "connected",
          detail: `State: ${connectionState}`,
          ms: Date.now() - start,
        };
      }
      case "bridge_health": {
        const resp = await fetch(BRIDGE_HEALTH_URL);
        const data = await resp.json();
        return {
          pass: data.status === "ok",
          detail: `nativeHost: ${data.nativeHost}, clients: ${data.clients}, uptime: ${Math.round(data.uptime)}s`,
          ms: Date.now() - start,
          data,
        };
      }
      case "tabs_query": {
        const tabs = await chrome.tabs.query({});
        return {
          pass: tabs.length > 0,
          detail: `${tabs.length} tabs found`,
          ms: Date.now() - start,
        };
      }
      case "tabs_context": {
        const result = await handleTabsContext({});
        const tabCount = result?.result?.tabs?.length || 0;
        return {
          pass: tabCount > 0,
          detail: `${tabCount} tabs in MCP group`,
          ms: Date.now() - start,
        };
      }
      case "navigate": {
        const tabs = await chrome.tabs.query({ active: true });
        const tid = tabs[0]?.id;
        if (!tid) return { pass: false, detail: "No active tab" };
        const result = await handleNavigate({ url: "http://127.0.0.1:18963/health", tabId: tid });
        return {
          pass: !!result?.result,
          detail: result?.result || result?.error,
          ms: Date.now() - start,
        };
      }
      case "js_exec": {
        const tabs = await chrome.tabs.query({ active: true });
        const tid = tabs[0]?.id;
        if (!tid) return { pass: false, detail: "No active tab" };
        const result = await handleJavascriptTool({ text: "1+1", tabId: tid });
        return {
          pass: result?.result === "2",
          detail: `Result: ${result?.result || result?.error}`,
          ms: Date.now() - start,
        };
      }
      case "read_page": {
        const tabs = await chrome.tabs.query({ active: true });
        const tid = tabs[0]?.id;
        if (!tid) return { pass: false, detail: "No active tab" };
        const result = await handleReadPage({ tabId: tid, depth: 3, max_chars: 1000 });
        const hasRefs = result?.result?.includes("[ref_");
        return {
          pass: hasRefs,
          detail: hasRefs ? `Got tree (${result.result.length} chars)` : (result?.error || "No refs found"),
          ms: Date.now() - start,
        };
      }
      case "screenshot": {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
          return {
            pass: dataUrl?.startsWith("data:image"),
            detail: `Screenshot ${Math.round(dataUrl.length / 1024)}KB`,
            ms: Date.now() - start,
          };
        } catch (err) {
          return { pass: false, detail: err.message, ms: Date.now() - start };
        }
      }
      case "tool_roundtrip": {
        if (connectionState !== "connected") {
          return { pass: false, detail: "Not connected to bridge" };
        }
        // Send ping and verify pong comes back
        const sent = sendMessage({ type: "ping" });
        return {
          pass: sent,
          detail: sent ? "Ping sent to bridge" : "Failed to send ping",
          ms: Date.now() - start,
        };
      }
      default:
        return { pass: false, detail: `Unknown test: ${testName}` };
    }
  } catch (err) {
    return { pass: false, error: err.message, ms: Date.now() - start };
  }
}

// --- Bridge launcher ---------------------------------------------------------

async function launchBridge() {
  // Try to launch bridge via Termux intent
  // Termux:RUN_COMMAND intent can execute a command in Termux
  addLog("info", "Attempting to launch bridge via Termux intent");

  // Method 1: Open a Termux URL scheme that runs the bridge
  // termux://run?command=... (requires Termux:Tasker or am start)
  try {
    // Create a tab that triggers the Termux intent
    const tab = await chrome.tabs.create({
      url: "intent:#Intent;action=com.termux.RUN_COMMAND;component=com.termux/.app.RunCommandService;S.com.termux.RUN_COMMAND_PATH=/data/data/com.termux/files/usr/bin/bash;S.com.termux.RUN_COMMAND_ARGUMENTS=-c;S.com.termux.RUN_COMMAND_ARGUMENTS='nohup bun $HOME/git/termux-tools/claude-chrome-bridge.ts > /data/data/com.termux/files/usr/tmp/bridge.log 2>&1 &';B.com.termux.RUN_COMMAND_BACKGROUND=true;end",
      active: false,
    });

    // Close the intent tab after a brief delay
    setTimeout(() => {
      chrome.tabs.remove(tab.id).catch(() => {});
    }, 3000);

    addLog("info", "Bridge launch intent sent");

    // Wait and check if bridge comes up
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const resp = await fetch(BRIDGE_HEALTH_URL);
      const data = await resp.json();
      if (data.status === "ok") {
        addLog("info", "Bridge launched successfully");
        // Reconnect WebSocket
        if (connectionState !== "connected") {
          reconnectAttempts = 0;
          connect();
        }
        return { ok: true, method: "intent", detail: "Bridge started via Termux intent" };
      }
    } catch {}

    return { ok: false, method: "intent", detail: "Intent sent but bridge not responding yet — check Termux" };
  } catch (err) {
    addLog("error", "Bridge launch failed", { error: err.message });
    return { ok: false, error: err.message };
  }
}

// --- Startup -----------------------------------------------------------------

addLog("info", "Service worker starting");
connect();
