#!/data/data/com.termux/files/usr/bin/bash
# setup-cfc-device.sh — provision a device with the slimmed dark-mode 154 Edge +
# the CFC (Claude-in-Chrome) extension, command-line flags, and CDP debugging.
#
# Run AFTER build.sh has produced output/signed/{base,split_*}.apk.
#
# Installs the SPLIT bundle (NOT the merged APK — the APKEditor merge breaks the
# dark theme, see build.sh Step 6 warning), pushes the unpacked CFC extension,
# writes the Chromium command-line flags (max 3D RAM + telemetry DNS blocking +
# --load-extension), and enables flag reading via the debug_app setting.
#
# Usage: ./setup-cfc-device.sh <adb-serial>
#        ./setup-cfc-device.sh              # single connected device
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG="com.microsoft.emmx.canary"
EXT_SRC="$REPO_ROOT/edge-claude-ext"
FLAGS_LIST="$SCRIPT_DIR/config/command-line-flags.list"
SIGNED="$SCRIPT_DIR/output/signed"

SERIAL="${1:-}"
if [ -z "$SERIAL" ]; then
  SERIAL=$(adb devices | awk '/\tdevice$/{print $1}' | head -1)
fi
[ -z "$SERIAL" ] && { echo "ERROR: no adb device. Pass a serial."; exit 1; }
A=(adb -s "$SERIAL")
echo "== Target: $SERIAL ($("${A[@]}" shell getprop ro.product.model | tr -d '\r'), API $("${A[@]}" shell getprop ro.build.version.sdk | tr -d '\r')) =="

for f in base.apk split_chrome.apk split_config.en.apk split_on_demand.apk; do
  [ -f "$SIGNED/$f" ] || { echo "ERROR: missing $SIGNED/$f — run build.sh first"; exit 1; }
done

# 1. Install the SPLIT bundle (in-place if already our-signed; keeps data).
echo "-- installing split bundle (dark theme depends on splits, not merged) --"
"${A[@]}" install-multiple -r \
  "$SIGNED/base.apk" "$SIGNED/split_chrome.apk" \
  "$SIGNED/split_config.en.apk" "$SIGNED/split_on_demand.apk"

# 2. Push the unpacked CFC extension to /data/local/tmp/cfc-ext.
echo "-- pushing CFC extension --"
"${A[@]}" shell 'rm -rf /data/local/tmp/cfc-ext && mkdir -p /data/local/tmp/cfc-ext'
"${A[@]}" push "$EXT_SRC/." /data/local/tmp/cfc-ext/ >/dev/null

# 3. Write the command-line flags. host-resolver-rules contains spaces, so build
#    the file locally (the space-stripping in push-flags.sh would corrupt it).
echo "-- writing command-line flags --"
FLAGS_FILE="$(mktemp "${TMPDIR:-$PREFIX/tmp}/ccl.XXXXXX")"
python3 - "$FLAGS_LIST" > "$FLAGS_FILE" <<'PY'
import sys, re
out = ["_"]
buf = ""
for raw in open(sys.argv[1]):
    line = raw.split("#", 1)[0].rstrip()
    if not line.strip():
        continue
    out.append(line.strip())
sys.stdout.write(" ".join(out))
PY
"${A[@]}" push "$FLAGS_FILE" /data/local/tmp/chrome-command-line >/dev/null
rm -f "$FLAGS_FILE"

# 4. Enable flag reading (the build is android:debuggable=true, but set debug_app
#    too as belt-and-suspenders; debug_app also enables it on non-debuggable builds).
"${A[@]}" shell settings put global debug_app "$PKG" >/dev/null

# 5. Restart Edge and report.
"${A[@]}" shell am force-stop "$PKG" || true
sleep 1
"${A[@]}" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 4
PROCS=$("${A[@]}" shell 'ps -A -o NAME 2>/dev/null | grep -c emmx.canary' | tr -d '\r')
echo "== Done. Edge processes: $PROCS =="
echo "   Version: $("${A[@]}" shell dumpsys package $PKG 2>/dev/null | sed -n 's/.*versionName=//p' | head -1 | tr -d '\r')"
echo "   Verify dark theme (Settings > Appearance = Dark) and, for CFC, that a"
echo "   claude-chrome-bridge is running on THIS device's localhost:18963."
