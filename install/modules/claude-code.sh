#!/data/data/com.termux/files/usr/bin/bash
# Module: Install Claude Code CLI

module_claude_code() {
  header "[Claude Code] Install CLI"

  # Check if already installed
  if detect_claude_code; then
    ok "Claude Code already installed: ${_DETECT_CLAUDE_CODE}"
    if ! ask_yn "Reinstall/update anyway?" N; then
      _ensure_cfc_env
      return 0
    fi
  fi

  # Ensure bun is available
  if ! detect_bun; then
    fail "Bun is required to install Claude Code"
    info "Run the Bun installer first (option 1)"
    return 1
  fi

  # Install globally via bun
  info "Installing @anthropic-ai/claude-code..."
  if bun install -g @anthropic-ai/claude-code 2>&1; then
    ok "Claude Code installed"
  else
    fail "Installation failed"
    return 1
  fi

  # Verify
  if detect_claude_code; then
    ok "Verified: ${_DETECT_CLAUDE_CODE}"
  else
    warn "Install completed but cli.js not found at expected path"
    info "Expected: ${CLI_JS_GLOBAL}"
  fi

  _ensure_cfc_env
}

# Ensure CLAUDE_CODE_ENABLE_CFC=true is in environment
_ensure_cfc_env() {
  if ! grep -q "CLAUDE_CODE_ENABLE_CFC=true" "${TERMUX_HOME}/.bashrc" 2>/dev/null; then
    if ask_yn "Add CLAUDE_CODE_ENABLE_CFC=true to .bashrc?" Y; then
      echo 'export CLAUDE_CODE_ENABLE_CFC=true' >> "${TERMUX_HOME}/.bashrc"
      export CLAUDE_CODE_ENABLE_CFC=true
      ok "Added CLAUDE_CODE_ENABLE_CFC=true to .bashrc"
    fi
  else
    ok "CLAUDE_CODE_ENABLE_CFC=true already in .bashrc"
  fi
}
