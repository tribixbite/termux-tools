# termux-tools — `ccx` · `cdx` · `agx`

Pinned **stable / next** release channels for the AI CLIs you run on Termux, plus the
self-contained Termux tooling scripts from
[tribixbite/termux-tools](https://github.com/tribixbite/termux-tools), in one npm package.

| Manager | Manages | Launchers it owns | Release store |
|---|---|---|---|
| `ccx` | Claude Code (native release channel, not npm) | `claude`, `claude-next` | `~/.claude/binaries/` |
| `cdx` | OpenAI Codex CLI (`@openai/codex`) | `codex`, `codex-next` | `~/.local/share/codex-channel/` |
| `agx` | Google Antigravity CLI (`agy`) | `agy`, `agy-next` | `~/.local/share/antigravity-channel/` |

All three follow the same model:

- **next** — `<tool> update` fetches the current upstream release into an immutable
  per-version directory, applies the Termux fixes that release needs, verifies the binary
  reports the expected version, and only then points `next` at it. Re-running is a no-op
  when already current.
- **stable** — `<tool> promote` makes `next` the stable launcher in one atomic state
  write and archives the outgoing stable. `<tool> rollback [--to VERSION]` restores an
  archived version.
- Nothing is ever promoted or scheduled automatically. `schedule` is opt-in, updates
  `next` only, and needs a running `crond`. `prune` previews by default and never removes
  `next`, `stable`, or the retained archive. Mutations take a directory lock
  (`.lock/owner.json`); check the recorded PID before removing a stale lock by hand.
- Launchers disable each tool's built-in self-updater, so a channel never changes
  underneath you.

## Install

```bash
npm i -g termux-tools        # or: bun add -g termux-tools
export PATH="$HOME/.local/bin:$PATH"   # managed launchers live here (ccx alias / cdx alias / agx alias print this)
```

Requirements on Termux: `node` (the managed launchers exec through it), and per tool:

- `ccx`: [bun-on-termux](https://github.com/tribixbite/bun-on-termux) (`~/.bun/bin/bun-termux`)
  and the glibc runtime (`pkg install glibc-runner`).
- `cdx`: `bun` (isolated package installs) and ripgrep (`pkg install ripgrep`).
- `agx`: `pkg install proot glibc-runner` (Antigravity is a glibc Go binary; see below).

## `ccx` — Claude Code

Updates come from the native release channel
`https://downloads.claude.ai/claude-code-releases`, not npm. Each binary is byte-patched
for Termux (DNS resolver redirect for the bundled c-ares, plus two CLAUDE.md-conflicting
prompt lines blanked; opt out per patch with `CCPATCH_KEEP_RESOLV=1`,
`CCPATCH_KEEP_NO_COMMIT=1`, `CCPATCH_KEEP_NO_COMMENTS=1`).

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

The pinned launchers export `DISABLE_AUTOUPDATER=1` so `ccx` is the sole updater.

## `cdx` — Codex

Independent ARM64 Termux manager with its own state and release storage; it never edits
`ccx` pins or Codex login/config files.

```bash
cdx setup                   # install cdx, codex and codex-next launchers (refuses unmanaged files)
cdx update                  # latest upstream -> codex-next (isolated Bun install, DNS patch, native ripgrep copy)
codex-next                  # try it before promotion
cdx promote                 # next -> codex; archive outgoing stable
```

| Command | Behavior |
|---|---|
| `cdx update [--pin VERSION]` | Isolated Bun install, DNS patch, native ripgrep copy, version/feature checks; only changes next |
| `cdx promote` | Atomically switches stable to the verified next version |
| `cdx rollback [--to VERSION]` | Switches to a retained archived stable; also archives the outgoing stable |
| `cdx status [--json]` | Stable, next, registry latest, and explicit registry errors when offline |
| `cdx list` | Installed versions and rollback history |
| `cdx prune [--keep N] [--yes]` | Previews by default; `--yes` deletes unused releases, preserving both channels and N archives |
| `cdx schedule [--every HOURS]` / `cdx unschedule` | Opt-in cron updates of next only; intervals 1, 2, 3, 4, 6, 8, 12, or 24 hours |
| `cdx alias` | Prints PATH setup and a `cdup` alias |
| `cdx setup` | Installs the three managed launchers, refusing unmanaged existing files |

Launchers use the native Node runtime, set Termux temporary-directory variables, prepend
the release's patched ripgrep, and disable `daemon_auto_start` per invocation. No PRoot
is used and sandbox or approval policies are not relaxed. Use `cdx update`, not upstream
`codex update`, to keep the channel workflow and Termux fixes.

## `agx` — Antigravity

Google ships Antigravity only as a glibc-linked Go binary. On Termux's bionic libc it
needs the glibc dynamic loader bound where its `PT_INTERP` expects it and the Go
runtime's raw `faccessat2` syscall remapped (Android's seccomp kills it otherwise). Both
come from `proot`, so every managed launch is
`proot -b $PREFIX/glibc/lib/ld-linux-aarch64.so.1:/lib/… -b $PREFIX/etc/resolv.conf:/etc/resolv.conf <binary>`
with `LD_PRELOAD` unset and `AGY_CLI_DISABLE_AUTO_UPDATE=true`, so the binary's own
background updater cannot replace a pinned release. The binary is never `patchelf`'d
(that corrupts Go's pclntab).

```bash
agx setup                   # install agx, agy, agy-next; adopts an existing install-antigravity-termux.sh binary as stable
agx update                  # Google's current release -> agy-next (SHA-512 verified, tarball unpacked, --version checked)
agy-next --version          # try it
agx promote                 # next -> agy; archive the outgoing stable
```

| Command | Behavior |
|---|---|
| `agx update [--pin VERSION]` | Downloads Google's current manifest release into next. A pin must already be installed or in the catalog (see below) |
| `agx promote` / `agx rollback [--to VERSION]` | Same semantics as cdx |
| `agx status [--json]` | Stable, next, archive and the manifest's current version (or the manifest error) |
| `agx list` | Installed, archived and catalogued versions |
| `agx prune [--keep N] [--yes]` | Preview by default; `--yes` deletes unprotected releases |
| `agx import` | Adopt `~/.local/lib/antigravity/antigravity` (the legacy installer's binary) as a managed release; seeds stable if none exists |
| `agx setup` | Writes the launchers. Replaces only agx-managed files or the legacy installer's `agy`; refuses anything else |
| `agx schedule [--every HOURS]` / `agx unschedule` / `agx alias` | As cdx (`agup` alias) |

**Why pins need a catalog.** Google's manifest only ever describes the current release,
and download URLs embed a build id that cannot be derived from a version number. Every
manifest `agx` sees is recorded in `state.json`'s catalog, so any version seen since
`agx` was first run can be re-installed with `--pin`, even after Google moves on. Keep
the archive (or `agx import` the legacy binary) for anything older.

Through a launcher, `agy update` and `agy install` are refused: the first would bypass
the channel pins, the second copies the raw glibc binary over the managed launcher.
Authentication and settings stay in `~/.gemini/antigravity-cli/` across upgrades.

## Termux shell tools

Also installed as commands by this package (the same files as `scripts/` in the repo):

| Command | What |
|---|---|
| `pip-tool-install <pkg>` | Install a C-extension Python CLI into an isolated python3.12 venv (uv cannot build these on Termux) |
| `install-ghostty-termux` | Source-build the GTK4 Ghostty terminal for termux-x11 |
| `install-antigravity-termux` | The original one-shot Antigravity installer; `agx` supersedes it for upgrades |
| `migrate-termux backup\|restore` | Clone a Termux install to another device |
| `threads-dl <url>` | Download public Threads videos (no yt-dlp extractor exists) |

## Development

```bash
cd claude-channel
bun install
bun test            # unit tests for all three managers (offline fixtures)
bun run typecheck
bun run build       # dist/{cli,codex-cli,antigravity-cli}.js + bin/ + LICENSE
```

Releases: bump `version` here, tag `termux-tools-v<version>`, push the tag. The
`publish-termux-tools` workflow tests, builds, checks the tag against `package.json`,
publishes with npm trusted publishing (OIDC) and creates a GitHub release.
