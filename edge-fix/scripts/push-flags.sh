#!/data/data/com.termux/files/usr/bin/bash
# push-flags.sh — Push Chromium command-line flags to device
# Requires BuildInfo.isDebugAndroid() smali patch (or android:debuggable=true)
#
# Usage: ./push-flags.sh [adb-serial]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
FLAGS_FILE="$CONFIG_DIR/command-line-flags.list"
PKG="com.microsoft.emmx.canary"
DEST="/data/local/tmp/${PKG}-command-line"

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
FLAGS="_ "
while IFS= read -r line; do
    line="${line%%#*}"      # strip inline comments
    line="${line// /}"      # trim
    [ -z "$line" ] && continue
    FLAGS+="$line "
done < "$FLAGS_FILE"

echo "Pushing flags: $FLAGS"
echo "$FLAGS" | adb "${ADB_ARGS[@]}" shell "cat > $DEST"
echo "Written to $DEST"
echo ""
echo "Restart Edge for flags to take effect:"
echo "  adb ${ADB_ARGS[*]} shell am force-stop $PKG"
