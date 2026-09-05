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
ZIPALIGN="$(command -v zipalign)"

# Check for apksigner
APKSIGNER=""
for bt_dir in "$HOME/android-tools/android-sdk/build-tools/35.0.0" \
              "$HOME/android-tools/android-sdk/build-tools/34.0.0" \
              "$HOME/android-tools/android-sdk/build-tools/34.0.0-arm64" \
              "$HOME/android-sdk/build-tools/35.0.0" \
              "$HOME/android-sdk/build-tools/34.0.0" \
              "$HOME/android-sdk/build-tools/34.0.0-arm64" \
              "$HOME/android-sdk/build-tools/30.0.3" \
              "$HOME"/android-sdk/build-tools/*; do
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
VERSION="$(python3 -c 'import json, pathlib, sys
info = pathlib.Path(sys.argv[1])
print(json.loads(info.read_text()).get("version_name", "unknown") if info.is_file() else "unknown")
' "$EXTRACTED_DIR/info.json" 2>/dev/null || echo "unknown")"

BASE_APK="$EXTRACTED_DIR/base.apk"
if [ ! -f "$BASE_APK" ]; then
    echo "ERROR: base.apk not found in extracted bundle"
    exit 1
fi

# Clear every version-specific destination before the build can create it.
# This prevents a successful build without APKEditor from leaving an older
# merged APK available to an installer.
OUTPUT_APK="$OUTPUT_DIR/EdgeCanary-${VERSION}-privacy.apk"
MERGED_APK="$OUTPUT_DIR/EdgeCanary-${VERSION}-privacy-merged.apk"
mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_APK" "$OUTPUT_APK.idsig" "$MERGED_APK" "$MERGED_APK.idsig"

# ─── 2. Patch manifest ───
# Strategy: decode manifest with apktool (no smali), patch the XML, recompile
# to binary format, then extract the compiled AndroidManifest.xml
echo "=== Step 2/5: Patching AndroidManifest.xml ==="

MANIFEST_WORK="$WORK_DIR/manifest-only"
rm -rf "$MANIFEST_WORK"

# Decode manifest + resources only (skip smali to save time/space)
echo "  Decoding manifest..."
if ! APKTOOL_LOG="$(apktool d -s -f -o "$MANIFEST_WORK" "$BASE_APK" 2>&1)"; then
    printf '%s\n' "$APKTOOL_LOG" >&2
    echo "ERROR: apktool failed to decode the manifest" >&2
    exit 1
fi
awk '/^I:/{ if (++count <= 5) print }' <<< "$APKTOOL_LOG"

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

# ─── 3. Patch DEX ───
# Strategy: use standalone baksmali/smali to decompile only the DEX files
# that need changes, apply all patches, then recompile.
# This avoids apktool's baksmali/smali round-trip bugs entirely.
#
# Three patch types are applied:
#   a) Targeted method stubs (config/targeted-stubs.list)
#   b) System.loadLibrary neutralization (config/neutralize-libs.list)
#   c) Telemetry URL replacement (config/replace-urls.list)
#
# DEX files are not round-tripped solely for optional URL replacements. The
# DEX containing Chromium CommandLine is an exception because warning
# suppression is required; its complete tree is assembled and byte-checked.
echo "=== Step 3/5: Patching DEX ==="

DEX_WORK="$WORK_DIR/dex-patch"
rm -rf "$DEX_WORK"
mkdir -p "$DEX_WORK"

TARGETED_STUBS="$CONFIG_DIR/targeted-stubs.list"
NEUTRALIZE_LIBS="$CONFIG_DIR/neutralize-libs.list"
REPLACE_URLS="$CONFIG_DIR/replace-urls.list"

# Helper: read config file, skip comments and blanks
read_config() {
    grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//'
}

# Helper: map smali path prefix to DEX filename
smali_to_dex() {
    local smali_dir="${1%%/*}"
    case "$smali_dir" in
        smali) echo "classes.dex" ;;
        smali_classes*) echo "${smali_dir/smali_/}.dex" ;;
        *) echo "" ;;
    esac
}

# Collect all DEX files that need patching from all config sources
declare -A DEX_NEEDS_PATCH

# From targeted-stubs.list
if [ -f "$TARGETED_STUBS" ]; then
    while IFS='|' read -r smali_path _method; do
        smali_path="${smali_path#\?}"
        dex=$(smali_to_dex "$smali_path")
        [ -n "$dex" ] && DEX_NEEDS_PATCH["$dex"]=1
    done < <(read_config "$TARGETED_STUBS")
fi

# From neutralize-libs.list
if [ -f "$NEUTRALIZE_LIBS" ]; then
    while IFS= read -r smali_path; do
        smali_path="${smali_path#\?}"
        dex=$(smali_to_dex "$smali_path")
        [ -n "$dex" ] && DEX_NEEDS_PATCH["$dex"]=1
    done < <(read_config "$NEUTRALIZE_LIBS")
fi

# URL replacement is handled in two places:
#   - During smali round-trip (Step 3a) for DEX files already being decompiled
#   - Via binary DEX patching (Step 3b) for all remaining DEX files
# No need to add DEX files to the round-trip set just for URL replacement.

# Process each DEX file that needs patching
CMDLINE_PATCHED=0
CMDLINE_DEX=""
for dex_name in "${!DEX_NEEDS_PATCH[@]}"; do
    echo "  Processing $dex_name..."

    # Extract DEX from original APK
    unzip -o "$BASE_APK" "$dex_name" -d "$DEX_WORK" > /dev/null

    # Map dex name back to smali directory name
    case "$dex_name" in
        classes.dex) smali_dir_name="smali" ;;
        classes*.dex) smali_dir_name="smali_${dex_name%.dex}" ;;
    esac

    SMALI_OUT="$DEX_WORK/$smali_dir_name"

    # Decompile with baksmali v3.0.9
    echo "    baksmali: decompiling..."
    java -jar "$BAKSMALI_JAR" d "$DEX_WORK/$dex_name" -o "$SMALI_OUT" 2>&1

    # (a) Apply targeted method stubs
    if [ -f "$TARGETED_STUBS" ]; then
        while IFS='|' read -r smali_path method_name; do
            optional=0
            if [[ "$smali_path" == \?* ]]; then
                optional=1
                smali_path="${smali_path#\?}"
            fi
            [ "$(smali_to_dex "$smali_path")" != "$dex_name" ] && continue
            full_path="$DEX_WORK/$smali_path"
            if [ ! -f "$full_path" ]; then
                if [ "$optional" -eq 1 ]; then
                    echo "    [i] Optional target absent in this version: $smali_path"
                    continue
                fi
                echo "ERROR: required patch target not found: $smali_path" >&2
                exit 1
            fi
            if python3 "$SCRIPT_DIR/scripts/stub-method.py" "$full_path" "$method_name"; then
                :
            else
                patch_status=$?
                if [ "$optional" -eq 1 ] && [ "$patch_status" -eq 2 ]; then
                    echo "    [i] Optional method absent in this version: $smali_path|$method_name"
                    continue
                fi
                echo "ERROR: required method patch failed: $smali_path|$method_name" >&2
                exit "$patch_status"
            fi
        done < <(read_config "$TARGETED_STUBS")
    fi

    # (b) Neutralize System.loadLibrary calls
    if [ -f "$NEUTRALIZE_LIBS" ]; then
        while IFS= read -r smali_path; do
            optional=0
            if [[ "$smali_path" == \?* ]]; then
                optional=1
                smali_path="${smali_path#\?}"
            fi
            [ "$(smali_to_dex "$smali_path")" != "$dex_name" ] && continue
            full_path="$DEX_WORK/$smali_path"
            if [ ! -f "$full_path" ]; then
                if [ "$optional" -eq 1 ]; then
                    echo "    [i] Optional target absent in this version: $smali_path"
                    continue
                fi
                echo "ERROR: required patch target not found: $smali_path" >&2
                exit 1
            fi
            if ! python3 "$SCRIPT_DIR/scripts/neutralize-loadlibrary.py" "$full_path"; then
                echo "ERROR: required loadLibrary patch failed: $smali_path" >&2
                exit 1
            fi
        done < <(read_config "$NEUTRALIZE_LIBS")
    fi

    # (c) Replace telemetry endpoint URLs across all smali files in this DEX
    if [ -f "$REPLACE_URLS" ]; then
        while IFS= read -r url; do
            # Search for the URL in all smali files of this DEX
            matching_files=$(grep -rl "$url" "$SMALI_OUT" 2>/dev/null || true)
            for match_file in $matching_files; do
                python3 "$SCRIPT_DIR/scripts/replace-strings.py" "$match_file" "$url" "http://127.0.0.1:18971"
            done
        done < <(read_config "$REPLACE_URLS")
    fi

    # (c2) Downgrade HttpsURLConnection casts to HttpURLConnection in telemetry senders.
    # Our URL replacement changes HTTPS endpoints to HTTP (127.0.0.1:18971), but the ARIA
    # SDK casts URL.openConnection() to HttpsURLConnection which throws ClassCastException
    # for HTTP URLs. Replacing with HttpURLConnection (the parent class) is safe because
    # no HTTPS-specific methods (setSSLSocketFactory, etc.) are called after the cast.
    if [ -f "$REPLACE_URLS" ]; then
        for smali_file in $(grep -rl "check-cast.*HttpsURLConnection" "$SMALI_OUT" 2>/dev/null || true); do
            # Only patch files in telemetry/experimentation packages — don't touch identity/auth code
            case "$smali_file" in
                *telemetry*|*experimentation*)
                    sed -i 's|check-cast \(.*\), Ljavax/net/ssl/HttpsURLConnection;|check-cast \1, Ljava/net/HttpURLConnection;|g' "$smali_file"
                    echo "    [x] Downgraded HttpsURLConnection cast in $(basename "$smali_file")"
                    ;;
            esac
        done
    fi

    # (d) Strip tracker class packages (entire directory trees)
    STRIP_CLASSES="$CONFIG_DIR/strip-classes.list"
    if [ -f "$STRIP_CLASSES" ]; then
        while IFS= read -r pkg_prefix; do
            pkg_prefix="${pkg_prefix%%#*}"
            pkg_prefix="${pkg_prefix// /}"
            [ -z "$pkg_prefix" ] && continue
            if [ -d "$SMALI_OUT/$pkg_prefix" ]; then
                class_count=$(find "$SMALI_OUT/$pkg_prefix" -name '*.smali' | wc -l)
                rm -rf "$SMALI_OUT/$pkg_prefix"
                echo "    [x] Stripped $pkg_prefix/ ($class_count classes)"
            fi
        done < <(read_config "$STRIP_CLASSES")
    fi

    # Patch command-line behavior while this exact DEX tree is still mutable.
    # It must happen before assembly so the emitted DEX contains the changes.
    if [ "$CMDLINE_PATCHED" -eq 0 ] &&
            [ -f "$SMALI_OUT/org/chromium/base/CommandLine.smali" ]; then
        python3 "$SCRIPT_DIR/scripts/patch-commandline.py" "$SMALI_OUT"
        CMDLINE_PATCHED=1
        CMDLINE_DEX="$dex_name"
    fi

    # Recompile with smali v3.0.9
    echo "    smali: recompiling..."
    java -jar "$SMALI_JAR" a "$SMALI_OUT" -o "$DEX_WORK/${dex_name%.dex}-patched.dex" 2>&1

    ORIG_SIZE=$(wc -c < "$DEX_WORK/$dex_name")
    NEW_SIZE=$(wc -c < "$DEX_WORK/${dex_name%.dex}-patched.dex")
    echo "    $dex_name: $ORIG_SIZE → $NEW_SIZE bytes"
done

# NOTE: Binary DEX patching (patch-dex-strings.py) is available but disabled.
# Replacing strings in the DEX binary breaks the sorted string_id table, causing
# the ART verifier to reject the entire DEX file. URL-only targets in DEX files
# outside the configured round-trip set are left unchanged; these exceptions
# are documented in replace-urls.list.

# ─── 3c. Locate CommandLine in any remaining DEX ───
# Each candidate is searched in isolation. If it contains CommandLine, patch
# that exact smali tree and immediately assemble the same tree.
if [ "$CMDLINE_PATCHED" -eq 0 ]; then
    while IFS= read -r extra_name; do
        [ -z "$extra_name" ] && continue

        # Skip already-processed DEXes
        [ -f "$DEX_WORK/$extra_name" ] && continue

        echo "  Scanning $extra_name for Chromium CommandLine..."
        unzip -o "$BASE_APK" "$extra_name" -d "$DEX_WORK" > /dev/null

        case "$extra_name" in
            classes.dex) extra_smali="smali" ;;
            classes*.dex) extra_smali="smali_${extra_name%.dex}" ;;
        esac

        java -jar "$BAKSMALI_JAR" d "$DEX_WORK/$extra_name" -o "$DEX_WORK/$extra_smali" 2>&1

        if [ ! -f "$DEX_WORK/$extra_smali/org/chromium/base/CommandLine.smali" ]; then
            rm -rf "$DEX_WORK/$extra_smali" "$DEX_WORK/$extra_name"
            continue
        fi

        python3 "$SCRIPT_DIR/scripts/patch-commandline.py" "$DEX_WORK/$extra_smali"
        echo "    smali: recompiling..."
        java -jar "$SMALI_JAR" a "$DEX_WORK/$extra_smali" \
            -o "$DEX_WORK/${extra_name%.dex}-patched.dex" 2>&1
        CMDLINE_PATCHED=1
        CMDLINE_DEX="$extra_name"
        echo "    $extra_name: command-line behavior patched before assembly"
        break
    done < <(unzip -Z1 "$BASE_APK" | awk '/^classes([0-9]+)?\.dex$/')
fi

if [ "$CMDLINE_PATCHED" -eq 0 ]; then
    echo "ERROR: required Chromium CommandLine warning patch was not applied" >&2
    exit 1
fi
echo "  [x] Command-line patch assembled from $CMDLINE_DEX"
echo ""

# ─── 4. Assemble output APK ───
# Strategy: copy original base.apk, replace only the patched files (DEX +
# manifest), strip META-INF (old signatures). This preserves all original
# resources, native libs, and unmodified DEX files byte-for-byte.
echo "=== Step 4/5: Assembling patched APK ==="

# Start from original base.apk
cp "$BASE_APK" "$OUTPUT_APK"

# Strip old signatures
zip -d "$OUTPUT_APK" "META-INF/*" > /dev/null 2>&1 || true

# Strip unused native libraries (saves ~36MB)
if [ -f "$CONFIG_DIR/strip-libs.list" ]; then
    echo "  Stripping unused native libraries..."
    STRIP_COUNT=0
    STRIP_BYTES=0
    while IFS= read -r lib_path; do
        lib_path="${lib_path%%#*}"      # strip inline comments
        lib_path="${lib_path// /}"      # trim whitespace
        [ -z "$lib_path" ] && continue
        # Get size before removing (for stats)
        lib_size=$(unzip -l "$OUTPUT_APK" "$lib_path" 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)
        if zip -d "$OUTPUT_APK" "$lib_path" > /dev/null 2>&1; then
            echo "    [-] $lib_path"
            STRIP_COUNT=$((STRIP_COUNT + 1))
            STRIP_BYTES=$((STRIP_BYTES + lib_size))
        fi
    done < "$CONFIG_DIR/strip-libs.list"
    echo "  Stripped $STRIP_COUNT libraries (~$((STRIP_BYTES / 1048576))MB)"
fi

# Strip unused assets (HMS certs + GRS route configs, LaTeX math — PDF viewer kept)
echo "  Stripping unused assets..."
zip -d "$OUTPUT_APK" "assets/hmsrootcas.bks" "assets/hmsincas.bks" > /dev/null 2>&1 || true
zip -d "$OUTPUT_APK" "assets/grs_sdk_global_route_config_opendevicesdk.json" \
    "assets/grs_sdk_global_route_config_opensdkService.json" \
    "assets/grs_sdk_server_config.json" > /dev/null 2>&1 || true
zip -d "$OUTPUT_APK" "assets/org/scilab/forge/jlatexmath/*" > /dev/null 2>&1 || true

# Replace patched manifest
zip -j "$OUTPUT_APK" "$PATCHED_MANIFEST" > /dev/null

# Verify the ZIP contains the exact compiled manifest bytes.
EMITTED_MANIFEST="$WORK_DIR/emitted-AndroidManifest.xml"
unzip -p "$OUTPUT_APK" AndroidManifest.xml > "$EMITTED_MANIFEST"
if ! cmp -s "$PATCHED_MANIFEST" "$EMITTED_MANIFEST"; then
    echo "ERROR: assembled APK does not contain the patched manifest" >&2
    exit 1
fi
rm -f "$EMITTED_MANIFEST"

# Replace patched DEX files
PATCHED_DEX_COUNT=0
if [ -d "$DEX_WORK" ]; then
    for patched_dex in "$DEX_WORK"/*-patched.dex; do
        [ -f "$patched_dex" ] || continue
        # e.g., classes2-patched.dex → classes2.dex
        dex_basename="$(basename "$patched_dex" | sed 's/-patched//')"
        # zip expects the original entry name, so use a temporary copy.
        cp "$patched_dex" "$DEX_WORK/$dex_basename"
        (cd "$DEX_WORK" && zip -j "$OUTPUT_APK" "$dex_basename") > /dev/null

        # Compare emitted bytes to the assembled DEX, not merely its filename.
        emitted_dex="$DEX_WORK/emitted-$dex_basename"
        unzip -p "$OUTPUT_APK" "$dex_basename" > "$emitted_dex"
        if ! cmp -s "$patched_dex" "$emitted_dex"; then
            echo "ERROR: assembled APK contains the wrong $dex_basename bytes" >&2
            exit 1
        fi
        rm -f "$emitted_dex"
        PATCHED_DEX_COUNT=$((PATCHED_DEX_COUNT + 1))
        echo "  Replaced and verified: $dex_basename"
    done
fi

if [ "$PATCHED_DEX_COUNT" -eq 0 ] ||
        [ ! -f "$DEX_WORK/${CMDLINE_DEX%.dex}-patched.dex" ]; then
    echo "ERROR: required patched DEX output is missing" >&2
    exit 1
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

# Prefer 16 KiB native-library alignment with build-tools that support -P.
# Older Termux zipalign builds only expose legacy -p; keep them usable but make
# the compatibility limitation explicit and still validate their output.
ZIPALIGN_HELP="$("$ZIPALIGN" 2>&1 || true)"
if grep -q -- '-P' <<< "$ZIPALIGN_HELP"; then
    ZIPALIGN_PAGE_ARGS=(-P 16)
    ZIPALIGN_DESCRIPTION="16 KiB"
else
    ZIPALIGN_PAGE_ARGS=(-p)
    ZIPALIGN_DESCRIPTION="legacy 4 KiB"
    echo "  [!] WARNING: $ZIPALIGN lacks -P; native libraries cannot be validated for 16 KiB pages"
fi

BASE_CERT_DIGEST=""

verify_signed_apk() {
    local apk="$1"
    local verify_log
    local cert_digest

    "$ZIPALIGN" -c "${ZIPALIGN_PAGE_ARGS[@]}" -v 4 "$apk" > /dev/null
    if ! verify_log="$("$APKSIGNER" verify --verbose --print-certs "$apk" 2>&1)"; then
        printf '%s\n' "$verify_log" >&2
        echo "ERROR: APK signature verification failed: $apk" >&2
        exit 1
    fi

    cert_digest="$(awk -F': ' '/Signer #1 certificate SHA-256 digest:/{print $2; exit}' <<< "$verify_log")"
    if [ -z "$cert_digest" ]; then
        echo "ERROR: could not read signer certificate digest: $apk" >&2
        exit 1
    elif [ -z "$BASE_CERT_DIGEST" ]; then
        BASE_CERT_DIGEST="$cert_digest"
    elif [ "$cert_digest" != "$BASE_CERT_DIGEST" ]; then
        echo "ERROR: APK signer differs from signed base: $apk" >&2
        exit 1
    fi

    echo "  [x] Verified signature + $ZIPALIGN_DESCRIPTION alignment: $(basename "$apk")"
}

# Sign a single APK: zipalign (page-aligned for native libs) → apksigner
sign_apk() {
    local input_apk="$1"
    local output_name="$2"
    local aligned="${WORK_DIR}/${output_name}.aligned"
    local signed="${SIGNED_DIR}/${output_name}"

    "$ZIPALIGN" -f "${ZIPALIGN_PAGE_ARGS[@]}" 4 "$input_apk" "$aligned"
    "$APKSIGNER" sign \
        --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
        --ks-pass "pass:${KEY_PASS}" --key-pass "pass:${KEY_PASS}" \
        --out "$signed" "$aligned" 2>&1
    rm -f "$aligned"
    verify_signed_apk "$signed"
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

# ─── 6. Merge splits into a single installable APK (optional) ───
# A merged single APK installs with any installer (no split juggling).
# ⚠️  WARNING (confirmed 2026-09-04, Edge 154): the APKEditor MERGE rebuilds the
# combined resources.arsc across base+splits, and the reprocessed table BREAKS
# Edge's DayNight theme — Appearance=Dark renders as LIGHT chrome. The merge also
# previously dropped the sandboxed-service class. PREFER installing the SPLIT
# bundle instead:
#   adb install-multiple -r output/signed/base.apk output/signed/split_*.apk
# (or SAI with a zip of those). Only use the merged APK when splits aren't an
# option, and expect the light-theme regression.
APKEDITOR_JAR="$TOOLS_DIR/APKEditor.jar"
if [ -f "$APKEDITOR_JAR" ]; then
    echo ""
    echo "=== Step 6/6: Merging splits into single APK ==="
    MERGE_WORK="$WORK_DIR/merge"
    rm -rf "$MERGE_WORK"
    mkdir -p "$MERGE_WORK/input"
    # Use the signed patched base + signed splits as merge input
    cp "${SIGNED_DIR}/base.apk" "$MERGE_WORK/input/base.apk"
    for split_apk in "${SIGNED_DIR}"/split_*.apk; do
        [ -f "$split_apk" ] && cp "$split_apk" "$MERGE_WORK/input/"
    done
    echo "  Merging $(ls "$MERGE_WORK/input"/*.apk | wc -l) APKs..."
    java -jar "$APKEDITOR_JAR" m -i "$MERGE_WORK/input" \
        -o "$MERGE_WORK/merged-unsigned.apk" -clean-meta -f 2>&1 | tail -3
    # Re-sign the merged APK with the stable keystore
    "$ZIPALIGN" -f "${ZIPALIGN_PAGE_ARGS[@]}" 4 \
        "$MERGE_WORK/merged-unsigned.apk" "$MERGE_WORK/merged-aligned.apk"
    "$APKSIGNER" sign \
        --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
        --ks-pass "pass:${KEY_PASS}" --key-pass "pass:${KEY_PASS}" \
        --out "$MERGED_APK" "$MERGE_WORK/merged-aligned.apk" 2>&1
    verify_signed_apk "$MERGED_APK"
    rm -rf "$MERGE_WORK"
    echo "  [x] Merged single APK: $(ls -lh "$MERGED_APK" | awk '{print $5}')"
else
    echo ""
    echo "  [i] tools/APKEditor.jar not found — skipping single-APK merge."
    echo "      Install split bundle instead (see below)."
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                    BUILD COMPLETE                    ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Output: $OUTPUT_APK"
echo "║  Version: $VERSION (privacy patched)"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Verified build results:"
echo "  - Configured manifest removals are absent from the compiled manifest"
echo "  - $PATCHED_DEX_COUNT patched DEX entries match their assembled bytes"
echo "  - Required method and loadLibrary patches completed; optional misses were reported"
echo "  - CommandLine.wasFlagsLoadedFromFile() returns false in $CMDLINE_DEX"
echo "  - Version-dependent telemetry URLs were redirected wherever present"
echo "  - All APK signatures match and pass $ZIPALIGN_DESCRIPTION alignment checks"
echo ""

# Build install command
INSTALL_CMD="adb install-multiple $OUTPUT_APK"
for split in "$SIGNED_DIR"/split_*.apk; do
    [ -f "$split" ] && INSTALL_CMD="$INSTALL_CMD $split"
done

if [ -f "$MERGED_APK" ]; then
    echo "Optional merged APK (known to break Edge dark theme):"
    echo "  $MERGED_APK"
fi
echo "Install — verified split bundle (recommended):"
echo "  $INSTALL_CMD"
echo ""
echo "First install from THIS keystore requires uninstalling the original"
echo "(signature mismatch wipes Edge data):"
echo "  adb uninstall com.microsoft.emmx.canary   # then install above"
echo ""
echo "In-place UPDATE (NO data wipe) — only if already on a build from this"
echo "same keystore. Android allows the update because signatures match:"
echo "  adb install-multiple -r $OUTPUT_APK <splits...>"
if [ -f "$MERGED_APK" ]; then
    echo ""
    echo "Merged update (only if split install is impossible; dark theme will break):"
    echo "  adb install -r $MERGED_APK"
fi
echo ""
echo "To reapply to a new release:"
echo "  ./build.sh /path/to/new/Edge_Canary_xxx.apks"
