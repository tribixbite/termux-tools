# Claude in Chrome (CFC) — Edge Android Bridge

Use this skill for browser automation on Android Edge Canary via the Claude Code CFC tools (`mcp__claude-in-chrome__*`). Covers the WebSocket bridge, MV3 extension, CRX build pipeline, and known platform limitations.

## Architecture

```
Claude Code CLI
    ↕ Unix socket (MCP)
cli.js --chrome-native-host
    ↕ Native messaging (4-byte LE length + JSON via stdio)
claude-chrome-bridge.ts (Bun WebSocket server on ws://127.0.0.1:18963)
    ↕ WebSocket (JSON)
Edge Android extension (background.js service worker)
    ↕ chrome.runtime.connect persistent port
Content script (content.js, isolated world)
    ↕ DOM access
Web page
```

## Quick Start

### Start the bridge
```bash
# Start bridge server (backgrounded)
nohup bun ~/git/termux-tools/claude-chrome-bridge.ts > $PREFIX/tmp/bridge.log 2>&1 &

# Verify
curl -s http://127.0.0.1:18963/health | jq .
```

### Install/update the extension
```bash
# Build CRX (requires npm install first time)
cd ~/git/termux-tools && npm run build:crx

# Copy to Downloads for Edge installation
cp dist/claude-code-bridge-v*.crx ~/storage/downloads/

# In Edge Canary: edge://extensions → Developer mode → Load from file
# Select the CRX from Downloads
```

### Verify connection
```bash
# Health check shows clients count
curl -s http://127.0.0.1:18963/health
# Expected: {"status":"ok","version":"X.Y.Z","nativeHost":true,"clients":1,...}
```

## Key Files

| File | Purpose |
|------|---------|
| `claude-chrome-bridge.ts` | Bun WebSocket bridge server, spawns native host |
| `edge-claude-ext/manifest.json` | Extension manifest (version is single source of truth) |
| `edge-claude-ext/background.js` | Service worker: WS client, tool dispatch, port tracking |
| `edge-claude-ext/content.js` | Content script: DOM reads, click, form input, accessibility tree |
| `edge-claude-ext/popup.html` | Diagnostics dashboard UI |
| `edge-claude-ext/popup.js` | Dashboard: state, tests, logs, tabs panels |
| `scripts/build-crx.js` | CRX3 build script (Node, uses `crx3` package) |
| `.github/workflows/build-crx.yml` | CI: build + sign CRX, upload artifact, attach to releases |

## Available CFC Tools

| Tool | Status | Method |
|------|--------|--------|
| `javascript_tool` | Limited | DOM property reads + safe arithmetic (no eval/MAIN world) |
| `read_page` | Full | Accessibility tree via content script DOM traversal |
| `find` | Full | Text/role/attribute search with relevance scoring |
| `navigate` | Full | `chrome.tabs.update` + load wait |
| `form_input` | Full | Native setter + input/change events (React/Vue compatible) |
| `computer` (click) | Full | `dispatchEvent` MouseEvent at coordinates |
| `computer` (type) | Full | KeyboardEvent + value append |
| `computer` (scroll) | Full | `window.scrollBy` / `element.scrollIntoView` |
| `tabs_context_mcp` | Full | `chrome.tabs.query` |
| `tabs_create_mcp` | Full | `chrome.tabs.create` |
| `read_console_messages` | Full | Intercepted console log buffer |
| `computer` (screenshot) | Partial | `captureVisibleTab` may fail on mobile |

## Android Edge Limitations

### No MAIN-world JavaScript execution
`chrome.scripting.executeScript(world:"MAIN")` hangs indefinitely on Android Edge. `eval()`, `new Function()`, `<script>` injection, and blob URLs all fail due to MV3 CSP or platform restrictions. The extension uses a **DOM property evaluator** instead:

**Supported javascript_exec patterns:**
- Global properties: `document.title`, `document.URL`, `location.href`, etc.
- Element reads: `document.getElementById('x').textContent`, `document.querySelector('sel').value`
- Collection length: `document.querySelectorAll('sel').length`
- Body content: `document.body.innerText`
- Window properties: `window.innerWidth`, `window.scrollY`, etc.
- Arithmetic: `1+1`, `(10 - 3) * 2`, `100 / 4 % 7`
- Literals: `true`, `false`, `null`, `"hello"`

**Not supported:** arbitrary JS, page variables, function calls, DOM mutation via JS.
Use `read_page`, `find`, `form_input`, or `computer` tools instead.

### Persistent port messaging required
`chrome.tabs.sendMessage` corrupts after 2-3 calls on Android Edge. The extension uses `chrome.runtime.connect` persistent ports with exponential backoff reconnection. If tools start timing out, navigate to a new page to reset the content script port.

### No native messaging
Mobile browsers don't support `chrome.runtime.connectNative`. The bridge server translates between WebSocket (extension) and stdio native messaging (cli.js).

## CRX Build Pipeline

### Local build
```bash
cd ~/git/termux-tools
npm install        # first time only
npm run build:crx  # outputs to dist/claude-code-bridge-vX.Y.Z.crx
```

### CI build (GitHub Actions)
Triggers on pushes to `edge-claude-ext/**`, `scripts/build-crx.js`, `package.json`, `package-lock.json`, or the workflow file. Also triggers on `v*` tags.

**Required secret:** `CRX_SIGNING_KEY` — base64-encoded PEM:
```bash
base64 -w0 edge-claude-ext.pem | termux-clipboard-set
# Paste into GitHub → Settings → Secrets → Actions → CRX_SIGNING_KEY
```

On `v*` tags, the CRX is attached to a GitHub Release automatically.

### Version management
- `edge-claude-ext/manifest.json` `version` field is the **single source of truth**
- Bridge reads version from manifest at startup via `Bun.file().text()`
- Extension reads via `chrome.runtime.getManifest().version`
- Always bump version before building a new CRX
- CRX filename includes version: `claude-code-bridge-vX.Y.Z.crx`

## Diagnostics

### Extension popup
Open the extension popup for:
- **Dashboard:** connection state, stats, uptime, version info
- **Tests:** 9-test self-test suite (WS, health, tabs, navigate, js_exec, read_page, screenshot, roundtrip)
- **Logs:** ring buffer of last 200 bridge messages
- **Tabs:** MCP tab group info

### Bridge health endpoint
```bash
curl -s http://127.0.0.1:18963/health | jq .
```
Returns: status, version, nativeHost (bool), clients count, uptime.

### Bridge logs
```bash
tail -f $PREFIX/tmp/bridge.log
```

## Troubleshooting

### Extension not connecting
```bash
# Check bridge is running
curl -s http://127.0.0.1:18963/health

# Restart bridge
pkill -f claude-chrome-bridge
nohup bun ~/git/termux-tools/claude-chrome-bridge.ts > $PREFIX/tmp/bridge.log 2>&1 &
```

### Tools timing out
Navigate to a new page to reset the content script port. Parallel tool calls can overwhelm the port — prefer sequential calls for reliability.

### "Content port disconnected" errors
The content script lost connection to the service worker. Navigating or refreshing the page re-establishes the port automatically.

### CRX won't install in Edge
1. Enable `edge://flags/#extension-developer-mode`
2. Edge → Settings → Extensions → Developer mode ON
3. Drag CRX from Downloads or use "Load from file"

### js_exec returns "limited on Android Edge"
The expression doesn't match any supported pattern. Rewrite using DOM property reads or use `read_page`/`find` tools instead.
