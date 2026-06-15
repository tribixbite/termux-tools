# claude-channel (`ccx`)

Manage Claude Code as two pinned channels on Termux:

- **next** — `ccx update` fetches the latest release, Termux-patches it, and pins it to
  `~/.local/bin/claude-next`. Re-run anytime; it no-ops when already current.
- **stable** — `ccx promote` snapshots next → `~/.local/bin/claude` and archives the
  outgoing stable. `ccx rollback` restores it (re-fetching if pruned).

## Install

```bash
npm i -g claude-channel    # or: bun add -g claude-channel
ccx alias >> ~/.bashrc      # adds `cnup` alias + PATH hint
```

Requires Termux with bun-on-termux (`~/.bun/bin/bun-termux`) and the glibc runtime
(`$PREFIX/glibc`). Updates come from the native release channel
`https://downloads.claude.ai/claude-code-releases` (not npm).

## Commands

| Command | What |
|---|---|
| `ccx update [--channel latest\|stable] [--pin X.Y.Z]` | install/refresh **next** |
| `ccx promote` | next → stable, archiving the old stable |
| `ccx rollback [--to X.Y.Z]` | restore an archived stable |
| `ccx status [--json]` | versions + update availability + PATH check |
| `ccx list` | installed versions + archive |
| `ccx prune [--keep N]` | reclaim disk (default keep 2; ~250 MB/binary) |
| `ccx schedule [--every H]` / `ccx unschedule` | opt-in crontab auto-update |
| `ccx alias` | print the `cnup` alias + PATH line |

The pinned launchers export `DISABLE_AUTOUPDATER=1` so `ccx` is the sole updater and a
channel never changes underneath you.
