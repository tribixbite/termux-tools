#!/data/data/com.termux/files/usr/bin/bash
# Module: Configure Termux permissions and settings

module_termux_config() {
  header "[Termux] Configure permissions & settings"

  local changes_made=false

  # Step 1: Storage access
  if [[ -d "${TERMUX_HOME}/storage/shared" ]]; then
    ok "Storage already linked"
  else
    info "Storage access needed to copy CRX to Downloads"
    if ask_yn "Run termux-setup-storage now?" Y; then
      termux-setup-storage 2>/dev/null
      sleep 2
      if [[ -d "${TERMUX_HOME}/storage/shared" ]]; then
        ok "Storage linked"
      else
        warn "Storage not linked — you may need to grant permission in the popup"
        info "Try running 'termux-setup-storage' manually"
      fi
    fi
  fi

  # Step 2: allow-external-apps
  mkdir -p "${TERMUX_HOME}/.termux"
  if [[ -f "$TERMUX_PROPS" ]] && grep -q "^allow-external-apps *= *true" "$TERMUX_PROPS" 2>/dev/null; then
    ok "allow-external-apps = true"
  else
    info "allow-external-apps enables Edge to launch the bridge via intent"
    if ask_yn "Set allow-external-apps = true?" Y; then
      if [[ -f "$TERMUX_PROPS" ]]; then
        # Replace existing line or append
        if grep -q "allow-external-apps" "$TERMUX_PROPS" 2>/dev/null; then
          sed -i 's/^.*allow-external-apps.*$/allow-external-apps = true/' "$TERMUX_PROPS"
        else
          echo "allow-external-apps = true" >> "$TERMUX_PROPS"
        fi
      else
        echo "allow-external-apps = true" > "$TERMUX_PROPS"
      fi
      ok "Set allow-external-apps = true"
      changes_made=true
    fi
  fi

  # Step 3: Environment variables in .bashrc
  local bashrc="${TERMUX_HOME}/.bashrc"
  local env_vars=(
    "CLAUDE_CODE_ENABLE_CFC=true"
    "DISABLE_AUTOUPDATER=true"
  )
  for var in "${env_vars[@]}"; do
    local name="${var%%=*}"
    if grep -q "${name}" "$bashrc" 2>/dev/null; then
      ok "${var} in .bashrc"
    else
      if ask_yn "Add export ${var} to .bashrc?" Y; then
        echo "export ${var}" >> "$bashrc"
        export "$var"
        ok "Added ${var}"
      fi
    fi
  done

  # Step 4: termux-url-opener for deep-link bridge launch
  # TermuxFileReceiverActivity calls this script when extension sends ACTION_SEND
  local url_opener="${TERMUX_HOME}/bin/termux-url-opener"
  mkdir -p "${TERMUX_HOME}/bin"
  if [[ -f "$url_opener" ]] && grep -q "cfcbridge" "$url_opener" 2>/dev/null; then
    ok "termux-url-opener has CFC handler"
  else
    info "termux-url-opener enables one-tap bridge launch from the extension"
    if ask_yn "Install termux-url-opener with CFC handler?" Y; then
      if [[ -f "$url_opener" ]]; then
        # Existing script — prepend CFC handler before the default case
        if ! grep -q "cfc-bridge-start" "$url_opener" 2>/dev/null; then
          warn "Existing termux-url-opener found — adding CFC handler"
          info "Review ~/bin/termux-url-opener if you have custom URL handling"
        fi
      fi
      # Write the standard CFC-aware url-opener
      cat > "$url_opener" << 'URLEOF'
#!/data/data/com.termux/files/usr/bin/bash
# termux-url-opener — handles URLs shared to Termux via Android share menu
# Called by TermuxFileReceiverActivity with the shared URL as $1
set -euo pipefail
url="${1:-}"
case "$url" in
  *cfcbridge*/start*)
    BRIDGE_SCRIPT="$HOME/git/termux-tools/claude-chrome-bridge.ts"
    BRIDGE_LOG="$PREFIX/tmp/bridge.log"
    BUN="${HOME}/.bun/bin/bun"
    [[ -x "$BUN" ]] || BUN="$(command -v bun 2>/dev/null || true)"
    if pgrep -f "claude-chrome-bridge" > /dev/null 2>&1; then exit 0; fi
    if [[ ! -f "$BRIDGE_SCRIPT" || -z "$BUN" ]]; then exit 1; fi
    setsid nohup "$BUN" "$BRIDGE_SCRIPT" > "$BRIDGE_LOG" 2>&1 &
    exit 0
    ;;
  *)
    if command -v termux-open-url > /dev/null 2>&1; then
      termux-open-url "$url"
    elif command -v xdg-open > /dev/null 2>&1; then
      xdg-open "$url"
    fi
    ;;
esac
URLEOF
      chmod +x "$url_opener"
      ok "Installed termux-url-opener"
    fi
  fi

  # Step 5: Check Termux:API app
  if adb shell pm list packages com.termux.api 2>/dev/null | grep -q "com.termux.api"; then
    ok "Termux:API app installed"
  elif pm list packages com.termux.api 2>/dev/null | grep -q "com.termux.api"; then
    ok "Termux:API app installed"
  else
    warn "Termux:API app not detected"
    info "Install from F-Droid for notification-based bridge launch"
    info "https://f-droid.org/packages/com.termux.api/"
  fi

  if [[ "$changes_made" == true ]]; then
    warn "Restart Termux for termux.properties changes to take effect"
  fi
}
