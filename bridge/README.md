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
claude-chrome-android --setup      # register MCP + install CRX extension
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

## Important

The bridge **must be running before** starting a Claude Code session. MCP tools are registered at session startup — if the bridge is down, the tools won't appear.

## Extension

The bridge serves the CRX at `http://127.0.0.1:18963/ext/crx` — open this URL in Edge to install or update the extension.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `18963` | WebSocket/HTTP server port |
| `BRIDGE_URL` | `http://127.0.0.1:18963` | Bridge URL for MCP relay |

## License

MIT
