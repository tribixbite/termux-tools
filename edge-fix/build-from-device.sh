#!/data/data/com.termux/files/usr/bin/bash
# build-from-device.sh — Build a privacy-patched Edge Canary from the copy
# ALREADY INSTALLED on your device. No APKMirror download or AppManager export
# needed: this pulls the installed split APKs over ADB, bundles them, and runs
# the standard build.sh pipeline.
#
# The output is signed with edge-fix.keystore. If your installed Edge was
# already signed with this same keystore, you can update it IN PLACE with
# `adb install ... -r` (or pass --install below) WITHOUT wiping your Edge data
# (bookmarks, logins, settings). The first switch from the Play Store build
# can't avoid a data wipe — its signature differs from ours.
#
# Usage:
#   ./build-from-device.sh                 # build only (auto-pick device)
#   ./build-from-device.sh -s <serial>     # target a specific adb device
#   ./build-from-device.sh --install       # build, then no-wipe update via adb
#   ADB_SERIAL=1.2.3.4:5555 ./build-from-device.sh
#
# Env: PKG overrides the package (default com.microsoft.emmx.canary).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="${PKG:-com.microsoft.emmx.canary}"
DO_INSTALL=0
SERIAL="${ADB_SERIAL:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        -s) SERIAL="$2"; shift 2 ;;
        --install) DO_INSTALL=1; shift ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

command -v adb >/dev/null || { echo "ERROR: adb not found in PATH" >&2; exit 1; }

# ─── Resolve a single online ADB device ───
if [ -z "$SERIAL" ]; then
    mapfile -t ONLINE < <(adb devices | awk '/\tdevice$/{print $1}')
    if [ "${#ONLINE[@]}" -eq 0 ]; then
        echo "ERROR: no online ADB device. Run 'adb devices' to check." >&2
        exit 1
    elif [ "${#ONLINE[@]}" -gt 1 ]; then
        echo "ERROR: multiple devices online — pass one with -s <serial>:" >&2
        printf '  %s\n' "${ONLINE[@]}" >&2
        exit 1
    fi
    SERIAL="${ONLINE[0]}"
fi
ADB=(adb -s "$SERIAL")
echo "  Device: $SERIAL"

# ─── Verify the package is installed ───
PATHS="$("${ADB[@]}" shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed 's/^package://')"
if [ -z "$PATHS" ]; then
    echo "ERROR: $PKG is not installed on $SERIAL." >&2
    echo "  Install Edge Canary from the Play Store first, then re-run." >&2
    exit 1
fi

# Capture the dump first, then extract — piping dumpsys|grep -m1 directly would
# send SIGPIPE upstream when grep exits early, which `set -o pipefail` turns
# into a fatal exit 141.
DUMP="$("${ADB[@]}" shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r')"
VERSION="$(grep -m1 versionName <<<"$DUMP" | sed 's/.*versionName=//' | tr -d ' ')"
[ -z "$VERSION" ] && VERSION="unknown"
echo "  Installed version: $VERSION"

# ─── Pull the installed split APKs ───
PULL_DIR="$SCRIPT_DIR/work/from-device"
rm -rf "$PULL_DIR"
mkdir -p "$PULL_DIR"
echo "  Pulling $(echo "$PATHS" | wc -l) APKs from device..."
while IFS= read -r apk_path; do
    [ -z "$apk_path" ] && continue
    name="$(basename "$apk_path")"
    "${ADB[@]}" pull "$apk_path" "$PULL_DIR/$name" >/dev/null
    echo "    $name ($(ls -lh "$PULL_DIR/$name" | awk '{print $5}'))"
done <<< "$PATHS"

if [ ! -f "$PULL_DIR/base.apk" ]; then
    echo "ERROR: base.apk not found among pulled APKs." >&2
    exit 1
fi

# ─── Bundle into a .apks that build.sh understands ───
# build.sh reads version_name from info.json inside the bundle.
printf '{"version_name": "%s", "package_name": "%s"}\n' "$VERSION" "$PKG" \
    > "$PULL_DIR/info.json"
BUNDLE="$SCRIPT_DIR/work/Edge_Canary_${VERSION}-from-device.apks"
rm -f "$BUNDLE"
( cd "$PULL_DIR" && zip -q "$BUNDLE" base.apk split_*.apk info.json )
echo "  Bundle: $BUNDLE ($(ls -lh "$BUNDLE" | awk '{print $5}'))"
echo ""

# ─── Run the standard build pipeline ───
"$SCRIPT_DIR/build.sh" "$BUNDLE"

# ─── Optional in-place install (no data wipe) ───
if [ "$DO_INSTALL" -eq 1 ]; then
    echo ""
    echo "=== Installing (in-place, no data wipe) ==="
    MERGED="$SCRIPT_DIR/output/EdgeCanary-${VERSION}-privacy-merged.apk"
    BASE="$SCRIPT_DIR/output/EdgeCanary-${VERSION}-privacy.apk"
    if [ -f "$MERGED" ]; then
        echo "  adb install -r <merged>"
        "${ADB[@]}" install -r "$MERGED"
    else
        mapfile -t SPLITS < <(ls "$SCRIPT_DIR"/output/signed/split_*.apk 2>/dev/null)
        echo "  adb install-multiple -r <base + ${#SPLITS[@]} splits>"
        "${ADB[@]}" install-multiple -r "$BASE" "${SPLITS[@]}"
    fi
    echo "  [x] Updated $PKG on $SERIAL — Edge data preserved."
fi
