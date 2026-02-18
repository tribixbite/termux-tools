#!/data/data/com.termux/files/usr/bin/bash
# Shared utilities for CFC installer modules
# Source this file — do not execute directly.

# --- Constants ----------------------------------------------------------------

TERMUX_PREFIX="/data/data/com.termux/files/usr"
TERMUX_BIN="${TERMUX_PREFIX}/bin"
TERMUX_HOME="/data/data/com.termux/files/home"
TERMUX_PROPS="${TERMUX_HOME}/.termux/termux.properties"
BUN_DIR="${TERMUX_HOME}/.bun"
BUN_BIN="${BUN_DIR}/bin/bun"
CLI_JS_GLOBAL="${TERMUX_HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js"
BRIDGE_PORT="${BRIDGE_PORT:-18963}"
BRIDGE_HEALTH_URL="http://127.0.0.1:${BRIDGE_PORT}/health"
BRIDGE_LOG="${TERMUX_PREFIX}/tmp/claude-chrome-bridge.log"
BRIDGE_PID_FILE="${TERMUX_PREFIX}/tmp/claude-chrome-bridge.pid"
GITHUB_REPO="tribixbite/termux-tools"
GITHUB_RAW="https://raw.githubusercontent.com/${GITHUB_REPO}/main"
BUN_ON_TERMUX_REPO="tribixbite/bun-on-termux"
DOWNLOAD_DIR="${TERMUX_HOME}/storage/shared/Download"

# Resolve REPO_DIR: walk up from this file's location to find the repo root
# (install/lib/common.sh → repo root is ../../)
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  _COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_DIR="$(cd "${_COMMON_DIR}/../.." && pwd)"
else
  REPO_DIR="${TERMUX_HOME}/git/termux-tools"
fi

BRIDGE_TS="${REPO_DIR}/claude-chrome-bridge.ts"
EXT_DIR="${REPO_DIR}/edge-claude-ext"
CRX_KEY="${REPO_DIR}/edge-claude-ext.pem"
MANIFEST_JSON="${EXT_DIR}/manifest.json"

