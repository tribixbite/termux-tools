#!/data/data/com.termux/files/usr/bin/bash
# watchdog.sh — Keeps tmx daemon alive after OOM kills
# Install: replace ~/.termux/boot/startup.sh with this script
# The tmx daemon handles everything startup.sh used to do:
# ADB fix, session creation, health checks, wake lock management.

LOG_DIR="$HOME/.local/share/tmx/logs"
mkdir -p "$LOG_DIR"

while true; do
  echo "[$(date)] Starting tmx boot..." >> "$LOG_DIR/watchdog.log"
  tmx boot
  EXIT_CODE=$?
  echo "[$(date)] tmx daemon exited (code=$EXIT_CODE), restarting in 5s..." >> "$LOG_DIR/watchdog.log"
  sleep 5
done
