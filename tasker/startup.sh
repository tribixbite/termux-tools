#!/data/data/com.termux/files/usr/bin/bash
# ~/.termux/boot/startup.sh
# Runs automatically when device boots (requires Termux:Boot app)
# Creates separate tmux instances for each project

# XDG-compliant paths
CONFIG_DIR="$HOME/.config/termux-boot"
LOG_DIR="$HOME/.local/share/termux-boot/logs"
BOOT_LOG="$LOG_DIR/boot.log"
BOT_LOG="$LOG_DIR/discord-bot.log"

# Ensure directories exist
mkdir -p "$CONFIG_DIR" "$LOG_DIR"

# Acquire wake lock to prevent sleep during startup
termux-wake-lock

# Log boot startup
echo "[$(date)] Boot startup initiated" >> "$BOOT_LOG"

# === CRITICAL: Fix phantom process killer FIRST before starting anything ===
echo "[$(date)] Waiting 15s for ADB wireless debugging to initialize..." >> "$BOOT_LOG"
sleep 15  # Wait for wireless debugging to initialize after boot

ADB_FIXED=false
if timeout 45 ~/git/termux-tools/tools/adb-wireless-connect.sh >> "$BOOT_LOG" 2>&1; then
  echo "[$(date)] ADB connected, applying fixes..." >> "$BOOT_LOG"
  # Phantom process killer fix
  adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647" >> "$BOOT_LOG" 2>&1
  adb shell "settings put global settings_enable_monitor_phantom_procs false" >> "$BOOT_LOG" 2>&1
  # Enable Samsung sensor/camera packages
  for pkg in com.samsung.android.ssco com.samsung.android.mocca com.samsung.android.camerasdkservice; do
    adb shell "pm enable $pkg" >> "$BOOT_LOG" 2>&1
  done
  echo "[$(date)] Fixes applied successfully" >> "$BOOT_LOG"
  ADB_FIXED=true
else
  echo "[$(date)] WARNING: ADB connection failed - phantom killer fix NOT applied!" >> "$BOOT_LOG"
  echo "[$(date)] Processes may be killed. Run fix-after-update.sh manually." >> "$BOOT_LOG"
  termux-notification --title "Boot Warning" --content "ADB fix failed - processes may be killed"
fi

# Load repository configuration
# Check both old and new locations
if [ -f "$CONFIG_DIR/repos.conf" ]; then
  source "$CONFIG_DIR/repos.conf"
elif [ -f "$HOME/.termux/boot/repos.conf" ]; then
  source "$HOME/.termux/boot/repos.conf"
else
  echo "[$(date)] ERROR: repos.conf not found" >> "$BOOT_LOG"
  termux-notification --title "Boot Error" --content "repos.conf not found"
  termux-wake-unlock
  exit 1
fi

# Counter for tracking instances
instance_count=0
error_count=0

# Create separate tmux instance for each repo
for repo in "${!REPOS[@]}"; do
  # Parse config: auto_go:enabled
  IFS=':' read -r auto_go enabled <<< "${REPOS[$repo]}"

  # Skip if not enabled
  if [ "$enabled" != "1" ]; then
    echo "[$(date)] Skipping disabled repo: $repo" >> "$BOOT_LOG"
    continue
  fi

  # Verify repo exists
  if [ ! -d "$repo" ]; then
    echo "[$(date)] ERROR: Skipping non-existent repo: $repo" >> "$BOOT_LOG"
    error_count=$((error_count + 1))
    continue
  fi

  # Get repo name for session naming
  name=$(basename "$repo")

  # Create unique session name (lowercase, no special chars)
  session_name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

  echo "[$(date)] Creating tmux instance: $session_name" >> "$BOOT_LOG"

  # Create new detached tmux session
  if ! tmux new-session -d -s "$session_name" -c "$repo" 2>> "$BOOT_LOG"; then
    echo "[$(date)] ERROR: Failed to create session: $session_name" >> "$BOOT_LOG"
    error_count=$((error_count + 1))
    continue
  fi

  # Start Claude Code in the session
  tmux send-keys -t "$session_name" "cc"
  tmux send-keys -t "$session_name" Enter

  # Auto-send 'go' if flagged
  if [ "$auto_go" = "1" ]; then
    sleep 1  # Wait for cc to fully start
    tmux send-keys -t "$session_name" "go"
    tmux send-keys -t "$session_name" Enter
    echo "[$(date)] Auto-sent 'go' to $session_name" >> "$BOOT_LOG"
  fi

  instance_count=$((instance_count + 1))
