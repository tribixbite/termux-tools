# Tasker Setup via ADB

Automate Tasker configuration to monitor and restart Termux using ADB commands.

## Overview

Three approaches available, from simplest to most robust:

1. **Manual Setup** (most reliable) - Follow step-by-step Tasker UI instructions
2. **Semi-Automated** - Use ADB to import pre-made XML profiles
3. **Fully Automated** - Script creates and enables Tasker profile

## Why Monitor Termux?

Termux may crash due to:
- Out of memory (OOM) kills by Android
- System aggressive battery optimization
- User accidentally closing app
- Android killing background processes

**Solution:** Tasker monitors Termux health and auto-restarts when needed.

## Prerequisites

```bash
# Required packages in Termux
pkg install termux-api android-tools

# Required apps on Android
# - Tasker (Play Store)
# - Termux:Tasker plugin (F-Droid recommended)
# - Termux:API (F-Droid)
```

## Monitoring Strategy

The robust approach: Monitor for **absence of boot notification**

Our `startup.sh` sends a notification: "Termux Boot - ✓ Started 6 sessions"

If this notification is missing → Termux crashed or didn't start → Restart it

**Advantages:**
- Checks Termux actually completed boot successfully
- Not just that the app is open
- Verifies sessions are running
- Less prone to false positives than "App Closed" events

## Method 1: Manual Setup (Recommended)

Run the setup helper:
```bash
cd ~/git/termux-tools
bash tasker/setup-tasker-simple.sh
```

Then follow the on-screen instructions to manually create the Tasker profile.

**What it creates:**
- Health check script: `~/.shortcuts/check-termux-health.sh`
- Checks: tmux running, 6 sessions exist, boot notification present

**Tasker Profile (10 minute interval):**
1. Run health check script via Termux:Tasker
2. If script fails (exit code != 0):
   - Show "Termux Recovery" notification
   - Launch Termux app
   - Wait 3 seconds
   - Run `~/.termux/boot/startup.sh`

## Method 2: Semi-Automated (ADB Import)

Use ADB to push pre-made Tasker XML and import:

```bash
cd ~/git/termux-tools

# Creates profile XML and saves to Downloads
bash tasker/auto-setup-tasker.sh
```

**What it does:**
1. Connects via ADB
2. Creates Tasker profile XML file
3. Saves to `/sdcard/Download/TermuxHealthMonitor.prj.xml`
4. Attempts to import via intent
5. Opens Tasker for manual verification

**Then in Tasker:**
1. Menu → Data → Import Project
2. Navigate to Downloads → TermuxHealthMonitor.prj.xml
3. Enable the profile (checkmark)

## Method 3: Even Simpler (Notification Check)

Monitor notification directly without health check script:

**Tasker Profile:**
```
Profile: Check Termux Notification
Context: Time (Every 10 minutes)

Task:
1. Variable Search Replace
   - Variable: %NOTIFICATIONS
   - Search: "Termux Boot"
   - Continue Task After Error: ON

2. If %err Set

3. Alert → Notify
   - Title: Termux Recovery
   - Text: Restarting sessions...

4. App → Launch App
   - App: Termux

5. Task → Wait
   - Seconds: 3

6. Plugin → Termux:Tasker
   - Executable: bash
   - Arguments: ~/.termux/boot/startup.sh

7. End If
```

**How it works:**
- Searches active notifications for "Termux Boot"
- If not found (%err is set) → Termux is down
- Launches Termux and runs startup script

## Testing

### Test Health Check
```bash
# Should show HEALTHY
bash ~/.shortcuts/check-termux-health.sh
# Output: HEALTHY: 6 sessions running

# Make it unhealthy
tmux kill-server

# Should show UNHEALTHY
bash ~/.shortcuts/check-termux-health.sh
# Output: UNHEALTHY: tmux not running
# Exit code: 1
```

### Test Tasker Profile
```bash
# Kill all sessions
tmux kill-server

# Dismiss boot notification
termux-notification-remove "Termux Boot"

# Wait for Tasker (up to 10 minutes based on interval)
# Watch for:
# 1. "Termux Recovery" notification
# 2. Termux app launching
# 3. Sessions being created
```

### Manual Test in Tasker
1. Long-press the task in Tasker
2. Tap "Play" button (bottom of screen)
3. Task should run immediately
4. Watch logs in Tasker for any errors

