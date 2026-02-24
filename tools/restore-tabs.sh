#!/data/data/com.termux/files/usr/bin/bash
# restore-tabs.sh — Recreate Termux UI tabs attached to existing tmux sessions
# Usage: restore-tabs.sh [session1 session2 ...]
# No args = restore all detached sessions. With args = restore only named sessions.
set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'

restored=0
skipped=0
failed=0

# Detect the best method to create Termux tabs:
# 1. termux-am socket (fast, preferred) — may be down after crash
# 2. RunCommandService via DalvikVM am (reliable fallback)
AM_METHOD=""
if termux-am broadcast -a com.termux.test 2>/dev/null | grep -q "Broadcast completed" 2>/dev/null; then
  AM_METHOD="termux-am"
  echo -e "${BLUE}Using termux-am (socket)${NC}"
else
  AM_METHOD="run-command-service"
  echo -e "${BLUE}Using RunCommandService (termux-am socket unavailable)${NC}"
fi

# Create a new Termux tab running a command
# $1 = command string to execute in the new tab
create_tab() {
  local cmd="$1"
  if [[ "$AM_METHOD" == "termux-am" ]]; then
    # Fast path: termux-am socket creates tab directly
    termux-am start \
      -n com.termux/.app.TermuxActivity \
      --es com.termux.execute.background true \
      -e com.termux.execute.command "$cmd" 2>/dev/null
  else
    # Fallback: RunCommandService via DalvikVM am
    # SESSION_ACTION 0 = open new tab in foreground
    am startservice \
      -n com.termux/com.termux.app.RunCommandService \
      -a com.termux.RUN_COMMAND \
      --es com.termux.RUN_COMMAND_PATH "/data/data/com.termux/files/usr/bin/bash" \
      --esa com.termux.RUN_COMMAND_ARGUMENTS "-c,$cmd" \
      --ez com.termux.RUN_COMMAND_BACKGROUND false \
      --es com.termux.RUN_COMMAND_SESSION_ACTION "0" >/dev/null 2>&1
  fi
}

# Get list of sessions to restore
if [[ $# -gt 0 ]]; then
  sessions=("$@")
else
  # Auto-discover all tmux sessions
  if ! tmux list-sessions &>/dev/null; then
    echo -e "${RED}No tmux server running — nothing to restore${NC}"
    exit 1
  fi
  mapfile -t sessions < <(tmux list-sessions -F '#{session_name}')
fi

echo -e "${BLUE}Restoring Termux tabs for ${#sessions[@]} tmux sessions...${NC}"

for session in "${sessions[@]}"; do
  # Check session exists
  if ! tmux has-session -t "$session" 2>/dev/null; then
    echo -e "  ${RED}✗${NC} $session — session not found"
    failed=$((failed + 1))
    continue
  fi

  # Check if already attached (has a client)
  attached=$(tmux list-clients -t "$session" 2>/dev/null | wc -l)
  if [[ "$attached" -gt 0 ]]; then
    echo -e "  ${YELLOW}→${NC} $session — already attached, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  # Create a new Termux tab that attaches to this tmux session
  if create_tab "tmux attach -t '$session'"; then
    echo -e "  ${GREEN}✓${NC} $session — tab created"
    restored=$((restored + 1))
  else
    echo -e "  ${RED}✗${NC} $session — failed to create tab"
    failed=$((failed + 1))
  fi

  # Stagger to avoid UI race conditions
  sleep 1
done

echo ""
echo -e "${GREEN}Restored: $restored${NC}  ${YELLOW}Skipped: $skipped${NC}  ${RED}Failed: $failed${NC}"
