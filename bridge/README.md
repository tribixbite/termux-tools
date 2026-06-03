# claude-chrome-android

Browser bridge for Claude Code on Android — connects the Claude Code CLI in Termux to Chrome/Edge via WebSocket + MCP.

## Quick Start

```bash
# In Termux — one-time setup:
npx claude-chrome-android --setup

# Start the bridge (must be running BEFORE opening Claude Code):
npx claude-chrome-android

# Then open a Claude Code session — browser tools are available as mcp__cfc-bridge__*
```

## Requirements

- Android device with [Termux](https://termux.dev)
- Chrome or Edge browser with the Claude Code Bridge extension
- Node.js 18+ or Bun

## Usage

```bash
claude-chrome-android              # start the bridge server
claude-chrome-android --mcp        # MCP server mode (spawned by Claude Code)
claude-chrome-android --stop       # stop a running bridge
claude-chrome-android --setup      # full setup: MCP + url-opener + Edge/extension
claude-chrome-android --setup-edge # browser-side only: install Edge, patch, sideload extension
claude-chrome-android --version    # show version
claude-chrome-android --help       # show help
```

## How It Works

1. The bridge runs a WebSocket server on `ws://127.0.0.1:18963`
2. The browser extension connects and relays page content to Claude Code
3. Claude Code spawns `--mcp` as a thin MCP relay per session (~5MB)
4. Multiple Claude Code sessions share one bridge via a FIFO tool queue

```
Claude Code session 1 ─→ cli.js --mcp ─┐
Claude Code session 2 ─→ cli.js --mcp ─┤─→ HTTP POST /tool ─→ bridge (WS) ─→ extension
Claude Code session N ─→ cli.js --mcp ─┘
```

## Setup Details

`--setup` performs three steps:

1. **Registers MCP server** in `~/.claude/settings.json` as `cfc-bridge` — Claude Code spawns `cli.js --mcp` per session
2. **Creates `~/bin/termux-url-opener`** — handles `cfcbridge://start` URLs to auto-start the bridge
3. **Installs CRX extension** — serves the bundled CRX over HTTP and opens Edge for installation (requires ADB)

## First-run setup

The bridge is only useful once a privacy-patched Edge with the CFC extension is
running. The **first time you run `claude-chrome-android` in a terminal**, if
the browser side isn't wired up it walks you through setup before starting the
bridge — so a bare `bunx claude-chrome-android` is enough to get going. You can
re-run just the browser-side setup any time with `--setup-edge`.

Setup checks each piece over ADB and offers to fix what's missing:

- **ADB device connected** — required for everything below
- **Edge installed** — detects Canary/Dev/Beta/stable; if absent it opens the
  Play Store listing for Edge Canary via deeplink so it's one tap to install
  (Play has no silent-install API), then waits and re-checks
- **Edge privacy-patched** — heuristic: the `AD_ID` tracking permission is stripped;
  if not, offers to build + install a patched Edge from your installed copy via
  `edge-fix/build-from-device.sh` (no data wipe on re-sign)
- **CFC extension sideloaded** — files in `/data/local/tmp/cfc-ext` + `--load-extension` flag set
- **Extension connected to bridge** — live WebSocket client count from `/health`

It never silently installs base Edge (no Play/APKMirror API — you tap Install)
and never touches the signing keystore. Non-interactive launches (e.g. spawned
by `termux-url-opener`) skip the prompts and just print a one-line hint.

## Important

The bridge **must be running before** starting a Claude Code session. MCP tools are registered at session startup — if the bridge is down, the tools won't appear.

## Extension

The bridge serves the CRX at `http://127.0.0.1:18963/ext/crx` — open this URL in Edge to install or update the extension.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `18963` | WebSocket/HTTP server port |
| `BRIDGE_URL` | `http://127.0.0.1:18963` | Bridge URL for MCP relay |
| `BRIDGE_TOKEN` | *(empty)* | Optional shared secret for auth |
| `BRIDGE_LOG_LEVEL` | `info` | debug, info, warn, error |
| `CDP_PORT` | `9223` | ADB forward port for Chrome DevTools Protocol |

## Changelog

### 1.5.0

- First-run setup: `claude-chrome-android` in a terminal now walks through Edge/extension setup before starting the bridge when the browser side isn't wired up
- Add `--setup-edge` (alias `--doctor`): probes ADB, Edge install, privacy-patch status (AD_ID stripped), extension sideload, and live bridge connection, and offers to fix each
- Install Edge Canary via Play Store deeplink when missing; offer the `build-from-device.sh` privacy-patch build (no data wipe on re-sign)
- Stop publishing the CRX signing key (`dist/edge-claude-ext.pem`) and stale versioned CRX builds to npm via `files` allowlist negation

### 1.2.2

- Fix CDP pending commands hanging on WebSocket close (reject immediately)
- Fix unhandled rejection in native host stdout/stderr readers
- Add `typeof data.id === "number"` guard for CDP message handler
- Add `MAX_PENDING_PORT_REQUESTS` (100) size cap in extension
- Add 60s max recording duration for GIF creator
- Add WeakMap reverse index for O(1) element ref lookup in content script
- Bump extension to v1.9.1

### 1.2.1

- Fix watchdog socket deletion cascade
- Tighten path traversal check, fix FD leak
- Validate JS runtime before launching in url-opener

### 1.1.0

- Initial npm release with MCP server, FIFO queue, multi-session support

## License

MIT
