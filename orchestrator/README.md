# operadic

**operad** -- tmux session orchestrator for Claude Code on Android/Termux.

Manages multiple Claude Code sessions as tmux windows with dependency-ordered boot, health checks, auto-restart, memory monitoring, battery management, and a web dashboard.

## Install

```sh
npm i -g operadic
# or
bunx operadic
```

## Quick start

```sh
# Copy the example config
mkdir -p ~/.config/operad
cp operad.toml.example ~/.config/operad/operad.toml
# Edit sessions to match your projects
vi ~/.config/operad/operad.toml

# Boot everything (starts daemon + sessions)
operad boot

# Check status
operad status

# Shut down (sessions persist for next daemon to adopt)
operad shutdown
```

## Config

Default location: `~/.config/operad/operad.toml`

Falls back to `~/.config/tmx/tmx.toml` for backward compatibility.

TOML format with `$ENV_VAR` expansion. Define sessions as `[[session]]` entries:

```toml
[orchestrator]
socket = "$PREFIX/tmp/tmx.sock"
dashboard_port = 18970
health_interval_s = 120
wake_lock_policy = "active_sessions"

[boot]
auto_start = 6
visible = 10

[[session]]
name = "my-project"
type = "claude"
path = "$HOME/git/my-project"
auto_go = true
priority = 5
```

Session types: `claude` (Claude Code), `daemon` (long-running command), `service` (headless).

## Commands

| Command | Description |
|---|---|
| `operad boot` | Start daemon + ADB fix + boot all sessions |
| `operad status [name]` | Session table or single session detail |
| `operad start [name]` | Start all or one session |
| `operad stop [name]` | Graceful stop |
| `operad restart [name]` | Stop then start |
| `operad health` | Run health sweep |
| `operad memory` | System memory + per-session RSS |
| `operad logs [name]` | Tail structured logs |
| `operad tabs [name...]` | Restore Termux UI tabs |
| `operad config` | Validate and print resolved config |
| `operad go <name>` | Send "go" to a Claude session |
| `operad send <name> <text>` | Send arbitrary text to a session |
| `operad open <path>` | Register and start a dynamic session |
| `operad close <name>` | Stop and unregister a dynamic session |
| `operad recent [count]` | Show recently active Claude projects |
| `operad suspend <name>` | Freeze session (SIGSTOP) |
| `operad resume <name>` | Unfreeze session (SIGCONT) |
| `operad suspend-others <name>` | Suspend all except one |
| `operad suspend-all` | Suspend all running sessions |
| `operad resume-all` | Resume all suspended sessions |
| `operad upgrade` | Rebuild + restart daemon |
| `operad shutdown` | Stop daemon (sessions persist) |
| `operad shutdown --kill` | Stop daemon + kill all tmux sessions |
| `operad daemon` | Run daemon in foreground |
| `operad migrate [path]` | Convert old repos.conf to operad.toml |

## Dashboard

Web dashboard on port 18970 (configurable via `dashboard_port`).

Pages: Overview (session table, memory/battery gauges), Memory (per-session RSS, Android app manager), Logs (real-time tail).

Real-time updates via SSE.

## Watchdog

`watchdog.sh` keeps the daemon alive after Android OOM kills. Place it in `~/.termux/boot/` for auto-start on device boot.

## Requirements

- **Termux** on Android (primary target)
- **tmux** (`pkg install tmux`)
- **Node.js >= 18** or **Bun >= 1.0** (runtime)
- **ADB** (optional, for phantom process killer fix and OOM protections)
- **Claude Code** CLI installed (`claude` or `cc`)

## License

MIT
