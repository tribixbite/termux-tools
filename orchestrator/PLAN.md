# Session Registry: Track & Restore Active Repos

**Status: IMPLEMENTED** (commit `eea1b27`)

## Overview
Sessions can be opened dynamically via `tmx open <path>` and persist across daemon restarts in `~/.local/share/tmx/registry.json`. On boot, both config sessions (tmx.toml) and registry sessions merge — all sessions survive OOM/crash/reboot.

## Commands

| Command | Description |
|---------|-------------|
| `tmx open <path> [--name N] [--auto-go] [--priority N]` | Open a new Claude session at path |
| `tmx close <name>` | Stop + remove a registry session |
| `tmx recent [--count N]` | List recent projects from Claude history |

## Implementation Files

| File | Role |
|------|------|
| `registry.ts` | Registry class — CRUD, persistence, prune, toSessionConfigs() |
| `daemon.ts` | Merge on boot, IPC handlers for open/close/recent |
| `tmx.ts` | CLI commands, fallback mode (recent works without daemon) |
| `types.ts` | IpcCommand union extended with open/close/recent |

## Design
- Registry sessions are Claude type only (services/daemons belong in config)
- Config sessions take precedence on name collision
- Auto-prune entries >30 days inactive on boot
- `tmx recent` parses `~/.claude/history.jsonl` (dedup by path, most recent first)
- Status labels: running / registered / config / untracked
