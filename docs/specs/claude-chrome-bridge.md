# Claude Chrome Bridge — Architecture Spec

> Last Updated: 2026-04-16

Enables Claude Code's "Claude in Chrome" (CFC) browser automation on Android via Edge Canary,
replacing the desktop-only Native Messaging API with a local WebSocket bridge and MV2 extension.

---

## Problem

CFC on desktop uses Chrome's Native Messaging Host API:

```
Chrome Extension ←Native Messaging (stdio)→ cli.js --chrome-native-host
                                                 ↕ Unix socket
                                           cli.js --claude-in-chrome-mcp
                                                 ↕ MCP protocol
                                            Claude Code CLI
```

Mobile browsers do not support native messaging hosts. No extension can communicate with a
local process via stdin/stdout on Android. Additionally, the bundled `cli.js` in
`@anthropic-ai/claude-code` has Termux-incompatible bugs that crash the built-in MCP path.

---

## Solution

Insert a WebSocket bridge between the extension and the native host, and provide an independent
MCP relay that bypasses the native host entirely:

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

- `mcp__cfc-bridge__*` — our relay: Claude Code → `cli.js --mcp` (stdio) → HTTP POST `/tool` →
  bridge → extension. Registered via `claude mcp add`. This is the preferred path.
- `mcp__claude-in-chrome__*` — built-in CC dynamic MCP: Claude Code → Unix socket → native
  host → bridge → extension. Auto-registered by Claude Code v2.1.56+.

Both paths work simultaneously. The `--mcp` relay is more reliable because it avoids the native
host crash bugs described in the cli.js Patches section below.

---

## Components

### 1. WebSocket Bridge Server (`claude-chrome-bridge.ts`)

The core of the system. A ~2000-line Bun server that:

- **Runtime**: Bun (native WS + subprocess support, `compat.ts` abstracts Bun/Node APIs)
- **WebSocket**: `ws://127.0.0.1:18963` (localhost-only; optional `BRIDGE_TOKEN` auth)
- **HTTP**: REST endpoints for health, tool dispatch, and diagnostics
- **Protocol**: Bidirectional JSON relay between extension and native host
- **Native host child**: Spawns `node cli.js --chrome-native-host` on first WS connection
- **Native messaging format**: 4-byte little-endian length prefix + UTF-8 JSON body (Chrome spec)
- **Max message size**: 1,048,576 bytes (1 MiB, Chrome native messaging limit)
- **Lifecycle**: Lazy-spawns native host on first WS connection; auto-restarts on crash;
  stops the native host after 30s with no connected clients
- **Tool endpoint**: `POST /tool` accepts `{method, params}`, enqueues in the per-tab FIFO
  queue, waits for extension response, returns result as JSON
- **Health endpoint**: `GET /health` returns `{status, version, nativeHost, clients, uptime, lastTool}`
- **Auth**: Optional `BRIDGE_TOKEN` env var checked via query param `?token=` or
  `x-bridge-token` request header

### 2. Edge Extension (`edge-claude-ext/`)

A Manifest V2 extension (see MV2 section) with four components:

| File | Purpose |
|------|---------|
| `manifest.json` | MV2 manifest; `version` field is single source of truth for extension version |
| `background.js` | Background page: WS client, tool request dispatch, per-tab FIFO queue |
| `content.js` | Content script (isolated world): DOM reading, element interaction, accessibility tree |
| `popup.html` / `popup.js` | Diagnostics popup: connection status, self-test suite, log viewer, tab info |

Current extension version: **1.10.0**

### 3. MCP Relay (`bridge/src/cli.ts` → `bridge/dist/cli.js`)

The npm package entry point. A thin relay that:

- Reads MCP JSON-RPC from stdio (Claude Code spawns it)
- POSTs tool calls to the bridge's `/tool` HTTP endpoint
- Returns results back over stdio

This relay is the `cfc-bridge` MCP server registered in `~/.claude.json`.

CLI modes:

| Flag | Behavior |
|------|----------|
| _(none)_ | Start bridge (default) |
| `--mcp` | MCP relay over stdio (spawned by Claude Code) |
| `--setup` | Register MCP server + install CRX |
| `--stop` | Stop bridge |
| `--version` | Print version |

### 4. npm Package (`bridge/`)

Published as `claude-chrome-android` v1.4.0. CJS bundle:

