/**
 * Claude Code Browser Bridge — Service Worker (background.js)
 *
 * Maintains a WebSocket connection to the local bridge server
 * (ws://127.0.0.1:18963) and handles tool requests from Claude Code
 * by dispatching them to content scripts or using chrome.* APIs.
 */

// --- Configuration -----------------------------------------------------------

const WS_URL = "ws://127.0.0.1:18963/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 20000;

// --- State -------------------------------------------------------------------

/** @type {WebSocket|null} */
let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let keepaliveTimer = null;
let connectionState = "disconnected"; // disconnected | connecting | connected

// MCP tab group tracking
let mcpTabGroup = new Map(); // tabId -> tab info
let nextRefId = 1;

// --- WebSocket Connection ----------------------------------------------------

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  connectionState = "connecting";
  broadcastState();

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    console.error("[bridge] WebSocket creation failed:", err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("[bridge] Connected to bridge server");
    connectionState = "connected";
    reconnectAttempts = 0;
    broadcastState();

    // Send initial ping
    sendMessage({ type: "ping" });

    // Start keepalive
    clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        sendMessage({ type: "ping" });
      }
    }, KEEPALIVE_INTERVAL_MS);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleBridgeMessage(msg);
    } catch (err) {
      console.error("[bridge] Failed to parse message:", err);
    }
  };

  ws.onclose = (event) => {
    console.log("[bridge] Disconnected:", event.code, event.reason);
    connectionState = "disconnected";
    ws = null;
    clearInterval(keepaliveTimer);
    broadcastState();
    scheduleReconnect();
  };

  ws.onerror = (event) => {
    console.error("[bridge] WebSocket error:", event);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS
  );
  reconnectAttempts++;
  console.log(`[bridge] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function sendMessage(msg) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

// --- Message Handling --------------------------------------------------------

async function handleBridgeMessage(msg) {
  switch (msg.type) {
    case "pong":
    case "heartbeat":
    case "bridge_connected":
    case "status_response":
      // Informational, no action needed
      break;

    case "mcp_connected":
      console.log("[bridge] MCP server connected to native host");
      break;

    case "tool_request":
      await handleToolRequest(msg);
      break;

    case "error":
      console.error("[bridge] Error from bridge:", msg.error);
      break;

    default:
      console.log("[bridge] Unknown message type:", msg.type);
  }
}

// --- Tool Request Dispatch ---------------------------------------------------

async function handleToolRequest(msg) {
  const { method, params } = msg;
  console.log("[bridge] Tool request:", method, params);

  // MCP server wraps tool calls as {method: "execute_tool", params: {tool, args}}
  // Unwrap and re-dispatch with the actual tool name
  if (method === "execute_tool" && params?.tool) {
    return handleToolRequest({
      type: msg.type,
      method: params.tool,
      params: params.args || {},
    });
  }

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

    // CRITICAL: Do NOT include `method` in response — cli.js response classifier
    // M7z() checks `"method" in A` first and misclassifies as notification,
    // causing handleResponse() to never fire and the tool call to timeout.
    sendMessage({
      type: "tool_response",
      result,
    });
  } catch (err) {
    console.error(`[bridge] Tool ${method} failed:`, err);
    sendMessage({
      type: "tool_response",
      error: err.message || String(err),
    });
  }
}

// --- Tool Implementations ----------------------------------------------------

/**
 * Execute JavaScript in page context via chrome.scripting.executeScript
 */
async function handleJavascriptTool(params) {
  const { text, tabId } = params;
  const tid = resolveTabId(tabId);

  try {
    // chrome.scripting.executeScript can hang on Android Edge —
    // race with a 10s timeout, then fall through to content script
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tid },
        func: (code) => {
          try {
            const fn = new Function(`return (async () => { return (${code}); })();`);
            return fn();
          } catch (syncErr) {
            try {
              const fn2 = new Function(`return (async () => { ${code} })();`);
              return fn2();
            } catch (stmtErr) {
              return { __error: stmtErr.message };
            }
          }
        },
        args: [text],
        world: "MAIN",
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("chrome.scripting timeout")), 10000)
      ),
    ]);

    const result = results?.[0]?.result;
    if (result && typeof result === "object" && result.__error) {
      return { error: result.__error };
    }
    return { result: typeof result === "undefined" ? "undefined" : JSON.stringify(result) };
  } catch (err) {
    // Fallback: execute via content script message
    console.log("[bridge] chrome.scripting failed, falling back to content script:", err.message);
    return await executeViaContentScript(tid, "javascript_exec", { code: text });
  }
}

/**
 * Read page accessibility tree via content script
 */
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

/**
 * Find elements by natural language query via content script
 */
async function handleFind(params) {
  const { query, tabId } = params;
  const tid = resolveTabId(tabId);

  return await executeViaContentScript(tid, "find", { query });
}

/**
 * Navigate to URL or forward/back
 */
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

  // Add protocol if missing
  let fullUrl = url;
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = "https://" + fullUrl;
  }

  await chrome.tabs.update(tid, { url: fullUrl });

  // Wait for page load
  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tid && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout fallback
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });

  return { result: `Navigated to ${fullUrl}` };
}

/**
 * Set form input values via content script
 */
async function handleFormInput(params) {
  const { ref, value, tabId } = params;
  const tid = resolveTabId(tabId);

  return await executeViaContentScript(tid, "form_input", { ref, value });
}

/**
 * Computer tool — handle mouse/keyboard/screenshot actions
 */
async function handleComputer(params) {
  const { action, tabId, coordinate, text } = params;
  const tid = resolveTabId(tabId);

  switch (action) {
    case "screenshot":
      // captureVisibleTab may not be available on Android Edge
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: "png",
        });
        return {
          result: dataUrl,
          type: "image/png",
          encoding: "base64",
        };
      } catch (err) {
        // Fallback: use html2canvas via content script
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
      return await executeViaContentScript(tid, "scroll_to", {
        ref: params.ref_id,
      });

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

/**
 * Get tab group context
 */
async function handleTabsContext(params) {
  const { createIfEmpty } = params;

  const tabs = await chrome.tabs.query({});

  // If we have no tracked MCP tabs, initialize from current tabs
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

  // Create a new tab if requested and group is empty
  if (createIfEmpty && mcpTabGroup.size === 0) {
    const newTab = await chrome.tabs.create({ url: "about:blank" });
    mcpTabGroup.set(newTab.id, {
      id: newTab.id,
      url: "about:blank",
      title: "New Tab",
      active: true,
    });
  }

  // Refresh tab info
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
      // Tab no longer exists
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

/**
 * Create a new tab in the MCP group
 */
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

/**
 * Read console messages (limited — no persistent console access on mobile)
 */
async function handleReadConsole(params) {
  const { tabId } = params;
  const tid = resolveTabId(tabId);

  return await executeViaContentScript(tid, "read_console", {});
}

// --- Content Script Communication --------------------------------------------

/**
 * Send a command to the content script in the given tab and await response
 */
function executeViaContentScript(tabId, action, params) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Content script timeout for ${action}`));
    }, 30000);

    chrome.tabs.sendMessage(
      tabId,
      { action, params },
      (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          // Content script not injected yet — try injecting first
          injectAndRetry(tabId, action, params)
            .then(resolve)
            .catch(reject);
          return;
        }
        resolve(response);
      }
    );
  });
}

/**
 * Inject content script into a tab then retry the command
 */
async function injectAndRetry(tabId, action, params) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  // Brief delay for script initialization
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

/**
 * Resolve tab ID — if the given ID is in our MCP group, use it.
 * Otherwise fall back to the active tab.
 */
function resolveTabId(tabId) {
  if (tabId && mcpTabGroup.has(tabId)) return tabId;
  // Find active tab in group
  for (const [id, info] of mcpTabGroup) {
    if (info.active) return id;
  }
  // Return first tab if any
  const first = mcpTabGroup.keys().next();
  if (!first.done) return first.value;
  return tabId; // pass through and let chrome.* API handle the error
}

/**
 * Broadcast connection state to popup
 */
function broadcastState() {
  chrome.runtime.sendMessage({
    type: "state_update",
    state: connectionState,
    tabCount: mcpTabGroup.size,
  }).catch(() => {}); // popup may not be open
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
});

// --- Startup -----------------------------------------------------------------

console.log("[bridge] Service worker starting, connecting to", WS_URL);
connect();
