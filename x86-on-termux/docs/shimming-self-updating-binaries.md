---
name: shimming-self-updating-binaries
description: Use when wrapping a binary that overwrites itself (or a sibling binary) on update — launcher binaries, CLIs with self-update subcommands, tools that fetch their real executable on first run. Covers the detect-and-repair wrapper pattern so the shim survives updates.
---

# Shimming Self-Updating Binaries

## Problem

You've wrapped a binary with a shell shim — e.g. to route it through `qemu-x86_64`, `nix-shell`, `firejail`, `env FOO=bar`, or a compatibility layer. Then the user runs an update command (`tool update`, `tool self-upgrade`), or a launcher re-runs itself on version mismatch, and your shim gets overwritten with a fresh copy of the real binary. Next invocation breaks.

This pattern keeps the shim working across arbitrary update cycles without hooking into the tool's own update mechanism.

## Core idea

1. Keep the real binary at a sibling path (`<name>.real`).
2. The shim at `<name>` delegates to `<name>.real`.
3. Provide a single entry point at `$PREFIX/bin/<name>` (or `~/bin/<name>`) that **detects** whether `<name>` is still a shim or has been overwritten with an ELF, and **repairs** it if so before exec'ing.

```
$PREFIX/bin/<name>             ← stable entry point, repairs as needed
  └─► ~/.tool/bin/<name>       ← shim (may get overwritten by update)
        └─► ~/.tool/bin/<name>.real   ← real binary
```

## Detect + repair wrapper

```bash
#!/data/data/com.termux/files/usr/bin/bash
# Stable entry point for <name>. Detects update overwrites and repairs.

set -e

CLI_DIR="$HOME/.tool/bin"
CLI="$CLI_DIR/<name>"
REAL="$CLI_DIR/<name>.real"

# Repair: if $CLI is a fresh ELF (update replaced our shim), move it aside
# and reinstall the shim. Detection: shebang "#!" vs ELF magic "\x7fELF".
if [[ -f "$CLI" ]] && [[ "$(head -c 2 "$CLI" 2>/dev/null)" != "#!" ]]; then
  mv -f "$CLI" "$REAL"
  cat > "$CLI" <<'SHIM'
#!/data/data/com.termux/files/usr/bin/bash
# --- Wrapper body (e.g. qemu-x86_64 invocation) ---
exec env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD \
  -L "$PREFIX/opt/x86_64-sysroot" \
  "$HOME/.tool/bin/<name>.real" "$@"
SHIM
  chmod +x "$CLI"
fi

exec "$CLI" "$@"
```

Key moves:

- **Two-byte check** (`head -c 2 == "#!"`) distinguishes a shell shim from an ELF without needing `file` or external tools. Works on any Unix.
- **Heredoc with single-quoted `'SHIM'`** keeps `$` expansions literal — the shim evaluates them at its own runtime, not when the wrapper writes it. This is the one most-common mistake.
- **`mv -f`** handles the case where `<name>.real` already exists from a previous repair cycle.
- **`exec`** at the end replaces the wrapper process, keeping the process tree clean.

## When the shim body is non-trivial

If the shim content is more than ~20 lines, keep it in a template file instead of an inlined heredoc:

```bash
SHIM_TEMPLATE="$PREFIX/share/<name>/shim.template"
cp "$SHIM_TEMPLATE" "$CLI" && chmod +x "$CLI"
```

The template is shipped alongside the package install; the wrapper only copies it. This avoids the heredoc-quoting trap entirely.

## Update path considerations

Different tools overwrite different things. Map before wrapping:

| Tool behavior | What gets overwritten | Repair target |
|---|---|---|
| `tool update` writes new binary in place | `<name>` (our shim) | Reinstall shim, move new binary to `<name>.real` |
| Launcher re-fetches real tool into `<real-path>` on version bump | `<name>.real` | Nothing — shim untouched |
| Launcher checks a `.version` file and re-downloads only on bump | `<name>.real` | Nothing |
| Tool installs a second binary (`<name>-helper`) | Separate sibling | Repeat pattern for helper |

Only the first case needs the repair loop. If your tool matches the second/third case, you can skip this pattern and just wrap once.

## Preserving update metadata

Some tools embed a version string in the binary and read it back from `/proc/self/exe`. The shim should preserve the path the real binary sees:

- With `exec <real> "$@"` the child's `argv[0]` is the real binary's path — usually fine.
- If the tool uses `env::current_exe()` (Rust) or `readlink("/proc/self/exe")`, it sees the real path. No action needed.
- If the tool insists on `argv[0]` being the shim name, pass `--argv0` (when using ld.so directly) or `exec -a <name>`.

## Detection alternatives (when `#!` check isn't enough)

```bash
# Size-based (robust if shim is small and real binary is large)
shim_size=$(stat -c%s "$CLI" 2>/dev/null || echo 0)
if (( shim_size > 10000 )); then repair; fi

# Magic-bytes (more explicit)
if head -c 4 "$CLI" 2>/dev/null | cmp -s - <(printf '\x7fELF'); then repair; fi

# file(1) based (requires `file` to be installed)
if file -b "$CLI" | grep -q '^ELF'; then repair; fi
```

The `#!` check wins on portability. Use it unless the shim itself is not a shell script.

## Idempotency

The repair block must be safe to run on every invocation — tens of thousands of runs should produce identical state. Test:

```bash
# Simulate an update overwriting the shim with the real ELF, then run the wrapper
cp ~/.tool/bin/<name>.real ~/.tool/bin/<name>
$PREFIX/bin/<name> --version          # should repair + succeed
$PREFIX/bin/<name> --version          # second run, no repair, still succeeds
diff -q ~/.tool/bin/<name> <(...expected shim content...)   # shim reinstalled correctly
```

If the second invocation triggers a repair, the detection check is broken.

## Gotchas

- **Heredoc variable expansion**: always single-quote the heredoc delimiter (`<<'SHIM'`). Without quoting, `$PREFIX` and `$HOME` get expanded when the wrapper writes the file, baking in one specific user's paths.
- **`set -e` in the wrapper**: fine for the wrapper but do not put `set -e` inside the generated shim unless you want the shim to abort on every harmless non-zero from the real binary.
- **Race with concurrent invocations**: if two `<name>` calls race during repair, both may try to `mv` the ELF. Harmless in practice (`mv -f` is atomic on the same filesystem), but if you're paranoid, wrap the repair block in `flock $CLI_DIR/.repair-lock ...`.
- **Deleted `<name>.real`**: if the user manually removes `<name>.real`, the shim exec's a missing file. Wrapper should check `-x "$REAL"` before exec'ing the shim, and fall back to re-downloading or erroring loudly.
- **Symlinks vs copies**: do not implement the shim as a symlink — the update will follow the symlink and overwrite the real binary. Always use a separate `<name>.real` file.

## Real-world verified case

`$PREFIX/bin/android` on this device: wraps Google's Android CLI (x86_64) via qemu-user. The CLI has an `update` subcommand that replaces `~/.android/bin/android-cli` with a fresh x86_64 ELF; the wrapper detects this by `#!` check and reinstalls the shim automatically.
