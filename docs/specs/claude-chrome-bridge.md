# Claude Chrome Bridge — Architecture Spec

> Enables Claude Code's "Claude in Chrome" (CFC) browser automation on Android
> via Edge or Termux X11 Chromium, replacing the desktop-only Native Messaging API
> with a local WebSocket bridge.

## Problem

CFC works on desktop via Chrome's Native Messaging Host API:

```
Chrome Extension ←Native Messaging (stdio)→ cli.js --chrome-native-host
                                                ↕ Unix socket
                                            cli.js --claude-in-chrome-mcp
                                                ↕ MCP protocol
                                              Claude Code CLI
```

Mobile browsers don't support native messaging hosts. No extension can
communicate with a local process via stdin/stdout on Android.

## Solution

Insert a WebSocket bridge between the extension and the native host:

```
Edge Extension ←WebSocket→ claude-chrome-bridge.ts ←stdio→ cli.js --chrome-native-host
                ws://127.0.0.1:18963                          ↕ Unix socket
                                                         cli.js --claude-in-chrome-mcp
                                                              ↕ MCP protocol
                                                            Claude Code CLI
```

## Components

### 1. WebSocket Bridge Server (`claude-chrome-bridge.ts`)

- **Runtime**: Bun (native WS + subprocess support)
- **Port**: `ws://127.0.0.1:18963` (localhost only)
- **Protocol**: Bidirectional JSON relay
- **Child process**: `bun cli.js --chrome-native-host`
- **Native messaging format**: 4-byte LE length prefix + UTF-8 JSON body
- **Max message size**: 1,048,576 bytes (1 MiB)
- **Lifecycle**: Lazy-spawns native host on first WS connection, auto-restarts on crash, stops after 30s with no clients
- **Health check**: `GET /health` returns JSON status
- **Auth**: Optional `BRIDGE_TOKEN` env var (query param or `x-bridge-token` header)

### 2. Edge Extension (`edge-claude-ext/`)

Manifest V3 extension with:

| File | Purpose |
|------|---------|
| `manifest.json` | Permissions: `activeTab`, `scripting`, `tabs`, `<all_urls>` |
| `background.js` | Service worker: WS client, tool request dispatch |
| `content.js` | Content script: DOM reading, element interaction |
| `popup.html/js` | Connection status UI (dark mode) |

### 3. Setup Script (`claude-edge-setup.sh`)

One-time: verifies deps, packages extension as ZIP, tests bridge, prints install instructions.

### 4. Launch Script (`claude-edge-bridge.sh`)

Daily use: starts bridge in background, launches Claude with `CLAUDE_CODE_ENABLE_CFC=true`, cleans up on exit.

## Message Protocol

### Extension → Bridge → Native Host

| Type | Purpose |
|------|---------|
| `ping` | Keepalive |
| `get_status` | Query native host version |
| `tool_response` | Return tool execution results |
| `notification` | Forward extension events |

### Native Host → Bridge → Extension

| Type | Purpose |
|------|---------|
| `pong` | Keepalive response |
| `status_response` | Version info |
| `mcp_connected` | MCP client connected to socket |
| `tool_request` | Execute a tool (method + params) |
| `error` | Error message |

### Bridge-only messages

| Type | Direction | Purpose |
|------|-----------|---------|
| `bridge_connected` | → Extension | Initial handshake |
| `heartbeat` | → Extension | 15s keepalive from bridge |

## Tool Implementations

| Tool | Priority | Implementation |
|------|----------|----------------|
| `javascript_tool` | P0 | `chrome.scripting.executeScript` (MAIN world), fallback to content script `new Function()` |
| `read_page` | P0 | Content script builds accessibility tree from DOM |
| `navigate` | P0 | `chrome.tabs.update({url})` + completion listener |
| `find` | P1 | Content script scores elements by text/role/aria-label match |
| `form_input` | P1 | Content script uses native setter + dispatches input/change events |
| `tabs_context_mcp` | P1 | `chrome.tabs.query()` with group tracking |
| `tabs_create_mcp` | P1 | `chrome.tabs.create()` |
| `computer` | P2 | Click/type/scroll via content script `dispatchEvent`. Screenshot limited (no `captureVisibleTab` on mobile) |
| `read_console_messages` | P2 | Content script intercepts `console.*` methods |

## Installation Options

### Option A: Edge Canary Android (CRX sideload)

1. Run `./claude-edge-setup.sh` — builds CRX3, copies to Downloads
2. Edge Canary → Settings → About → tap build number 5x (enables Developer Options)
3. Settings → Developer Options → "Extension install by CRX"
4. Browse to `Download/claude-code-bridge.crx` → install → grant permissions

Requires Edge Canary (`com.microsoft.emmx.canary`). Stable Edge does not
expose the CRX install UI.

### Option A2: Chrome Canary Android

1. `chrome://flags` → `#extension-mime-request-handling` → "Always prompt for install"
2. Open `claude-code-bridge.crx` from Downloads → install

Limitations: Some `chrome.*` APIs may be unavailable on mobile.

### Option B: Termux X11 + Chromium (full API support)

```bash
pkg install chromium
DISPLAY=:0 chromium --no-sandbox --load-extension=./edge-claude-ext
```

Full desktop Chrome extension API support. Requires X11 display server.

## File Inventory

```
termux-tools/
├── cli.js                      # Version-controlled cli.js (patched)
├── claude-chrome-bridge.ts     # WebSocket ↔ Native Messaging bridge
├── claude-edge-setup.sh        # One-time setup script
├── claude-edge-bridge.sh       # Daily launch script
├── edge-claude-ext/
│   ├── manifest.json
│   ├── background.js           # Service worker (WS client + tool dispatch)
│   ├── content.js              # DOM reader + interaction handler
│   ├── popup.html              # Status UI
│   ├── popup.js
│   └── icon{16,48,128}.png
└── docs/specs/
    ├── README.md               # Specs table of contents
    └── claude-chrome-bridge.md # This file
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_CODE_ENABLE_CFC` | `false` | Enable CFC in Claude CLI |
| `BRIDGE_PORT` | `18963` | WebSocket server port |
| `BRIDGE_TOKEN` | (empty) | Optional shared secret for WS auth |
| `BRIDGE_LOG_LEVEL` | `info` | Bridge log verbosity: debug, info, warn, error |
| `DISABLE_AUTOUPDATER` | `true` | Prevent cli.js patches from being overwritten |

## Known Limitations

- **No screenshot on Android**: `captureVisibleTab` unavailable in Edge Android. Falls back to text description.
- **Service worker lifecycle**: Edge may suspend the background service worker after idle. WS reconnects on wake.
- **Content script injection**: Some pages (chrome://, edge://) block content script injection.
- **Form input reactivity**: The native setter trick works for React/Vue but may miss some framework bindings.