## Adjust Check Interval

**In Tasker:**
1. Long-press profile name
2. Tap clock icon (time context)
3. Change "Repeat" value:
   - 5 minutes = more responsive, more battery usage
   - 10 minutes = balanced (recommended)
   - 30 minutes = less responsive, better battery

## Troubleshooting

### Health Check Fails Even When Healthy
```bash
# Check what the script sees
bash ~/.shortcuts/check-termux-health.sh
echo "Exit code: $?"

# Verify sessions
tmux list-sessions

# Check notification
termux-notification-list | grep "Termux Boot"
```

### Tasker Not Running Script
1. Check Termux:Tasker plugin installed
2. Verify permissions:
   - Settings → Apps → Tasker → Permissions
   - Ensure "Run commands" granted

3. Test script manually:
   ```bash
   bash ~/.shortcuts/check-termux-health.sh
   echo $?  # Should be 0 if healthy
   ```

4. Check Tasker logs:
   - Tasker → Menu → More → Run Log
   - Look for errors when task runs

### ADB Connection Issues
```bash
# Re-enable wireless debugging on device:
# Settings → Developer Options → Wireless Debugging → ON

# Get new pairing info and reconnect
bash ~/git/termux-tools/tools/adb-wireless-connect.sh

# Verify connection
adb devices
```

### Profile Not Importing
If ADB import fails:
1. File is saved to: `/sdcard/Download/TermuxHealthMonitor.prj.xml`
2. In Tasker: Menu → Data → Import Project
3. Browse to Downloads folder
4. Select the XML file

### Notification Monitor Not Working
Enable notification access for Tasker:
```bash
# Open notification settings
adb shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS

# Then manually enable Tasker in the list
```

Or manually:
- Settings → Apps → Special Access → Notification Access
- Enable Tasker

## Files Created

```
~/git/termux-tools/
├── tasker/setup-tasker-simple.sh              # Interactive setup helper
├── tasker/auto-setup-tasker.sh                # Automated ADB setup
├── tasker/setup-tasker-via-adb.sh             # Original ADB approach
└── tasker/setup-tasker-notification-monitor.sh # Notification-based monitor

~/.shortcuts/
└── check-termux-health.sh              # Health check script

/sdcard/Download/
└── TermuxHealthMonitor.prj.xml         # Tasker project XML (created by auto-setup)
```

## Advanced: Custom Health Checks

Edit `~/.shortcuts/check-termux-health.sh` to add custom checks:

```bash
# Check specific bot is running
if ! pgrep -f "discord-irc" >/dev/null; then
    echo "UNHEALTHY: discord-bot not running"
    exit 1
fi

# Check specific tmux session exists
if ! tmux has-session -t cleverkeys 2>/dev/null; then
    echo "UNHEALTHY: cleverkeys session missing"
    exit 1
fi

# Check Claude Code is responding
if ! tmux capture-pane -t cleverkeys -p | tail -5 | grep -q "Thinking\|Scurrying"; then
    echo "UNHEALTHY: Claude not responding in cleverkeys"
    exit 1
fi
```

## Why This Approach is Robust

1. **Monitors actual health**, not just app state
   - Verifies tmux is running
   - Confirms sessions exist
   - Checks boot completed successfully

2. **Graceful recovery**
   - Waits 3 seconds for Termux to fully start
   - Runs full startup script (not just partial restart)
   - Sends notification so you know it happened

3. **Low false positives**
   - Doesn't trigger on app switch
   - Only triggers on actual crashes or missing sessions
   - Notification check ensures boot completed

4. **Adjustable sensitivity**
   - Change check interval (5-30 minutes)
   - Modify health check criteria
   - Add custom validation logic

## Battery Impact

**Check every 10 minutes:**
- Minimal impact (~1-2% per day)
- Script runs for <1 second
- Tasker is already optimized for periodic tasks

**To reduce impact:**
- Increase interval to 30 minutes
- Use simpler notification check (no shell script)
- Only enable profile during certain hours

## See Also

- [BOOT_ARCHITECTURE.md](BOOT_ARCHITECTURE.md) - How boot automation works
- [TASKER_SETUP.md](TASKER_SETUP.md) - Manual Tasker configuration guide
- [ADB_WIRELESS_GUIDE.md](ADB_WIRELESS_GUIDE.md) - ADB connection help
