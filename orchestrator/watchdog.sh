#!/data/data/com.termux/files/usr/bin/bash
# watchdog.sh — Keeps operad daemon alive after OOM kills
# Install: replace ~/.termux/boot/startup.sh with this script
# The operad daemon handles everything startup.sh used to do:
# ADB fix, session creation, health checks, wake lock management.
#
# After a successful boot, this script attaches tmux to the current terminal
# so the watchdog's Termux tab becomes a tmux client (enabling tab switching).

LOG_DIR="$HOME/.local/share/tmx/logs"
SOCKET="$PREFIX/tmp/tmx.sock"
TMX="$HOME/.local/bin/tmx"
mkdir -p "$LOG_DIR"

# Check if daemon is alive by testing the IPC socket with a status command.
# Returns 0 if daemon responds, 1 otherwise.
daemon_alive() {
  timeout 5 "$TMX" status > /dev/null 2>&1
}

while true; do
  # If daemon is already running, skip boot entirely — just attach tmux.
  if daemon_alive; then
    echo "[$(date)] Daemon already running, attaching tmux" >> "$LOG_DIR/watchdog.log"
  else
    echo "[$(date)] Starting operad boot..." >> "$LOG_DIR/watchdog.log"

    # Do NOT delete the socket here — isRunning() handles stale detection.
    # Deleting an active socket causes duplicate daemon spawns.

    "$TMX" boot
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
      echo "[$(date)] operad boot failed (code=$EXIT_CODE), retrying in 5s..." >> "$LOG_DIR/watchdog.log"
      sleep 5
      continue
    fi

    echo "[$(date)] Boot succeeded" >> "$LOG_DIR/watchdog.log"
  fi

  # Wait for tmux sessions to exist before attaching (boot is async).
  for i in $(seq 1 15); do
    if tmux has-session 2>/dev/null; then break; fi
    sleep 1
  done

  if tmux has-session 2>/dev/null; then
    echo "[$(date)] Attaching tmux client" >> "$LOG_DIR/watchdog.log"
    # Attach tmux to this terminal — makes the watchdog tab a tmux client.
    # No exec — when tmux exits (daemon shutdown/OOM), the loop continues and reboots.
    tmux attach
    echo "[$(date)] tmux exited, loop will restart daemon" >> "$LOG_DIR/watchdog.log"
  else
    echo "[$(date)] No tmux sessions available, skipping attach" >> "$LOG_DIR/watchdog.log"
  fi

  # Brief pause before checking again — prevents tight loop if daemon keeps crashing
  sleep 3
done
