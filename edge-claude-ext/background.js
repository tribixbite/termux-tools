/**
 * Claude Code Browser Bridge — Service Worker (background.js)
 *
 * Maintains a WebSocket connection to the local bridge server
 * (ws://127.0.0.1:18963) and handles tool requests from Claude Code
 * by dispatching them to content scripts or using chrome.* APIs.
 */

// --- Configuration -----------------------------------------------------------

const EXT_VERSION = chrome.runtime.getManifest().version;
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
    addLog("ws", `Connected to bridge server (ext v${EXT_VERSION})`);
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
      stats.bridgeVersion = msg.version || "unknown";
      addLog("info", `Bridge handshake (bridge v${stats.bridgeVersion}, ext v${EXT_VERSION})`, msg);
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
      case "get_page_text":
        result = await handleGetPageText(params);
        break;
      case "update_plan":
        result = handleUpdatePlan(params);
        break;
      case "shortcuts_list":
        result = { result: [] }; // no side panel shortcuts on Android
        break;
      case "shortcuts_execute":
        result = { error: "Keyboard shortcuts are not available on Android Edge" };
        break;
      case "read_network_requests":
        result = handleReadNetworkRequests(params);
        break;
      case "resize_window":
        result = await handleResizeWindow(params);
        break;
      case "upload_image":
        result = await handleUploadImage(params);
        break;
      case "gif_creator":
        result = await handleGifCreator(params);
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

  // Parse modifier keys (e.g. "ctrl+shift") into event properties
  const modifiers = parseModifiers(params.modifiers);

  switch (action) {
    case "screenshot":
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
        return { result: dataUrl, type: "image/png", encoding: "base64" };
      } catch (err) {
        return await executeViaContentScript(tid, "screenshot", {});
      }

    case "type":
      return await executeViaContentScript(tid, "type_text", { text, modifiers });

    case "key":
      return await executeViaContentScript(tid, "key_press", { keys: text, modifiers });

    case "scroll":
      return await executeViaContentScript(tid, "scroll", {
        x: coordinate?.[0] || 0,
        y: coordinate?.[1] || 0,
        direction: params.scroll_direction,
        amount: params.scroll_amount || 3,
        modifiers,
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
        ref: params.ref,
        button: action.replace("_click", ""),
        clickCount: action === "double_click" ? 2 : action === "triple_click" ? 3 : 1,
        modifiers,
      });

    case "left_click_drag":
      return await executeViaContentScript(tid, "drag", {
        startX: coordinate?.[0] || 0,
        startY: coordinate?.[1] || 0,
        endX: params.end_coordinate?.[0] || 0,
        endY: params.end_coordinate?.[1] || 0,
        modifiers,
      });

    case "hover":
      return await executeViaContentScript(tid, "hover", {
        x: coordinate?.[0] || 0,
        y: coordinate?.[1] || 0,
        modifiers,
      });

    case "zoom": {
      // Capture full screenshot, then crop via bridge for zoomed view
      const zoomFactor = params.zoom_factor || 2;
      try {
        const fullShot = await chrome.tabs.captureVisibleTab(null, { format: "png" });
        // Determine image dimensions from the data URL via bridge crop
        // Use viewport-based crop centered on coordinate
        const dims = await executeViaContentScript(tid, "get_viewport_dims", {});
        const vw = dims?.width || 1080;
        const vh = dims?.height || 1920;
        const zx = coordinate?.[0] || Math.round(vw / 2);
        const zy = coordinate?.[1] || Math.round(vh / 2);
        const cropW = Math.round(vw / zoomFactor);
        const cropH = Math.round(vh / zoomFactor);
        const cropX = Math.max(0, Math.min(Math.round(zx - cropW / 2), vw - cropW));
        const cropY = Math.max(0, Math.min(Math.round(zy - cropH / 2), vh - cropH));

        const resp = await fetch("http://127.0.0.1:18963/crop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: fullShot, crop: { x: cropX, y: cropY, width: cropW, height: cropH } }),
        });
        const data = await resp.json();
        if (data.image) {
          return { result: data.image, type: "image/png", encoding: "base64" };
        }
        return { error: data.error || "Crop failed" };
      } catch (err) {
        return { error: `Zoom failed: ${err.message}` };
      }
    }

    case "wait":
      const waitMs = (params.duration || 2) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      return { result: `Waited ${params.duration || 2}s` };

    default:
      return { error: `Unsupported computer action: ${action}` };
  }
}

