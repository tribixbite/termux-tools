#!/data/data/com.termux/files/usr/bin/bash
# push-extension.sh — Push CFC extension files to device for --load-extension
#
# Edge Android loads the extension from /data/local/tmp/cfc-ext/ via
# the --load-extension flag in chrome-command-line. This script pushes
# the latest extension source files to that directory.
#
# Usage: ./push-extension.sh [adb-serial]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/../../edge-claude-ext"
DEST="/data/local/tmp/cfc-ext"

if [ ! -d "$EXT_DIR" ]; then
    echo "ERROR: extension dir not found: $EXT_DIR"
    exit 1
fi

# Resolve ADB serial
ADB_ARGS=()
if [ -n "${1:-}" ]; then
    ADB_ARGS=(-s "$1")
else
    SERIAL=$(adb devices | grep -v offline | grep 'device$' | head -1 | cut -f1)
    if [ -n "$SERIAL" ]; then
        ADB_ARGS=(-s "$SERIAL")
    fi
fi

echo "Pushing extension to $DEST..."
adb "${ADB_ARGS[@]}" shell "mkdir -p $DEST" 2>/dev/null || true

# Push only the files Edge needs (skip markdown docs)
for f in manifest.json background.js content.js popup.html popup.js launcher.html launcher.js icon16.png icon48.png icon128.png; do
    if [ -f "$EXT_DIR/$f" ]; then
        adb "${ADB_ARGS[@]}" push "$EXT_DIR/$f" "$DEST/$f" 2>/dev/null
        echo "  [+] $f"
    fi
done

VERSION=$(node -e "console.log(require('$EXT_DIR/manifest.json').version)")
echo ""
echo "Pushed CFC extension v$VERSION to $DEST"
echo "Restart Edge for changes to take effect:"
echo "  adb ${ADB_ARGS[*]} shell am force-stop com.microsoft.emmx.canary"
