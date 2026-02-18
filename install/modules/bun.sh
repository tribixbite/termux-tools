#!/data/data/com.termux/files/usr/bin/bash
# Module: Install Bun via bun-on-termux
# Requires: pacman, glibc-runner

module_bun() {
  header "[Bun] Install Bun runtime"

  # Check if already working
  if detect_bun; then
    ok "Bun already installed: ${_DETECT_BUN}"
    if ! ask_yn "Reinstall/update anyway?" N; then
      return 0
    fi
  fi

  # Step 1: Check pacman (termux-pacman required for glibc-runner)
  if ! command -v pacman &>/dev/null; then
    fail "pacman not found — bun-on-termux requires termux-pacman"
    info "Install termux-pacman first: https://github.com/termux-pacman/termux-packages"
    info "Then re-run this installer."
    return 1
  fi
  ok "pacman available"

  # Step 2: Check/install glibc-runner
  if ! command -v grun &>/dev/null; then
    info "Installing glibc-runner..."
    if pacman -S glibc-runner --noconfirm 2>/dev/null; then
      ok "glibc-runner installed"
    else
      fail "Failed to install glibc-runner"
      info "Ensure gpkg repository is configured: https://github.com/termux-pacman/glibc-packages/wiki"
      return 1
    fi
  else
    ok "glibc-runner available"
  fi

  # Step 3: Clone/update bun-on-termux
  local bot_dir="${TERMUX_HOME}/git/bun-on-termux"
  mkdir -p "${TERMUX_HOME}/git"

  if [[ -d "${bot_dir}/.git" ]]; then
    info "Updating bun-on-termux..."
    git -C "$bot_dir" pull --ff-only 2>/dev/null || true
    ok "bun-on-termux updated"
  else
    info "Cloning bun-on-termux..."
    git clone "https://github.com/${BUN_ON_TERMUX_REPO}.git" "$bot_dir" || {
      fail "Failed to clone bun-on-termux"
      return 1
    }
    ok "bun-on-termux cloned"
  fi

  # Step 4: Run its setup
  info "Running bun-on-termux setup..."
  (cd "$bot_dir" && bash setup.sh) || {
    fail "bun-on-termux setup failed"
    return 1
  }

  # Step 5: Check if buno binary exists and is recent
  if [[ ! -f "${BUN_DIR}/bin/buno" ]]; then
    info "buno binary not found — downloading latest from GitHub..."
    _download_buno
  elif [[ -f "${bot_dir}/binaries/buno" ]]; then
    # Compare sizes to detect if bun-on-termux shipped one
    local installed_size repo_size
    installed_size=$(stat -c%s "${BUN_DIR}/bin/buno" 2>/dev/null || echo 0)
    repo_size=$(stat -c%s "${bot_dir}/binaries/buno" 2>/dev/null || echo 0)
    if [[ "$installed_size" -lt 1000000 ]]; then
      info "buno binary looks incomplete, re-downloading..."
      _download_buno
    fi
  fi

  # Step 6: Ensure PATH includes ~/.bun/bin
  if ! echo "$PATH" | grep -q "${BUN_DIR}/bin"; then
    export PATH="${BUN_DIR}/bin:$PATH"
  fi
  if ! grep -q '\.bun/bin' "${TERMUX_HOME}/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "${TERMUX_HOME}/.bashrc"
    ok "Added ~/.bun/bin to PATH in .bashrc"
  fi

  # Step 7: Verify
  export PATH="${BUN_DIR}/bin:$PATH"
  if detect_bun; then
    ok "Bun working: ${_DETECT_BUN}"
  else
    fail "Bun installation could not be verified"
    return 1
  fi
}

# Download latest buno binary from GitHub releases
_download_buno() {
  local bun_version="1.2.4"
  local zip_url="https://github.com/oven-sh/bun/releases/download/bun-v${bun_version}/bun-linux-aarch64.zip"
  local tmp_dir="${BUN_DIR}/tmp"
  mkdir -p "$tmp_dir"

  info "Downloading Bun v${bun_version} (aarch64)..."
  if curl -fsSL "$zip_url" -o "${tmp_dir}/bun.zip"; then
    unzip -o "${tmp_dir}/bun.zip" -d "$tmp_dir" >/dev/null 2>&1
    if [[ -f "${tmp_dir}/bun-linux-aarch64/bun" ]]; then
      cp "${tmp_dir}/bun-linux-aarch64/bun" "${BUN_DIR}/bin/buno"
      chmod +x "${BUN_DIR}/bin/buno"
      ok "buno v${bun_version} installed"
    else
      fail "Unexpected zip contents"
      return 1
    fi
    rm -rf "${tmp_dir}/bun.zip" "${tmp_dir}/bun-linux-aarch64"
  else
    fail "Download failed — check network"
    return 1
  fi
}
