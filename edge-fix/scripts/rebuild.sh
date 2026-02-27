#!/data/data/com.termux/files/usr/bin/bash
# rebuild.sh - Rebuild the decompiled APK, merge splits, zipalign, sign
# Usage: ./scripts/rebuild.sh <decompiled-dir> <output-apk> [split-apks-dir]

set -euo pipefail

DECOMPILED_DIR="$1"
OUTPUT_APK="$2"
SPLIT_DIR="${3:-}"
SCRIPT_DIR="$(dirname "$0")"
WORK_DIR="$(dirname "$OUTPUT_APK")"
KEYSTORE="${SCRIPT_DIR}/../edge-fix.keystore"
KEY_ALIAS="edge-fix"
KEY_PASS="edge-fix-key"

if [ ! -d "$DECOMPILED_DIR" ]; then
    echo "ERROR: Decompiled directory not found: $DECOMPILED_DIR"
    exit 1
fi

# ─── 1. Replace decoded manifest back into decompiled dir ───
echo "=== Step 1: Preparing manifest ==="
# The decoded manifest (from manifest-decoded/) needs to replace the raw one
# in the decompiled dir. However since we used -r (no-res), we need to rebuild
# differently: we'll rebuild the base.apk with decoded resources.
#
# Strategy: Copy the patched manifest into the resource-decoded copy,
# then build from there.

MANIFEST_DECODED_DIR="${DECOMPILED_DIR}/../manifest-decoded"
if [ -d "$MANIFEST_DECODED_DIR" ]; then
    echo "  Using resource-decoded dir for manifest..."
    # Copy patched smali into the manifest-decoded dir (which has decoded resources)
    echo "  Copying patched smali to resource-decoded dir..."
    for smali_dir in "$DECOMPILED_DIR"/smali*; do
        dir_name=$(basename "$smali_dir")
        if [ -d "$smali_dir" ]; then
            rm -rf "${MANIFEST_DECODED_DIR}/${dir_name}"
            cp -r "$smali_dir" "${MANIFEST_DECODED_DIR}/${dir_name}"
        fi
    done
    # Also copy assets
    if [ -d "$DECOMPILED_DIR/assets" ]; then
        rm -rf "${MANIFEST_DECODED_DIR}/assets"
        cp -r "$DECOMPILED_DIR/assets" "${MANIFEST_DECODED_DIR}/assets"
    fi
    # Copy lib
    if [ -d "$DECOMPILED_DIR/lib" ]; then
        rm -rf "${MANIFEST_DECODED_DIR}/lib"
        cp -r "$DECOMPILED_DIR/lib" "${MANIFEST_DECODED_DIR}/lib"
    fi
    # Copy unknown files
    if [ -d "$DECOMPILED_DIR/unknown" ]; then
        cp -r "$DECOMPILED_DIR/unknown" "${MANIFEST_DECODED_DIR}/unknown" 2>/dev/null || true
    fi
    # Keep the manifest-decoded apktool.yml (has correct SDK, version, resource settings)
    BUILD_DIR="$MANIFEST_DECODED_DIR"
else
    echo "  WARNING: No resource-decoded dir found, building from raw resources"
    BUILD_DIR="$DECOMPILED_DIR"
fi

# ─── 2. Rebuild with apktool ───
echo ""
echo "=== Step 2: Rebuilding APK with apktool ==="
REBUILT_APK="${WORK_DIR}/base-rebuilt.apk"

# Use system aapt2 (Termux wrapper with qemu-x86_64) instead of apktool's
# bundled x86 binary that can't run natively on ARM64
AAPT2_PATH="$(which aapt2 2>/dev/null || echo "")"
AAPT_ARGS=""
if [ -n "$AAPT2_PATH" ]; then
    echo "  Using system aapt2: $AAPT2_PATH"
    AAPT_ARGS="-a $AAPT2_PATH"
fi

apktool b -f $AAPT_ARGS "$BUILD_DIR" -o "$REBUILT_APK" 2>&1 | tail -30

if [ ! -f "$REBUILT_APK" ]; then
    echo "  Trying with --use-aapt1..."
    apktool b -f --use-aapt1 $AAPT_ARGS "$BUILD_DIR" -o "$REBUILT_APK" 2>&1 | tail -30
fi

