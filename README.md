# Termux Tools

Tools, automation, and infrastructure for running Claude Code sessions on Android with Termux.

## Components

### TMX Orchestrator (`orchestrator/`)

TypeScript daemon that manages tmux session lifecycle — replaces the old bash boot scripts
with dependency-ordered startup, health monitoring, battery management, and a web dashboard.

```bash
tmx boot              # Start daemon + boot all sessions + create Termux tabs
tmx status            # Show daemon status, all sessions, battery, memory
tmx health            # Run health checks
tmx start <name>      # Start a stopped session (fuzzy-matches names)
tmx stop <name>       # Stop a running session
tmx go <name>         # Send Enter to a waiting Claude session
tmx open <path|name>  # Open a new Claude session dynamically (fuzzy match)
tmx close <name>      # Stop + remove a dynamic session from registry
tmx recent            # List recent Claude projects from history.jsonl
tmx tabs              # Recreate Termux tabs for tmux sessions
tmx memory            # Show system + per-session memory usage
tmx upgrade           # Rebuild, shutdown daemon, let watchdog auto-restart
tmx shutdown          # Graceful shutdown (sessions orphaned for re-adoption)
```

**Features:**
- Config-driven sessions via `~/.config/tmx/tmx.toml`
- Dependency-ordered parallel startup (topological sort)
- Health checks (tmux_alive, http, process, custom) with auto-restart
- Battery monitoring — disables radios below threshold when not charging
- Memory pressure detection (normal/warning/critical/emergency from /proc/meminfo)
- Boot recency — auto-starts only the N most recently used Claude sessions
- Multi-instance sessions — multiple Claude instances per project with named session resume
- Fuzzy matching — `tmx start torch` / `tmx open embeddy` match by prefix or substring
- Dynamic session registry — `tmx open`/`tmx close` survive daemon restarts
- Web dashboard on port 18970 (Astro 5 + Svelte 5 + SSE real-time updates)
  - Session controls: start/stop/restart/go/close
  - Recent projects panel with search and play buttons
  - System memory, battery, ADB, CFC bridge status gauges
- Persistent status bar notification — taps open dashboard
- `tmx upgrade` — rebuilds, shuts down daemon, watchdog auto-restarts with new build
- Watchdog bash loop survives Android OOM kills
- Termux tab creation via TermuxService intents (Android 16 compatible)

### CFC Bridge (`bridge/`)

WebSocket bridge connecting Chrome extension to Claude Code CLI. Enables browser
automation tools (screenshots, navigation, form fill) as MCP tools in Claude sessions.

```bash
npx claude-chrome-android          # Start bridge server
npx claude-chrome-android --mcp    # MCP relay mode (spawned by Claude Code)
npx claude-chrome-android --setup  # Register MCP server + install extension
```

Published as `claude-chrome-android` on npm.

### Landing Page (`site/`)

Static site at [termux.party](https://termux.party) — Astro 5 + Svelte 5 + Tailwind v4.
Deployed via GitHub Pages on push to main.

### ADB Wireless Automation (`tools/`)

```bash
tools/adb-wireless-connect.sh     # Scan and connect ADB over WiFi
tools/restore-tabs.sh             # Recreate Termux tabs for tmux sessions
tools/fix-after-update.sh         # Apply phantom process killer fix
```

ADB auto-reconnects every 5 minutes via cron.

## Quick Start

```bash
# Install dependencies
pkg install tmux termux-api termux-boot bun

# Clone and build
git clone https://github.com/tribixbite/termux-tools ~/git/termux-tools
cd ~/git/termux-tools/orchestrator
bun install && bun run build

# Symlink CLI
mkdir -p ~/.local/bin
ln -sf ~/git/termux-tools/orchestrator/dist/tmx.js ~/.local/bin/tmx

# Create config
mkdir -p ~/.config/tmx
# Edit ~/.config/tmx/tmx.toml (see orchestrator/examples/)

# Install watchdog as boot script
cp orchestrator/watchdog.sh ~/.termux/boot/startup.sh
chmod +x ~/.termux/boot/startup.sh

# Boot
tmx boot
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system diagram,
module map, boot sequence, and component details.

## Documentation

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, module map, boot sequence |
| [ADB_WIRELESS_GUIDE.md](docs/ADB_WIRELESS_GUIDE.md) | ADB wireless setup and troubleshooting |
| [QUICK_REFERENCE.md](docs/QUICK_REFERENCE.md) | Command cheat sheet |
| [specs/claude-chrome-bridge.md](docs/specs/claude-chrome-bridge.md) | CFC Bridge protocol spec |

## Requirements

- Android device with Termux (0.118+)
- Termux:Boot, Termux:API apps (F-Droid)
- Bun runtime (`pkg install bun`)
- tmux (`pkg install tmux`)
- Optional: Termux:Widget, Termux:Tasker for shortcuts

## License

MIT
