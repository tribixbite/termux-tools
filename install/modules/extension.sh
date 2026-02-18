#!/data/data/com.termux/files/usr/bin/bash
# Module: Guide user through extension sideload

module_extension() {
  header "[Extension] Install in browser"

  local version
  version=$(manifest_version)
  local crx_in_downloads="${DOWNLOAD_DIR}/claude-code-bridge.crx"

  # Check if CRX is in Downloads
  if [[ -f "$crx_in_downloads" ]]; then
    ok "CRX found in Downloads"
  else
    warn "CRX not found in Downloads"
    info "Run 'Build CRX' (option 5) first"
    if ask_yn "Build CRX now?" Y; then
      source "${REPO_DIR}/install/modules/crx.sh"
      module_crx || return 1
    else
      return 1
    fi
  fi

  echo
  echo -e "  ${BOLD}════════════════════════════════════════════════${NC}"
  echo -e "  ${BOLD}  Extension Installation Guide (v${version})${NC}"
  echo -e "  ${BOLD}════════════════════════════════════════════════${NC}"

  echo
  echo -e "  ${BOLD}Option A: Edge Canary (recommended)${NC}"
  echo
  echo -e "    ${BOLD}1.${NC} Enable Developer Options:"
  echo "       Open Edge Canary → ⋯ → Settings → About"
  echo "       Tap the Edge build number 5 times"
  echo
  echo -e "    ${BOLD}2.${NC} Install the extension:"
  echo "       Settings → Developer Options → Extension install by CRX"
  echo "       Browse to: Download/claude-code-bridge.crx"
  echo "       Confirm install and grant permissions"
  echo
  echo -e "    ${BOLD}3.${NC} Verify:"
  echo "       Tap the extension puzzle piece icon"
  echo "       Open 'Claude Code Bridge' popup"
  echo "       Status should show 'Disconnected' (bridge not running yet)"
  echo

  echo -e "  ${BOLD}Option B: Chrome Canary${NC}"
  echo
  echo "    Navigate to: chrome://flags"
  echo "    Search: #extension-mime-request-handling"
  echo "    Set to: 'Always prompt for install'"
  echo "    Open the CRX file from Downloads → install"
  echo

  echo -e "  ${BOLD}Option C: Termux X11 + Chromium${NC}"
  echo
  echo "    pkg install chromium"
  echo "    DISPLAY=:0 chromium --no-sandbox --load-extension=${EXT_DIR}"
  echo

  # Offer to launch Edge
  if command -v adb &>/dev/null && detect_adb >/dev/null 2>&1; then
    if ask_yn "Open Edge Canary now (via ADB)?" N; then
      adb shell am start -n com.microsoft.emmx.canary/com.microsoft.ruby.Main 2>/dev/null
      ok "Edge Canary launched"
    fi
  fi
}
