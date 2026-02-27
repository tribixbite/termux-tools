#!/data/data/com.termux/files/usr/bin/bash
# build.sh - Master build script for Edge Canary privacy fix
#
# Uses targeted DEX patching with standalone baksmali/smali v3.0.9 to avoid
# apktool's smali round-trip bugs (IncompatibleClassChangeError on Java 8+
# interface static methods) and resource ID renumbering.
#
# Pipeline:
#   1. Extract .apks bundle
#   2. Patch manifest (apktool -s decode → Python XML patch → recompile to binary)
#   3. Patch DEX (baksmali → targeted method stubs → smali)
#   4. Assemble APK (copy original, replace patched DEX + manifest, strip META-INF)
#   5. Sign all APKs (zipalign + apksigner v1/v2/v3)
#
# Usage:
#   ./build.sh <edge-canary.apks>
#   ./build.sh  # uses default path from AppManager exports
#
# Requirements: apktool, zipalign, apksigner, keytool, python3, java

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$SCRIPT_DIR/work"
OUTPUT_DIR="$SCRIPT_DIR/output"
CONFIG_DIR="$SCRIPT_DIR/config"
TOOLS_DIR="$SCRIPT_DIR/tools"

# Standalone baksmali/smali v3.0.9 (avoids apktool's round-trip bugs)
BAKSMALI_JAR="$TOOLS_DIR/baksmali-3.0.9-fat.jar"
SMALI_JAR="$TOOLS_DIR/smali-3.0.9-fat.jar"

# Default .apks path (auto-detected from AppManager exports)
if [ -n "${1:-}" ]; then
    INPUT_APKS="$1"
else
    # Find most recent Edge Canary .apks export
    INPUT_APKS=$(find "$HOME/storage/shared/AppManager/apks" \
        -name "Edge Canary_*.apks" -type f 2>/dev/null \
        | sort -t_ -k2 -V | tail -1 || true)
    if [ -z "$INPUT_APKS" ]; then
        echo "ERROR: No Edge Canary .apks found in AppManager exports"
        echo ""
        echo "Usage: $0 <edge-canary.apks>"
        exit 1
    fi
fi

if [ ! -f "$INPUT_APKS" ]; then
    echo "ERROR: Input .apks not found: $INPUT_APKS"
    echo ""
    echo "Usage: $0 <edge-canary.apks>"
    echo "       $0  # auto-detect from AppManager exports"
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
for cmd in apktool zipalign keytool python3 java; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "ERROR: Required tool not found: $cmd"
        exit 1
    fi
done

# Check for apksigner
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
    exit 1
fi

# Check for baksmali/smali jars
if [ ! -f "$BAKSMALI_JAR" ] || [ ! -f "$SMALI_JAR" ]; then
    echo "ERROR: baksmali/smali jars not found in $TOOLS_DIR"
    echo "  Download from: gh release download 3.0.9 --repo baksmali/smali --pattern '*fat*'"
    exit 1
fi

echo "  All tools available"
echo "  apksigner: $APKSIGNER"
echo "  baksmali:  $BAKSMALI_JAR"
echo "  smali:     $SMALI_JAR"
echo ""

# Check disk space (need ~1GB free for working files)
FREE_KB=$(df -k "$HOME" | tail -1 | awk '{print $4}')
if [ "$FREE_KB" -lt 1048576 ]; then
    echo "WARNING: Low disk space ($(( FREE_KB / 1024 ))MB free, recommend 1GB+)"
    echo "  Proceeding anyway..."
fi

