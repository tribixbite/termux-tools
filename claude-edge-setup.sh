#!/data/data/com.termux/files/usr/bin/bash
# Claude Edge Bridge — One-time Setup
# Verifies deps, builds CRX3, copies to Downloads, tests bridge,
# prints Edge Canary install steps.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/edge-claude-ext"
BRIDGE_TS="$SCRIPT_DIR/claude-chrome-bridge.ts"
CLI_JS="$HOME/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js"
CRX_KEY="$SCRIPT_DIR/edge-claude-ext.pem"
CRX_FILE="$SCRIPT_DIR/claude-code-bridge.crx"
DOWNLOAD_DIR="$HOME/storage/shared/Download"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${BLUE}→${NC} $1"; }

echo
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Claude Code → Edge Canary Bridge Setup${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo

# --- Check dependencies -------------------------------------------------------

echo -e "${BOLD}[1/5] Checking dependencies${NC}"

# Bun
if command -v bun &>/dev/null; then
  ok "bun $(bun --version)"
else
  fail "bun not found. Install: curl -fsSL https://bun.sh/install | bash"
fi

# Claude Code
if [ -f "$CLI_JS" ]; then
  VERSION=$(grep -oP 'VERSION:"[^"]+' "$CLI_JS" | head -1 | cut -d'"' -f2)
  ok "claude-code v${VERSION:-unknown}"
else
  fail "claude-code not found at $CLI_JS"
fi

# Bridge server
if [ -f "$BRIDGE_TS" ]; then
  ok "bridge server"
else
  fail "bridge server not found: $BRIDGE_TS"
fi

# Extension source
if [ -d "$EXT_DIR" ] && [ -f "$EXT_DIR/manifest.json" ]; then
  ok "extension source"
else
  fail "extension not found: $EXT_DIR"
fi

# crx3 tool
if command -v crx3 &>/dev/null; then
  ok "crx3 packager"
else
  info "Installing crx3..."
  npm install -g crx3 >/dev/null 2>&1
  if command -v crx3 &>/dev/null; then
    ok "crx3 installed"
  else
    fail "Failed to install crx3 (npm install -g crx3)"
  fi
fi

# openssl (for key generation)
if command -v openssl &>/dev/null; then
  ok "openssl"
else
  fail "openssl not found. Install: pkg install openssl-tool"
fi

echo

# --- Build CRX3 ---------------------------------------------------------------

echo -e "${BOLD}[2/5] Building CRX3 extension${NC}"

# Generate signing key if missing
if [ ! -f "$CRX_KEY" ]; then
  info "Generating RSA signing key..."
  openssl genrsa -out "$CRX_KEY" 2048 2>/dev/null
  ok "Key generated: $(basename "$CRX_KEY")"
else
  ok "Signing key exists"
fi

# Build CRX3
info "Packaging CRX3..."
crx3 "$EXT_DIR" -p "$CRX_KEY" -o "$CRX_FILE" >/dev/null 2>&1
CRX_SIZE=$(du -h "$CRX_FILE" | cut -f1)
ok "Built: $(basename "$CRX_FILE") (${CRX_SIZE})"

# Verify it's a valid CRX3
CRX_TYPE=$(file "$CRX_FILE" 2>/dev/null)
if echo "$CRX_TYPE" | grep -q "Chrome extension, version 3"; then
  ok "Valid CRX3 format"
else
  warn "File type: $CRX_TYPE"
fi

# Copy to Downloads for Edge to access
if [ -d "$DOWNLOAD_DIR" ]; then
  cp "$CRX_FILE" "$DOWNLOAD_DIR/claude-code-bridge.crx"
  ok "Copied to Downloads: ${DOWNLOAD_DIR}/claude-code-bridge.crx"
else
  warn "Shared storage not linked — run 'termux-setup-storage' first"
  warn "Then copy manually: cp $CRX_FILE ~/storage/shared/Download/"
fi

echo

# --- Test bridge server -------------------------------------------------------

echo -e "${BOLD}[3/5] Testing bridge server${NC}"

timeout 5 bun "$BRIDGE_TS" >/dev/null 2>&1 &
BRIDGE_PID=$!
sleep 2

if kill -0 "$BRIDGE_PID" 2>/dev/null; then
  HEALTH=$(curl -sf http://127.0.0.1:18963/health 2>/dev/null || echo '{}')
  if echo "$HEALTH" | grep -q '"status":"ok"'; then
    ok "Bridge responds on ws://127.0.0.1:18963"
  else
    warn "Bridge started but /health check failed"
  fi
  kill "$BRIDGE_PID" 2>/dev/null
  wait "$BRIDGE_PID" 2>/dev/null || true
else
  warn "Bridge failed to start (check logs)"
fi

echo

# --- CFC feature gate ---------------------------------------------------------

echo -e "${BOLD}[4/5] Checking CFC feature gate${NC}"

SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  if grep -q "claudeInChromeDefaultEnabled" "$SETTINGS"; then
    ok "CFC enabled in settings.json"
  else
    warn "CFC not in settings.json — launch script uses CLAUDE_CODE_ENABLE_CFC=true"
  fi
else
  warn "No settings.json found"
fi

echo

# --- Install instructions -----------------------------------------------------

echo -e "${BOLD}[5/5] Edge Canary Install Instructions${NC}"
echo
echo -e "  ${BOLD}Step 1: Enable developer options in Edge Canary${NC}"
echo "    Open Edge Canary → Settings → About"
echo "    Tap the Edge build number 5 times"
echo "    (e.g. 'Edge Canary 136.0.xxxx.x')"
echo
echo -e "  ${BOLD}Step 2: Install CRX${NC}"
echo "    Settings → Developer Options → Extension install by CRX"
echo "    Browse to: Download/claude-code-bridge.crx"
echo "    Confirm install → grant permissions"
echo
echo -e "  ${BOLD}Step 3: Start the bridge${NC}"
echo "    ./claude-edge-bridge.sh"
echo
echo -e "  ${BOLD}Step 4: Verify connection${NC}"
echo "    Tap the extension icon in Edge Canary"
echo "    Status should show 'connected'"
echo
echo -e "  ${BOLD}Alternative: Chrome Canary${NC}"
echo "    chrome://flags → #extension-mime-request-handling → Always prompt"
echo "    Open the CRX file from Downloads → install"
echo
echo -e "  ${BOLD}Alternative: Termux X11 + Chromium${NC}"
echo "    pkg install chromium"
echo "    DISPLAY=:0 chromium --no-sandbox --load-extension=$EXT_DIR"
echo
echo -e "${GREEN}${BOLD}Setup complete.${NC} CRX ready at:"
echo -e "  ${DOWNLOAD_DIR}/claude-code-bridge.crx"
echo