# --- Colors -------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# --- Output helpers -----------------------------------------------------------

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}→${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

# --- Interactive prompts ------------------------------------------------------

# Ask yes/no question. Usage: ask_yn "Do thing?" Y  (default Y)
# Returns 0 for yes, 1 for no.
ask_yn() {
  local prompt="$1"
  local default="${2:-Y}"
  local yn_hint
  if [[ "$default" =~ ^[Yy] ]]; then
    yn_hint="[Y/n]"
  else
    yn_hint="[y/N]"
  fi
  echo -ne "  ${CYAN}?${NC} ${prompt} ${DIM}${yn_hint}${NC} "
  read -r answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

# --- Detection functions ------------------------------------------------------
# Each returns 0=ok, 1=missing, 2=partial and sets a global _DETECT_* variable
# with human-readable status text.

detect_bun() {
  if [[ -x "$BUN_BIN" ]]; then
    local ver
    ver=$("$BUN_BIN" --version 2>/dev/null)
    if [[ -n "$ver" ]]; then
      _DETECT_BUN="v${ver}"
      return 0
    fi
  fi
  if command -v bun &>/dev/null; then
    local ver
    ver=$(bun --version 2>/dev/null)
    _DETECT_BUN="v${ver} (PATH)"
    return 0
  fi
  _DETECT_BUN="not found"
  return 1
}

detect_claude_code() {
  if [[ -f "$CLI_JS_GLOBAL" ]]; then
    local ver
    ver=$(grep -oP 'VERSION:"[^"]+' "$CLI_JS_GLOBAL" 2>/dev/null | head -1 | cut -d'"' -f2)
    _DETECT_CLAUDE_CODE="v${ver:-unknown}"
    return 0
  fi
  # Also check repo copy
  local repo_cli="${REPO_DIR}/cli.js"
  if [[ -f "$repo_cli" ]]; then
    _DETECT_CLAUDE_CODE="repo copy"
    return 0
  fi
  _DETECT_CLAUDE_CODE="not found"
  return 1
}

detect_termux_config() {
  local score=0
  local total=3
  # Check allow-external-apps
  if [[ -f "$TERMUX_PROPS" ]] && grep -q "^allow-external-apps *= *true" "$TERMUX_PROPS" 2>/dev/null; then
    ((score++))
  fi
  # Check storage linked
  if [[ -d "${TERMUX_HOME}/storage/shared" ]]; then
    ((score++))
  fi
  # Check CFC env var in bashrc
  if grep -q "CLAUDE_CODE_ENABLE_CFC" "${TERMUX_HOME}/.bashrc" 2>/dev/null; then
    ((score++))
  fi

  if [[ $score -eq $total ]]; then
    _DETECT_TERMUX_CONFIG="configured"
    return 0
  elif [[ $score -gt 0 ]]; then
    _DETECT_TERMUX_CONFIG="${score}/${total}"
    return 2
  fi
  _DETECT_TERMUX_CONFIG="not configured"
  return 1
}

detect_adb() {
  if ! command -v adb &>/dev/null; then
    _DETECT_ADB="not installed"
    return 1
  fi
  local devices
  devices=$(adb devices 2>/dev/null | grep -c "device$" || true)
  if [[ "$devices" -gt 0 ]]; then
    _DETECT_ADB="${devices} device(s)"
    return 0
  fi
  _DETECT_ADB="no device"
  return 2
}

detect_crx() {
  if [[ ! -f "$MANIFEST_JSON" ]]; then
    _DETECT_CRX="no manifest"
    return 1
  fi
  local manifest_ver
  manifest_ver=$(grep -oP '"version":\s*"\K[^"]+' "$MANIFEST_JSON" 2>/dev/null)
  local crx_file="${REPO_DIR}/dist/claude-code-bridge-v${manifest_ver}.crx"
  if [[ -f "$crx_file" ]]; then
    _DETECT_CRX="v${manifest_ver}"
    return 0
  fi
  # Check Downloads
  if [[ -f "${DOWNLOAD_DIR}/claude-code-bridge.crx" ]]; then
    _DETECT_CRX="v${manifest_ver} (Downloads)"
    return 0
  fi
  _DETECT_CRX="not built"
  return 1
}

detect_bridge() {
  local health
  health=$(curl -sf "$BRIDGE_HEALTH_URL" 2>/dev/null)
  if [[ $? -eq 0 ]] && echo "$health" | grep -q '"status":"ok"'; then
    local ver
    ver=$(echo "$health" | grep -oP '"version":"[^"]+' | cut -d'"' -f4)
    _DETECT_BRIDGE="v${ver} running"
    return 0
  fi
  # Check if process exists but not responding
  if pgrep -f "claude-chrome-bridge" &>/dev/null; then
    _DETECT_BRIDGE="process exists, not responding"
    return 2
  fi
  _DETECT_BRIDGE="not running"
  return 1
}

detect_storage() {
  if [[ -d "${TERMUX_HOME}/storage/shared" ]]; then
    _DETECT_STORAGE="linked"
    return 0
  fi
  _DETECT_STORAGE="not linked"
  return 1
}

# --- Status indicator for menu ------------------------------------------------

# Usage: status_indicator detect_bun
# Outputs colored status like "[v1.2.3 ✓]" or "[not found ✗]"
status_indicator() {
  local detect_fn="$1"
  $detect_fn
  local rc=$?
  local text="${2:-}"
  # Get the _DETECT_* variable name from function name
  local varname="_DETECT_${detect_fn#detect_}"
  varname="${varname^^}"
  text="${!varname:-unknown}"

  case $rc in
    0) echo -e "${GREEN}[${text} ✓]${NC}" ;;
    2) echo -e "${YELLOW}[${text} ~]${NC}" ;;
    *) echo -e "${RED}[${text} ✗]${NC}" ;;
  esac
}

# --- Repo bootstrap -----------------------------------------------------------

# Ensure we're running from the repo. If not, clone and re-exec.
ensure_repo() {
  # Already in repo?
  if [[ -f "${REPO_DIR}/claude-chrome-bridge.ts" ]]; then
    return 0
  fi

  header "Bootstrap: cloning repository"

  # Ensure git is available
  if ! command -v git &>/dev/null; then
    info "Installing git..."
    pkg install -y git 2>/dev/null || {
      fail "Could not install git. Please run: pkg install git"
      return 1
    }
  fi

  # Create ~/git if needed
  mkdir -p "${TERMUX_HOME}/git"

  local target="${TERMUX_HOME}/git/termux-tools"
  if [[ -d "$target/.git" ]]; then
    info "Updating existing repo..."
    git -C "$target" pull --ff-only 2>/dev/null || true
  else
    info "Cloning ${GITHUB_REPO}..."
    git clone "https://github.com/${GITHUB_REPO}.git" "$target" || {
      fail "Clone failed"
      return 1
    }
  fi

  ok "Repository ready at ${target}"

  # Re-exec from the repo
  exec "${target}/claude-edge-setup.sh" "$@"
}

# --- Manifest version helper --------------------------------------------------

manifest_version() {
  grep -oP '"version":\s*"\K[^"]+' "$MANIFEST_JSON" 2>/dev/null || echo "unknown"
}
