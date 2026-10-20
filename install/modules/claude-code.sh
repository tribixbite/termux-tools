#!/data/data/com.termux/files/usr/bin/bash
# Module: Install Claude Code CLI through ccx (the termux-tools channel manager)
#
# History: this module used to pin @anthropic-ai/claude-code@2.1.112 (a sed-patched
# cli.js bundle) or hand-fetch the 2.1.158 bun-compiled binary. Both paths are
# superseded by ccx, which fetches the native release channel, applies the
# byte-preserving Termux patches (c-ares resolver redirect + CLAUDE.md prompt
# alignment, opt-out via CCPATCH_KEEP_*) and manages the stable/next launchers in
# ~/.local/bin. See claude-channel/README.md for the channel model.

module_claude_code() {
  header "[Claude Code] Install via ccx"

  if detect_claude_code; then
    ok "Claude Code already installed: ${_DETECT_CLAUDE_CODE}"
    if ! ask_yn "Refresh the next channel anyway (ccx update)?" N; then
      _ensure_cfc_env
      return 0
    fi
  fi

  # ccx launches the glibc binary through bun-on-termux's userland-exec wrapper.
  if ! detect_bun; then
    fail "Bun (bun-on-termux) is required for the Claude Code binary"
    info "Run the Bun installer first (option 1)"
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    fail "node is required for the ccx launcher: pkg install nodejs"
    return 1
  fi

  _ensure_ccx || return 1

  info "Fetching + patching the latest Claude Code into claude-next..."
  if ! _ccx update; then
    fail "ccx update failed"
    return 1
  fi

  if ask_yn "Promote next -> stable (~/.local/bin/claude)?" Y; then
    _ccx promote || { fail "ccx promote failed"; return 1; }
  fi
  _ccx status

  case ":$PATH:" in
    *":${TERMUX_HOME}/.local/bin:"*) ;;
    *) warn "~/.local/bin is not on PATH — add: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac

  _ensure_cfc_env
}

# Run ccx from the repo build when present, else from a global install.
_ccx() {
  local repo_cli="${REPO_DIR}/claude-channel/dist/cli.js"
  if [[ -f "$repo_cli" ]]; then
    node "$repo_cli" "$@"
  elif command -v ccx >/dev/null 2>&1; then
    ccx "$@"
  else
    return 127
  fi
}

# Make ccx available: repo build (bun) first, otherwise the published package.
_ensure_ccx() {
  if _ccx help >/dev/null 2>&1; then
    ok "ccx available"
    return 0
  fi
  if [[ -f "${REPO_DIR}/claude-channel/build.ts" ]] && command -v bun >/dev/null 2>&1; then
    info "Building ccx from the repo checkout..."
    if (cd "${REPO_DIR}/claude-channel" && bun install && bun run build.ts); then
      ok "Built claude-channel/dist/cli.js"
      return 0
    fi
    warn "repo build failed; falling back to the npm package"
  fi
  info "Installing the termux-tools package (ccx, cdx, agx) globally..."
  if npm install -g termux-tools; then
    ok "termux-tools installed"
    return 0
  fi
  fail "Could not obtain ccx (repo build and npm install both failed)"
  return 1
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
