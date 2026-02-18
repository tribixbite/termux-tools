#!/data/data/com.termux/files/usr/bin/bash
# Module: Health check and diagnostics

module_health() {
  header "[Health] System diagnostics"

  local pass=0
  local total=0

  # 1. Bridge process
  total=$((total + 1))
  local bridge_pid
  bridge_pid=$(pgrep -f "claude-chrome-bridge" 2>/dev/null | head -1 || true)
  if [[ -n "$bridge_pid" ]]; then
    ok "Bridge process running (PID ${bridge_pid})"
    pass=$((pass + 1))
  else
    fail "Bridge process not running"
  fi

  # 2. Health endpoint
  total=$((total + 1))
  local health
  health=$(curl -sf "$BRIDGE_HEALTH_URL" 2>/dev/null || true)
  if echo "$health" | grep -q '"status":"ok"' 2>/dev/null; then
    local ver clients uptime cdp_state
    ver=$(echo "$health" | grep -oP '"version":"[^"]+' | cut -d'"' -f4)
    clients=$(echo "$health" | grep -oP '"clients":\d+' | cut -d: -f2)
    uptime=$(echo "$health" | grep -oP '"uptime":[\d.]+' | cut -d: -f2)
    cdp_state=$(echo "$health" | grep -oP '"state":"[^"]+' | head -1 | cut -d'"' -f4)
    ok "Health endpoint OK — v${ver}, ${clients} client(s), uptime ${uptime}s"
    pass=$((pass + 1))

    # 3. CDP
    total=$((total + 1))
    if [[ "$cdp_state" == "connected" ]]; then
      local cdp_pid cdp_port
      cdp_pid=$(echo "$health" | grep -oP '"edgePid":\d+' | cut -d: -f2)
      cdp_port=$(echo "$health" | grep -oP '"port":\d+' | cut -d: -f2)
      ok "CDP connected (Edge PID ${cdp_pid}, port ${cdp_port})"
      pass=$((pass + 1))
    else
      warn "CDP not connected (state: ${cdp_state:-unknown})"
    fi

    # 4. WS clients
    total=$((total + 1))
    if [[ "${clients:-0}" -gt 0 ]]; then
      ok "Native host connected (${clients} WS client)"
      pass=$((pass + 1))
    else
      warn "No WS clients — extension may not be connected"
    fi
  else
    fail "Health endpoint not responding at ${BRIDGE_HEALTH_URL}"
  fi

  # 5. Edge process
  total=$((total + 1))
  if command -v adb &>/dev/null; then
    local edge_pid
    edge_pid=$(adb shell pidof com.microsoft.emmx.canary 2>/dev/null || true)
    if [[ -n "$edge_pid" ]]; then
      ok "Edge Canary running (PID ${edge_pid})"
      pass=$((pass + 1))
    else
      warn "Edge Canary not running"
    fi
  else
    info "ADB not available — cannot check Edge process"
  fi

  # 6. Extension manifest version
  total=$((total + 1))
  local manifest_ver
  manifest_ver=$(manifest_version)
  if [[ "$manifest_ver" != "unknown" ]]; then
    ok "Extension source: v${manifest_ver}"
    pass=$((pass + 1))
  else
    fail "Cannot read manifest version"
  fi

  # 7. Bun
  total=$((total + 1))
  if detect_bun; then
    ok "Bun: ${_DETECT_BUN}"
    pass=$((pass + 1))
  else
    fail "Bun: ${_DETECT_BUN}"
  fi

  # 8. Claude Code CLI
  total=$((total + 1))
  if detect_claude_code; then
    ok "Claude Code: ${_DETECT_CLAUDE_CODE}"
    pass=$((pass + 1))
  else
    fail "Claude Code: ${_DETECT_CLAUDE_CODE}"
  fi

  # Summary
  echo
  if [[ $pass -eq $total ]]; then
    echo -e "  ${GREEN}${BOLD}All checks passed (${pass}/${total})${NC}"
  elif [[ $pass -gt 0 ]]; then
    echo -e "  ${YELLOW}${BOLD}${pass}/${total} checks passed${NC}"
  else
    echo -e "  ${RED}${BOLD}${pass}/${total} checks passed${NC}"
  fi
}