- `bridge/dist/cli.js` — ~240KB CJS bundle (the actual binary Claude Code spawns)
- `bridge/dist/*.crx` — ~39KB bundled CRX for distribution

Build:
```bash
cd ~/git/termux-tools/bridge
bun run build      # esbuild → dist/cli.js + dist/crx
```

---

## Extension Details

### MV2 Architecture (not MV3)

Edge Android MV3 is broken for sideloaded extensions — service workers never start in CDP
targets. MV2 background pages work correctly. Both uBlock Origin and Dark Reader ship as MV2
on Android Edge for the same reason.

Key MV2 differences from MV3 that affect this extension:

| Aspect | MV3 | MV2 (used here) |
|--------|-----|-----------------|
| Manifest | `manifest_version: 3` | `manifest_version: 2` |
| Background | `service_worker` key | `scripts` key under `background` |
| Browser action | `action` | `browser_action` |
| Host permissions | separate `host_permissions` key | merged into `permissions` array |
| Storage permission | inferred | must be listed explicitly as `"storage"` |
| Script injection API | `chrome.scripting.executeScript()` | `chrome.tabs.executeScript(tabId, {file}, cb)` |

### Background Page Connection Race

On Edge Android, calling `connect()` synchronously at background page script load silently
fails — the WebSocket is never created and no error is logged. This is an Edge Android timing
bug with background page initialization.

Fix applied: `setTimeout(connect, 1000)` delays the initial connect by 1 second. Additionally,
`chrome.runtime.onStartup` and `chrome.runtime.onInstalled` listeners serve as backup triggers
to ensure connection is established even if the timeout fires too early.

### Per-Tab FIFO Tool Queue

The bridge `/tool` endpoint receives concurrent requests from multiple MCP instances (7+ Claude
Code sessions can be active simultaneously). The queue is **per-tab** — implemented as
`tabQueues = new Map()` keyed by tab ID.

This means:
- Multiple tools can execute in parallel on different tabs
- Tools targeting the same tab are serialized (FIFO order)
- Per-tab queueing prevents DOM race conditions without blocking unrelated tabs

### Persistent Port Messaging

`chrome.tabs.sendMessage` becomes unreliable after 2-3 calls on Android Edge (messages silently
dropped). The extension uses `chrome.runtime.connect()` to establish persistent ports between
the background page and content scripts. Ports reconnect automatically with exponential backoff
when disconnected (e.g., after page navigation).

---

## javascript_tool: MAIN-World Execution (Script-Tag Bridge)

In MV2, `chrome.tabs.executeScript()` runs exclusively in the **ISOLATED** world — there is no
`world` parameter (that is a MV3 `chrome.scripting` API feature). Calling
`chrome.scripting.executeScript({world: "MAIN"})` on Android Edge hangs indefinitely.

**Implemented as of extension v1.11.0**: The content script injects a `<script>` element with
inline `textContent` into the page, which executes synchronously in the page's MAIN world, and
uses `window.postMessage` to relay the return value back across world boundaries. A
5-second timeout converts silent CSP blocks into an error. If MAIN-world execution fails for
any reason (CSP, timeout, thrown exception), a DOM-property fallback evaluator handles common
read patterns so simple queries still work on strict-CSP pages.

### MAIN-world (primary path)

Supports arbitrary expressions, page-scoped variable reads, function calls, and DOM mutation,
subject only to the page's CSP. Both synchronous return values and Promise-returning IIFEs
are supported (the injected wrapper awaits thenables before posting).

### DOM-property fallback

Activated if MAIN world fails. Restricted to the expression set below — no eval, no function
calls, no mutation. CSP-safe because nothing inline-evaluates.

| Pattern | Example |
|---------|---------|
| Global properties | `document.title`, `document.URL`, `location.href` |
| Element reads | `document.getElementById('x').textContent` |
| Collection length | `document.querySelectorAll('sel').length` |
| Body content | `document.body.innerText` |
| Window properties | `window.innerWidth`, `window.scrollY` |
| Arithmetic | `1+1`, `(10 - 3) * 2` |
| Literals | `true`, `false`, `null`, `"hello"` |

### Implementation

