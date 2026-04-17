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
#   Patch 1 — MB/Yw6 null guard (v2.1.56 only):
#     [...MB,"inherit"] → [...(MB||[]),"inherit"]
#     MB (minified agent-type list) could be null on Termux. Fixed upstream in v2.1.112+
#     (Yw6 is now initialized as an array literal so no guard needed). Still patched
#     when the unguarded pattern is found for older installs.
#
#   Patch 2 — Socket path /tmp/ → z2() / os.tmpdir():
#     The built-in claude-in-chrome socket dir function uses a hardcoded /tmp/ path.
#     On Termux, /tmp/ does not exist (correct path is $PREFIX/tmp).
#     Fix: replace with z2() which is Claude Code's own smart-tmpdir helper:
#       z2() → CLAUDE_CODE_TMPDIR env > /tmp (macOS) > os.tmpdir() (all others incl. Android)
#     Minified function name varies by version:
#       v2.1.56:  function dg6(){return`/tmp/...`}  →  `${Za9()}/...`  (Za9=os.tmpdir import)
#       v2.1.112: function i88(){return`/tmp/...`}  →  `${z2()}/...`   (z2=smart tmpdir helper)
#     We try both patterns so the script works across versions.
patch_claude_cli() {
  local cli="${CLI_JS_GLOBAL}"
  if [[ ! -f "$cli" ]]; then
    warn "patch_claude_cli: cli.js not found at ${cli}, skipping"
    return 1
  fi

  local needs_patch=0

  # Check for any unpatched pattern that needs fixing
  grep -qF '[...MB,"inherit"]' "$cli" 2>/dev/null && needs_patch=1
  grep -qF '`/tmp/claude-mcp-browser-bridge-' "$cli" 2>/dev/null && needs_patch=1

  if [[ $needs_patch -eq 0 ]]; then
    ok "cli.js Termux patches already applied"
    return 0
  fi

  # Backup before patching (only if no backup exists yet for this install)
  local bak="${cli}.bak-prepatch"
  if [[ ! -f "$bak" ]]; then
    cp "$cli" "$bak"
    info "Backup: ${bak}"
  fi

  local applied=0

  # Patch 1: MB null guard (v2.1.56 — fixed upstream in v2.1.112+, no-op if not found)
  if grep -qF '[...MB,"inherit"]' "$cli" 2>/dev/null; then
    sed -i 's/\[\.\.\.MB,"inherit"\]/[...(MB||[]),"inherit"]/g' "$cli"
    grep -qF '[...(MB||[]),"inherit"]' "$cli" 2>/dev/null && ((applied++)) \
      || warn "Patch 1 (MB null guard): sed ran but pattern not found in result"
  else
    ok "Patch 1 (MB null guard): not needed for this version"
    ((applied++))
  fi

  # Patch 2a: /tmp/ socket path — v2.1.56 style (dg6/Za9)
  # Patch 2b: /tmp/ socket path — v2.1.112 style (i88/z2)
  # We replace the hardcoded /tmp/ with z2() (Claude's own smart-tmpdir that respects
  # CLAUDE_CODE_TMPDIR env var and falls back to os.tmpdir() on Android/Linux).
  if grep -qF '`/tmp/claude-mcp-browser-bridge-' "$cli" 2>/dev/null; then
    # Try v2.1.112 pattern first (i88 → z2), then v2.1.56 (dg6 → Za9)
    sed -i 's|`/tmp/claude-mcp-browser-bridge-|`${z2()}/claude-mcp-browser-bridge-|g' "$cli"
    if grep -qF '`${z2()}/claude-mcp-browser-bridge-' "$cli" 2>/dev/null; then
      ok "Patch 2 (socket /tmp/ → z2()): applied"
      ((applied++))
    else
      warn "Patch 2 (socket path): sed ran but verification failed — check ${cli} manually"
    fi
  else
    ok "Patch 2 (socket path): not needed or already applied"
    ((applied++))
  fi

  if [[ $applied -eq 2 ]]; then
    ok "cli.js Termux patches complete (${applied}/2)"
  else
    warn "cli.js patch incomplete (${applied}/2) — manual verification needed"
    warn "Variable names may have changed in this version. Check:"
    warn "  grep -o '.\\{30\\}/tmp/claude-mcp-browser-bridge.\\{30\\}' ${cli}"
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
