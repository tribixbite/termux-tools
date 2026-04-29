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

  # Install globally via bun.
  # Pinned at v2.1.112: starting with v2.1.123 the package layout switched
  # from a single bundled cli.js to platform-native binaries via
  # optionalDependencies. The shipped Linux ARM64 binaries link against
  # /lib/ld-{linux,musl}-aarch64.so.1 (paths that don't exist on Termux
  # bionic), so they only run via grun + patchelf — and our patch_claude_cli
  # targets the JS bundle. Override with CCINSTALL_VERSION=latest to opt
  # in to the new layout (and accept the patcher won't do anything).
  local target_version="${CCINSTALL_VERSION:-2.1.112}"
  info "Installing @anthropic-ai/claude-code@${target_version}..."
  if bun install -g "@anthropic-ai/claude-code@${target_version}" 2>&1; then
    ok "Claude Code ${target_version} installed"
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
# Compatibility-fix patches (always applied):
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
#
# System-prompt patches (opt-out via env vars; default on for this user):
#
#   Patch 3 — Strip "NEVER commit changes unless asked":
#     Conflicts with our global CLAUDE.md directive ("after every round of
#     work, make a conventional commit"). Removing the redundant negative
#     lets the CLAUDE.md positive rule apply cleanly without context noise.
#     Set CCPATCH_KEEP_NO_COMMIT=1 to skip.
#
#   Patch 4 — Strip "Default to writing no comments":
#     Conflicts with our global CLAUDE.md ("use properly typed DRY production
#     level code with explanatory comments"). Set CCPATCH_KEEP_NO_COMMENTS=1
#     to skip.
#
#   Patch 5 — Relax inter-tool length cap from 25 → 60 words:
#     The 25-word cap on between-tool updates is too tight for explaining
#     non-trivial state. Set CCPATCH_KEEP_TIGHT_LENGTH=1 to skip.
#
# Tested against v2.1.112. Patterns are sentinel-string-based (literal phrase
# matches) so they typically survive minor version bumps. If a patch's
# verification grep fails after `bun install -g`, the .bak-prepatch backup
# remains untouched.
patch_claude_cli() {
  local cli="${CLI_JS_GLOBAL}"
  if [[ ! -f "$cli" ]]; then
    warn "patch_claude_cli: cli.js not found at ${cli}, skipping"
    return 1
  fi

  local needs_patch=0

  # Compatibility-fix detection
  grep -qF '[...MB,"inherit"]' "$cli" 2>/dev/null && needs_patch=1
  grep -qF '`/tmp/claude-mcp-browser-bridge-' "$cli" 2>/dev/null && needs_patch=1

  # System-prompt detection (each gated by an opt-out env var)
  [[ "${CCPATCH_KEEP_NO_COMMIT:-0}" == "1" ]] || \
    grep -qF -- '- NEVER commit changes unless the user explicitly asks you to.' "$cli" 2>/dev/null && \
    [[ "${CCPATCH_KEEP_NO_COMMIT:-0}" != "1" ]] && needs_patch=1
  [[ "${CCPATCH_KEEP_NO_COMMENTS:-0}" == "1" ]] || \
    grep -qF '"Default to writing no comments. Only add one' "$cli" 2>/dev/null && \
    [[ "${CCPATCH_KEEP_NO_COMMENTS:-0}" != "1" ]] && needs_patch=1
  [[ "${CCPATCH_KEEP_TIGHT_LENGTH:-0}" == "1" ]] || \
    grep -qF 'Length limits: keep text between tool calls to ≤25 words.' "$cli" 2>/dev/null && \
    [[ "${CCPATCH_KEEP_TIGHT_LENGTH:-0}" != "1" ]] && needs_patch=1

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

  local total=2

  # Patch 3: strip the "NEVER commit changes unless..." bullet from the static
  # git-workflow section. The phrase lives on its own line inside a backtick
  # template literal (real newlines), so a line-delete cleanly removes it
  # without touching the surrounding bullets.
  if [[ "${CCPATCH_KEEP_NO_COMMIT:-0}" != "1" ]]; then
    total=$((total+1))
    if grep -qF -- '- NEVER commit changes unless the user explicitly asks you to.' "$cli" 2>/dev/null; then
      sed -i '/^- NEVER commit changes unless the user explicitly asks you to\. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive$/d' "$cli"
      if ! grep -qF -- '- NEVER commit changes unless the user explicitly asks you to.' "$cli" 2>/dev/null; then
        ok "Patch 3 (no-commit prompt strip): applied"
        ((applied++))
      else
        warn "Patch 3: sed ran but phrase still present"
      fi
    else
      ok "Patch 3 (no-commit prompt strip): not needed"
      ((applied++))
    fi
  fi

  # Patch 4: strip the "Default to writing no comments." JS string from the
  # `D6A()` array. The string is one element of a comma-separated array on a
  # single physical line, so we substitute the literal `"...",` (string +
  # trailing comma) out, leaving the array intact.
  if [[ "${CCPATCH_KEEP_NO_COMMENTS:-0}" != "1" ]]; then
    total=$((total+1))
    if grep -qF '"Default to writing no comments. Only add one' "$cli" 2>/dev/null; then
      sed -i 's|"Default to writing no comments\. Only add one when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader\. If removing the comment wouldn'"'"'t confuse a future reader, don'"'"'t write it\.",||g' "$cli"
      if ! grep -qF '"Default to writing no comments. Only add one' "$cli" 2>/dev/null; then
        ok "Patch 4 (no-comments prompt strip): applied"
        ((applied++))
      else
        warn "Patch 4: sed ran but phrase still present"
      fi
    else
      ok "Patch 4 (no-comments prompt strip): not needed"
      ((applied++))
    fi
  fi

  # Patch 5: relax inter-tool word cap 25 → 60. The literal lives inside an
  # `XT("numeric_length_anchors", () => "...")` arrow on a single line.
  if [[ "${CCPATCH_KEEP_TIGHT_LENGTH:-0}" != "1" ]]; then
    total=$((total+1))
    if grep -qF '"Length limits: keep text between tool calls to ≤25 words.' "$cli" 2>/dev/null; then
      sed -i 's|"Length limits: keep text between tool calls to ≤25 words\. Keep final responses to ≤100 words unless the task requires more detail\."|"Length limits: keep text between tool calls to ≤60 words. Keep final responses to ≤250 words unless the task requires more detail."|g' "$cli"
      if grep -qF '"Length limits: keep text between tool calls to ≤60 words.' "$cli" 2>/dev/null; then
        ok "Patch 5 (length-cap relax 25→60 / 100→250): applied"
        ((applied++))
      else
        warn "Patch 5: sed ran but new phrase not present"
      fi
    else
      ok "Patch 5 (length-cap relax): already applied or phrase not found"
      ((applied++))
    fi
  fi

  if [[ $applied -eq $total ]]; then
    ok "cli.js patches complete (${applied}/${total})"
  else
    warn "cli.js patch incomplete (${applied}/${total}) — manual verification needed"
    warn "Variable names or phrases may have changed in this version. Restore:"
    warn "  cp ${bak} ${cli}"
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
