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

### Codex channel manager (`cdx`)

For routine Codex updates, use the ccx companion in [claude-channel](claude-channel/README.md#codex-channels-cdx):

```bash
cdx update       # stage latest with Termux DNS/ripgrep fixes
codex-next       # try the staged release
cdx promote      # make it the normal codex command
cdx status
```

`cdx rollback` returns to a retained stable release. Updates use isolated Bun
installs and never overwrite running binaries. Scheduling is opt-in; updates only
change next. Installed on 2026-10-01 with stable 0.157.1 and next 0.159.3. The older
manual patch script below remains available for the unmanaged Bun installation.

### Codex CLI DNS patch (`scripts/patch-codex-termux-dns.sh`)

Repairs device-code authentication in the native Codex CLI package on Termux when
the initial request fails with an error such as:

```text
Error logging in with device code: error sending request for url
(https://auth.openai.com/api/accounts/deviceauth/usercode)
```

The native binary's bundled resolver opens `/etc/resolv.conf`, but Android's
read-only `/system/etc` does not provide that file to Termux. The script uses the
existing byte-preserving patcher in `claude-channel/src/patch.ts` to replace the
16-byte `/etc/resolv.conf` literal with the equal-length `/sdcard/dns.conf` path.
It creates the resolver file when needed, keeps a one-time `.bak-prepatch` backup,
and replaces the binary atomically so running mapped processes retain their old
inode safely.

```bash
scripts/patch-codex-termux-dns.sh
codex login --device-auth
```

The default target is the Bun global installation's aarch64 musl binary. Pass a
different native binary path as the first argument, or set `CODEX_BINARY`, when
Codex is installed elsewhere:

```bash
scripts/patch-codex-termux-dns.sh /path/to/native/codex
```

Codex package updates replace the native binary, so rerun the script after an
update if the login error returns. Device-code login must also be enabled in the
account or workspace settings as described in the
[official Codex authentication documentation](https://developers.openai.com/codex/auth).
The binary rewrite itself is a Termux-specific workaround, not an official OpenAI
installation step. The patcher also replaces Codex's bundled `codex-path/rg` with
an atomic regular-file copy of Termux's native ripgrep when available, keeping the upstream
binary as `rg.bak-prepatch`. Codex prepends this directory to PATH; the bundled
Linux interpreter is unavailable on Android.

#### Verified update: 2026-09-27

- Updated Bun's global `@openai/codex` from **0.153.4 to 0.157.1**, the registry's
  stable `latest` at the time. Staged the release with Bun first, patched it, and
  checked `--version` before updating the global package with
  `env -u BUN_BINARY_PATH bun add --global --ignore-scripts --exact @openai/codex@0.157.1`.
- Before updating a running installation, preserve the native `codex` and
  `codex-code-mode-host` inodes by renaming them within their directory; never
  truncate mapped executables. Previous packages for this update are backed up
  under `$PREFIX/tmp/codex-update-20260927/previous/`.
- Reapplied this script after installation. Verified the installed binary differs
  from its new upstream backup **only in two DNS path substitutions**, with equal
  size. `codex --version`, `codex login status`, native `rg --version`, shell syntax,
  patcher reapplication, six patch regression tests (26 assertions), and the
  shared patch module's TypeScript check passed. Existing ChatGPT login survived.
- CFC's existing HTTP configuration required an already-running daemon. Restored
  the documented stdio configuration in `bridge/README.md`, started the existing
  daemon with Node, and verified MCP discovery and a read-only browser-context
  call. Start the daemon with `node bridge/dist/cli.js` before browser use and open
  Edge Canary. The extension disconnected when Edge stopped/backgrounded during
  testing; registration alone does not guarantee a live browser connection.
- **Sandbox remains unavailable on this Android host.** `/proc/sys/kernel/overflowuid`
  is denied, `unshare -Ur true` returns `EINVAL`, and mount namespace creation
  returns `EPERM`. Codex 0.157.1's sandbox fails with permission denied; its deprecated
  Landlock option also refuses filesystem-restricted execution without bubblewrap.
  Installing another bubblewrap binary cannot supply the missing kernel/SELinux
  permissions. No security settings or Codex approval defaults were weakened.
  A compatible Linux host/VM is the practical route to the
  [official Linux sandbox](https://learn.chatgpt.com/docs/sandboxing); Proot path
  translation is not equivalent security isolation.

#### Daemon startup correction: 2026-09-27

The initial ripgrep symlink repair caused `package link escapes its root` when
normal interactive startup staged the daemon package. The patcher now copies
native ripgrep atomically into the package instead; it repairs existing symlinks
and skips unchanged regular files. Version/login checks alone did not exercise
this installation path.

After that fix, daemon installation succeeded but startup failed creating
`/tmp/codex-daemon-10364` with `EACCES`. The version-matched upstream
`codex-rs/uds/src/daemon_directory.rs` deliberately uses a fixed `/tmp` root,
ignoring `TMPDIR`, `HOME`, and `CODEX_HOME`. This is separate from the sandbox
failure. Applied the supported setting:

```bash
codex features disable daemon_auto_start
```

Normal interactive launch was verified in a PTY without `--no-daemon`; foreground
mode opened with the configured model and project. Shared background-daemon
features remain unavailable on this host. Sandbox and approval settings were
not changed. Explicit `codex --no-daemon` remains a per-launch alternative.

<!-- TODO: Validate sandboxed execution on a compatible Linux host/VM; native
Android namespace restrictions remain unresolved. Verify durable CFC daemon and
browser-extension availability across device backgrounding and reboot. -->

### Native temporary-directory policy (2026-09-27)

Use native configuration and builds; PRoot is not the preferred solution for this
host. Both `~/.bashrc` and `~/.profile` now export the same values for new shells:

```bash
export TMPDIR=/data/data/com.termux/files/usr/tmp
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
```

Login-shell Python and interactive-shell Node checks passed; Bun also reports
this directory. Existing processes keep their old environment. Service launchers
that bypass shell startup files must supply these variables themselves. Java
programs may additionally need `-Djava.io.tmpdir=/data/data/com.termux/files/usr/tmp`.

There is no universal native userspace setting for programs that deliberately
ignore these variables. This host's real `/tmp` is a writable tmpfs owned by
`shell:shell`, mode 0771, labeled `shell_data_file`; it is not an app-writable
Termux directory. Android policy prohibits app-domain writes to that directory
label, so an ADB chmod alone is not a sound fix. No global mount, mode, ownership,
or SELinux policy was changed.

Codex's distributed ARM64 binary is statically linked, so LD_PRELOAD cannot
intercept its filesystem calls. A native rebuild needs a platform-specific
constant in `codex-rs/uds/src/daemon_directory.rs`: use the fixed
`/data/data/com.termux/files/usr/tmp` root for Android and retain `/tmp` elsewhere.
Keep its existing UID-derived directory, 0700 permissions, ownership checks, and
symlink rejection. Both daemon listeners and sandbox exclusions must use the
same shared function. Do not replace it with an environment-selected directory:
upstream explicitly requires this privileged socket root to be independent of
HOME, TMPDIR, CODEX_HOME, and command settings.

The configured TUR repository offers native Codex **0.122.0-1**, older than the
installed **0.157.1**, so it was not installed. Its build recipe also builds V8;
with only about 9.2 GiB free and existing load around 11, no full native build was
started. The current CLI remains configured for foreground mode. A temporary
PRoot daemon test was stopped and its leftover supervisor terminated; no PRoot
launcher or service was installed.

The shared daemon enables the `codex agents` overview, shared live sessions that
can outlive a terminal client, and managed remote-control/SSH workflows. Disabling
its automatic startup does not remove ordinary chat, saved-session resume/fork,
MCP tools, or in-session subagent work. Foreground work still needs its owning
process kept alive.

<!-- TODO: Build and validate current native Codex with the fixed Android socket
root on a host with enough build capacity. Verify daemon start/stop, interactive
attachment, socket ownership/mode, child-tool execution, and sandbox path
consistency before restoring daemon_auto_start. Do not weaken socket validation
or promise that a temp-path fix resolves Android's separate namespace limits. -->

### Google Antigravity CLI (`scripts/install-antigravity-termux.sh`)

Installs or upgrades Google's `agy` CLI on Termux without changing the system
Python or package-manager state. Google distributes Antigravity as a glibc-linked
Go binary; the generated launcher runs it through the already-installed Proot and
Termux glibc runtime, binds Termux's resolver configuration, removes the
incompatible bionic `LD_PRELOAD`, and preserves the downloaded binary unchanged.
Downloads are verified against Google's SHA-512 release manifest and the
executable is replaced atomically.

```bash
scripts/install-antigravity-termux.sh
agy --version
agy --help
```

The binary is stored under `~/.local/lib/antigravity/`, with the Termux launcher
at `~/.local/bin/agy`. Authentication and settings remain under
`~/.gemini/antigravity-cli/` across upgrades.

Run `agy` interactively once to complete Google OAuth. Commands that require the
agent service, such as `agy models`, remain unavailable until that sign-in.

### Android Secure Prefs Dumper (`scripts/android-secure-prefs-dump`)

Dumps any Android app's `androidx.security.crypto.EncryptedSharedPreferences`
file in plaintext (entry name → value). Works on flutter_secure_storage and on
native-Java EncryptedSharedPreferences callers. **Requires** Magisk/KernelSU
root on the target device.

```bash
android-secure-prefs-dump <package>                       # default file = FlutterSecureStorage
android-secure-prefs-dump <package> <prefs-file-basename> # custom prefs file
android-secure-prefs-dump --device <serial> <package>     # explicit ADB device
android-secure-prefs-dump --json <package> | jq .         # JSON for scripting
android-secure-prefs-dump --raw  <package>                # KEY=VALUE lines
android-secure-prefs-dump --list-aliases <package>        # just AndroidKeyStore aliases
```

Mechanism: pushes a bundled DEX to `/data/local/tmp/`, runs it via
`su -c 'su <pkg-uid> -c "app_process … SecureStorageDumper"'` to extract the
two Tink keysets (one AES-SIV for entry names, one AES-GCM for values) using
the HW-backed `_androidx_security_master_key_`, then decrypts every entry on
the host using `python3-cryptography`. See the source for the full data-flow
explanation and the format quirks (Tink output prefix layout, AES-SIV vs
AES-GCM AAD bindings, flutter_secure_storage's 8-byte BE length preamble).

Install:
```bash
pkg install python python-cryptography
ln -sf ~/git/termux-tools/scripts/android-secure-prefs-dump $PREFIX/bin/
```

The bundled DEX rebuilds from `~/git/x2d/runtime/handy_extract/keystore_dumper/`
via `./build.sh` (needs `$ANDROID_HOME/platforms/android-34/android.jar` and
`build-tools/34.0.0*/d8`).

### Git History Recover (`scripts/git-history-recover.ts`)

Recovers overwritten / force-pushed / dangling commits from a GitHub repo (public,
or private with a token). A normal clone only returns commits reachable from the
live refs; history that was force-pushed away (rebase, `filter-repo`, squash,
"clean up history") is orphaned and invisible. This reconstructs it and reports the
oldest overwritten commit plus the full force-push timeline — and can scan the
whole recovered history for secrets.

```bash
git-history-recover <owner/repo | github-url>            # analyze (read-only report)
git-history-recover <owner/repo> --recover               # also write ./<repo>-recovered
git-history-recover <owner/repo> --recover --dir PATH    # choose output dir
git-history-recover <owner/repo> --no-forks              # events + fetch-by-SHA only (faster)
git-history-recover <owner/repo> --json                  # machine-readable output
```

Three independent recovery sources, none needing admin on the repo:
1. **Events API** — retains the full PushEvent timeline (`before`/`head` SHAs) for
   ~90 days / 300 events; the authoritative force-push record.
2. **Fork network** — forks share GitHub's object store, so forks created before a
   rewrite still point at the pre-rewrite tips.
3. **Fetch-by-SHA** — GitHub honours `git fetch origin <sha>` for any object still
   in the network repo, recovering commits that were force-pushed away and never
   forked.

`--recover` materialises a browsable repo with a `refs/recovered/NN-<sha>` ref on
every orphaned leaf (so `git log --all` shows the complete reconstructed DAG).
Coverage is reported honestly: if the events window doesn't reach repo creation it
says so, and any SHA referenced but no longer fetchable is listed as unrecoverable.

**Secret scanning (`--secrets`)** — scans *every blob across the entire recovered
history* (current tree + overwritten/dangling commits, and inside zip archives)
for committed secrets. Use it to confirm a private repo is clean — anywhere in its
history — **before** making it public (a history rewrite doesn't help once pushed;
secrets stay recoverable exactly as this tool demonstrates).

```bash
git-history-recover myorg/private-repo --secrets               # scan all history, masked report
git-history-recover myorg/private-repo --secrets --show-secrets # reveal matched values
git-history-recover myorg/private-repo --secrets --fail-on high # exit 2 only on high-confidence
git-history-recover myorg/private-repo --secrets --no-archives  # skip zip extraction
```

Detects: provider-prefixed keys/tokens (AWS, GitHub, Google, Slack, Stripe,
Anthropic, OpenAI/`sk-`, Google OAuth), PEM private keys, JWTs, key-like
assignments (`*_KEY = "…"`, placeholders filtered out), **Solana keypairs** as
both 32/64-byte JSON numeric arrays and 64-byte base58 secret keys (base58-decoded
to confirm length), and **BIP39 mnemonics** (12/15/18/21/24 words; checksum-valid
phrases are HIGH, wordlist runs that fail checksum are MEDIUM). Findings are
grouped by confidence, marked `current` vs `history-only`, masked by default, and
`--fail-on` makes the exit code gate a pre-publish check (default: fail on medium+).

```bash
ln -sf ~/git/termux-tools/scripts/git-history-recover.ts ~/.local/bin/git-history-recover
```

Requires `git` + `bun`; optional `unzip` (archive scanning) and the sibling
`bip39-english.txt` (mnemonic checksum validation). Uses a token from `--token`,
`$GH_TOKEN`/`$GITHUB_TOKEN`, or `gh auth token` (raises API rate limits and enables
private-repo access; the token is stripped from the recovered repo's `origin`).

### GitHub Secret Pipeline (`scripts/gh-secret-pipeline.ts`)

One repeatable command that runs the whole audit over an entire org/user (or a
single repo) and **keeps a ledger of what it has scanned** — driving
`git-history-recover` per repo, discovering deleted/renamed repos via the GH
Archive event firehose, and scanning surviving copies (GitHub forks + npm
tarballs). Symlinked as `gh-secret-pipeline` and `ghsp`.

```bash
ghsp <org | user | owner/repo>            # full pipeline; re-runs SKIP unchanged repos
ghsp myorg --force                        # rescan everything
ghsp myorg --mask                         # mask secrets in the printed report
ghsp myorg --no-deleted                   # skip GH-Archive deleted-repo discovery
```

- **Per repo:** full history scan (incl. fork-recovered dangling commits) for
  originals/small forks; **delta** scan (owner's commits ahead of upstream, via
  the compare API) for large forks — so upstream fixtures don't create noise.
- **Solana keypairs + secrets** are extracted, triaged (real vs vendored), and
  shown unmasked by default. Full values are **always appended** (NDJSON,
  append-only) to `~/.local/share/gh-secret-pipeline/secrets.ndjson`.
- **Ledger** at `~/.local/share/gh-secret-pipeline/ledger.json` records every
  repo's `pushed_at`, findings, keypair pubkeys, deleted-repo results, and run
  history; unchanged repos are skipped on re-run.
- **Hang-proof:** all git network ops run with `GIT_TERMINAL_PROMPT=0` + timeouts;
  a failed GH-Archive query is reported as "unavailable", never as a false "clean".

```bash
ln -sf ~/git/termux-tools/scripts/gh-secret-pipeline.ts ~/.local/bin/gh-secret-pipeline
ln -sf ~/git/termux-tools/scripts/gh-secret-pipeline.ts ~/.local/bin/ghsp
```

### F-Droid metadata tooling (`scripts/fdroid-proot.sh`)

Runs `fdroidserver` from the Ubuntu proot container, so F-Droid recipe checks
work on-device without a Termux Python build. Symlinked as `fdroid`.

```bash
cd ~/git/fdroiddata-fork
fdroid lint app.embeddy          # metadata correctness
fdroid readmeta                  # parses against the schema
fdroid rewritemeta app.embeddy   # canonical form (CI enforces this)
fdroid checkupdates --allow-dirty app.embeddy   # validates UpdateCheckData live
```

- **Why the container:** fdroidserver pulls Pillow, cryptography (via paramiko),
  lxml and androguard. Termux has no wheels for those and would build every one
  from sdist; Ubuntu 24.04 aarch64 has manylinux wheels for all of them.
- **No copying, no `--bind`:** proot-distro binds `/data/data/com.termux` by
  default, so the container sees Termux `$HOME` at the same absolute path —
  `fdroid lint` reads the very files you edit here.
- **`ANDROID_HOME` is deliberately not forwarded.** These are the metadata
  commands; they need no SDK, so `~/android-sdk`, `~/.gradle` and `~/.android`
  are never touched.
- **`fdroid build` is not the goal here.** Reproducible-build verification only
  means anything on amd64: F-Droid's `fdroid build` job runs on
  `saas-linux-medium-amd64` in `fdroidserver:buildserver-bookworm`, against a
  release GitHub Actions also built on amd64. Building on this aarch64 device
  uses a different aapt2, so its APKs cannot byte-match. Push a branch to your
  fdroiddata fork to get the real check.

```bash
proot-distro login ubuntu -- /bin/bash -lc \
  "python3 -m venv /opt/fdroidserver && /opt/fdroidserver/bin/pip install fdroidserver"
ln -sf ~/git/termux-tools/scripts/fdroid-proot.sh ~/.local/bin/fdroid
```

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
| [CLAUDE_CODE_TERMUX_SETUP.md](docs/CLAUDE_CODE_TERMUX_SETUP.md) | Brand-new Termux → working, patched, self-updating Claude Code (glibc runtime, `ccx` channels, DNS patch) |
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
