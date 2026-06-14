# claude-channel — design spec

Date: 2026-06-12
Status: approved design, pending spec review

## Purpose

A small TypeScript CLI (`ccx`, npm package `claude-channel`) that manages Claude Code
as two independent **channels** on Termux:

- **next** — the latest published claude-code, fetched + Termux-patched, exposed as
  `~/.local/bin/claude-next`. Re-running `ccx update` bumps it when a new version drops.
- **stable** — the version you've promoted, exposed as `~/.local/bin/claude`. It never
  changes underneath you until you `ccx promote`.

It automates what we currently do by hand (the `install/modules/claude-code.sh` binary
path + the `claude-next` launcher + the manual symlink flip), and adds promote/rollback
with an archived history and an opt-in scheduled update.

## Scope

- **In scope (now):** the Termux backend end-to-end (fetch the bun-compiled
  `linux-arm64` binary, byte-preserving patch, channel launchers, promote/rollback/archive,
  status, opt-in scheduler, the shell alias helper). Published to npm from
  `termux-tools/claude-channel/` (like `bridge/` publishes `claude-chrome-android`).
- **Extensible (later, not implemented now):** a `Platform` interface with a Termux
  implementation; other platforms throw a clear "not implemented". A future plain-`npm`
  backend (standard Linux/macOS, no patching/bun-binary) can slot in behind the same
  interface.
- **Non-goals:** no background watcher daemon; no nvm-style arbitrary multi-version
  `use`; no cross-platform implementation in v1; the toolkit never reads or stores
  captured prompts / private context.

## Architecture: two independent channel pins

`next` and `stable` are **separate launcher scripts**, each pinned to a specific binary
under `~/.claude/binaries/claude-<version>/claude-binary`:

- `~/.local/bin/claude-next` → execs the **next** binary
- `~/.local/bin/claude` → execs the **stable** binary

Each launcher is the bun-on-termux form (matching the current `claude-next`):

```bash
#!/data/data/com.termux/files/usr/bin/bash
export CLAUDE_CODE_TMPDIR="${CLAUDE_CODE_TMPDIR:-$PREFIX/tmp}"
export DISABLE_AUTOUPDATER=1   # ccx is the sole updater; keep the pinned/patched binary put
BUN_BINARY_PATH="<.../claude-<ver>/claude-binary>" exec "$HOME/.bun/bin/bun-termux" "$@"
```

**Why `DISABLE_AUTOUPDATER=1`:** claude-code self-updates from the very channel `ccx`
uses, replacing its own executable (`os.Executable` = the pinned binary file). Left on,
it would silently overwrite a pinned channel's binary — un-pinning the version and
discarding our byte-preserving patch. Disabling it makes `ccx` authoritative and keeps
next/stable reproducible. (`ccx status` warns if a launcher is missing the flag.)

`update` only rewrites the **next** launcher. `promote` snapshots next→stable by writing
the **stable** launcher to point at the exact binary next currently uses. Because they're
independent files pinned to explicit versions, updating next never disturbs stable.

`~/.local/bin` must precede `~/.bun/bin` on PATH (so `~/.local/bin/claude` shadows the
old cli.js shim `~/.bun/bin/claude`). `ccx status` checks this and `ccx alias` documents it.

## State file

`~/.claude/binaries/channel-state.json` (the single source of truth):

```jsonc
{
  "version": 1,
  "stable": { "version": "2.1.158", "binary": ".../claude-2.1.158/claude-binary",
              "patched": true, "promotedAt": "2026-06-12T..." },
  "next":   { "version": "2.1.170", "binary": ".../claude-2.1.170/claude-binary",
              "patched": true, "updatedAt": "2026-06-12T..." },
  "archive": [
    { "version": "2.1.153", "binary": ".../claude-2.1.153/claude-binary",
      "promotedAt": "...", "archivedAt": "..." }
  ]
}
```

- Metadata in `archive[]` is kept **forever** (cheap). It is the durable record of every
  version that was ever promoted.
