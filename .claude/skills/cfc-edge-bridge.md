# Claude in Chrome (CFC) — Edge Android Bridge

Browser automation on Android Edge Canary via the CFC MCP tools (`mcp__cfc-bridge__*`). Covers the WebSocket bridge, MV2 extension, sideloading, MCP relay, and platform limitations.

## Architecture

```
Claude Code CLI
    ↕ stdio (MCP protocol)
cli.js --mcp  (bridge/dist/cli.js)
    ↕ HTTP POST /tool
claude-chrome-bridge.ts  (WebSocket server on ws://127.0.0.1:18963)
    ↕ WebSocket (JSON)
Edge Android extension  (MV2 background page, background.js)
    ↕ chrome.runtime.connect persistent port
Content script  (content.js, isolated world)
    ↕ DOM access
Web page
```

**Two MCP paths coexist:**
- `mcp__cfc-bridge__*` — our relay: Claude Code → `cli.js --mcp` (stdio) → HTTP POST → bridge → extension. Registered via `claude mcp add`.
- `mcp__claude-in-chrome__*` — built-in CC dynamic MCP: Claude Code → Unix socket → native host → bridge → extension. Auto-registered by Claude Code.

Both work. Our `--mcp` relay is more reliable (no native host crash bugs).

## Key Files

| File | Purpose |
|------|---------|
| `claude-chrome-bridge.ts` | WebSocket bridge server (~2000 lines), spawns native host |
| `bridge/src/cli.ts` | npm package entry — `--mcp` relay, `--setup`, `--stop`, `--version` |
| `bridge/dist/cli.js` | CJS bundle (~240KB), the actual binary Claude Code spawns |
| `edge-claude-ext/manifest.json` | MV2 manifest (version is single source of truth) |
| `edge-claude-ext/background.js` | Background page: WS client, tool dispatch, FIFO queue |
| `edge-claude-ext/content.js` | Content script: DOM reads, click, form input, accessibility tree |
| `edge-claude-ext/popup.html` | Diagnostics popup UI |
| `scripts/build-crx.js` | CRX3 build (Node, uses `crx3` package) |
| `edge-fix/scripts/push-extension.sh` | Push unpacked extension to device via ADB |

## Setup

### 1. Register MCP server (one-time)

```bash
claude mcp add --transport stdio --scope user cfc-bridge -- \
    node ~/git/termux-tools/bridge/dist/cli.js --mcp
```

This goes into `~/.claude.json`. NOT `settings.json` — that path is not read for MCP spawning.

### 2. Start the bridge

The bridge is typically started by operad as a managed session. Manual start:

```bash
nohup bun ~/git/termux-tools/claude-chrome-bridge.ts > $PREFIX/tmp/bridge.log 2>&1 &
```

Verify:
```bash
curl -s http://127.0.0.1:18963/health | python3 -m json.tool
# Expected: {"status":"ok","version":"1.10.0","clients":1,...}
```

### 3. Push extension to device