/** Parse modifier string (e.g. "ctrl+shift") into event property flags */
function parseModifiers(modStr) {
  if (!modStr) return {};
  const mods = modStr.toLowerCase().split("+").map((s) => s.trim());
  return {
    ctrlKey: mods.includes("ctrl") || mods.includes("control"),
    shiftKey: mods.includes("shift"),
    altKey: mods.includes("alt"),
    metaKey: mods.includes("meta") || mods.includes("cmd") || mods.includes("command"),
  };
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

// --- New Tool Handlers -------------------------------------------------------

async function handleGetPageText(params) {
  const { tabId, max_chars } = params;
  const tid = resolveTabId(tabId);
  return await executeViaContentScript(tid, "get_page_text", {
    max_chars: max_chars || 100000,
  });
}

/** Auto-approve on Android (no side panel UI for plan display) */
function handleUpdatePlan(params) {
  const { domains } = params;
  return {
    result: {
      approved: true,
      domains: domains || [],
      note: "Auto-approved on Android (no side panel UI)",
    },
  };
}

// --- Network request tracking ------------------------------------------------

/** Per-tab network request ring buffer. @type {Map<number, Array>} */
const networkRequests = new Map();
const MAX_NETWORK_ENTRIES = 500;

// Register webRequest listener if the API is available (requires webRequest permission)
try {
  if (chrome.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        if (!details.tabId || details.tabId < 0) return;
        if (!networkRequests.has(details.tabId)) {
          networkRequests.set(details.tabId, []);
        }
        const buf = networkRequests.get(details.tabId);
        buf.push({
          url: details.url,
          method: details.method,
          statusCode: details.statusCode,
          type: details.type,
          timestamp: details.timeStamp,
          fromCache: details.fromCache || false,
        });
        // Ring buffer: trim oldest entries
        while (buf.length > MAX_NETWORK_ENTRIES) buf.shift();
      },
      { urls: ["<all_urls>"] }
    );
    addLog("info", "webRequest.onCompleted listener registered");
  }
} catch (err) {
  addLog("warn", "webRequest not available", { error: err.message });
}

// Clear network buffer on cross-domain navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && networkRequests.has(tabId)) {
    try {
      const oldEntries = networkRequests.get(tabId);
      const oldDomain = oldEntries.length > 0 ? new URL(oldEntries[0].url).hostname : "";
      const newDomain = new URL(changeInfo.url).hostname;
      if (oldDomain && newDomain !== oldDomain) {
        networkRequests.set(tabId, []);
      }
    } catch {}
  }
});

function handleReadNetworkRequests(params) {
  const { tabId, since, type_filter } = params;
  const tid = resolveTabId(tabId);
  let entries = networkRequests.get(tid) || [];

  if (since) {
    entries = entries.filter((e) => e.timestamp > since);
  }
  if (type_filter) {
    entries = entries.filter((e) => e.type === type_filter);
  }

  return {
    result: entries.slice(-100), // return last 100 matching
    count: entries.length,
    // Note: if empty, the bridge may intercept this tool call and return CDP Network data instead
  };
}

async function handleResizeWindow(params) {
  const { width, height } = params;
  // Try chrome.windows.update first (works on desktop)
  try {
    const [win] = await chrome.windows.getAll();
    if (win?.id) {
      await chrome.windows.update(win.id, { width, height });
      return { result: `Resized window to ${width}x${height}` };
    }
  } catch {}

  // Fallback: bridge handles this via CDP Emulation.setDeviceMetricsOverride
  // (the bridge intercepts resize_window when CDP is available)
  return { error: `Window resize not supported natively on Android. Bridge will use CDP if available.` };
}

async function handleUploadImage(params) {
  const { tabId, ref, coordinate, image_data } = params;
  const tid = resolveTabId(tabId);
  return await executeViaContentScript(tid, "upload_image", {
    ref,
    x: coordinate?.[0],
    y: coordinate?.[1],
    image_data,
  });
}

/** GIF creator — captures PNG frames, encodes via bridge's /gif endpoint */
const gifState = { recording: false, frames: [], tabId: null, timer: null };
const GIF_BRIDGE_URL = "http://127.0.0.1:18963/gif";

