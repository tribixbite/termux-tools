#!/data/data/com.termux/files/usr/bin/bash
# setup-tasker-simple.sh
# Simplest approach: Tasker periodically checks if Termux is healthy
# If not → restart it

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🎯 Simple Tasker Termux Monitor Setup"
echo "====================================="
echo
echo "This will create a Tasker profile that:"
echo "  • Runs every 10 minutes"
echo "  • Checks if Termux sessions are running"
echo "  • If not → launches Termux and runs startup script"
echo

# Connect ADB
if ! adb devices | grep -q "device$"; then
    "$SCRIPT_DIR/adb-wireless-connect.sh"
fi

# Create simple check script in Termux
echo "📝 Creating health check script..."
cat > ~/.shortcuts/check-termux-health.sh <<'HEALTHCHECK'
#!/data/data/com.termux/files/usr/bin/bash
# Quick health check - returns 0 if healthy, 1 if needs restart

# Check if tmux is running
if ! pgrep -x tmux >/dev/null; then
    echo "UNHEALTHY: tmux not running"
    exit 1
fi

# Check if we have the expected number of sessions (6)
SESSION_COUNT=$(tmux list-sessions 2>/dev/null | wc -l || echo 0)
if [ "$SESSION_COUNT" -lt 5 ]; then
    echo "UNHEALTHY: Only $SESSION_COUNT sessions (expected 6)"
    exit 1
fi

# Check if boot notification exists
if ! termux-notification-list | grep -q "Termux Boot"; then
    echo "UNHEALTHY: Boot notification missing"
    exit 1
fi

echo "HEALTHY: $SESSION_COUNT sessions running"
exit 0
HEALTHCHECK

chmod +x ~/.shortcuts/check-termux-health.sh
echo "✓ Health check script created"
echo

# Create Tasker task using Termux:Tasker
echo "📱 Creating Tasker configuration..."
cat <<'INSTRUCTIONS'

╔════════════════════════════════════════════════════════════╗
║  MANUAL TASKER SETUP (Simple & Robust)                     ║
╚════════════════════════════════════════════════════════════╝

1. Open Tasker on your device

2. CREATE PROFILE:
   • Tap "+" (bottom right)
   • Select "Time"
   • Set: Every 10 minutes (From: 00:00, To: 23:59, Repeat: 10 minutes)
   • Tap back

3. CREATE TASK "Termux Health Check":
   • Tap "+" to add new task
   • Name it: "Termux Health Check"

   ACTION 1 - Check Health:
   • Plugin → Termux:Tasker
   • Configuration:
     Executable: bash
     Arguments: /data/data/com.termux/files/home/.shortcuts/check-termux-health.sh
   • Continue Task After Error: ✓ (CHECK THIS!)
   • Tap back

   ACTION 2 - If Unhealthy:
   • Task → If
   • Condition: %err Set (or %errmsg matches *)

   ACTION 3 - Show Recovery Notification:
   • Alert → Notify
   • Title: Termux Recovery
   • Text: Restarting Termux sessions...

   ACTION 4 - Launch Termux:
   • App → Launch App
   • Select: Termux

   ACTION 5 - Wait:
   • Task → Wait
   • Seconds: 3

   ACTION 6 - Run Startup Script:
   • Plugin → Termux:Tasker
   • Configuration:
     Executable: bash
     Arguments: /data/data/com.termux/files/home/.termux/boot/startup.sh

   ACTION 7 - End If:
   • Task → End If

4. ENABLE PROFILE:
   • Toggle the profile ON (checkmark appears)

5. TEST:
   • Kill all tmux sessions: tmux kill-server
   • Wait up to 10 minutes
   • Tasker should detect and restart

INSTRUCTIONS

echo
echo "📋 OR use this simpler approach:"
echo

cat <<'SIMPLER'
╔════════════════════════════════════════════════════════════╗
║  EVEN SIMPLER: Just monitor the notification               ║
╚════════════════════════════════════════════════════════════╝

1. Open Tasker → Profiles tab

2. CREATE PROFILE:
   • Tap "+"
   • Select "Time"
   • Every 10 minutes

3. CREATE TASK:
   ACTION 1 - Check Notification:
   • Variables → Variable Search Replace
   • Variable: %NOTIFICATIONS
   • Search: Termux Boot
   • (Leave others blank)
   • Continue Task After Error: ✓

   ACTION 2 - If Not Found:
   • Task → If
   • %err Set

   ACTION 3 - Launch Termux:
   • App → Launch App → Termux

   ACTION 4 - Wait 3 sec:
   • Task → Wait → 3

   ACTION 5 - Run Script:
   • Plugin → Termux:Tasker
   • Executable: bash
   • Arguments: ~/.termux/boot/startup.sh

   ACTION 6 - End If

This checks if "Termux Boot" notification exists.
If not → restart Termux and run startup script.

SIMPLER

echo
echo "✅ Setup files created!"
echo "   Health check: ~/.shortcuts/check-termux-health.sh"
echo
echo "🧪 Test health check:"
echo "   bash ~/.shortcuts/check-termux-health.sh"
echo
echo "   Expected output: 'HEALTHY: 6 sessions running'"
echo
