#!/data/data/com.termux/files/usr/bin/bash
# watchdog.sh — Keeps tmx daemon alive after OOM kills
# Install: replace ~/.termux/boot/startup.sh with this script
# The tmx daemon handles everything startup.sh used to do:
# ADB fix, session creation, health checks, wake lock management.
#
# After a successful boot, this script attaches tmux to the current terminal
# so the watchdog's Termux tab becomes a tmux client (enabling tab switching).

LOG_DIR="$HOME/.local/share/tmx/logs"
SOCKET="$PREFIX/tmp/tmx.sock"
mkdir -p "$LOG_DIR"

while true; do
  echo "[$(date)] Starting tmx boot..." >> "$LOG_DIR/watchdog.log"

  # Clean up stale socket from previous daemon crash / OOM kill
  if [ -S "$SOCKET" ]; then
    echo "[$(date)] Removing stale socket" >> "$LOG_DIR/watchdog.log"
    rm -f "$SOCKET" 2>/dev/null
  fi

  tmx boot
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] Boot succeeded, attaching tmux client" >> "$LOG_DIR/watchdog.log"
    # Attach tmux to this terminal — makes the watchdog tab a tmux client.
    # When tmux exits (daemon shutdown/OOM), the loop continues and reboots.
    exec tmux attach
  fi

  echo "[$(date)] tmx boot failed (code=$EXIT_CODE), restarting in 5s..." >> "$LOG_DIR/watchdog.log"
  sleep 5
done
