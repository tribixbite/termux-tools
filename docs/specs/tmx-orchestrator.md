# TMX Orchestrator Spec

## Overview

TypeScript daemon managing tmux session lifecycle on Termux/Android. Replaces
bash-based `startup.sh` with config-driven, dependency-ordered startup, health
monitoring, battery management, and a web dashboard.

## Config (`~/.config/tmx/tmx.toml`)

```toml
[orchestrator]
socket = "$PREFIX/tmp/tmx.sock"
state_file = "$HOME/.local/share/tmx/state.json"
log_dir = "$HOME/.local/share/tmx/logs"
health_interval_s = 30
boot_timeout_s = 120
process_budget = 128
wake_lock_policy = "active_sessions"
dashboard_port = 18970
memory_warning_mb = 1024
memory_critical_mb = 512
memory_emergency_mb = 256

[adb]
enabled = true
connect_script = "$HOME/git/termux-tools/tools/adb-wireless-connect.sh"
connect_timeout_s = 60
retry_interval_s = 300
phantom_fix = true
boot_delay_s = 15

[battery]
enabled = true
low_threshold_pct = 10
poll_interval_s = 60

[health_defaults.claude]
check = "tmux_alive"
unhealthy_threshold = 3

[health_defaults.service]
check = "tmux_alive"
unhealthy_threshold = 3

[[sessions]]
name = "termux-tools"
type = "claude"
path = "$HOME/git/termux-tools"
auto_go = true
priority = 10
depends_on = []
headless = false
enabled = true
```

## IPC Protocol

Newline-delimited JSON over Unix socket.

**Request:** `{ "cmd": "status", "name": "termux-tools" }\n`
**Response:** `{ "ok": true, "data": { ... } }\n`

### Commands

| Command | Args | Description |
|---------|------|-------------|
| `status` | `name?` | Get daemon/session status |
| `start` | `name?` | Start session(s) |
| `stop` | `name?` | Stop session(s) |
| `restart` | `name?` | Restart session(s) |
| `health` | — | Run health sweep |
| `boot` | — | Full boot sequence |
| `shutdown` | — | Graceful shutdown |
| `go` | `name` | Send Enter to Claude session |
| `send` | `name, text` | Send text to session |
| `tabs` | `names?` | Create Termux tabs |
| `config` | — | Return parsed config |
| `memory` | — | System + per-session memory |
| `open` | `path, name?, auto_go?, priority?` | Open dynamic session |
| `close` | `name` | Stop + remove registry session |
| `recent` | `count?` | Recent projects from history |

## Session Lifecycle

### State Machine

```
pending ──→ waiting ──→ starting ──→ running ⇄ degraded
   ↑            │            │          │           │
   │            │            │          │           │
   │            ↓            ↓          ↓           ↓
   └── stopped ←── stopping ←── stopping ←── failed
```

### Boot Sequence

1. **Preflight**: ensure dirs exist, validate config
2. **ADB fix**: wait `boot_delay_s`, connect, apply phantom process killer fix
3. **Start sessions**: topological sort by `depends_on`, parallel within depth level
4. **Cron**: ensure crond running
5. **Auto-tabs**: create Termux tabs via TermuxService after 3s delay
6. **Timers**: health sweep, memory monitor, battery monitor, ADB retry

### Health Checks

| Type | How |
|------|-----|
| `tmux_alive` | `tmux has-session -t name` |
| `http` | GET to configured URL, expect 2xx |
| `process` | Check process name pattern exists |
| `custom` | Run shell command, exit 0 = healthy |

Failed checks increment `consecutive_failures`. When threshold exceeded:
`running → degraded`. Degraded sessions auto-restart with exponential backoff
up to `max_restarts`.

### Tab Creation (Android 16)

```
TermuxService.service_execute intent
  → creates new Termux terminal session
  → runs tmx-attach.sh (sets OSC title + exec tmux attach)
  → result: real Termux tab with tmux client
```

Alternatives tried and failed on Android 16:
- RunCommandService: requires signature-level permission
- am start TermuxActivity: singleTask, ignores execute extras on reuse
- TIOCSTI injection: blocked on Linux 6.2+

## Monitoring

### Memory Pressure Levels

| Level | Condition | Action |
|-------|-----------|--------|
| normal | available > warning_mb | — |
| warning | available < warning_mb | Log warning |
| critical | available < critical_mb | Shed idle sessions |
| emergency | available < emergency_mb | Shed all non-essential |

### Battery

Polls `termux-battery-status` every `poll_interval_s`. When below
`low_threshold_pct` AND not charging:
- Disable WiFi via `termux-wifi-enable false`
- Disable mobile data via `svc data disable`
- Send notification + toast

Auto-restores at threshold + 5% hysteresis when charging resumes.

### Session Registry

Dynamic sessions opened via `tmx open` persist in `registry.json`:

```json
{
  "version": 1,
  "sessions": [{
    "name": "my-project",
    "path": "/home/.../git/my-project",
    "opened_at": "2026-03-10T...",
    "last_active": "2026-03-11T...",
    "priority": 50,
    "auto_go": false
  }]
}
```

Merged with config sessions on boot. Auto-pruned after 30 days inactive.

## Dashboard

Astro 5 static site with Svelte 5 islands, served on port 18970.

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Full daemon + session status |
| `/api/health` | GET | Health check results |
| `/api/memory` | GET | System + per-session memory |
| `/api/processes` | GET | Android apps via `adb shell ps` |
| `/api/kill/:pkg` | POST | Force-stop Android app |
| `/api/tab/:name` | POST | Bring session tab to foreground |
| `/api/adb` | GET | ADB device list |
| `/api/adb/connect` | POST | Run wireless ADB connect |
| `/api/adb/disconnect` | POST | Disconnect ADB |
| `/api/logs` | GET | Recent log entries (JSON) |
| `/api/events` | GET | SSE stream for real-time state |

### Session Control (via SSE actions)

| Action | Effect |
|--------|--------|
| Stop (square) | Kill tmux session |
| Restart (loop) | Stop + start |
| Go (play) | Send Enter to Claude session |
| Play (play) | Start stopped session |

## Build

```bash
cd orchestrator
bun install
bun run build            # esbuild → dist/tmx.js (~140KB CJS)

# Dashboard
cd dashboard
bun install
node scripts/fix-android-binaries.mjs  # fix native deps for Android ARM64
bun run build            # Astro → dashboard/dist/
```

Note: `bun run build` routes through the bun wrapper which runs `node build.cjs`
as a shell command (esbuild needs the android-arm64 binary, not linux-arm64-gnu).