```js
// Content script (ISOLATED world)
const MAIN_WORLD_TIMEOUT_MS = 5000;

function executeInMainWorld(code) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let settled = false;
    let timeoutHandle;

    function cleanup() {
      window.removeEventListener('message', handler);
      clearTimeout(timeoutHandle);
    }

    // Listen for result relayed back via postMessage
    function handler(event) {
      if (event.source !== window) return;
      if (event.data?.type !== 'cfc-result' || event.data?.id !== id) return;
      if (settled) return;
      settled = true;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    }
    window.addEventListener('message', handler);

    // Timeout guard — fires if CSP blocks the script tag or postMessage never arrives
    timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`executeInMainWorld timed out after ${MAIN_WORLD_TIMEOUT_MS}ms (CSP block?)`));
    }, MAIN_WORLD_TIMEOUT_MS);

    // Inject script tag — executes synchronously in MAIN world then self-removes
    const script = document.createElement('script');
    script.textContent = `
      try {
        const result = (function() { ${code} })();
        window.postMessage({ type: 'cfc-result', id: '${id}', result }, '*');
      } catch (e) {
        window.postMessage({ type: 'cfc-result', id: '${id}', error: e.message }, '*');
      }
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  });
}
```

**Limitations**:
- **CSP**: The page's Content Security Policy applies to injected `<script>` tags. Pages with
  strict CSP (`script-src 'self'` or nonce-based) will block inline injection — the timeout
  will fire after 5s with a descriptive error.
- **Async code**: The injected script runs synchronously. `await`/promises inside `code` are
  not supported — only expressions that return a value immediately.
- **Return value serialization**: The result is sent via `postMessage` so it must be
  structured-cloneable (no functions, DOM nodes, or circular refs).

---

## Available MCP Tools

18 MCP tool entries are registered under `mcp__cfc-bridge__*`. Note that `computer` is a
single tool with multiple action sub-types, not four separate tools.

| Tool | Status | Implementation |
|------|--------|----------------|
| `navigate` | Full | `chrome.tabs.update({url})` + load completion listener |
| `read_page` | Full | Accessibility tree via content script DOM traversal |
| `get_page_text` | Full | Full page text extraction via content script |
| `find` | Full | Text/role/aria-attribute search with relevance scoring |
| `form_input` | Full | Native value setter + `input`/`change` event dispatch (React/Vue compatible) |
| `computer` (click) | Full | `dispatchEvent(new MouseEvent(...))` at coordinates |
| `computer` (type) | Full | KeyboardEvent dispatch + value append |
| `computer` (scroll) | Full | `window.scrollBy()` / `element.scrollIntoView()` |
| `computer` (screenshot) | Partial | `captureVisibleTab` — may fail on Android Edge |
| `javascript_tool` | Full | `<script>`-tag injection + postMessage bridge, DOM-property fallback on CSP-strict pages |
| `tabs_context_mcp` | Full | `chrome.tabs.query()` with group tracking |
| `tabs_create_mcp` | Full | `chrome.tabs.create()` |
| `read_console_messages` | Full | Intercepted `console.*` method buffer in content script |
| `read_network_requests` | Full | Intercepted network request log in content script |
| `shortcuts_list` | Full | List available keyboard shortcuts |
| `shortcuts_execute` | Full | Execute keyboard shortcut |
| `gif_creator` | Full | Create animated GIF from screenshot sequence |
| `upload_image` | Full | Upload image to page file input element |
| `resize_window` | Full | Resize browser viewport |
| `switch_browser` | Full | Switch between open browser tabs |
| `update_plan` | Full | Update plan state |

---

## cli.js Patches

The `@anthropic-ai/claude-code` npm package bundles a minified `cli.js`. Version 2.1.56 (and
possibly other versions) contains two Termux-incompatible bugs that crash the built-in
`claude-in-chrome` MCP on startup.

These patches are applied by the `patch_claude_cli()` function in
`install/modules/claude-code.sh`.

### Patch 1 — MB Null Guard

**Bug**: `[...MB,"inherit"]` at the M06 array initializer. `MB` is the minified variable
holding agent type strings. On Termux it can be `null`, causing a `TypeError: null is not
iterable` on startup of the built-in claude-in-chrome MCP.

**Fix**: Replace with `[...(MB||[]),"inherit"]` — null-safe spread.

```bash
# Applied by:
sed -i 's/\[\.\.\.MB,"inherit"\]/[...(MB||[]),"inherit"]/g' "$cli"
```

### Patch 2 — Socket Path /tmp/ → os.tmpdir()

**Bug**: The socket path function (minified as `dg6()`) returns:
`` `/tmp/claude-mcp-browser-bridge-${bf8()}` ``

On Termux, `/tmp/` does not exist. The correct path is `$PREFIX/tmp` (e.g.
`/data/data/com.termux/files/usr/tmp`). The Unix socket creation silently fails or errors.

**Fix**: Replace the hardcoded `/tmp/` prefix with `${Za9()}/`, where `Za9` is the minified
alias for `os.tmpdir()` in the bundled `cli.js`. On Termux, `os.tmpdir()` returns `$PREFIX/tmp`.

```bash
# Applied by:
sed -i 's|`/tmp/claude-mcp-browser-bridge-|`${Za9()}/claude-mcp-browser-bridge-|g' "$cli"
```

### Patch Properties

| Property | Detail |
|----------|--------|
| **Idempotent** | Safe to re-run. The script checks whether patches are already applied before modifying the file. |
| **Backup** | Created at `cli.js.bak-prepatch` before first modification. |
| **Fragile** | Lost on every `bun i -g @anthropic-ai/claude-code` update. Re-run `patch_claude_cli` after every update. |
| **Scope** | Only affects the built-in `claude-in-chrome` MCP path. Our `cfc-bridge --mcp` relay is unaffected by these bugs. |
| **Version sensitivity** | Minified variable names (`MB`, `Za9`) may change across versions. The function warns if patterns are not found. |

### Re-applying After Update

```bash
# After any claude-code global update:
source ~/git/termux-tools/install/modules/claude-code.sh
patch_claude_cli
```

---

## Setup

### 1. Register MCP Server (One-Time)

```bash
claude mcp add --transport stdio --scope user cfc-bridge -- \
    node ~/git/termux-tools/bridge/dist/cli.js --mcp
