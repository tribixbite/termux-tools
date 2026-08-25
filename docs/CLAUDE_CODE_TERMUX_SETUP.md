# Claude Code on a brand-new Termux instance — start to finish

Takes a freshly installed Termux to a working, patched, self-updating Claude Code.

Claude Code ships as a **bun-compiled glibc binary** (since 2.1.123). Android uses bionic
libc, and Termux has no `/etc`, so three things must be solved in order:

| Layer | Problem | Solution |
|---|---|---|
| glibc | the binary's ELF interpreter doesn't exist on bionic | `bun-on-termux` userland-exec wrapper |
| install | `npm i -g @anthropic-ai/claude-code` installs a platform-native binary that won't run here, and self-updates over whatever you patched | `ccx` pins + patches a specific binary, `DISABLE_AUTOUPDATER=1` |
| DNS | OAuth login/token-refresh read the absent `/etc/resolv.conf` → `getaddrinfo ETIMEOUT` | byte-preserving patch → `/sdcard/dns.conf` |

Skipping the DNS patch is the difference between "logs in once and stays logged in" and
"`Login failed: getaddrinfo ETIMEOUT platform.claude.com`, re-auth every few hours."

**End state:** `claude` and `claude-next` on PATH, both patched, updated with `ccx update`.

---

## 0. Prerequisites

- **ARM64 (aarch64)** Android device.
- **Termux with `pacman`** — from [termux-pacman](https://github.com/termux-pacman/termux-packages),
  *not* the Play Store build. The glibc runtime (`glibc-runner`) lives in the `gpkg`
  repository, which is a pacman repo; `bun-on-termux` documents termux-pacman as a hard
  prerequisite. Check with `command -v pacman`.
  (An existing dual apt/pacman box: `termux-setup-package-manager` selects the active one.)
- ~1.5 GB free: each Claude binary is ~260 MB and `ccx` keeps a `.bak-prepatch` backup
  plus, by default, two versions.

Everything below is copy-pasteable in order.

---

## 1. Base packages and storage permission

```bash
pkg update
pkg install git clang nodejs unzip curl ripgrep

termux-setup-storage        # tap "Allow" — REQUIRED
```

`termux-setup-storage` is not optional: the DNS patch points the resolver at
`/sdcard/dns.conf`, and Termux cannot write `/sdcard` until storage permission is
granted. Verify:

```bash
touch /sdcard/.probe && rm /sdcard/.probe && echo "sdcard writable"
```

If that fails, no login will work later. Fix it before continuing.

---

## 2. glibc runtime

```bash
pacman -S glibc-runner        # pulls glibc + headers
ls $PREFIX/glibc/include > /dev/null && echo "glibc headers present"
```

Headers are needed because the shim is compiled against glibc, not bionic.

---

## 3. bun-on-termux (the glibc launcher)

```bash
mkdir -p ~/git && cd ~/git
git clone https://github.com/tribixbite/bun-on-termux.git
cd bun-on-termux
make install
chmod +x setup.sh && ./setup.sh
```

Add to PATH (the setup script usually does this; make it explicit):

```bash
echo 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

> **PATH order matters.** `~/.local/bin` must come **before** `~/.bun/bin` — `ccx` puts
> its launchers in `~/.local/bin` and warns if a stale `~/.bun/bin/claude` would shadow them.

Verify:

```bash
bun --version        # -> 1.3.x
```

If this prints `2.1.x (Claude Code)` instead, see *Troubleshooting → bun runs Claude Code*.

This installs three pieces `ccx` depends on: `~/.bun/bin/bun-termux` (C userland-exec
wrapper), `~/.bun/lib/bun-shim.so` (LD_PRELOAD shim), and `~/.bun/bin/buno` (real bun).

---

## 4. Install `ccx` (the channel manager + patcher)

`claude-channel` is **not published to npm** — build it from this repo.

```bash
cd ~/git
git clone https://github.com/tribixbite/termux-tools.git
cd termux-tools/claude-channel

bun install
bun run build.ts             # -> dist/cli.js

mkdir -p ~/.local/bin
cat > ~/.local/bin/ccx <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Local launcher for the claude-channel CLI
# (rebuild with: cd ~/git/termux-tools/claude-channel && bun run build.ts)
exec node "$HOME/git/termux-tools/claude-channel/dist/cli.js" "$@"
EOF
chmod +x ~/.local/bin/ccx

ccx --help 2>/dev/null || ccx help
```

`ccx` itself runs under Termux's **bionic node**, not bun — only the Claude binary needs
the glibc path.

---

## 5. Install Claude Code

```bash
ccx update      # fetch latest release + verify sha256 + patch  (~1-2 min, ~260 MB)
ccx promote     # point `claude` at it (archives the previous stable)
```

`ccx update` fetches from `https://downloads.claude.ai/claude-code-releases` (the same
channel Claude Code self-updates from — **not** npm, which lags), verifies the manifest
sha256, applies the patches, and refuses to keep a binary whose `--version` doesn't match.

