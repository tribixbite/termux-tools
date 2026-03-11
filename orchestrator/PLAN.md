# Session Registry: Track & Restore Active Repos

## Problem
Sessions are hardcoded in `tmx.toml`. After OOM/crash/reboot, only config sessions restart. There's no way to dynamically open a new repo as a Claude session and have it survive crashes.

## Solution
A **session registry** (`~/.local/share/tmx/registry.json`) that persists "dynamic" Claude sessions alongside the static `tmx.toml` config. On boot, both sources merge — config sessions + registry sessions all start.

## Registry File
```json
{
  "version": 1,
  "sessions": [
    {
      "name": "new-project",
      "path": "/home/.../git/new-project",
      "opened_at": "2026-03-10T...",
      "last_active": "2026-03-10T...",
      "priority": 50,
      "auto_go": false
    }
  ]
}
```

## New CLI Commands

### `tmx open <path> [--name <n>] [--auto-go] [--priority N]`
- Validates path is a directory
- Derives name from `basename(path)` if not given
- Rejects if name conflicts with a config session
- If daemon running: registers in registry + starts session immediately via IPC
- If daemon not running: registers in registry only (starts on next boot)

### `tmx close <name>`
- Stops the session if running (via IPC)
- Removes from registry
- Refuses to close config sessions (use `tmx stop` instead)

### `tmx recent [--count N]`
- Parses `~/.claude/history.jsonl` tail for recently active projects
- Deduplicates by project path, shows most recent timestamp
- Marks which are already running or registered
- Example output:
  ```
  Recent projects:
    craftmatic     ~/git/craftmatic          [running]
    cleverkeys     ~/git/swype/cleverkeys    [running]
    commet         ~/git/commet              [registered]
    stoatally      ~/git/stoatally           [not tracked]
  ```

## Implementation

### 1. `registry.ts` (NEW ~120 lines)
- `RegistryEntry` interface: name, path, opened_at, last_active, priority, auto_go
- `Registry` class:
  - `load(path)` — read JSON, validate version, return entries
  - `save(path)` — atomic write (tmp + rename, same as state.ts)
  - `add(entry)` — append, dedupe by name, persist
  - `remove(name)` — filter out, persist
  - `find(name)` — lookup by name
  - `findByPath(path)` — lookup by path (to prevent duplicates)
  - `updateActivity(name)` — set `last_active` to now
  - `prune(maxAgeDays)` — remove entries with `last_active` older than N days
  - `toSessionConfigs()` — convert entries to `SessionConfig[]` for merging with config

### 2. `types.ts` — Add types
- `RegistryEntry` interface
- `RegistryData` interface (`{ version: number; sessions: RegistryEntry[] }`)
- Extend `IpcCommand` union:
  - `{ cmd: "open"; path: string; name?: string; auto_go?: boolean; priority?: number }`
  - `{ cmd: "close"; name: string }`
  - `{ cmd: "recent"; count?: number }`

### 3. `daemon.ts` — Integrate registry
- Add `private registry: Registry` field
- In `constructor()`: load registry from `~/.local/share/tmx/registry.json`
- In `start()`: merge `this.config.sessions` + `this.registry.toSessionConfigs()` before `initFromConfig()`
- New `cmdOpen(path, name?, autoGo?, priority?)`:
  - Validate path exists
  - Derive name, check conflicts with config sessions
  - Add to registry
  - Create `SessionConfig`, add to `this.config.sessions`
  - Start session immediately
  - Return response with session name
- New `cmdClose(name)`:
  - Verify it's a registry session (not config)
  - Stop session
  - Remove from registry
  - Remove from `this.config.sessions`
  - Remove state entry
- New `cmdRecent(count)`:
  - Parse `~/.claude/history.jsonl` tail (last 1000 lines)
  - Extract unique project paths with latest timestamp + sessionId
  - Mark running/registered/untracked status
  - Return sorted by recency
- In `memoryPollAndShed()`: call `this.registry.updateActivity(name)` for running registry sessions
- In `shutdown()`: save registry with final timestamps
- Wire new commands in `handleIpcCommand()`

### 4. `tmx.ts` — Add CLI commands
- `open` command:
  - If daemon running → send IPC `{ cmd: "open", path, name, auto_go, priority }`
  - If daemon not running → directly use Registry class to add entry, print hint to `tmx boot`
- `close` command: send IPC `{ cmd: "close", name }`
- `recent` command:
  - If daemon running → send IPC `{ cmd: "recent", count }`
  - If daemon not running → directly parse history.jsonl (same logic)
- Add to `printHelp()` and command router

### 5. `state.ts` — Minor change
- `initFromConfig()` already handles adding new sessions and removing stale ones — no change needed since daemon merges config + registry before calling it

### 6. `config.ts` — Add helper
- `registryToSessionConfig(entry: RegistryEntry): SessionConfig` — creates a SessionConfig with claude type defaults

## Design Decisions
- **Registry sessions are Claude type only** — services/daemons belong in config
- **Config sessions take precedence** — name collision → config wins, registry entry skipped with warning
- **Auto-prune on boot**: entries with `last_active` > 30 days removed automatically
- **Registry file location**: next to state.json in `~/.local/share/tmx/`
- **No `--continue` flag**: fresh Claude instance per crash recovery. User can manually `--resume` inside the session.
- **Registry survives daemon restart** — it's the persistence layer, not the daemon

## File Changes Summary
| File | Change |
|------|--------|
| `registry.ts` | NEW — Registry class + types |
| `types.ts` | Add RegistryEntry, RegistryData, extend IpcCommand |
| `daemon.ts` | Load registry, merge sessions, handle open/close/recent |
| `tmx.ts` | Add open/close/recent CLI commands + help text |
| `config.ts` | Add `registryToSessionConfig()` helper |