- Binary **files** are large (~250 MB each), so they are retention-managed (see `prune`),
  not kept unboundedly. If `rollback` needs a binary that was pruned, it re-fetches it
  from the release channel — so the archive stays restorable regardless of disk pressure.
- On startup the tool reconciles state with reality (launcher contents, files on disk);
  a missing/corrupt state file is rebuilt from what's installed.

## Commands (bin: `ccx`)

| Command | Behavior |
|---|---|
| `ccx update [--channel latest\|stable] [--pin <version>]` | Resolve the upstream channel file (default `latest`). If it equals the installed **next** version → print "up to date", exit 0. Else: fetch + sha256-verify + patch + install as next, update state, verify `claude-next --version`. **Idempotent; this is the aliased command.** `--pin <X.Y.Z>` installs an exact version. |
| `ccx promote` | Push current `stable` onto `archive[]` (with `archivedAt`), then point the **stable** launcher at the binary **next** currently uses; update state. No-op (with notice) if stable already equals next. |
| `ccx rollback [--to <version>]` | Restore stable to the most recent archived version (or `--to`). If that binary was pruned, re-fetch+patch it first. Updates state. |
| `ccx status` | Table: next version, stable version, upstream `stable`/`latest` channel versions, "update available?", and a PATH-precedence check (`~/.local/bin` before `~/.bun/bin`). |
| `ccx list` | Installed binary versions on disk + the archive history from state. |
| `ccx prune [--keep N]` | Delete binary files not referenced by next/stable and beyond the `N` most-recent archived (default `N=2`). Never touches `archive[]` metadata. |
| `ccx schedule [--every <dur>]` / `ccx unschedule` | Opt-in: install/remove a scheduled `ccx update` (Termux: a `crontab` line via `crond`; standard Linux: a systemd user timer). Prints what it installed. |
| `ccx alias` | Print (and optionally `--write` to `~/.bashrc`) the convenience alias, e.g. `alias cnup='ccx update'`, plus the PATH-precedence line if missing. |

Global flags: `--json` (machine output for `status`/`list`), `--yes` (skip confirms), `--quiet`.

## Platform layer

```
interface Platform {
  id(): "termux" | "linux" | "darwin";
  resolveLatest(channel: Channel): Promise<string>;            // GET $BASE/{stable,latest} -> version
  isInstalled(version: string): boolean;
  fetchBinary(version: string): Promise<string>;               // -> patched binary path
  writeLauncher(kind: "next"|"stable", binary: string): void;  // write ~/.local/bin/{claude-next,claude}
  currentLauncherBinary(kind): string | null;                  // parse BUN_BINARY_PATH out of launcher
  verify(kind): Promise<string>;                               // run `--version`
  scheduleInstall(every: Duration): void;  scheduleRemove(): void;
  pathPrecedenceOk(): boolean;
}
```

`TermuxPlatform` implements all of it; `LinuxPlatform`/`DarwinPlatform` throw
`NotImplementedError` with a pointer to the issue tracker. `detectPlatform()` keys off
`process.platform` + the presence of `$PREFIX/glibc` and `~/.bun/bin/bun-termux`.

### Update source: the native release channel (NOT npm)

Claude Code moved to a native installer + self-update; **npm lags** (when written, npm
`latest` = 2.1.170 while the native channel `latest` = 2.1.175). So the toolkit uses the
same source claude-code itself self-updates from — the official CDN over the
`claude-code-dist` GCS bucket — and does **not** touch npm:

- **Base:** `https://downloads.claude.ai/claude-code-releases` (this is what
  `claude.ai/install.sh` uses).
- **Channels:** `GET $BASE/stable` and `GET $BASE/latest` each return a bare version
  string (e.g. `2.1.175`). Validate it matches `^\d+\.\d+\.\d+(-\S+)?$` (reject HTML
  error pages) before use.