Use `--channel stable` for the conservative channel, or `--pin X.Y.Z` for an exact version.

---

## 6. Verify before logging in

```bash
ccx status
claude --version

BIN=$(node -e 'console.log(require(process.env.HOME+"/.claude/binaries/channel-state.json").stable.binary)')
# `rg --count-matches` prints nothing and exits 1 on zero matches, hence the `|| echo 0`
echo "dns redirect : $(rg -a --count-matches -F '/sdcard/dns.conf' "$BIN" || echo 0)   (want 1)"
echo "old resolv   : $(rg -a --count-matches -F '/etc/resolv.conf' "$BIN" || echo 0)   (want 0)"
echo "size         : $(wc -c < "$BIN") vs $(wc -c < "$BIN.bak-prepatch")  (must match)"
cat /sdcard/dns.conf
```

Expected:

```
next:    2.1.220
stable:  2.1.220   (/data/data/com.termux/files/home/.local/bin/claude)
channel: latest=2.1.245 stable=2.1.231
update:  up to date
2.1.220 (Claude Code)
dns redirect : 1   (want 1)
old resolv   : 0   (want 0)
size         : 271825824 vs 271825824  (must match)
nameserver 8.8.8.8
nameserver 8.8.4.4
options timeout:2 attempts:2
```

Two invariants worth understanding:

- **`claude --version` must report `2.1.x`, never `1.3.x`.** `1.3.x` is the *bun runtime*
  version leaking through — it means the embedded bun-vfs blob is corrupted (a
  length-changing edit shifted its internal byte offsets).
- **Patched size == backup size.** All patches are byte-preserving by construction.

---

## 7. Log in

```bash
claude
# then: /login  -> opens the OAuth flow
```

This is the step that fails on an unpatched install. With the patch, the resolver has
nameservers and both login *and* the silent ~8-hour token refresh work.

---

## Ongoing use

```bash
ccx update && ccx promote     # routine update
ccx status                    # what's installed vs. what's released
ccx list                      # installed versions + rollback archive
ccx rollback                  # restore the previous stable (re-fetches if pruned)
ccx prune --keep 2            # reclaim disk (~260 MB per version)
ccx schedule --every 24       # opt-in crontab auto-update (fetches into `next` only)
```

Every `ccx update` re-applies the patches to the newly downloaded binary — patching is
part of install, never a manual follow-up step.

