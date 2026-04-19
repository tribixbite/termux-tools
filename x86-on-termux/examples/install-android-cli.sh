#!/data/data/com.termux/files/usr/bin/bash
# Install Google's Android CLI (dl.google.com/android/cli/latest/linux_x86_64/android)
# on aarch64 Termux via qemu-user + x86_64 sysroot.
#
# End state:
#   $PREFIX/opt/x86_64-sysroot/       x86_64 glibc sysroot
#   ~/.android/bin/android-cli.real   real x86_64 binary
#   ~/.android/bin/android-cli        shell shim -> qemu-x86_64 android-cli.real
#   $PREFIX/bin/android               stable entry point, self-repairing wrapper
#
# Run:
#   bash install-android-cli.sh

set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO="$(cd "$HERE/.." && pwd)"
SYSROOT="$PREFIX/opt/x86_64-sysroot"
ANDROID_DIR="$HOME/.android/bin"
LAUNCHER_URL="https://dl.google.com/android/cli/latest/linux_x86_64/android"
DOWNLOAD="$HOME/Downloads/android-launcher"

log() { printf '\033[1;34m[install-android-cli]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Ensure sysroot exists
if [[ ! -x "$SYSROOT/lib64/ld-linux-x86-64.so.2" ]]; then
  log "sysroot missing - building it via install-sysroot.sh"
  bash "$REPO/install-sysroot.sh"
fi

# 2. Download the Google launcher
if [[ ! -s "$DOWNLOAD" ]]; then
  mkdir -p "$(dirname "$DOWNLOAD")"
  log "downloading Google Android CLI launcher"
  curl -fsSL -o "$DOWNLOAD" "$LAUNCHER_URL"
  chmod +x "$DOWNLOAD"
fi

# 3. First-run: let the launcher download android-cli into ~/.android/bin/
mkdir -p "$ANDROID_DIR"
if [[ ! -x "$ANDROID_DIR/android-cli.real" ]]; then
  log "first-run: invoking launcher to fetch android-cli"
  ANDROID_CLI_FRESH_INSTALL=1 \
    env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD -L "$SYSROOT" \
      "$DOWNLOAD" --help >/dev/null 2>&1 || true

  # After first-run, ~/.android/bin/android-cli is the real x86_64 ELF.
  if [[ -s "$ANDROID_DIR/android-cli" ]]; then
    mv -f "$ANDROID_DIR/android-cli" "$ANDROID_DIR/android-cli.real"
    chmod +x "$ANDROID_DIR/android-cli.real"
  else
    die "launcher did not fetch android-cli (network? check $DOWNLOAD manually)"
  fi
fi

# 4. Install the shim (executed by android-cli callers)
cat > "$ANDROID_DIR/android-cli" <<'SHIM'
#!/data/data/com.termux/files/usr/bin/bash
# qemu-x86_64 shim for android-cli on aarch64 Termux.
# Reinstalled automatically by $PREFIX/bin/android if overwritten by `android update`.
exec env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD \
  -L "$PREFIX/opt/x86_64-sysroot" \
  "$HOME/.android/bin/android-cli.real" "$@"
SHIM
chmod +x "$ANDROID_DIR/android-cli"

# 5. Install the stable entry point at $PREFIX/bin/android with self-repair
cat > "$PREFIX/bin/android" <<'WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
# Entry point for Android CLI on Termux (aarch64).
# The real tool is an x86_64 ELF; we run it under qemu-user via a shim.
# `android update` (and friends) may overwrite the shim with a fresh x86_64
# binary - detect that and reinstall the shim before exec'ing.
# Pattern: see docs/shimming-self-updating-binaries.md in x86-on-termux.

set -e

CLI_DIR="$HOME/.android/bin"
CLI="$CLI_DIR/android-cli"
REAL="$CLI_DIR/android-cli.real"
SYSROOT="$PREFIX/opt/x86_64-sysroot"

if [[ ! -x "$SYSROOT/lib64/ld-linux-x86-64.so.2" ]]; then
  echo "android: x86_64 sysroot missing at $SYSROOT" >&2
  echo "         Run install-sysroot.sh from x86-on-termux" >&2
  exit 127
fi

# Detect update overwrite: if $CLI is not a shell shim (doesn't start with "#!"),
# it's been replaced by a fresh x86_64 ELF. Move it to $REAL and reinstall shim.
if [[ -f "$CLI" ]] && [[ "$(head -c 2 "$CLI" 2>/dev/null)" != "#!" ]]; then
  mv -f "$CLI" "$REAL"
  cat > "$CLI" <<'SHIM'
#!/data/data/com.termux/files/usr/bin/bash
exec env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD \
  -L "$PREFIX/opt/x86_64-sysroot" \
  "$HOME/.android/bin/android-cli.real" "$@"
SHIM
  chmod +x "$CLI"
fi

if [[ ! -x "$REAL" ]]; then
  echo "android: real binary missing at $REAL" >&2
  echo "         Rerun install-android-cli.sh or 'android update'" >&2
  exit 127
fi

exec "$CLI" "$@"
WRAPPER
chmod +x "$PREFIX/bin/android"

# 6. Smoke test
log "smoke-testing: android --version"
if ! version=$(android --version 2>&1 | tail -1); then
  die "android --version failed - check $PREFIX/bin/android and $ANDROID_DIR"
fi
log "installed: android $version"
log "try:       android --help"
