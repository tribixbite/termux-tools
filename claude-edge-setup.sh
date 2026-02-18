#!/data/data/com.termux/files/usr/bin/bash
# CFC Bridge Installer — Interactive setup for Claude Code ↔ Edge Android
#
# Usage:
#   ./claude-edge-setup.sh          # interactive menu from repo
#   ./claude-edge-setup.sh --all    # run all steps non-interactively
#   curl -fsSL <raw-url> | bash     # bootstrap: clones repo, then runs from it
#
# Modular design: each menu option sources a module from install/modules/.
# Shared utilities live in install/lib/common.sh.

set -euo pipefail

# --- Bootstrap: ensure we're running from the repo ----------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"

# If running from a pipe (curl | bash) or not in the repo, bootstrap first
if [[ ! -f "${SCRIPT_DIR}/claude-chrome-bridge.ts" ]]; then
  echo -e "\033[1mCFC Bootstrap\033[0m"
  echo

  # Ensure git is available
  if ! command -v git &>/dev/null; then
    echo -e "  \033[0;34m→\033[0m Installing git..."
    if command -v pkg &>/dev/null; then
      pkg install -y git 2>/dev/null
    elif command -v pacman &>/dev/null; then
      pacman -S git --noconfirm 2>/dev/null
    fi
    if ! command -v git &>/dev/null; then
      echo -e "  \033[0;31m✗\033[0m Could not install git. Please run: pkg install git"
      exit 1
    fi
  fi

  REPO_TARGET="${HOME}/git/termux-tools"
  mkdir -p "${HOME}/git"

  if [[ -d "${REPO_TARGET}/.git" ]]; then
    echo -e "  \033[0;34m→\033[0m Updating existing repo..."
    git -C "$REPO_TARGET" pull --ff-only 2>/dev/null || true
  else
    echo -e "  \033[0;34m→\033[0m Cloning tribixbite/termux-tools..."
    git clone "https://github.com/tribixbite/termux-tools.git" "$REPO_TARGET" || {
      echo -e "  \033[0;31m✗\033[0m Clone failed"
      exit 1
    }
  fi

  echo -e "  \033[0;32m✓\033[0m Repository ready"
  echo

  # Re-exec from the cloned repo
  exec "${REPO_TARGET}/claude-edge-setup.sh" "$@"
fi

# --- We're in the repo — source shared library --------------------------------

source "${SCRIPT_DIR}/install/lib/common.sh"

# --- Module loader ------------------------------------------------------------

_load_module() {
  local mod="${SCRIPT_DIR}/install/modules/${1}.sh"
  if [[ -f "$mod" ]]; then
    source "$mod"
  else
    fail "Module not found: ${mod}"
    return 1
  fi
}

# --- Run all ------------------------------------------------------------------

run_all() {
  header "Running full setup..."
  echo

  _load_module bun
  module_bun
  echo

  _load_module claude-code
  module_claude_code
  echo

  _load_module termux-config
  module_termux_config
  echo

  _load_module adb
  module_adb
  echo

  _load_module crx
  module_crx
  echo

  _load_module extension
  module_extension
  echo

  # Start bridge
  _load_module health
  if ! detect_bridge; then
    if ask_yn "Start the bridge now?" Y; then
      "${SCRIPT_DIR}/claude-edge-bridge.sh" start
    fi
  fi
  echo

  module_health
}

# --- Interactive menu ---------------------------------------------------------

show_menu() {
  echo
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  CFC Bridge Installer${NC}"
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  echo

  # Compute status for each item
  local s_bun s_cc s_termux s_adb s_crx s_bridge
  s_bun=$(status_indicator detect_bun 2>/dev/null)
  s_cc=$(status_indicator detect_claude_code 2>/dev/null)
  s_termux=$(status_indicator detect_termux_config 2>/dev/null)
  s_adb=$(status_indicator detect_adb 2>/dev/null)
  s_crx=$(status_indicator detect_crx 2>/dev/null)
  s_bridge=$(status_indicator detect_bridge 2>/dev/null)

  echo -e "  ${BOLD}1)${NC} Install Bun (via bun-on-termux)     ${s_bun}"
  echo -e "  ${BOLD}2)${NC} Install Claude Code CLI              ${s_cc}"
  echo -e "  ${BOLD}3)${NC} Configure Termux permissions         ${s_termux}"
  echo -e "  ${BOLD}4)${NC} Setup ADB wireless                   ${s_adb}"
  echo -e "  ${BOLD}5)${NC} Build extension (CRX)                ${s_crx}"
  echo -e "  ${BOLD}6)${NC} Install extension in browser"
  echo -e "  ${BOLD}7)${NC} Start/manage bridge                  ${s_bridge}"
  echo -e "  ${BOLD}8)${NC} Health check & diagnostics"
  echo -e "  ${BOLD}9)${NC} Run all (full setup)"
  echo -e "  ${BOLD}0)${NC} Exit"
  echo
  echo -ne "  ${CYAN}Choose [0-9]:${NC} "
}

handle_choice() {
  local choice="$1"
  case "$choice" in
    1)
      _load_module bun
      module_bun
      ;;
    2)
      _load_module claude-code
      module_claude_code
      ;;
    3)
      _load_module termux-config
      module_termux_config
      ;;
    4)
      _load_module adb
      module_adb
      ;;
    5)
      _load_module crx
      module_crx
      ;;
    6)
      _load_module extension
      module_extension
      ;;
    7)
      echo
      echo -e "  ${BOLD}Bridge management:${NC}"
      echo -e "    ${BOLD}a)${NC} Start bridge"
      echo -e "    ${BOLD}b)${NC} Stop bridge"
      echo -e "    ${BOLD}c)${NC} Status"
      echo -e "    ${BOLD}d)${NC} Restart"
      echo -e "    ${BOLD}e)${NC} View logs"
      echo
      echo -ne "  ${CYAN}Choose [a-e]:${NC} "
      read -r sub
      case "$sub" in
        a) "${SCRIPT_DIR}/claude-edge-bridge.sh" start ;;
        b) "${SCRIPT_DIR}/claude-edge-bridge.sh" stop ;;
        c) "${SCRIPT_DIR}/claude-edge-bridge.sh" status ;;
        d) "${SCRIPT_DIR}/claude-edge-bridge.sh" restart ;;
        e) "${SCRIPT_DIR}/claude-edge-bridge.sh" logs ;;
        *) warn "Unknown option" ;;
      esac
      ;;
    8)
      _load_module health
      module_health
      ;;
    9)
      run_all
      ;;
    0)
      echo -e "\n  ${DIM}Goodbye${NC}"
      exit 0
      ;;
    *)
      warn "Invalid choice"
      ;;
  esac
}

# --- Main ---------------------------------------------------------------------

# Handle --all flag
if [[ "${1:-}" == "--all" ]]; then
  run_all
  exit 0
fi

# Interactive loop
while true; do
  show_menu
  read -r choice
  handle_choice "$choice"
  echo
  echo -ne "  ${DIM}Press Enter to continue...${NC}"
  read -r
done
