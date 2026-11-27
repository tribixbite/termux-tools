#!/data/data/com.termux/files/usr/bin/bash
# push-extension.sh — Push CFC extension files to device for --load-extension
#
# Edge Android loads the extension from /data/local/tmp/cfc-ext/ via
# the --load-extension flag in chrome-command-line. This script pushes
# the latest extension source files to that directory.
#
# The pushed manifest.json always carries a "key": it pins the unpacked copy to
# the signed CRX's extension id (defkpflanhkgnhdhdehfbmkhphboncdg), so it
# overrides the installed CRX instead of loading as a second extension. The key
# is kept from the manifest already on the device, or derived from
# edge-claude-ext.pem (repo root, git-ignored).
#
# Usage: ./push-extension.sh [adb-serial]
#   Serial order: argument, $BRIDGE_ADB_SERIAL, the attached device whose
#   boot_id matches this phone, the only attached device. Several devices and
#   no match is an error rather than a guess.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/../../edge-claude-ext"
PEM="$SCRIPT_DIR/../../edge-claude-ext.pem"
DEST="/data/local/tmp/cfc-ext"

if [ ! -d "$EXT_DIR" ]; then
    echo "ERROR: extension dir not found: $EXT_DIR"
    exit 1
fi

# Resolve ADB serial (see Usage)
resolve_serial() {
    if [ -n "${1:-}" ]; then echo "$1"; return; fi
    if [ -n "${BRIDGE_ADB_SERIAL:-}" ]; then echo "$BRIDGE_ADB_SERIAL"; return; fi
    local devices local_boot s
    devices=$(adb devices | awk 'NR > 1 && $2 == "device" {print $1}')
    local_boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || true)
    if [ -n "$local_boot" ]; then
        for s in $devices; do
            if [ "$(adb -s "$s" shell cat /proc/sys/kernel/random/boot_id 2>/dev/null | tr -d '\r')" = "$local_boot" ]; then
                echo "$s"; return
            fi
        done
    fi
    if [ "$(echo "$devices" | awk 'NF' | wc -l)" -eq 1 ]; then echo "$devices"; return; fi
    echo "ERROR: several adb devices and none is this phone; pass a serial or set BRIDGE_ADB_SERIAL:" >&2
    echo "$devices" >&2
    exit 1
}
SERIAL=$(resolve_serial "${1:-}")
ADB_ARGS=(-s "$SERIAL")
echo "Target device: $SERIAL"

echo "Pushing extension to $DEST..."
adb "${ADB_ARGS[@]}" shell "mkdir -p $DEST" 2>/dev/null || true

# Push only the files Edge needs (skip markdown docs)
for f in background.js content.js popup.html popup.js launcher.html launcher.js icon16.png icon48.png icon128.png; do
    if [ -f "$EXT_DIR/$f" ]; then
        adb "${ADB_ARGS[@]}" push "$EXT_DIR/$f" "$DEST/$f" >/dev/null
        echo "  [+] $f"
    fi
done

# manifest.json: repo copy plus the "key" (device copy first, else from the PEM).
WORK="$(mktemp -d "${TMPDIR:-$PREFIX/tmp}/push-ext.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
adb "${ADB_ARGS[@]}" pull "$DEST/manifest.json" "$WORK/device.json" >/dev/null 2>&1 || true
KEY=""
if [ -f "$WORK/device.json" ]; then
    KEY=$(node -e 'try { process.stdout.write(require(process.argv[1]).key || "") } catch {}' "$WORK/device.json")
fi
if [ -z "$KEY" ] && [ -f "$PEM" ]; then
    KEY=$(openssl rsa -in "$PEM" -pubout -outform DER 2>/dev/null | base64 -w0)
fi
if [ -z "$KEY" ]; then
    echo "ERROR: no manifest key on the device and no $PEM; refusing to push a keyless manifest" >&2
    exit 1
fi
node -e 'const m = require(process.argv[1]); m.key = process.argv[2]; process.stdout.write(JSON.stringify(m, null, 2) + "\n")' \
    "$(cd "$EXT_DIR" && pwd)/manifest.json" "$KEY" > "$WORK/manifest.json"
adb "${ADB_ARGS[@]}" push "$WORK/manifest.json" "$DEST/manifest.json" >/dev/null
echo "  [+] manifest.json (with key)"

VERSION=$(node -e "console.log(require('$EXT_DIR/manifest.json').version)")
echo ""
echo "Pushed CFC extension v$VERSION to $DEST"
echo "Restart Edge for changes to take effect:"
echo "  adb ${ADB_ARGS[*]} shell am force-stop com.microsoft.emmx.canary"