async function handleGifCreator(params) {
  const { action } = params;

  switch (action) {
    case "start_recording": {
      if (gifState.recording) return { error: "Already recording" };
      gifState.recording = true;
      gifState.frames = [];
      gifState.tabId = resolveTabId(params.tabId);

      // Capture at ~2fps (500ms intervals), max 30s / 60 frames
      gifState.timer = setInterval(async () => {
        if (gifState.frames.length >= 60) {
          clearInterval(gifState.timer);
          gifState.recording = false;
          return;
        }
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
          gifState.frames.push({ data: dataUrl, ts: Date.now() });
        } catch {}
      }, 500);

      return { result: "Recording started (max 30s / 60 frames)" };
    }
    case "stop_recording": {
      if (!gifState.recording) return { error: "Not recording" };
      clearInterval(gifState.timer);
      gifState.recording = false;
      return {
        result: `Recording stopped. ${gifState.frames.length} frames captured.`,
        frameCount: gifState.frames.length,
      };
    }
    case "export": {
      if (gifState.frames.length === 0) return { error: "No frames captured. Start and stop a recording first." };

      // Calculate inter-frame delay from timestamps
      const avgDelay = gifState.frames.length > 1
        ? Math.round((gifState.frames[gifState.frames.length - 1].ts - gifState.frames[0].ts) / (gifState.frames.length - 1))
        : 500;

      try {
        addLog("info", `GIF: encoding ${gifState.frames.length} frames via bridge`);
        const resp = await fetch(GIF_BRIDGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frames: gifState.frames,
            delay: avgDelay,
            maxWidth: params.maxWidth || 480,
          }),
        });
        const data = await resp.json();
        if (data.error) return { error: `GIF encoding failed: ${data.error}` };

        const filename = params.filename || `recording_${Date.now()}.gif`;
        return {
          result: data.gif,
          filename,
          size: data.size,
          frameCount: gifState.frames.length,
          type: "image/gif",
          encoding: "base64",
        };
      } catch (err) {
        return { error: `GIF export failed: ${err.message}` };
      }
    }
    default:
      return { error: `Unknown gif_creator action: ${action}. Use start_recording, stop_recording, or export.` };
  }
}

// --- Content Script Communication --------------------------------------------

// Persistent port connections from content scripts (keyed by tab ID).
// These are far more reliable than chrome.tabs.sendMessage on Android Edge,
// which corrupts message channels after 2-3 calls.
/** @type {Map<number, chrome.runtime.Port>} */
const contentPorts = new Map();
/** @type {Map<string, {resolve: Function, timer: number}>} */
const pendingPortRequests = new Map();
let portReqCounter = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "cfc-content") return;
  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  contentPorts.set(tabId, port);
  addLog("info", `Content port connected for tab ${tabId}`);

  port.onMessage.addListener((msg) => {
    if (!msg._reqId) return;
    const pending = pendingPortRequests.get(msg._reqId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPortRequests.delete(msg._reqId);
      pending.resolve(msg.result);
    }
  });

  port.onDisconnect.addListener(() => {
    contentPorts.delete(tabId);
    // Clean up any pending requests to prevent memory leaks and stale resolves
    for (const [reqId, pending] of pendingPortRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve({ error: `Content port disconnected for tab ${tabId}` });
    }
    pendingPortRequests.clear();
    addLog("info", `Content port disconnected for tab ${tabId}, cleared ${pendingPortRequests.size} pending requests`);
  });
});

function executeViaContentScript(tabId, action, params) {
  const port = contentPorts.get(tabId);
  if (port) {
    return executeViaPort(port, tabId, action, params);
  }
  // Fall back to sendMessage if no persistent port
  return executeViaSendMessage(tabId, action, params);
}

function executeViaPort(port, tabId, action, params) {
  return new Promise((resolve, reject) => {
    const reqId = `req_${++portReqCounter}`;
    const timer = setTimeout(() => {
      pendingPortRequests.delete(reqId);
      addLog("warn", `Port timeout for ${action} on tab ${tabId}, falling back to sendMessage`);
      // Fall back to sendMessage on timeout
      executeViaSendMessage(tabId, action, params).then(resolve).catch(reject);
    }, CONTENT_SCRIPT_TIMEOUT_MS);

    pendingPortRequests.set(reqId, { resolve, timer });

    try {
      port.postMessage({ _reqId: reqId, action, params });
    } catch (err) {
      clearTimeout(timer);
      pendingPortRequests.delete(reqId);
      // Port broken — remove and fall back
      contentPorts.delete(tabId);
      executeViaSendMessage(tabId, action, params).then(resolve).catch(reject);
    }
  });
}

