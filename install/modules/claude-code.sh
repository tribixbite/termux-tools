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
  patch_claude_cli
}

# Apply Termux-compatibility patches to cli.js after install/update.
# Patches are idempotent — safe to re-run after any `bun install -g` update.
#
#   Patch 1 — MB null guard:
#     [...MB,"inherit"] → [...(MB||[]),"inherit"]
#     MB (minified agent-type list) can be null on Termux, causing TypeError on startup.
#
#   Patch 2 — Socket path /tmp/ → os.tmpdir():
#     `/tmp/claude-mcp-browser-bridge-  →  `${Za9()}/claude-mcp-browser-bridge-
#     Za9 is the minified alias for os.tmpdir in the bundled cli.js; /tmp/ does not
#     exist on Termux (correct path is $PREFIX/tmp).
patch_claude_cli() {
  local cli="${CLI_JS_GLOBAL}"
  if [[ ! -f "$cli" ]]; then
    warn "patch_claude_cli: cli.js not found at ${cli}, skipping"
    return 1
  fi

  local needs_patch=0

  # Check if patches are already applied
  if grep -qF '[...MB,"inherit"]' "$cli" 2>/dev/null; then
    needs_patch=1
  fi
  if grep -qF '`/tmp/claude-mcp-browser-bridge-' "$cli" 2>/dev/null; then
    needs_patch=1
  fi

  if [[ $needs_patch -eq 0 ]]; then
    ok "cli.js Termux patches already applied"
    return 0
  fi

  # Backup before patching
  local bak="${cli}.bak-prepatch"
  if [[ ! -f "$bak" ]]; then
    cp "$cli" "$bak"
    info "Backup: ${bak}"
  fi

  # Patch 1: MB null guard
  sed -i 's/\[\.\.\.MB,"inherit"\]/[...(MB||[]),"inherit"]/g' "$cli"

  # Patch 2: hardcoded /tmp/ → os.tmpdir() via Za9() (minified alias in bundled cli.js)
  sed -i 's|`/tmp/claude-mcp-browser-bridge-|`${Za9()}/claude-mcp-browser-bridge-|g' "$cli"

  # Verify
  local applied=0
  grep -qF '[...(MB||[]),"inherit"]' "$cli" 2>/dev/null && ((applied++))
  grep -qF '${Za9()}/claude-mcp-browser-bridge-' "$cli" 2>/dev/null && ((applied++))

  if [[ $applied -eq 2 ]]; then
    ok "cli.js Termux patches applied (${applied}/2)"
  else
    warn "cli.js patch verification failed (${applied}/2 applied) — check ${cli} manually"
    warn "Note: Za9 is the minified os.tmpdir alias and may differ across versions"
  fi
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