**Never** run `npm i -g @anthropic-ai/claude-code` or let the built-in updater run. The
launchers export `DISABLE_AUTOUPDATER=1` precisely because Claude Code self-updates by
overwriting its own executable, which would silently replace your patched binary with one
that can't resolve DNS (and, on some versions, can't run on bionic at all).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Login failed: getaddrinfo ETIMEOUT platform.claude.com` | DNS patch missing/reverted, or `/sdcard/dns.conf` absent | re-run `ccx update`; confirm §6 counts; confirm `termux-setup-storage` was granted |
| Re-auth every few hours/days | same root cause — the silent token refresh is failing, not the login | as above |
| `claude --version` prints `1.3.10` | bun-vfs blob corrupted by a length-changing edit | `ccx rollback`, or re-`ccx update` (never hand-edit the binary with a size change) |
| `bun --version` prints `2.1.x (Claude Code)` | a running bun single-file executable exports `BUN_BINARY_PATH` into child shells | update `bun-on-termux` (its `bun` wrapper unsets it), or `env -u BUN_BINARY_PATH bun …` |
| SIGSEGV in running claude/bun right after an update | a live mmap'd file was replaced with `cp` (truncates the same inode) | restart the session; replace mapped files with atomic `mv`, never `cp` |
| `ccx status` warns about PATH | `~/.bun/bin` precedes `~/.local/bin` | fix the `export PATH` line from §3, `ccx alias` prints it |
| Works on wifi, dead on a plane / captive portal | `8.8.8.8` is blocked until you clear the portal | open the portal in a browser; check `curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/api/hello` → `200` |
| `pacman -S glibc-runner` fails | `gpkg` mirror issue (403 on the db, not DNS) | retry; the DE mirror `ftp.agdsn.de` in `$PREFIX/etc/pacman.d/serverlist` is tried first |

---

## Appendix: what the patch actually changes

`claude-channel/src/patch.ts` applies **byte-preserving** edits only — the bun-compiled
binary embeds its JS in a bun-vfs blob keyed by internal byte offsets, so any length
change corrupts it. Same-length overwrites are safe (the blob is not checksummed).

| Target | Edit | Why | Opt out |
|---|---|---|---|
| `/etc/resolv.conf` | → `/sdcard/dns.conf` (both exactly 16 bytes) | bun's bundled **c-ares** — the resolver behind OAuth login and token refresh — reads the *absolute* `/etc/resolv.conf` via a **raw `openat` syscall**. Termux `/etc` → Android's read-only `/system/etc`, which has no `resolv.conf`, so c-ares gets **zero nameservers**. Normal inference is unaffected (it resolves through glibc's getaddrinfo → `$PREFIX/glibc/etc/resolv.conf`), which is why an unpatched install *appears* to work until the token expires. | `CCPATCH_KEEP_RESOLV=1` |
| `NEVER commit changes unless the user explicitly asks you to.` | blanked with spaces | CLAUDE.md alignment | `CCPATCH_KEEP_NO_COMMIT=1` |
| `Default to writing no comments.` | blanked with spaces | CLAUDE.md alignment | `CCPATCH_KEEP_NO_COMMENTS=1` |

A one-time `<binary>.bak-prepatch` backup is kept next to every binary, and the patched
binary is installed with an atomic rename so running processes keep their old inode.

Notes on the DNS fix specifically:

- **LD_PRELOAD cannot fix this.** c-ares issues a raw syscall, which bypasses the shim's
  hooked libc `openat`. Confirm the distinction yourself with
  `strace -f -e trace=openat <cmd>`.
- **`proot -b $PREFIX/etc/resolv.conf:/etc/resolv.conf <cmd>` also works** (ptrace-level
  redirect) and needs no patch — but it ptraces the whole process tree, taxing every
  spawned MCP server and shell, and nesting breaks when a wrapped session spawns another
  wrapped session (tmux/operad orchestration). The byte-patch has zero runtime cost and is
  transparent to child processes, which is why it's the default.
- The two prompt-string blanks are **vestigial for the rendered system prompt** on current
  versions — those strings now live in the Bash tool description and coding-standards
  array, not the top-level system blocks. Kept because they still neutralize the
  directives in tool/subagent paths and cost nothing.

The same resolver fix applies to other bun/native CLIs with the same bug — see
`scripts/patch-codex-termux-dns.sh`, which reuses this patcher for the Codex CLI.
