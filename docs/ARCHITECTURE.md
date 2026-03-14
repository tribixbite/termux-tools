# Architecture Overview

## System Map

```
termux-tools/
├── orchestrator/         TMX daemon — session lifecycle, health, monitoring
│   ├── src/              TypeScript source (20 modules)
│   ├── dashboard/        Astro 5 + Svelte 5 web dashboard
│   ├── dist/tmx.js       CJS bundle (~140KB, esbuild)
│   └── watchdog.sh       Bash loop that restarts daemon after OOM kill
├── bridge/               CFC Bridge — Chrome ↔ Termux WebSocket relay
│   ├── src/cli.ts        Entry point (bridge, --mcp, --setup, --stop)
│   └── dist/cli.js       CJS bundle (240K)
├── edge-claude-ext/      Chrome extension (Manifest V3)
├── site/                 Landing page — termux.party (Astro 5 + Svelte 5)
├── tools/                Standalone bash scripts (ADB, restore-tabs, etc.)
├── tasker/               Legacy bash boot system (replaced by tmx)
└── docs/                 Documentation
```

## TMX Orchestrator

The orchestrator replaces the old `tasker/startup.sh` bash boot system with a
TypeScript daemon that manages tmux session lifecycle on Termux/Android.

### Runtime

- **Binary**: `~/.local/bin/tmx` → `orchestrator/dist/tmx.js` (shebang `#!/$PREFIX/bin/env bun`)
- **Config**: `~/.config/tmx/tmx.toml` (TOML with `$VAR` expansion, schema validation)
- **State**: `~/.local/share/tmx/state.json` (restart counts, uptimes, errors)
- **Registry**: `~/.local/share/tmx/registry.json` (dynamically opened sessions)
- **IPC**: Unix socket at `$PREFIX/tmp/tmx.sock` (newline-delimited JSON)
- **Logs**: `~/.local/share/tmx/logs/tmx.jsonl` (structured JSONL)
- **Dashboard**: HTTP on port 18970 (REST API + SSE + static Astro site)

### Boot Sequence

```
Termux:Boot → watchdog.sh → tmx boot → daemon spawned (detached)
                                         ├── preflight checks (dirs, config)
                                         ├── ADB fix (boot_delay_s wait + disable phantom killer)
                                         ├── persistent notification ("tmx ▶ N/M")
                                         ├── startAllSessions (topological order)
                                         │   ├── batch by dependency depth
                                         │   ├── parallel within batch
                                         │   └── retry waiting sessions (3x)
                                         ├── crond start
                                         ├── auto-tabs (TermuxService intents)
                                         └── health/memory/battery timers start
```

### Session Types

| Type | Behavior |
|------|----------|
| `claude` | Starts `cc` in tmux, polls capture-pane for readiness, sends "go" if `auto_go` |
| `daemon` | Runs custom `command` in tmux session |
| `service` | Headless — runs command, no tab created |

### Session State Machine

```
pending → waiting → starting → running ⇄ degraded → failed
                                  ↓                    ↓
                              stopping              stopping
                                  ↓                    ↓
                              stopped  ←←←←←←←←←  stopped → pending (restart)
```

### Module Map

| Module | Purpose |
|--------|---------|
| `daemon.ts` | Main daemon — lifecycle, IPC dispatch, boot, shutdown, notifications |
| `tmx.ts` | CLI entry point — command router, output formatting |
| `session.ts` | Tmux operations — create, stop, readiness poll, tab creation |
| `config.ts` | TOML parsing with validation and env expansion |
| `state.ts` | State persistence — transitions, adopt existing sessions |
| `types.ts` | Shared interfaces (SessionConfig, IpcCommand, TmxState, etc.) |
| `registry.ts` | Dynamic session registry — persist, merge, prune, history parsing |
| `ipc.ts` | Unix socket IPC — server (daemon) + client (CLI) |
| `http.ts` | Dashboard HTTP server — REST API + SSE for real-time push |
| `health.ts` | Health checks — tmux_alive, http, process, custom |
| `memory.ts` | /proc/meminfo parsing, per-process RSS, pressure levels |
| `activity.ts` | CPU tick-based idle/active detection via /proc/PID/stat |
| `budget.ts` | Phantom process counter (informational only, no enforcement) |
| `battery.ts` | Battery monitoring — low-power radio cutoff, notifications |
| `deps.ts` | Topological sort for dependency-ordered startup |
| `wake.ts` | Termux wake lock management (always/active_sessions/boot_only/never) |
| `log.ts` | Structured JSONL logging + pretty stderr |
| `migrate.ts` | Legacy repos.conf → tmx.toml converter |
| `display-types.ts` | CLI display data interfaces |

### CLI Commands

