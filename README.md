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
