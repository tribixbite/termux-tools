#!/data/data/com.termux/files/usr/bin/bash
# Claude Edge Bridge — One-time Setup
# Verifies dependencies, packages extension, prints install instructions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/edge-claude-ext"
BRIDGE_TS="$SCRIPT_DIR/claude-chrome-bridge.ts"
CLI_JS="$HOME/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}→${NC} $1"; }

echo "═══════════════════════════════════════════════════"
echo "  Claude Code → Edge Android Bridge Setup"
echo "═══════════════════════════════════════════════════"
echo

# --- Check dependencies -------------------------------------------------------

info "Checking dependencies..."

# Bun
if command -v bun &>/dev/null; then
  ok "bun $(bun --version)"
else
  fail "bun not found. Install: curl -fsSL https://bun.sh/install | bash"
fi

# Claude Code
if [ -f "$CLI_JS" ]; then
  VERSION=$(grep -oP 'VERSION:"[^"]+' "$CLI_JS" | head -1 | cut -d'"' -f2)
  ok "claude-code v${VERSION:-unknown} found"
else
  fail "claude-code not found at $CLI_JS"
fi

# Bridge server
if [ -f "$BRIDGE_TS" ]; then
  ok "Bridge server: $BRIDGE_TS"
else
  fail "Bridge server not found: $BRIDGE_TS"
fi

# Extension
if [ -d "$EXT_DIR" ] && [ -f "$EXT_DIR/manifest.json" ]; then
  ok "Extension directory: $EXT_DIR"
else
  fail "Extension not found: $EXT_DIR"
fi

echo

# --- Package extension as ZIP -------------------------------------------------

info "Packaging extension..."
EXT_ZIP="$SCRIPT_DIR/claude-edge-ext.zip"
(cd "$EXT_DIR" && zip -q -r "$EXT_ZIP" . -x "*.DS_Store" "*.swp")
ok "Extension packaged: $EXT_ZIP ($(du -h "$EXT_ZIP" | cut -f1))"

echo

# --- Quick bridge test --------------------------------------------------------

info "Testing bridge server startup..."
timeout 5 bun "$BRIDGE_TS" &
BRIDGE_PID=$!
sleep 2

if kill -0 "$BRIDGE_PID" 2>/dev/null; then
  HEALTH=$(curl -sf http://127.0.0.1:18963/health 2>/dev/null || echo '{}')
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    ok "Bridge server responds on :18963"
  else
    warn "Bridge started but /health failed: $HEALTH"
  fi
  kill "$BRIDGE_PID" 2>/dev/null
  wait "$BRIDGE_PID" 2>/dev/null || true
else
  warn "Bridge server failed to start (may need debugging)"
fi

echo

# --- CFC feature gate check ---------------------------------------------------

info "Checking CFC feature gate..."
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  if grep -q "claudeInChromeDefaultEnabled" "$SETTINGS"; then
    ok "CFC setting found in settings.json"
  else
    warn "CFC not enabled in settings.json — will use env var CLAUDE_CODE_ENABLE_CFC=true"
  fi
fi

echo
echo "═══════════════════════════════════════════════════"
echo "  Installation Instructions"
echo "═══════════════════════════════════════════════════"
echo
echo -e "${BLUE}Option A: Edge Android (developer mode)${NC}"
echo "  1. Open Edge → edge://flags"
echo "     Enable 'Extension developer mode'"
echo "     Enable 'Extensions on Edge' if present"
echo "  2. Open edge://extensions"
echo "     Enable 'Developer mode' toggle"
echo "  3. Load the extension:"
echo "     - If 'Load unpacked' available → browse to:"
echo "       $EXT_DIR"
echo "     - If only CRX/ZIP → load:"
echo "       $EXT_ZIP"
echo "  4. Grant all requested permissions"
echo
echo -e "${BLUE}Option B: Termux X11 + Chromium (full API support)${NC}"
echo "  pkg install chromium"
echo "  # Start Termux:X11, then:"
echo "  DISPLAY=:0 chromium --no-sandbox \\"
echo "    --load-extension=$EXT_DIR"
echo
echo -e "${BLUE}Usage:${NC}"
echo "  # Start bridge + Claude:"
echo "  ./claude-edge-bridge.sh"
echo
echo -e "${BLUE}Manual start:${NC}"
echo "  # Terminal 1 — bridge:"
echo "  CLAUDE_CODE_ENABLE_CFC=true bun $BRIDGE_TS"
echo "  # Terminal 2 — Claude:"
echo "  CLAUDE_CODE_ENABLE_CFC=true claude"
echo
echo -e "${GREEN}Setup complete.${NC}"
