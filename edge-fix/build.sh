#!/data/data/com.termux/files/usr/bin/bash
# build.sh - Master build script for Edge Canary privacy fix
# Extracts, decompiles, patches, and rebuilds the APK with all tracking removed
#
# Usage:
#   ./build.sh <edge-canary.apks>
#   ./build.sh  # uses default path from AppManager exports
#
# Requirements: apktool, zipalign, jarsigner, keytool, perl, python3

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$SCRIPT_DIR/work"
OUTPUT_DIR="$SCRIPT_DIR/output"

# Default .apks path
DEFAULT_APKS="$HOME/storage/shared/AppManager/apks/Edge Canary_146.0.3853.0.apks"
INPUT_APKS="${1:-$DEFAULT_APKS}"

if [ ! -f "$INPUT_APKS" ]; then
    echo "ERROR: Input .apks not found: $INPUT_APKS"
    echo ""
    echo "Usage: $0 <edge-canary.apks>"
    echo "       $0  # uses AppManager default export"
    exit 1
fi

echo "╔══════════════════════════════════════════════════════╗"
echo "║       Edge Canary Privacy Fix - Build Pipeline      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Input: $INPUT_APKS"
echo "  Size:  $(ls -lh "$INPUT_APKS" | awk '{print $5}')"
echo ""

# Check prerequisites
echo "=== Checking prerequisites ==="
for cmd in apktool zipalign jarsigner keytool perl python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: Required tool not found: $cmd"
        exit 1
    fi
done
echo "  All tools available"
echo ""

# Check disk space (need ~2GB free for decompile + rebuild)
FREE_KB=$(df -k "$HOME" | tail -1 | awk '{print $4}')
if [ "$FREE_KB" -lt 2097152 ]; then
    echo "WARNING: Low disk space ($(( FREE_KB / 1024 ))MB free, recommend 2GB+)"
    echo "  Proceeding anyway..."
fi