| Command | Description |
|---------|-------------|
| `tmx boot` | Start daemon + boot all sessions (idempotent) |
| `tmx status [name]` | Show daemon/session status |
| `tmx health` | Run health checks on all sessions |
| `tmx start [name]` | Start a specific or all sessions |
| `tmx stop [name]` | Stop a specific or all sessions |
| `tmx restart [name]` | Restart a specific or all sessions |
| `tmx go <name>` | Send Enter to a Claude session waiting for input |
| `tmx send <name> <text>` | Send arbitrary text to a session |
| `tmx tabs [names...]` | Create Termux tabs for tmux sessions |
| `tmx memory` | Show system + per-session memory usage |
| `tmx config` | Validate and display parsed config |
| `tmx recent [--count N]` | List recent Claude projects from history |
| `tmx open <path>` | Open a new Claude session at path |
| `tmx close <name>` | Stop + remove a registry-only session |
| `tmx logs` | Tail daemon log file |
| `tmx shutdown` | Graceful daemon shutdown |
| `tmx upgrade` | Rebuild, shutdown daemon, let watchdog auto-restart |
| `tmx migrate` | Convert legacy repos.conf to tmx.toml |

### Tab Creation (Android 16)

Termux tabs are created via `TermuxService` intents:

```
am startservice -n com.termux/.app.TermuxService \
  -a com.termux.service_execute \
  -d "file://$PREFIX/tmp/tmx-attach.sh" \
  --esa com.termux.execute.arguments "session_name" \
  --ei com.termux.execute.session_action 0 \
  --es com.termux.execute.shell_name "session_name"
```

The attach script sets the terminal title (Termux tab label) and execs `tmux attach`.
This works on Android 16 because TermuxService is already a foreground service.
RunCommandService requires a signature-level permission that only Termux plugins have.

### Health & Monitoring

- **Health sweeps**: configurable interval, per-session check type override
- **Memory monitoring**: /proc/meminfo → pressure levels (normal/warning/critical/emergency)
- **Auto-kill disabled**: `shedIdleSessions()` is completely disabled — the daemon never auto-kills sessions. Memory pressure levels are reported but never acted on.
- **Battery monitoring**: polls termux-battery-status, disables radios below threshold
- **Activity detection**: CPU ticks from /proc/PID/stat classify idle vs active
- **Phantom process counter**: informational only — counts descendants of `TERMUX_APP_PID` matching what Android's `PhantomProcessList` tracks. The phantom killer itself is disabled on the device via `device_config put activity_manager max_phantom_processes 2147483647` (applied by the daemon on ADB connect). Budget checks never block session starts.
- **Notifications**: persistent Android status bar notification (`termux-notification --ongoing --id tmx-status`) showing "tmx ▶ N/M" (running/total sessions). Tapping opens the dashboard at `http://localhost:18970`. All recurring notifications use `--id` + `--alert-once` to prevent stacking. Notification spawns are async to avoid blocking the event loop.

### Dashboard

Astro 5 + Svelte 5 + Tailwind v4 static site served by the daemon on port 18970.

**Pages:**
- **Overview** — session table, system gauges (memory, phantom procs, CFC bridge, ADB)
- **Memory** — per-session RSS, Android app process manager (force-stop)
- **Logs** — real-time log tail via SSE

**API endpoints:** `/api/status`, `/api/health`, `/api/memory`, `/api/processes`,
`/api/kill/:pkg`, `/api/tab/:name`, `/api/adb/*`, `/api/logs`, `/api/events` (SSE)

### Upgrade

`tmx upgrade` rebuilds the daemon bundle (`bun run build`), shuts down the running
daemon, and relies on the watchdog loop to auto-restart with the new code. Safety
guard: refuses to run from inside a managed tmux session (detected by matching
`$TMUX` pane against known session names) to avoid killing itself mid-upgrade.

### Service Notes

- **termux-x11**: the x11 service command includes `rm -f $PREFIX/tmp/.X1-lock $PREFIX/tmp/.X11-unix/X1 2>/dev/null;` before launching Xwayland to prevent stale lock segfaults from previous crashes.

### Watchdog

`watchdog.sh` is a bash loop installed as `~/.termux/boot/startup.sh`:

1. Clean stale socket
2. Run `tmx boot`
3. On success: `tmux attach` (makes watchdog tab a tmux client)
4. On tmux exit (OOM/crash): loop back to step 1
5. On boot failure: retry after 5s

---

## CFC Bridge

WebSocket bridge between a Chrome extension and Claude Code CLI sessions.

- **Bridge server**: `bridge/src/cli.ts` — HTTP + WebSocket on configurable port
- **MCP relay**: `cli.ts --mcp` — stdio MCP server that POSTs to bridge `/tool` endpoint
- **Extension**: `edge-claude-ext/` — Manifest V3, connects via WebSocket
- **Native host**: Chrome native messaging host for direct extension ↔ CLI communication
- **FIFO queue**: concurrent tool requests from multiple Claude sessions queued, processed in order

Registered as `cfc-bridge` MCP server in Claude Code settings.

---

## Legacy System (tasker/)

The original `startup.sh` + `repos.conf` bash-based boot system. Replaced by TMX
orchestrator but kept for reference. Use `tmx migrate` to convert `repos.conf` to
`tmx.toml`.
