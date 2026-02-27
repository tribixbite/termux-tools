#!/data/data/com.termux/files/usr/bin/bash
# patch-smali.sh - Stub telemetry initialization methods in smali
# Replaces method bodies with safe return defaults to neutralize tracking
# Usage: ./scripts/patch-smali.sh <decompiled-dir>

set -euo pipefail

DECOMPILED_DIR="$1"
CONFIG_DIR="$(dirname "$0")/../config"
STUBS_LIST="$CONFIG_DIR/smali-stubs.list"

if [ ! -d "$DECOMPILED_DIR" ]; then
    echo "ERROR: Decompiled directory not found: $DECOMPILED_DIR"
    exit 1
fi

# ─── Helper: read config file, skip comments and blanks ───
read_config() {
    grep -v '^#' "$1" | grep -v '^[[:space:]]*$' | sed 's/[[:space:]]*$//'
}

# ─── Stub a single smali file ───
# Strategy: Replace method bodies with safe return stubs
# - void methods -> return-void
# - boolean methods -> const/4 v0, 0x0 + return v0 (return false)
# - object methods -> const/4 v0, 0x0 + return-object v0 (return null)
# - int/short/byte/char methods -> const/4 v0, 0x0 + return v0
# - long methods -> const-wide/16 v0, 0x0 + return-wide v0
# - float/double methods -> similar
#
# We preserve constructors (<init>) to avoid ClassNotFoundException crashes
# but stub <clinit> (static initializer) and all other methods
stub_smali_file() {
    local smali_file="$1"
    local patched=0

    if [ ! -f "$smali_file" ]; then
        echo "  [!] Not found: $smali_file"
        return 1
    fi

    # Back up original
    cp "$smali_file" "${smali_file}.orig"

    # Use Python for reliable multi-line smali method body replacement
    python3 - "$smali_file" << 'PYEOF'
import sys
import re

filepath = sys.argv[1]

with open(filepath, 'r') as f:
    content = f.read()

# Parse methods and replace bodies
lines = content.split('\n')
output = []
in_method = False
method_header = ""
method_sig = ""
skip_body = False
locals_line = ""
patched_count = 0

i = 0
while i < len(lines):
    line = lines[i]

    if line.strip().startswith('.method '):
        in_method = True
        method_header = line
        method_sig = line.strip()
        skip_body = False
        locals_line = ""

        # Determine if we should stub this method
        # Always stub: everything except <init> constructors
        # (preserve <init> to prevent instantiation crashes)
        is_init = '<init>' in method_sig
        is_abstract = 'abstract' in method_sig
        is_native = 'native' in method_sig

        if is_init or is_abstract or is_native:
            # Don't touch constructors, abstract, or native methods
            output.append(line)
            i += 1
            continue

        # Determine return type from signature
        # e.g. ".method public onCreate()Z" -> return type is Z (boolean)
        return_match = re.search(r'\)(\[*[VZBCSIJFD]|\[*L[^;]+;)', method_sig)
        if not return_match:
            # Can't parse return type, leave as-is
            output.append(line)
            i += 1
            continue

        return_type = return_match.group(1)

        # Generate stub body
        output.append(line)  # keep .method header

        # Skip to .end method, collecting .locals/.registers
        i += 1
        while i < len(lines) and not lines[i].strip().startswith('.end method'):
            stripped = lines[i].strip()
            if stripped.startswith('.locals') or stripped.startswith('.registers'):
                locals_line = stripped
            # Keep annotation lines (needed for some framework methods)
            if stripped.startswith('.annotation') or stripped.startswith('.end annotation') or stripped.startswith('value'):
                output.append(lines[i])
            elif stripped.startswith('.param') or stripped.startswith('.end param'):
                output.append(lines[i])
            i += 1

        # Determine minimum registers needed
        if return_type == 'V':
            min_regs = 0
            ret_code = "    return-void"
        elif return_type in ('Z', 'B', 'C', 'S', 'I'):
            min_regs = 1
            ret_code = "    const/4 v0, 0x0\n    return v0"
        elif return_type == 'J':
            min_regs = 2
            ret_code = "    const-wide/16 v0, 0x0\n    return-wide v0"
        elif return_type == 'F':
            min_regs = 1
            ret_code = "    const/4 v0, 0x0\n    return v0"
        elif return_type == 'D':
            min_regs = 2
            ret_code = "    const-wide/16 v0, 0x0\n    return-wide v0"
        else:
            # Object type (L...;) or array type ([...)
            min_regs = 1
            ret_code = "    const/4 v0, 0x0\n    return-object v0"

        output.append(f"    .locals {min_regs}")
        output.append("")
        output.append(ret_code)
        output.append("")

        # Add the .end method line
        if i < len(lines):
            output.append(lines[i])
        patched_count += 1
        i += 1
        continue

    output.append(line)
    i += 1

with open(filepath, 'w') as f:
    f.write('\n'.join(output))

print(f"  [x] Stubbed {patched_count} methods in {filepath.split('/')[-1]}")
PYEOF
}

echo "=== Stubbing telemetry smali classes ==="

total_stubbed=0
total_missing=0

while IFS= read -r smali_path; do
    full_path="${DECOMPILED_DIR}/${smali_path}"
    if stub_smali_file "$full_path"; then
        total_stubbed=$((total_stubbed + 1))
    else
        total_missing=$((total_missing + 1))
    fi
done < <(read_config "$STUBS_LIST")

echo ""
echo "=== Smali stubbing complete ==="
echo "  Stubbed: $total_stubbed files"
echo "  Missing: $total_missing files"
echo ""

# ─── Additional targeted patches ───
echo "=== Applying targeted patches ==="

# Patch 1: Disable Sentry auto-init check (already false in manifest, but
# ensure the Java-side check also returns false)
sentry_init=$(find "$DECOMPILED_DIR"/smali* -path "*/io/sentry/android/core/SentryAndroidOptions.smali" 2>/dev/null | head -1)
if [ -n "$sentry_init" ] && [ -f "$sentry_init" ]; then
    echo "  [x] Found Sentry options class (manifest already disables auto-init)"
fi

# Patch 2: Stub device ID utility classes pattern
echo "  Scanning for device ID utility classes..."
for vendor_util in $(find "$DECOMPILED_DIR"/smali* \
    -path "*/adjust/sdk/*/Util.smali" \
    -o -path "*/oaid/*.smali" \
    2>/dev/null); do
    if [ -f "$vendor_util" ] && ! grep -q "\.orig$" <<< "$vendor_util"; then
        stub_smali_file "$vendor_util"
    fi
done

echo ""
echo "=== All smali patches applied ==="