- **Manifest:** `GET $BASE/<version>/manifest.json` →
  `{ version, commit, buildDate, platforms: { "<platform>": { binary, checksum, size } } }`
  where `checksum` is **sha256**.
- **Binary (no tarball):** `GET $BASE/<version>/<platform>/claude` is the raw executable.
  Copy → `~/.claude/binaries/claude-<ver>/claude-binary`, `chmod +x`, verify sha256
  against the manifest before trusting it, then patch.
- **Platform:** `linux-arm64` on Termux. Reuse install.sh's musl probe
  (`/lib/libc.musl-*` / `ldd /bin/ls | grep musl`); bionic Termux is non-musl → the
  glibc `linux-arm64` build (which we already run via bun-on-termux).
- HTTP via Node `fetch` (Node 18+) with a `node:https` fallback; no third-party HTTP deps.
- **Patch (byte-preserving only):** port `_patch_claude_binary` — blank
  `"NEVER commit changes unless the user explicitly asks you to."` and
  `"Default to writing no comments."` with equal-length spaces; `assert origLen == newLen`
  (a length change corrupts the bun-vfs blob). Keep `claude-binary.bak-prepatch`. Honor
  `CCPATCH_KEEP_NO_COMMIT` / `CCPATCH_KEEP_NO_COMMENTS`. **Never patchelf** (corrupts the
  binary). **Warn, don't fail,** if a target string is absent (a future version reworded it
  → the patch is a harmless no-op).
- **Launchers:** the bun-termux form above; `~/.local/bin` created if absent.
- **Scheduler:** Termux uses `crontab` (requires `cronie`/`crond`); the tool checks for it
  and tells the user to `pkg install cronie && sv-enable crond` if missing rather than
  failing opaquely.

## Runtime & packaging

- **Runtime:** the CLI runs under **node** (bionic node is fine — it only does HTTP, tar,
  file writes, and shells out; it does not need bun to run itself). Shebang
  `#!/usr/bin/env node` for the published bin; the `ccx alias` / install guidance notes
  that on Termux you invoke it via the npm-installed `ccx` shim or `node dist/cli.js`.
- **Build:** `build.cjs` (esbuild, CJS bundle → `dist/cli.js`), mirroring `bridge/`.
- **package.json:** `name: claude-channel`, `bin: { ccx: ./dist/cli.js }`,
  `files: ["dist/", "README.md"]`, `engines.node >= 18`. No runtime deps (stdlib only);
  esbuild + typescript as devDeps. `private` stays out so it can publish.
- **Location:** `termux-tools/claude-channel/`, published directly from the subdir.

## Error handling

- Network/release-channel failures → clear message, non-zero exit, state untouched.
- Checksum mismatch → abort before install, leave previous state intact.
- Verify step (`--version`) failing after install → roll the channel back to its prior
  pin and report.
- All mutations (state file, launchers) are write-temp-then-rename to avoid half-writes.
- Re-entrancy: a lockfile under `~/.claude/binaries/.ccx.lock` so a scheduled run and a
  manual run don't collide.

## Testing

- **Unit (no network):** patch byte-preservation (golden fixture: a small blob containing
  the two target strings → asserts equal length + blanked); launcher parse/round-trip;
  state-file reconcile/migrate; channel decision logic (update no-ops when current; promote
  archives then repoints; rollback restores / triggers re-fetch when binary missing).
- **Integration (network, opt-in via env):** `resolveLatest` against the live release
  channel; a full `update` against a real fetch into a temp `HOME`.
- Run with `bun test` locally (Termux), Node on CI. Mock the release channel (HTTP) +
  filesystem via a temp `HOME` so tests never touch the real `~/.claude` or `~/.local/bin`.

## Resolved decisions

- **Retention:** `prune --keep 2` is the default (current next + current stable + 2
  most-recent archived stable ≈ up to ~1 GB). Rollback re-fetches a pruned binary from
  the release channel.
- **Default update channel:** `ccx update` defaults to `latest` (matching `install.sh`);
  `--channel stable` opts into the conservative channel.