done

# Start discord-irc bot in separate session with logging
if [ -d "$HOME/git/dirc" ] && [ -f "$HOME/git/discord-irc/dist/lib/cli.js" ]; then
  echo "[$(date)] Creating tmux instance: discord-bot" >> "$BOOT_LOG"

  # Rotate logs before starting bot (prevents 30MB+ log files)
  LOG_ROTATION_SCRIPT="$HOME/git/discord-irc/scripts/rotate-logs.sh"
  if [ -x "$LOG_ROTATION_SCRIPT" ]; then
    echo "[$(date)] Running log rotation..." >> "$BOOT_LOG"
    "$LOG_ROTATION_SCRIPT" >> "$BOOT_LOG" 2>&1
  fi

  # Create tmux session for bot
  if tmux new-session -d -s discord-bot -c "$HOME/git/dirc" 2>> "$BOOT_LOG"; then
    # Start the bot with output redirected to log file
    # Use script to capture output with timestamps
    tmux send-keys -t discord-bot "NODE_ENV=development bun ../discord-irc/dist/lib/cli.js 2>&1 | tee -a '$BOT_LOG'"
    tmux send-keys -t discord-bot Enter

    echo "[$(date)] Started discord-irc bot (logging to $BOT_LOG)" >> "$BOOT_LOG"
    instance_count=$((instance_count + 1))
  else
    echo "[$(date)] ERROR: Failed to create discord-bot session" >> "$BOOT_LOG"
    error_count=$((error_count + 1))
  fi
fi

# Start termux-x11 in separate session
echo "[$(date)] Creating tmux instance: termux-x11" >> "$BOOT_LOG"
if tmux new-session -d -s termux-x11 2>> "$BOOT_LOG"; then
  # Start X11 server on display :1
  tmux send-keys -t termux-x11 "termux-x11 :1 -legacy-drawing -xstartup 'xfce4-session'"
  tmux send-keys -t termux-x11 Enter

  echo "[$(date)] Started termux-x11 on display :1" >> "$BOOT_LOG"
  instance_count=$((instance_count + 1))
else
  echo "[$(date)] ERROR: Failed to create termux-x11 session" >> "$BOOT_LOG"
  error_count=$((error_count + 1))
fi

# Start Playwright MCP server in X11 environment
echo "[$(date)] Creating tmux instance: playwright" >> "$BOOT_LOG"
if tmux new-session -d -s playwright 2>> "$BOOT_LOG"; then
  # Wait for X11 to initialize, then start Playwright with DISPLAY set
  tmux send-keys -t playwright "sleep 3 && DISPLAY=:1 mcp-server-playwright --port 8989 --browser chromium --executable-path /data/data/com.termux/files/usr/bin/chromium-browser"
  tmux send-keys -t playwright Enter

  echo "[$(date)] Started Playwright MCP server on port 8989 (DISPLAY=:1)" >> "$BOOT_LOG"
  instance_count=$((instance_count + 1))
else
  echo "[$(date)] ERROR: Failed to create playwright session" >> "$BOOT_LOG"
  error_count=$((error_count + 1))
fi

# Release wake lock after setup
#termux-wake-unlock

# Final status
echo "[$(date)] Boot startup completed - created $instance_count tmux instances ($error_count errors)" >> "$BOOT_LOG"

# Send notification with status
if [ $error_count -eq 0 ]; then
  termux-notification --title "Termux Boot" --content "✓ Started $instance_count sessions"
else
  termux-notification --title "Termux Boot" --content "⚠ Started $instance_count sessions ($error_count errors)"
fi

# Start cron daemon for scheduled tasks
if ! pgrep -x crond > /dev/null; then
  crond -s -P
  echo "[$(date)] Started crond" >> "$BOOT_LOG"
fi

# Phantom process killer fix moved to beginning of script