```

This writes to `~/.claude.json`. Note: `settings.json` `mcpServers` is NOT read for MCP
spawning. Must be in `~/.claude.json` (via `claude mcp add`) or `.mcp.json` (project scope).

Verify registration:
```bash
cat ~/.claude.json | python3 -c "
import sys, json
servers = json.load(sys.stdin).get('mcpServers', {})
print(json.dumps(servers.get('cfc-bridge', 'NOT FOUND'), indent=2))
"
```

### 2. Start the Bridge

The bridge is typically managed by operad as a named session. Manual start:

```bash
nohup bun ~/git/termux-tools/claude-chrome-bridge.ts > $PREFIX/tmp/bridge.log 2>&1 &
```

Verify:
```bash
curl -s http://127.0.0.1:18963/health | python3 -m json.tool
# Expected: {"status":"ok","version":"1.10.0","clients":1,...}
```

### 3. Push Extension to Device

The extension is sideloaded via `--load-extension` Chrome command-line flag. CRX install on
Android Edge is unreliable — the CRX downloads as a file rather than triggering the install
flow. The `--load-extension` approach is the correct and stable method.

```bash
bash ~/git/termux-tools/edge-fix/scripts/push-extension.sh
```

This pushes unpacked extension files to `/data/local/tmp/cfc-ext/` via ADB. Edge reads them
at startup via the `--load-extension=/data/local/tmp/cfc-ext` flag in `command-line-flags.list`.

After pushing, force-stop and relaunch Edge to load the new extension files:

```bash
adb shell am force-stop com.microsoft.emmx.canary
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
    -a android.intent.action.VIEW -d "https://example.com"
```

### 4. Verify Connection

```bash
curl -s http://127.0.0.1:18963/health
# "clients": 1 confirms the extension is connected
```

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_CODE_ENABLE_CFC` | `false` | Enable CFC in Claude CLI (must be `true`) |
| `BRIDGE_PORT` | `18963` | WebSocket server port |
| `BRIDGE_TOKEN` | _(empty)_ | Optional shared secret for WebSocket auth |
| `BRIDGE_LOG_LEVEL` | `info` | Bridge log verbosity: `debug`, `info`, `warn`, `error` |

---

## File Inventory

