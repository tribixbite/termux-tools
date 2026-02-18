#!/data/data/com.termux/files/usr/bin/bash
# CFC Bridge — Lifecycle manager for the Claude ↔ Edge WebSocket bridge
#
# Usage:
#   ./claude-edge-bridge.sh           # start bridge + launch claude (daily use)
#   ./claude-edge-bridge.sh start     # start bridge only
#   ./claude-edge-bridge.sh stop      # stop bridge
#   ./claude-edge-bridge.sh status    # health check + process info
#   ./claude-edge-bridge.sh restart   # stop then start
#   ./claude-edge-bridge.sh logs      # tail bridge log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_TS="$SCRIPT_DIR/claude-chrome-bridge.ts"
BRIDGE_LOG="/data/data/com.termux/files/usr/tmp/claude-chrome-bridge.log"
BRIDGE_PID_FILE="/data/data/com.termux/files/usr/tmp/claude-chrome-bridge.pid"
BRIDGE_PORT="${BRIDGE_PORT:-18963}"
BRIDGE_HEALTH_URL="http://127.0.0.1:${BRIDGE_PORT}/health"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# --- Helpers ------------------------------------------------------------------

_bridge_pid() {
  # Check PID file first
  if [[ -f "$BRIDGE_PID_FILE" ]]; then
    local pid
    pid=$(cat "$BRIDGE_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$BRIDGE_PID_FILE"
  fi
  # Fallback: find by process name
  pgrep -f "claude-chrome-bridge" 2>/dev/null | head -1
}

_is_running() {
  local pid
  pid=$(_bridge_pid)
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

_health_check() {
  curl -sf "$BRIDGE_HEALTH_URL" 2>/dev/null
}

# --- Commands -----------------------------------------------------------------

cmd_start() {
  if _is_running; then
    local pid
    pid=$(_bridge_pid)
    echo -e "${GREEN}Bridge already running (PID ${pid})${NC}"
    local health
    health=$(_health_check)
    if [[ -n "$health" ]]; then
      echo "$health" | python3 -m json.tool 2>/dev/null || echo "$health"
    fi
    return 0
  fi

  echo -e "${BLUE}Starting bridge server...${NC}"

  # Environment
  export CLAUDE_CODE_ENABLE_CFC=true
  export BRIDGE_LOG_LEVEL="${BRIDGE_LOG_LEVEL:-info}"
  [[ -n "${BRIDGE_TOKEN:-}" ]] && export BRIDGE_TOKEN && echo -e "${YELLOW}Auth: token required${NC}"

  # Start bridge in background
  nohup bun "$BRIDGE_TS" >> "$BRIDGE_LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$BRIDGE_PID_FILE"

  # Wait for health
  for i in $(seq 1 10); do
    sleep 0.5
    if _health_check >/dev/null 2>&1; then
      echo -e "${GREEN}Bridge ready on ws://127.0.0.1:${BRIDGE_PORT} (PID ${pid})${NC}"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo -e "${RED}Bridge failed to start. Check: tail ${BRIDGE_LOG}${NC}"
      rm -f "$BRIDGE_PID_FILE"
      return 1
    fi
    if [[ "$i" -eq 10 ]]; then
      echo -e "${YELLOW}Bridge slow to start — PID ${pid} still alive${NC}"
    fi
  done
}

cmd_stop() {
  local pid
  pid=$(_bridge_pid)
  if [[ -z "$pid" ]]; then
    echo -e "${DIM}Bridge not running${NC}"
    return 0
  fi

  echo -e "${YELLOW}Stopping bridge (PID ${pid})...${NC}"
  kill "$pid" 2>/dev/null
  # Wait up to 5 seconds for graceful shutdown
  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}Bridge stopped${NC}"
      rm -f "$BRIDGE_PID_FILE"
      return 0
    fi
    sleep 0.5
  done

  # Force kill if still alive
  kill -9 "$pid" 2>/dev/null
  rm -f "$BRIDGE_PID_FILE"
  echo -e "${YELLOW}Bridge force-killed${NC}"
}

cmd_status() {
  local pid
  pid=$(_bridge_pid)

  if [[ -z "$pid" ]]; then
    echo -e "${RED}Bridge not running${NC}"
    return 1
  fi

  echo -e "${GREEN}Bridge running (PID ${pid})${NC}"

  local health
  health=$(_health_check)
  if [[ -n "$health" ]]; then
    echo "$health" | python3 -m json.tool 2>/dev/null || echo "$health"
  else
    echo -e "${YELLOW}Process alive but health endpoint not responding${NC}"
  fi
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_logs() {
  if [[ -f "$BRIDGE_LOG" ]]; then
    echo -e "${BLUE}Bridge log: ${BRIDGE_LOG}${NC}"
    echo -e "${DIM}(Ctrl+C to stop)${NC}"
    tail -f "$BRIDGE_LOG"
  else
    echo -e "${DIM}No log file found at ${BRIDGE_LOG}${NC}"
  fi
}

cmd_run() {
  # Default behavior: start bridge + launch claude (daily use)
  # Cleanup on exit
  cleanup() {
    local pid
    pid=$(_bridge_pid)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo -e "${YELLOW}Stopping bridge (PID ${pid})...${NC}"
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$BRIDGE_PID_FILE"
  }
  trap cleanup EXIT INT TERM

  cmd_start || exit 1

  echo
  echo -e "${BLUE}Launching Claude with CFC enabled...${NC}"
  echo

  export CLAUDE_CODE_ENABLE_CFC=true
  export DISABLE_AUTOUPDATER="${DISABLE_AUTOUPDATER:-true}"

  # Pass through any remaining CLI args
  claude "$@"
}

# --- Main dispatch ------------------------------------------------------------

case "${1:-}" in
  start)   shift; cmd_start "$@" ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  restart) cmd_restart ;;
  logs)    cmd_logs ;;
  help|--help|-h)
    echo "Usage: $(basename "$0") [start|stop|status|restart|logs]"
    echo "  (no args)  Start bridge + launch Claude"
    echo "  start      Start bridge only"
    echo "  stop       Stop bridge"
    echo "  status     Health check + process info"
    echo "  restart    Stop then start"
    echo "  logs       Tail bridge log"
    ;;
  *)       cmd_run "$@" ;;
esac