# ─── 1. Extract .apks bundle ───
echo "=== Step 1/6: Extracting .apks bundle ==="
EXTRACTED_DIR="$WORK_DIR/apks-extracted"
rm -rf "$EXTRACTED_DIR"
mkdir -p "$EXTRACTED_DIR"
unzip -o "$INPUT_APKS" -d "$EXTRACTED_DIR" > /dev/null
echo "  Extracted: $(ls "$EXTRACTED_DIR"/*.apk | wc -l) APK files"
for apk in "$EXTRACTED_DIR"/*.apk; do
    echo "    $(basename "$apk") ($(ls -lh "$apk" | awk '{print $5}'))"
done
echo ""

# ─── 2. Decompile base.apk ───
echo "=== Step 2/6: Decompiling base.apk ==="
DECOMPILED_DIR="$WORK_DIR/decompiled"
MANIFEST_DIR="$WORK_DIR/manifest-decoded"

# Full decompile with resources (for manifest + rebuild)
rm -rf "$MANIFEST_DIR"
echo "  Decoding resources + manifest (for rebuild)..."
apktool d -s -f -o "$MANIFEST_DIR" "$EXTRACTED_DIR/base.apk" 2>&1 | grep -E "^I:" | head -10

# Smali-only decompile (no resource decode, saves space)
rm -rf "$DECOMPILED_DIR"
echo "  Decoding smali (no resource decode)..."
apktool d -r -f -o "$DECOMPILED_DIR" "$EXTRACTED_DIR/base.apk" 2>&1 | grep -E "^I:" | head -10

SMALI_SIZE=$(du -sh "$DECOMPILED_DIR"/smali* 2>/dev/null | tail -1 | cut -f1)
echo "  Smali output: ~$SMALI_SIZE"
echo ""

# ─── 3. Patch manifest ───
echo "=== Step 3/6: Patching AndroidManifest.xml ==="
chmod +x "$SCRIPT_DIR/scripts/patch-manifest.sh"
bash "$SCRIPT_DIR/scripts/patch-manifest.sh" "$MANIFEST_DIR/AndroidManifest.xml"
echo ""

# ─── 4. Patch smali ───
echo "=== Step 4/6: Patching smali (stubbing telemetry) ==="
chmod +x "$SCRIPT_DIR/scripts/patch-smali.sh"
bash "$SCRIPT_DIR/scripts/patch-smali.sh" "$DECOMPILED_DIR"
echo ""

# ─── 5. Remove native telemetry libraries ───
echo "=== Step 5/6: Stripping native telemetry libraries ==="
NATIVE_LIBS=(
    "liboneds.so"          # Microsoft OneDS native telemetry
    "libtelclient.so"      # Microsoft telemetry client
    "libctxlog.so"         # Microsoft context logging
    "libkoom-fast-dump.so" # KOOM heap dump
    "libkoom-strip-dump.so" # KOOM strip dump
    "libkwai-android-base.so" # Kwai base (KOOM dependency)
    "libtrace-canary.so"   # Trace canary
)

for lib_name in "${NATIVE_LIBS[@]}"; do
    lib_path=$(find "$DECOMPILED_DIR/lib" -name "$lib_name" 2>/dev/null | head -1)
    if [ -n "$lib_path" ] && [ -f "$lib_path" ]; then
        lib_size=$(ls -lh "$lib_path" | awk '{print $5}')
        # Replace with minimal empty ELF stub (prevents UnsatisfiedLinkError
        # while ensuring no tracking code runs)
        # Actually: just remove it. The smali stubs prevent System.loadLibrary()
        # from being called, so the .so is never loaded.
        rm "$lib_path"
        # Also remove from manifest-decoded/lib if present
        lib_path2=$(find "$MANIFEST_DIR/lib" -name "$lib_name" 2>/dev/null | head -1)
        if [ -n "$lib_path2" ] && [ -f "$lib_path2" ]; then
            rm "$lib_path2"
        fi
        echo "  [x] Removed $lib_name ($lib_size)"
    fi
done
echo ""

# ─── 6. Rebuild ───
echo "=== Step 6/6: Rebuilding APK ==="
mkdir -p "$OUTPUT_DIR"

# Extract version from info.json
VERSION=$(python3 -c "
import json
with open('$EXTRACTED_DIR/info.json') as f:
    d = json.load(f)
    print(d.get('version_name', 'unknown'))
" 2>/dev/null || echo "unknown")

OUTPUT_APK="$OUTPUT_DIR/EdgeCanary-${VERSION}-privacy.apk"

chmod +x "$SCRIPT_DIR/scripts/rebuild.sh"
bash "$SCRIPT_DIR/scripts/rebuild.sh" "$DECOMPILED_DIR" "$OUTPUT_APK" "$EXTRACTED_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                    BUILD COMPLETE                    ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Output: $OUTPUT_APK"
echo "║  Version: $VERSION (privacy patched)"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "What was removed:"
echo "  - Adjust SDK initialization (288 classes neutralized)"
echo "  - Microsoft OneDS telemetry (131+ classes neutralized)"
echo "  - Microsoft analytics (91 classes neutralized)"
echo "  - Huawei HMS/AGConnect (784 classes, 8 manifest components)"
echo "  - Xiaomi Push (77 classes, 6 manifest components)"
echo "  - Google DataTransport/Firebase (37 classes, 6 manifest components)"
echo "  - KOOM/Kwai heap monitoring (57 classes)"
echo "  - Citrix MITM proxy (41 classes)"
echo "  - Tracking permissions (AD_ID, ADSERVICES, SMS, QUERY_ALL_PACKAGES)"
echo "  - Device ID vendor queries (MSA, Samsung, Coolpad, OPPO)"
echo "  - Native telemetry libraries (liboneds.so, libtelclient.so, etc.)"
echo ""
echo "To reapply to a new release:"
echo "  ./build.sh /path/to/new/Edge_Canary_xxx.apks"