# ─── 1. Extract .apks bundle ───
echo "=== Step 1/5: Extracting .apks bundle ==="
EXTRACTED_DIR="$WORK_DIR/apks-extracted"
rm -rf "$EXTRACTED_DIR"
mkdir -p "$EXTRACTED_DIR"
unzip -o "$INPUT_APKS" -d "$EXTRACTED_DIR" > /dev/null
echo "  Extracted: $(ls "$EXTRACTED_DIR"/*.apk 2>/dev/null | wc -l) APK files"
for apk in "$EXTRACTED_DIR"/*.apk; do
    echo "    $(basename "$apk") ($(ls -lh "$apk" | awk '{print $5}'))"
done
echo ""

# Extract version from info.json (if present in .apks bundle)
VERSION=$(python3 -c "
import json, os
info = '$EXTRACTED_DIR/info.json'
if os.path.isfile(info):
    with open(info) as f:
        print(json.load(f).get('version_name', 'unknown'))
else:
    print('unknown')
" 2>/dev/null || echo "unknown")

BASE_APK="$EXTRACTED_DIR/base.apk"
if [ ! -f "$BASE_APK" ]; then
    echo "ERROR: base.apk not found in extracted bundle"
    exit 1
fi

# ─── 2. Patch manifest ───
# Strategy: decode manifest with apktool (no smali), patch the XML, recompile
# to binary format, then extract the compiled AndroidManifest.xml
echo "=== Step 2/5: Patching AndroidManifest.xml ==="

MANIFEST_WORK="$WORK_DIR/manifest-only"
rm -rf "$MANIFEST_WORK"

# Decode manifest + resources only (skip smali to save time/space)
echo "  Decoding manifest..."
apktool d -s -f -o "$MANIFEST_WORK" "$BASE_APK" 2>&1 | grep -E "^I:" | head -5

# Patch the decoded XML manifest
echo "  Patching..."
python3 "$SCRIPT_DIR/scripts/patch-manifest.py" "$MANIFEST_WORK/AndroidManifest.xml" "$CONFIG_DIR"

# Recompile to get binary AndroidManifest.xml
echo "  Recompiling to binary format..."
AAPT2_PATH="$(which aapt2 2>/dev/null || echo "")"
AAPT_ARGS=""
if [ -n "$AAPT2_PATH" ]; then
    AAPT_ARGS="-a $AAPT2_PATH"
fi
apktool b -f $AAPT_ARGS "$MANIFEST_WORK" -o "$WORK_DIR/manifest-rebuilt.apk" 2>&1 | tail -5

# Extract the compiled binary manifest from the rebuilt APK
PATCHED_MANIFEST="$WORK_DIR/patched-manifest/AndroidManifest.xml"
mkdir -p "$WORK_DIR/patched-manifest"
unzip -o "$WORK_DIR/manifest-rebuilt.apk" AndroidManifest.xml -d "$WORK_DIR/patched-manifest" > /dev/null
echo "  Binary manifest: $(ls -lh "$PATCHED_MANIFEST" | awk '{print $5}')"
echo ""

# ─── 3. Patch DEX (targeted method stubs) ───
# Strategy: use standalone baksmali/smali to decompile only the DEX files
# that contain methods we need to stub, apply stubs, then recompile.
# This avoids apktool's baksmali/smali round-trip bugs entirely.
echo "=== Step 3/5: Patching DEX (targeted method stubs) ==="

DEX_WORK="$WORK_DIR/dex-patch"
rm -rf "$DEX_WORK"
mkdir -p "$DEX_WORK"

TARGETED_STUBS="$CONFIG_DIR/targeted-stubs.list"
if [ ! -f "$TARGETED_STUBS" ]; then
    echo "  No targeted-stubs.list found, skipping DEX patching"
else
    # Parse targeted-stubs.list to determine which DEX files need patching
    # smali/ → classes.dex, smali_classes2/ → classes2.dex, etc.
    declare -A DEX_NEEDS_PATCH

    while IFS='|' read -r smali_path method_name; do
        # Extract the top-level smali directory (e.g., "smali_classes2")
        smali_dir="${smali_path%%/*}"
        case "$smali_dir" in
            smali) dex_name="classes.dex" ;;
            smali_classes*) dex_name="${smali_dir/smali_/}.dex" ;; # smali_classes2 → classes2.dex
            *) echo "  [!] Unknown smali dir: $smali_dir"; continue ;;
        esac
        DEX_NEEDS_PATCH["$dex_name"]=1
    done < <(grep -v '^#' "$TARGETED_STUBS" | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//')

    # Process each DEX file that needs patching
    for dex_name in "${!DEX_NEEDS_PATCH[@]}"; do
        echo "  Processing $dex_name..."

        # Extract DEX from original APK
        unzip -o "$BASE_APK" "$dex_name" -d "$DEX_WORK" > /dev/null

        # Map dex name back to smali directory name
        case "$dex_name" in
            classes.dex) smali_dir_name="smali" ;;
            classes*.dex) smali_dir_name="smali_${dex_name%.dex}" ;; # classes2.dex → smali_classes2
        esac

        SMALI_OUT="$DEX_WORK/$smali_dir_name"

        # Decompile with baksmali v3.0.9
        echo "    baksmali: decompiling $dex_name..."
        java -jar "$BAKSMALI_JAR" d "$DEX_WORK/$dex_name" -o "$SMALI_OUT" 2>&1

        # Apply targeted method stubs for this DEX
        while IFS='|' read -r smali_path method_name; do
            this_smali_dir="${smali_path%%/*}"
            case "$this_smali_dir" in
                smali) this_dex="classes.dex" ;;
                smali_classes*) this_dex="${this_smali_dir/smali_/}.dex" ;;
            esac

            # Only process stubs belonging to this DEX
            [ "$this_dex" != "$dex_name" ] && continue

            full_path="$DEX_WORK/$smali_path"
            if [ ! -f "$full_path" ]; then
                echo "    [!] Not found: $smali_path"
                continue
            fi

            # Stub the specific method using Python
            python3 "$SCRIPT_DIR/scripts/stub-method.py" "$full_path" "$method_name"

        done < <(grep -v '^#' "$TARGETED_STUBS" | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//')

        # Recompile with smali v3.0.9
        echo "    smali: recompiling $dex_name..."
        java -jar "$SMALI_JAR" a "$SMALI_OUT" -o "$DEX_WORK/${dex_name%.dex}-patched.dex" 2>&1

        ORIG_SIZE=$(wc -c < "$DEX_WORK/$dex_name")
        NEW_SIZE=$(wc -c < "$DEX_WORK/${dex_name%.dex}-patched.dex")
        echo "    $dex_name: $ORIG_SIZE → $NEW_SIZE bytes"
    done
fi
echo ""

# ─── 4. Assemble output APK ───
# Strategy: copy original base.apk, replace only the patched files (DEX +
# manifest), strip META-INF (old signatures). This preserves all original
# resources, native libs, and unmodified DEX files byte-for-byte.
echo "=== Step 4/5: Assembling patched APK ==="

OUTPUT_APK="$OUTPUT_DIR/EdgeCanary-${VERSION}-privacy.apk"
mkdir -p "$OUTPUT_DIR"

# Start from original base.apk
cp "$BASE_APK" "$OUTPUT_APK"

# Strip old signatures
zip -d "$OUTPUT_APK" "META-INF/*" > /dev/null 2>&1 || true

# Replace patched manifest
zip -j "$OUTPUT_APK" "$PATCHED_MANIFEST" > /dev/null

# Replace patched DEX files
if [ -d "$DEX_WORK" ]; then
    for patched_dex in "$DEX_WORK"/*-patched.dex; do
        [ -f "$patched_dex" ] || continue
        # e.g., classes2-patched.dex → classes2.dex
        dex_basename="$(basename "$patched_dex" | sed 's/-patched//')"
        # zip expects the entry name, so we rename temporarily
        cp "$patched_dex" "$DEX_WORK/$dex_basename"
        (cd "$DEX_WORK" && zip -j "$OUTPUT_APK" "$dex_basename") > /dev/null
        echo "  Replaced: $dex_basename"
    done
fi

echo "  Assembled: $(ls -lh "$OUTPUT_APK" | awk '{print $5}')"
echo ""

# ─── 5. Sign all APKs ───
echo "=== Step 5/5: Signing APKs ==="

KEYSTORE="$SCRIPT_DIR/edge-fix.keystore"
KEY_ALIAS="edge-fix"
KEY_PASS="edge-fix-key"
SIGNED_DIR="$OUTPUT_DIR/signed"
rm -rf "$SIGNED_DIR"
mkdir -p "$SIGNED_DIR"

# Generate signing key if needed
if [ ! -f "$KEYSTORE" ]; then
    echo "  Generating signing keystore..."
    keytool -genkey -v -keystore "$KEYSTORE" -alias "$KEY_ALIAS" \
        -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
        -dname "CN=EdgeFix, OU=Privacy, O=EdgeFix, L=NA, S=NA, C=US" 2>/dev/null
fi

# Sign a single APK: zipalign (page-aligned for native libs) → apksigner
sign_apk() {
    local input_apk="$1"
    local output_name="$2"
    local aligned="${WORK_DIR}/${output_name}.aligned"
    local signed="${SIGNED_DIR}/${output_name}"

    zipalign -f -p 4 "$input_apk" "$aligned"
    "$APKSIGNER" sign \
        --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
        --ks-pass "pass:${KEY_PASS}" --key-pass "pass:${KEY_PASS}" \
        --out "$signed" "$aligned" 2>&1
    rm -f "$aligned"
    echo "  [x] $output_name ($(ls -lh "$signed" | awk '{print $5}'))"
}

# Sign base APK
sign_apk "$OUTPUT_APK" "base.apk"

# Re-sign split APKs with our key (signatures must match across all splits)
for split_apk in "$EXTRACTED_DIR"/split_*.apk; do
    [ -f "$split_apk" ] || continue
    split_name=$(basename "$split_apk")
    # Strip existing signature, then sign with our key
    UNSIGNED="${WORK_DIR}/${split_name}.unsigned"
    cp "$split_apk" "$UNSIGNED"
    zip -d "$UNSIGNED" "META-INF/*" > /dev/null 2>&1 || true
    sign_apk "$UNSIGNED" "$split_name"
    rm -f "$UNSIGNED"
done

# Copy signed base to output path
cp "${SIGNED_DIR}/base.apk" "$OUTPUT_APK"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                    BUILD COMPLETE                    ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Output: $OUTPUT_APK"
echo "║  Version: $VERSION (privacy patched)"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "What was neutralized:"
echo "  Manifest:"
echo "    - Tracking permissions (AD_ID, ADSERVICES, SMS, QUERY_ALL_PACKAGES)"
echo "    - Device ID vendor queries (MSA, Samsung, Coolpad, OPPO)"
echo "    - Adjust SDK content provider (auto-initialization)"
echo "    - Huawei HMS/AGConnect (8 components)"
echo "    - Xiaomi Push (6 components)"
echo "    - Google DataTransport/Firebase (6 components)"
echo "    - KOOM heap monitoring service"
echo "    - Citrix MITM proxy (4 components)"
echo "    - @null meta-data entries (prevents apktool compile issues)"
echo "  DEX:"
echo "    - OneAuth.registerTokenSharing() (prevents cross-app token leaking)"
echo "  Preserved (to avoid crashes):"
echo "    - Native libs (.so) kept but initialization stubbed at Java level"
echo "    - Intune MAM components (deeply integrated into Application class)"
echo "    - TokenSharingService manifest entry (programmatic enable/disable)"
echo ""

# Build install command
INSTALL_CMD="adb install-multiple $OUTPUT_APK"
for split in "$SIGNED_DIR"/split_*.apk; do
    [ -f "$split" ] && INSTALL_CMD="$INSTALL_CMD $split"
done

echo "Install (requires uninstalling original first):"
echo "  adb uninstall com.microsoft.emmx.canary"
echo "  $INSTALL_CMD"
echo ""
echo "To reapply to a new release:"
echo "  ./build.sh /path/to/new/Edge_Canary_xxx.apks"