if [ ! -f "$REBUILT_APK" ]; then
    echo "FATAL: Rebuild failed. Check errors above."
    exit 1
fi

echo "  Rebuilt: $(ls -lh "$REBUILT_APK" | awk '{print $5}')"

# ─── 3. Generate signing key (if needed) ───
echo ""
echo "=== Step 3: Generating signing key ==="
if [ ! -f "$KEYSTORE" ]; then
    echo "  Generating signing keystore..."
    keytool -genkey -v -keystore "$KEYSTORE" -alias "$KEY_ALIAS" \
        -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
        -dname "CN=EdgeFix, OU=Privacy, O=EdgeFix, L=NA, S=NA, C=US" 2>/dev/null
fi

# ─── 4. Zipalign and sign all APKs ───
echo ""
echo "=== Step 4: Zipaligning and signing ==="
OUTPUT_DIR_PATH="$(dirname "$OUTPUT_APK")"
SIGNED_DIR="${WORK_DIR}/signed"
rm -rf "$SIGNED_DIR"
mkdir -p "$SIGNED_DIR"

# Detect apksigner (v2/v3 signing required by modern Android)
APKSIGNER=""
for bt_dir in "$HOME/android-sdk/build-tools/35.0.0" \
              "$HOME/android-sdk/build-tools/34.0.0" \
              "$HOME/android-sdk/build-tools/34.0.0-arm64"; do
    if [ -f "$bt_dir/apksigner" ]; then
        APKSIGNER="$bt_dir/apksigner"
        break
    fi
done

if [ -z "$APKSIGNER" ]; then
    echo "ERROR: apksigner not found. Install Android SDK build-tools."
    echo "  pkg install android-sdk-build-tools"
    exit 1
fi
echo "  Using apksigner: $APKSIGNER"

sign_apk() {
    local input_apk="$1"
    local output_name="$2"
    local aligned="${WORK_DIR}/${output_name}.aligned"
    local signed="${SIGNED_DIR}/${output_name}"

    # For apksigner v2/v3: zipalign FIRST, then sign
    # (apksigner preserves alignment during signing)
    zipalign -f -p 4 "$input_apk" "$aligned"

    # Sign with apksigner (v1 + v2 + v3 schemes)
    "$APKSIGNER" sign \
        --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
        --ks-pass "pass:${KEY_PASS}" --key-pass "pass:${KEY_PASS}" \
        --out "$signed" "$aligned" 2>&1

    rm -f "$aligned"
    echo "  [x] Signed+aligned: $output_name ($(ls -lh "$signed" | awk '{print $5}'))"
}

# Sign rebuilt base APK
sign_apk "$REBUILT_APK" "base.apk"

# Sign split APKs (re-sign with our key so signatures match)
if [ -n "$SPLIT_DIR" ] && [ -d "$SPLIT_DIR" ]; then
    for split_apk in "$SPLIT_DIR"/split_*.apk; do
        split_name=$(basename "$split_apk")
        # Strip existing signature first
        UNSIGNED_SPLIT="${WORK_DIR}/${split_name}.unsigned"
        cp "$split_apk" "$UNSIGNED_SPLIT"
        zip -d "$UNSIGNED_SPLIT" "META-INF/*" > /dev/null 2>&1 || true
        sign_apk "$UNSIGNED_SPLIT" "$split_name"
        rm -f "$UNSIGNED_SPLIT"
    done
fi

# Copy base to output path
cp "${SIGNED_DIR}/base.apk" "$OUTPUT_APK"

echo ""
echo "=== Build complete ==="
echo "  Base APK: $OUTPUT_APK"
echo "  Splits:   ${SIGNED_DIR}/"
ls -lh "$SIGNED_DIR"/ 2>/dev/null
echo ""

# Build install command
INSTALL_APKS="$OUTPUT_APK"
if [ -d "$SIGNED_DIR" ]; then
    for split in "$SIGNED_DIR"/split_*.apk; do
        [ -f "$split" ] && INSTALL_APKS="$INSTALL_APKS $split"
    done
fi

echo "  Install with:"
echo "    adb install-multiple $INSTALL_APKS"
echo ""
echo "  NOTE: Signed with custom key (self-signed)."
echo "  Original Edge Canary must be uninstalled first if installed."