```
termux-tools/
├── claude-chrome-bridge.ts         # WebSocket ↔ Native Messaging bridge server (~2000 lines)
├── compat.ts                       # Bun/Node API abstraction layer
├── cli.js                          # Version-controlled patched cli.js snapshot
├── edge-claude-ext/
│   ├── manifest.json               # MV2 manifest; version field = single source of truth
│   ├── background.js               # Background page: WS client, tool dispatch, per-tab queue
│   ├── content.js                  # Content script: DOM reader, interaction, accessibility tree
│   ├── popup.html                  # Diagnostics popup UI
│   ├── popup.js                    # Popup logic: status, self-tests, log viewer
│   └── icon{16,48,128}.png
├── bridge/
│   ├── src/cli.ts                  # MCP relay + CLI entry point (TypeScript source)
│   ├── src/import-meta-shim.js     # ESM import.meta shim for CJS bundle
│   ├── dist/cli.js                 # CJS bundle (~240KB) — binary spawned by Claude Code
│   └── package.json                # claude-chrome-android v1.4.0
├── edge-fix/
│   └── scripts/
│       ├── push-extension.sh       # ADB push unpacked extension to /data/local/tmp/cfc-ext
│       ├── push-flags.sh           # ADB push command-line-flags.list to Edge data dir
│       └── patch-commandline.py    # Python helper: add/remove flags in command-line file
├── scripts/
│   └── build-crx.js                # CRX3 build script (uses crx3 npm package)
├── install/
│   └── modules/
│       └── claude-code.sh          # patch_claude_cli() + _ensure_cfc_env()
└── docs/specs/
    ├── README.md                   # Specs table of contents
    └── claude-chrome-bridge.md     # This file
```

---

## CRX Build

The CRX is primarily for distribution. On-device, use `push-extension.sh` for sideloading.

```bash
cd ~/git/termux-tools
bun install        # first time only
bun run build:crx  # outputs dist/claude-code-bridge-vX.Y.Z.crx
```

### Version Management

- `edge-claude-ext/manifest.json` `version` field is the **single source of truth**
- The bridge reads the extension version from manifest at startup
- Bump this field before building a new CRX
- CRX filename includes version: `claude-code-bridge-vX.Y.Z.crx`

---

## Message Protocol

### Extension → Bridge → Native Host

| Type | Purpose |
|------|---------|
| `ping` | Keepalive |
| `get_status` | Query native host version |
| `tool_response` | Return tool execution result |
| `notification` | Forward extension events |

### Native Host → Bridge → Extension

| Type | Purpose |
|------|---------|
| `pong` | Keepalive response |
| `status_response` | Version info |
| `mcp_connected` | MCP client connected to Unix socket |
| `tool_request` | Execute a tool (method + params) |
| `error` | Error message |

### Bridge-Only Messages

| Type | Direction | Purpose |
|------|-----------|---------|
| `bridge_connected` | Bridge → Extension | Initial handshake |
| `heartbeat` | Bridge → Extension | 15s keepalive from bridge |

---

## Diagnostics

### Bridge Health

```bash
curl -s http://127.0.0.1:18963/health | python3 -m json.tool
```

Returns: `status`, `version`, `nativeHost` (bool), `clients` (count), `uptime` (seconds),
`lastTool` (name of most recently dispatched tool).

### Bridge Logs

```bash
tail -f $PREFIX/tmp/bridge.log
```

### Extension Popup

Open the extension popup via Edge's toolbar for:
- **Dashboard**: Connection state, client count, uptime counter, last tool
- **Tests**: Self-test suite (WS connect, health endpoint, tabs, navigate, js_exec, read_page)
- **Logs**: Ring buffer of last 200 bridge messages
- **Tabs**: MCP tab group info

### Operad Dashboard CFC Card

The operad dashboard (port 18970) includes a collapsible CFC card showing:
- Live uptime counter (1s tick)
- CDP badge (on/off)
- `lastTool` name when the bridge exposes it

---

## Troubleshooting

### Extension Not Connecting (`clients: 0`)

```bash
# 1. Verify bridge is running
curl -s http://127.0.0.1:18963/health

# 2. Re-push extension files
bash ~/git/termux-tools/edge-fix/scripts/push-extension.sh

# 3. Force-stop and relaunch Edge to reload --load-extension flag
adb shell am force-stop com.microsoft.emmx.canary
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
    -a android.intent.action.VIEW -d "https://example.com"
```

### Tools Timing Out

