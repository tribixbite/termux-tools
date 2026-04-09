#!/data/data/com.termux/files/usr/bin/bash
# push-flags.sh — Push Chromium command-line flags to Edge Canary on Android
#
# Chromium reads flags from /data/local/tmp/chrome-command-line when:
#   1. android:debuggable=true, OR
#   2. Settings.Global.adb_enabled=1 AND Settings.Global.debug_app=<package>
#
# This script sets up option 2 (no APK rebuild needed) and writes the flags file.
#
# Usage: ./push-flags.sh [adb-serial]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
FLAGS_FILE="$CONFIG_DIR/command-line-flags.list"
PKG="com.microsoft.emmx.canary"
# Chromium hardcodes "chrome-command-line" regardless of package name
DEST="/data/local/tmp/chrome-command-line"

if [ ! -f "$FLAGS_FILE" ]; then
    echo "ERROR: flags file not found: $FLAGS_FILE"
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

# Read flags, skip comments/blanks, join into single line
# First token must be "_" (Chromium convention — argv[0] placeholder)
FLAGS="_ "
while IFS= read -r line; do
    line="${line%%#*}"      # strip inline comments
    line="${line// /}"      # trim whitespace
    [ -z "$line" ] && continue
    FLAGS+="$line "
done < "$FLAGS_FILE"

echo "Pushing flags: $FLAGS"
echo "$FLAGS" | adb "${ADB_ARGS[@]}" shell "cat > $DEST"
echo "Written to $DEST"

# Enable flag reading via ADB debug_app setting (no debuggable needed)
# Chromium checks: adb_enabled=1 AND debug_app=<package_name>
echo ""
echo "Setting debug_app=$PKG for flag reading..."
adb "${ADB_ARGS[@]}" shell settings put global debug_app "$PKG"
echo "Done. Current debug_app: $(adb "${ADB_ARGS[@]}" shell settings get global debug_app)"

echo ""
echo "Restart Edge for flags to take effect:"
echo "  adb ${ADB_ARGS[*]} shell am force-stop $PKG"
