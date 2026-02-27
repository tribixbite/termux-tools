#!/data/data/com.termux/files/usr/bin/bash
# patch-manifest.sh - Wrapper for Python-based manifest patcher
# Usage: ./scripts/patch-manifest.sh <path-to-decoded-manifest>

set -euo pipefail

MANIFEST="$1"
SCRIPT_DIR="$(dirname "$0")"
CONFIG_DIR="$SCRIPT_DIR/../config"

python3 "$SCRIPT_DIR/patch-manifest.py" "$MANIFEST" "$CONFIG_DIR"
