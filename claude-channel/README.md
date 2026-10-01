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

## Codex channels (`cdx`)

The same package now builds `cdx`, an independent ARM64 Termux manager. It shares
ccx's resolver patch implementation but has separate state and release storage at
`~/.local/share/codex-channel`; it never edits ccx pins or Codex login/config files.

```bash
cd ~/git/termux-tools/claude-channel
bun run build
node dist/codex-cli.js setup
export PATH="$HOME/.local/bin:$PATH"
cdx update                  # latest stable upstream -> codex-next
codex-next                  # try it before promotion
cdx promote                 # next -> codex; archive outgoing stable
codex
```

| Command | Behavior |
|---|---|
| `cdx update [--pin VERSION]` | Isolated Bun install, DNS patch, native ripgrep copy, version/feature checks; only changes next |
| `cdx promote` | Atomically switches stable to the verified next version |
| `cdx rollback [--to VERSION]` | Switches to a retained archived stable; also archives the outgoing stable |
| `cdx status [--json]` | Stable, next, registry latest, and explicit registry errors when offline |
| `cdx list` | Installed versions and rollback history |
| `cdx prune [--keep N] [--yes]` | Previews by default; `--yes` deletes unused releases, preserving both channels and N archives (default 2) |
| `cdx schedule [--every HOURS]` | Opt-in cron updates of next only; intervals 1, 2, 3, 4, 6, 8, 12, or 24 hours |
| `cdx unschedule` | Removes only the cdx cron entry |
| `cdx alias` | Prints PATH setup and a `cdup` alias |
| `cdx setup` | Installs the three managed command launchers, refusing unmanaged existing files |

Scheduled updates require an already-running `crond`. Nothing enables a schedule
or promotes a release automatically. Pruning removes corresponding rollback
history; install an intentionally pruned version again with `update --pin` before
promoting it. Interrupted mutations leave a `.lock/owner.json`; confirm that its
PID is no longer active before manually removing that lock directory.

Launchers use the native Node runtime (Node 24's `execve` on this device), set
Termux temporary-directory variables, prepend the release's patched ripgrep,
and disable `daemon_auto_start` per invocation. No PRoot is used and sandbox or
approval policies are not relaxed. The existing global Bun Codex package is left
intact; PATH selects the managed `~/.local/bin/codex` instead. Use `cdx update`,
not upstream `codex update`, to keep the channel workflow and Termux fixes.

Verified on 2026-10-01: initialized stable from 0.157.1, fetched/patched 0.159.3
into next, retained ChatGPT login, checked both launcher versions and opened next
interactively. No inference request or automatic schedule was started. Automated
coverage includes state corruption, invalid CLI arguments, failed-verification
isolation, promotion/rollback, pruning, locking, cron quoting, and inode safety.
Android's previously documented daemon and sandbox restrictions still apply.
