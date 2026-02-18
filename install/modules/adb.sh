#!/data/data/com.termux/files/usr/bin/bash
# Module: ADB install and wireless setup

module_adb() {
  header "[ADB] Setup Android Debug Bridge"

  # Step 1: Check/install adb binary
  if command -v adb &>/dev/null; then
    ok "adb installed: $(adb --version 2>&1 | head -1)"
  else
    info "adb is needed for CDP integration (full JS eval, screenshots)"
    if ask_yn "Install android-tools (provides adb)?" Y; then
      if command -v pacman &>/dev/null; then
        pacman -S android-tools --noconfirm 2>/dev/null
      else
        pkg install -y android-tools 2>/dev/null
      fi
      if command -v adb &>/dev/null; then
        ok "adb installed"
      else
        fail "Failed to install android-tools"
        return 1
      fi
    else
      info "Skipping ADB setup — CDP features will not be available"
      return 0
    fi
  fi

  # Step 2: Check device connection
  # Clean up offline devices first
  local offline_devs
  offline_devs=$(adb devices 2>/dev/null | grep "offline" | awk '{print $1}')
  for dev in $offline_devs; do
    adb disconnect "$dev" 2>/dev/null
  done

  local connected
  connected=$(adb devices 2>/dev/null | grep -c "device$" || true)
  if [[ "$connected" -gt 0 ]]; then
    ok "ADB connected (${connected} device(s))"
    adb devices -l 2>/dev/null | grep "device " | while read -r line; do
      info "$line"
    done
    return 0
  fi

  # Step 3: Interactive wireless ADB pairing
  info "No ADB device connected. Setting up wireless ADB..."
  echo
  echo -e "  ${BOLD}On your phone:${NC}"
  echo "    Settings → Developer Options → Wireless debugging"
  echo "    Tap 'Pair device with pairing code'"
  echo "    Note the IP:port and pairing code shown"
  echo

  echo -ne "  ${CYAN}?${NC} Pairing IP:port (e.g. 192.168.1.100:37123): "
  read -r pair_addr
  if [[ -z "$pair_addr" ]]; then
    warn "Skipping ADB pairing"
    return 0
  fi

  echo -ne "  ${CYAN}?${NC} Pairing code: "
  read -r pair_code
  if [[ -z "$pair_code" ]]; then
    warn "Skipping ADB pairing"
    return 0
  fi

  info "Pairing with ${pair_addr}..."
  if echo "$pair_code" | adb pair "$pair_addr" 2>&1; then
    ok "Pairing successful"
  else
    fail "Pairing failed — check IP, port, and code"
    return 1
  fi

  # Now connect (different port than pairing port)
  echo
  echo -e "  ${BOLD}On your phone:${NC}"
  echo "    The Wireless debugging screen shows IP:port under 'IP address & Port'"
  echo "    (This is different from the pairing port)"
  echo

  echo -ne "  ${CYAN}?${NC} Connection IP:port (e.g. 192.168.1.100:42897): "
  read -r connect_addr
  if [[ -z "$connect_addr" ]]; then
    warn "Skipping connection"
    return 0
  fi

  info "Connecting to ${connect_addr}..."
  if adb connect "$connect_addr" 2>&1 | grep -q "connected"; then
    ok "Connected to ${connect_addr}"
  else
    fail "Connection failed"
    return 1
  fi

  # Step 4: Test
  if adb shell echo "adb-ok" 2>/dev/null | grep -q "adb-ok"; then
    ok "ADB test passed"
  else
    warn "ADB connected but shell test failed"
  fi
}
