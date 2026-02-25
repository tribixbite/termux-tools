# claude-chrome-android

Browser bridge for Claude Code on Android — connects the Claude Code CLI in Termux to Chrome/Edge via WebSocket.

## Quick Start

```bash
# In Termux:
npx claude-chrome-android --setup   # one-time setup
npx claude-chrome-android            # start bridge
```

## Requirements

- Android device with [Termux](https://termux.dev)
- Chrome or Edge browser with the Claude Code Bridge extension (CRX)
- Node.js 18+ or Bun

## Usage

```bash
claude-chrome-android              # start the bridge server
claude-chrome-android --stop       # stop a running bridge
claude-chrome-android --setup      # configure Termux URL opener + dependencies
claude-chrome-android --version    # show version
```

## How It Works

1. The bridge runs a WebSocket server on `ws://127.0.0.1:18963`
2. The browser extension connects and relays page content to Claude Code
3. Claude Code MCP tools interact with the browser through the bridge

## Extension Install

The bridge serves the CRX at `http://127.0.0.1:18963/ext/crx` — open this URL in Edge to install or update the extension.

## License

MIT