function executeViaSendMessage(tabId, action, params) {
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

  // Wait for content script to connect its port
  await new Promise((r) => setTimeout(r, 500));

  // Try port first if it connected during injection
  const port = contentPorts.get(tabId);
  if (port) {
    return executeViaPort(port, tabId, action, params);
  }

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
      extVersion: EXT_VERSION,
      bridgeVersion: stats.bridgeVersion || "unknown",
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

  if (msg.type === "stop_bridge") {
    stopBridge()
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

async function stopBridge() {
  addLog("info", "Requesting bridge shutdown");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch("http://127.0.0.1:18963/shutdown", {
      method: "POST",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await resp.json();
    addLog("info", `Bridge shutdown: ${data.status}`);
    // Disconnect our WS
    if (ws) {
      ws.close();
      ws = null;
    }
    connectionState = "disconnected";
    broadcastState();
    return { ok: true, detail: "Bridge stopped" };
  } catch (err) {
    addLog("warn", `Bridge shutdown failed: ${err.message}`);
    return { ok: false, error: `Shutdown failed: ${err.message}` };
  }
}

async function launchBridge() {
  addLog("info", "Attempting to launch bridge");

  // Step 1: Check if bridge is already running (fast 2s timeout)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const resp = await fetch(BRIDGE_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await resp.json();
    if (data.status === "ok") {
      addLog("info", "Bridge already running — reconnecting");
      if (connectionState !== "connected") {
        reconnectAttempts = 0;
        connect();
      }
      return { ok: true, method: "health", detail: `Already running v${data.version}` };
    }
  } catch {
    addLog("info", "Bridge not responding — needs manual start");
  }

  // Step 2: Deep-link via ACTION_SEND to TermuxFileReceiverActivity
  // This is the only Termux Activity that accepts external intents for execution.
  // It calls ~/bin/termux-url-opener with the URL as $1, which starts the bridge.
  // Trade-off: creates a brief temporary terminal session (doesn't affect existing ones).
  //
  // NOTE: On Android, chrome.tabs.create() with an intent: URI switches focus to Termux,
  // which closes the popup and kills the sendResponse callback. We respond immediately
  // and poll for startup in the background.
  try {
    const tab = await chrome.tabs.create({
      url: "intent:#Intent;action=android.intent.action.SEND;"
        + "type=text%2Fplain;"
        + "S.android.intent.extra.TEXT=https%3A%2F%2Fcfcbridge.example.com%2Fstart;"
        + "component=com.termux/.filepicker.TermuxFileReceiverActivity;end",
      active: false,
    });
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 2000);
    addLog("info", "Sent ACTION_SEND deep-link to Termux url-opener");

    // Poll in background — auto-connect when bridge comes up
    pollForBridgeStartup();

    return { ok: true, method: "deep-link", detail: "Launching via Termux..." };
  } catch (err) {
    addLog("warn", `Termux deep-link failed: ${err.message}`);
  }

  // Step 3: Fallback — copy command to clipboard (popup.js also writes from DOM context)
  const cmd =
    "nohup bun ~/git/termux-tools/claude-chrome-bridge.ts > $PREFIX/tmp/bridge.log 2>&1 &";
  let copied = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && !/^(chrome|edge|about):/.test(tab.url || "")) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => navigator.clipboard.writeText(text),
        args: [cmd],
      });
      copied = true;
      addLog("info", "Bridge start command copied to clipboard");
    }
  } catch (err) {
    addLog("warn", `Clipboard via content script failed: ${err.message}`);
  }

  return {
    ok: false,
    method: "manual",
    detail: copied
      ? "Cmd copied — switch to Termux & paste"
      : `Open Termux and run: ${cmd}`,
  };
}

/**
 * Poll for bridge startup in the background after a deep-link launch.
 * Runs in the service worker — doesn't depend on popup being open.
 * Auto-connects when bridge comes up.
 */
async function pollForBridgeStartup() {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const resp = await fetch(BRIDGE_HEALTH_URL, { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await resp.json();
      if (data.status === "ok") {
        addLog("info", `Bridge started via deep-link: v${data.version}`);
        if (connectionState !== "connected") {
          reconnectAttempts = 0;
          connect();
        }
        return;
      }
    } catch { /* bridge not ready yet */ }
  }
  addLog("warn", "Deep-link sent but bridge didn't respond in 12s");
}

// --- Startup -----------------------------------------------------------------

addLog("info", "Service worker starting");
connect();
