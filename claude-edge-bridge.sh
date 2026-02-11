#!/data/data/com.termux/files/usr/bin/bash
# Claude Edge Bridge — Daily-use launcher
# Starts the WebSocket bridge, then launches Claude with CFC enabled.
# Bridge auto-stops when Claude exits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_TS="$SCRIPT_DIR/claude-chrome-bridge.ts"
BRIDGE_LOG="/data/data/com.termux/files/usr/tmp/claude-chrome-bridge.log"
BRIDGE_PID_FILE="/data/data/com.termux/files/usr/tmp/claude-chrome-bridge.pid"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

cleanup() {
  if [ -f "$BRIDGE_PID_FILE" ]; then
    local pid
    pid=$(cat "$BRIDGE_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${YELLOW}Stopping bridge (PID $pid)...${NC}"
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$BRIDGE_PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

# --- Check if bridge already running ------------------------------------------

if [ -f "$BRIDGE_PID_FILE" ]; then
  OLD_PID=$(cat "$BRIDGE_PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo -e "${GREEN}Bridge already running (PID $OLD_PID)${NC}"
    HEALTH=$(curl -sf http://127.0.0.1:18963/health 2>/dev/null || echo '{}')
    echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
    echo
  else
    rm -f "$BRIDGE_PID_FILE"
  fi
fi

# --- Start bridge if not running ----------------------------------------------

if [ ! -f "$BRIDGE_PID_FILE" ]; then
  echo -e "${BLUE}Starting bridge server...${NC}"

  # Environment
  export CLAUDE_CODE_ENABLE_CFC=true
  export BRIDGE_LOG_LEVEL="${BRIDGE_LOG_LEVEL:-info}"

  # Optional token auth
  if [ -n "${BRIDGE_TOKEN:-}" ]; then
    export BRIDGE_TOKEN
    echo -e "${YELLOW}Auth: token required${NC}"
  fi

  # Start bridge in background
  nohup bun "$BRIDGE_TS" >> "$BRIDGE_LOG" 2>&1 &
  BRIDGE_PID=$!
  echo "$BRIDGE_PID" > "$BRIDGE_PID_FILE"

  # Wait for bridge to be ready
  for i in $(seq 1 10); do
    sleep 0.5
    if curl -sf http://127.0.0.1:18963/health >/dev/null 2>&1; then
      echo -e "${GREEN}Bridge ready on ws://127.0.0.1:18963 (PID $BRIDGE_PID)${NC}"
      break
    fi
    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
      echo -e "${RED}Bridge failed to start. Check $BRIDGE_LOG${NC}"
      exit 1
    fi
    if [ "$i" -eq 10 ]; then
      echo -e "${YELLOW}Bridge slow to start, continuing anyway...${NC}"
    fi
  done
fi

echo -e "${BLUE}Launching Claude with CFC enabled...${NC}"
echo -e "${YELLOW}Tip: Use 'claude --chrome' or enable the claude-in-chrome skill${NC}"
echo

# --- Launch Claude ------------------------------------------------------------

export CLAUDE_CODE_ENABLE_CFC=true
export DISABLE_AUTOUPDATER="${DISABLE_AUTOUPDATER:-true}"

# Pass through any CLI args
claude "$@"
