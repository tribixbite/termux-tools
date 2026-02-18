#!/data/data/com.termux/files/usr/bin/bash
# Module: Build CRX extension package

module_crx() {
  header "[CRX] Build extension package"

  local version
  version=$(manifest_version)
  local crx_file="${REPO_DIR}/dist/claude-code-bridge-v${version}.crx"

  info "Extension version: ${version}"

  # Step 1: Check/generate signing key
  if [[ -f "$CRX_KEY" ]]; then
    ok "Signing key exists"
  else
    info "Generating RSA signing key..."
    if command -v openssl &>/dev/null; then
      openssl genrsa -out "$CRX_KEY" 2048 2>/dev/null
      ok "Signing key generated: $(basename "$CRX_KEY")"
    else
      fail "openssl not found — needed to generate signing key"
      info "Install: pkg install openssl-tool"
      return 1
    fi
  fi

  # Step 2: Check/install crx3
  if command -v crx3 &>/dev/null; then
    ok "crx3 packager available"
  else
    info "Installing crx3 packager..."
    if command -v bun &>/dev/null; then
      bun install -g crx3 2>/dev/null
    elif command -v npm &>/dev/null; then
      npm install -g crx3 2>/dev/null
    fi
    if command -v crx3 &>/dev/null; then
      ok "crx3 installed"
    else
      fail "Failed to install crx3"
      info "Try: bun install -g crx3"
      return 1
    fi
  fi

  # Step 3: Build
  mkdir -p "${REPO_DIR}/dist"
  info "Building CRX v${version}..."
  if crx3 "$EXT_DIR" -p "$CRX_KEY" -o "$crx_file" 2>/dev/null; then
    local size
    size=$(du -h "$crx_file" | cut -f1)
    ok "Built: $(basename "$crx_file") (${size})"
  else
    fail "CRX build failed"
    return 1
  fi

  # Step 4: Verify CRX3 format
  local file_type
  file_type=$(file "$crx_file" 2>/dev/null)
  if echo "$file_type" | grep -qi "chrome extension"; then
    ok "Valid CRX3 format"
  else
    warn "Could not verify CRX3 format: $(echo "$file_type" | cut -c1-80)"
  fi

  # Step 5: Copy to Downloads
  if [[ -d "$DOWNLOAD_DIR" ]]; then
    cp "$crx_file" "${DOWNLOAD_DIR}/claude-code-bridge.crx"
    ok "Copied to Downloads: ${DOWNLOAD_DIR}/claude-code-bridge.crx"
  else
    warn "Shared storage not linked — run termux-setup-storage first"
    info "Then copy manually: cp ${crx_file} ~/storage/shared/Download/"
  fi

  # Also update the CRX served by the bridge
  local bridge_crx="${REPO_DIR}/dist/claude-code-bridge-latest.crx"
  cp "$crx_file" "$bridge_crx" 2>/dev/null
  ok "Bridge-served CRX updated"
}