Navigate to a new page to reset the content script port. If the per-tab FIFO queue is stuck,
check bridge logs for errors. A stuck queue item can block all subsequent tools on that tab.

### "Content Port Disconnected" Errors

The content script lost its persistent port connection to the background page. This happens
automatically after page navigation or refresh. Navigating or refreshing the page
re-establishes the port connection automatically.

### Bridge Crashes or Won't Start

Check for a stale instance holding the port:
```bash
curl -s http://127.0.0.1:18963/health   # Is another instance running?
pkill -f claude-chrome-bridge            # Kill stale process
```

### MCP Tools Not Appearing in Claude Code

Verify MCP registration in `~/.claude.json`:
```bash
cat ~/.claude.json | python3 -c "
import sys, json
d = json.load(sys.stdin)
servers = d.get('mcpServers', {})
print(json.dumps(servers, indent=2))
"
```

Should show a `cfc-bridge` entry. If missing, re-register:
```bash
claude mcp add --transport stdio --scope user cfc-bridge -- \
    node ~/git/termux-tools/bridge/dist/cli.js --mcp
```

### Built-in `mcp__claude-in-chrome__*` Tools Crashing

The built-in `claude-in-chrome` MCP path has two known crash bugs in cli.js (MB null spread,
hardcoded `/tmp/` socket). Apply the Termux patches:

```bash
source ~/git/termux-tools/install/modules/claude-code.sh
patch_claude_cli
```

Or switch to `mcp__cfc-bridge__*` tools, which use our `--mcp` relay and are unaffected.

### Tab Accumulation in Edge

Each `am start` VIEW intent opens a new tab. After many reconnect cycles, Edge can accumulate
stale tabs with exhausted SSE connections. Force-stop Edge to clear all tabs:

```bash
adb shell am force-stop com.microsoft.emmx.canary
```

---

## Known Limitations

| Limitation | Detail |
|-----------|--------|
| No screenshot on Android | `captureVisibleTab` is unavailable in Android Edge. Falls back to text description of visible content. |
| javascript_tool on strict-CSP pages | Script-tag injection is blocked by pages with CSP `script-src` that disallows `'unsafe-inline'`. MAIN-world call times out after 5s and falls back to the restricted DOM-property evaluator. |
| Content script injection blocked | `chrome://`, `edge://`, and extension pages block content script injection entirely. |
| Background page lifecycle | Edge may suspend the background page after extended idle. WebSocket reconnects automatically on wake via retry logic. |
| Form input reactivity | The native setter trick works for React and Vue controlled inputs but may miss some framework-specific bindings. |

---

## Key Gotchas

- **MCP config location**: `settings.json` `mcpServers` is NOT read for MCP spawning. Must be
  in `~/.claude.json` (via `claude mcp add`) or `.mcp.json` (project scope).
- **Native host manifest**: `~/.config/chromium/NativeMessagingHosts/com.anthropic.claude_code.json`
  is auto-created by Claude Code and points to `cli.js --chrome-native-host`. The bridge
  spawns the native host as a child process.
- **Edge popup → tab**: `chrome.tabs.create()` is unreliable when called from the popup because
  the popup closes and kills the script context. Use `chrome.tabs.update()` on the active tab.
- **Edge IntentDispatcher**: Use `com.google.android.apps.chrome.IntentDispatcher` class (not
  `com.microsoft.ruby.Main`) for `VIEW` intents with URLs in Edge Android.
- **cli.js patches are fragile**: Every `bun i -g @anthropic-ai/claude-code` update overwrites
  the patched `cli.js`. Re-run `patch_claude_cli` after every global update.
- **Minified variable names**: `MB` and `Za9` are minified identifiers in the bundled cli.js
  that may change across package versions. The patch script warns if patterns are not found.
- **Bun spawn PATH**: Bun's `spawnSync` cannot find `adb` via PATH symlink chains on Termux.
  Use `resolveAdbPath()` which tries `which` then falls back to `$PREFIX/bin/`.
- **Playwright on Termux**: `process.platform === "android"` under Node.js causes Playwright
  to reject the platform. Run the MCP server with `bun` — bun reports
  `process.platform === "linux"`.
- **Delegate browser snapshot tools to subagents**: `browser_evaluate` and `browser_snapshot`
  return full page snapshots (~50-70KB). Always delegate to subagents with focused prompts
  to avoid exhausting main context tokens.