The extension is sideloaded via `--load-extension` Chrome flag, NOT via CRX install (CRX install on Android Edge is unreliable — downloads as file, doesn't trigger install).

```bash
bash ~/git/termux-tools/edge-fix/scripts/push-extension.sh
```

This pushes unpacked extension files to `/data/local/tmp/cfc-ext/`. Edge reads them via the `--load-extension=/data/local/tmp/cfc-ext` flag in `command-line-flags.list`.

After pushing, force-stop and relaunch Edge:
```bash
adb shell am force-stop com.microsoft.emmx.canary
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
    -a android.intent.action.VIEW -d "https://example.com"
```

### 4. Verify connection

```bash
curl -s http://127.0.0.1:18963/health
# clients: 1 means extension is connected
```

## Extension Details

### MV2 (not MV3)

Edge Android MV3 is broken for sideloaded extensions — service workers never start in CDP targets. MV2 background pages work fine (uBlock, Dark Reader are both MV2).

Key MV2 differences from MV3:
- `manifest_version: 2`, `scripts` not `service_worker`
- `browser_action` not `action`
- `host_permissions` merged into `permissions`
- Explicit `"storage"` permission required (MV3 inferred it)
- `chrome.tabs.executeScript(tabId, {file:...}, callback)` not `chrome.scripting.executeScript()`

### Background page connect() race

On Edge Android, `connect()` called synchronously at script load silently fails (WebSocket never created, no error). Fix: `setTimeout(connect, 1000)` + `onStartup`/`onInstalled` listeners as backup.

### FIFO tool queue

Bridge `/tool` endpoint queues concurrent requests from multiple MCP instances (7+ CC sessions). Extension processes one tool at a time, queue drains in order. This prevents race conditions from parallel tool calls.

## Available Tools

| Tool | Status | Method |
|------|--------|--------|
| `navigate` | Full | `chrome.tabs.update` + load wait |
| `read_page` | Full | Accessibility tree via content script DOM traversal |
| `get_page_text` | Full | Full page text extraction |
| `find` | Full | Text/role/attribute search with relevance scoring |
| `form_input` | Full | Native setter + input/change events (React/Vue compatible) |
| `computer` (click) | Full | `dispatchEvent` MouseEvent at coordinates |
| `computer` (type) | Full | KeyboardEvent + value append |
| `computer` (scroll) | Full | `window.scrollBy` / `element.scrollIntoView` |
| `javascript_tool` | Full | `<script>`-tag MAIN-world injection + `postMessage` bridge; DOM-property fallback when page CSP blocks inline script |
| `tabs_context_mcp` | Full | `chrome.tabs.query` |
| `tabs_create_mcp` | Full | `chrome.tabs.create` |
| `read_console_messages` | Full | Intercepted console log buffer |
| `read_network_requests` | Full | Intercepted network request log |
| `computer` (screenshot) | Partial | `captureVisibleTab` may fail on mobile |
| `shortcuts_list` | Full | List available keyboard shortcuts |
| `shortcuts_execute` | Full | Execute keyboard shortcut |
| `gif_creator` | Full | Create animated GIF from screenshots |
| `upload_image` | Full | Upload image to page file input |
| `resize_window` | Full | Resize browser viewport |
| `switch_browser` | Full | Switch between browser tabs |
| `update_plan` | Full | Update plan state |

### javascript_tool execution (Android Edge)

`chrome.scripting.executeScript({world:"MAIN"})` hangs indefinitely on Android Edge.
Extension v1.11.0+ instead:

1. Appends a `<script>` element with inline `textContent` to the page — this runs
   synchronously in the page's MAIN world and can access page-scoped variables,
   call page functions, and mutate the DOM.
2. The injected IIFE posts its return value back via `window.postMessage`
   (type `cfc-main-result`, content-script listener filters on `event.source === window`
   and a per-call UUID). Promise return values are awaited before posting.
3. A 5s timeout converts silent CSP blocks into a descriptive error.

When the page's CSP disallows inline scripts (strict `script-src`), MAIN-world
injection fails and the content script falls back to a restricted DOM-property
evaluator that handles these patterns without eval:

- Global properties: `document.title`, `document.URL`, `location.href`
- Element reads: `document.getElementById('x').textContent`
- Collection length: `document.querySelectorAll('sel').length`
- Body content: `document.body.innerText`
- Window properties: `window.innerWidth`, `window.scrollY`
- Arithmetic: `1+1`, `(10 - 3) * 2`
- Literals: `true`, `false`, `null`, `"hello"`

Results must be structured-clone-compatible (no functions, DOM nodes, or cyclic
refs cross the `postMessage` boundary).

## CRX Build

```bash
cd ~/git/termux-tools
bun install        # first time only
bun run build:crx  # outputs dist/claude-code-bridge-vX.Y.Z.crx
```

The CRX is primarily for distribution. On-device, use `push-extension.sh` for sideloading.

### Version management

- `edge-claude-ext/manifest.json` `version` field is the **single source of truth**
- Bridge reads version from manifest at startup
- Bump version before building a new CRX
- CRX filename includes version: `claude-code-bridge-vX.Y.Z.crx`

## npm Package

The `bridge/` directory publishes as `claude-chrome-android` on npm.

```bash
cd ~/git/termux-tools/bridge
bun run build      # esbuild → dist/cli.js (~240KB CJS) + dist/crx (~39KB)
```

CLI modes:
- `node dist/cli.js` — start bridge (default)
- `node dist/cli.js --mcp` — MCP relay over stdio (spawned by Claude Code)
- `node dist/cli.js --setup` — register MCP server + install CRX
- `node dist/cli.js --stop` — stop bridge
- `node dist/cli.js --version` — print version

## Diagnostics

### Bridge health

```bash
curl -s http://127.0.0.1:18963/health
```

Returns: status, version, nativeHost (bool), clients count, uptime, lastTool.

### Bridge logs

```bash
tail -f $PREFIX/tmp/bridge.log
```

### Extension popup

Open the extension popup (if accessible) for:
- **Dashboard:** connection state, stats, uptime
- **Tests:** self-test suite (WS, health, tabs, navigate, js_exec, read_page)
- **Logs:** ring buffer of last 200 bridge messages
- **Tabs:** MCP tab group info

### Dashboard CFC card

The operad dashboard (port 18970) shows a CFC card with:
- Live uptime counter (1s tick)
- CDP badge (on/off)
- lastTool name when bridge exposes it

## Troubleshooting

### Extension not connecting (clients: 0)

```bash
# 1. Verify bridge is running
curl -s http://127.0.0.1:18963/health

# 2. Re-push extension files
bash ~/git/termux-tools/edge-fix/scripts/push-extension.sh

# 3. Force-stop and relaunch Edge (picks up --load-extension flag)
adb shell am force-stop com.microsoft.emmx.canary
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
    -a android.intent.action.VIEW -d "https://example.com"
```

### Tools timing out

Navigate to a new page to reset the content script port. The FIFO queue may be stuck — check bridge logs for errors.

### "Content port disconnected" errors

Content script lost connection to background page. Navigating or refreshing re-establishes automatically.

### Bridge crashes on startup

Check for port conflict:
```bash
curl -s http://127.0.0.1:18963/health  # another instance running?
pkill -f claude-chrome-bridge           # kill stale process
```

### MCP tools not appearing in Claude Code

Verify MCP registration:
```bash
cat ~/.claude.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('mcpServers',{}), indent=2))"
```

Should show `cfc-bridge` entry. If missing:
```bash
claude mcp add --transport stdio --scope user cfc-bridge -- \
    node ~/git/termux-tools/bridge/dist/cli.js --mcp
```

### Native host errors in built-in CFC

The built-in `claude-in-chrome` MCP has known crash bugs (`[...MB,"inherit"]` null spread, hardcoded `/tmp/`). Our `--mcp` relay avoids these entirely. If `mcp__claude-in-chrome__*` tools fail, use `mcp__cfc-bridge__*` instead.

## Key Gotchas

- **MCP config location**: `settings.json` `mcpServers` is NOT read for spawning. Must be in `~/.claude.json` (via `claude mcp add`) or `.mcp.json` (project scope).
- **Native host manifest**: `~/.config/chromium/NativeMessagingHosts/com.anthropic.claude_code.json` — auto-created by CC, points to `cli.js --chrome-native-host`.
- **Edge popup → tab**: `chrome.tabs.create()` dies when popup closes. Use `chrome.tabs.update()` on active tab instead.
- **Persistent port messaging**: `chrome.tabs.sendMessage` corrupts after 2-3 calls on Android Edge. Extension uses `chrome.runtime.connect` persistent ports with exponential backoff reconnection.
- **Edge IntentDispatcher**: Use `com.google.android.apps.chrome.IntentDispatcher` (not `com.microsoft.ruby.Main`) for VIEW intents.
- **Playwright MCP on Termux**: `process.platform === "android"` under Node.js causes Playwright to reject the platform. Use `bun` to run the MCP server — bun reports `process.platform === "linux"`.
- **Delegate browser tools to subagents**: `browser_evaluate` and `browser_snapshot` return full page snapshots (~50-70KB). Always delegate to subagents with focused prompts to avoid wasting main context tokens.
