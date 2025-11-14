# Tasker Automation Setup

Automated recovery from Termux crashes and wireless debugging management.

## Overview

This setup provides:
1. **Automatic Termux restart** when it crashes or force closes
2. **Wireless debugging keep-alive** to maintain ADB connection
3. **Boot script execution** to restore all tmux sessions

## Prerequisites

### Required Apps

1. **Tasker** (Paid app from Play Store)
   - https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm
   - One-time purchase (~$3.49)

2. **Termux** (Already installed)
   - Ensure you have the latest version from F-Droid

3. **AutoInput** (Optional, for wireless debugging automation)
   - https://play.google.com/store/apps/details?id=com.joaomgcd.autoinput
   - Required for UI automation (wireless debugging toggle)
   - Free version works, Pro version recommended

### Permissions Required

```
Tasker permissions:
- Display over other apps
- Notification access
- Accessibility (for AutoInput)
- Battery optimization disabled (important!)

Termux permissions:
- RUN_COMMAND intent permission (auto-granted)
```

## Setup Instructions

### Method 1: Import XML Files (Recommended)

1. **Transfer XML files to device:**
   ```bash
   # Files are in ~/git/termux-tools/tasker/
   # Copy to Downloads or any accessible folder
   cp ~/git/termux-tools/tasker/*.xml ~/storage/downloads/
   ```

2. **Import into Tasker:**
   - Open Tasker
   - Long press the **PROFILES** tab → Import
   - Select `Termux_Monitor.prf.xml`
   - Long press the **TASKS** tab → Import
   - Select `Termux_Restart.tsk.xml`
   - (Optional) Import `Wireless_Debugging_KeepAlive.tsk.xml`

3. **Verify imports:**
   - Check PROFILES tab: "Termux Crash Monitor" should appear
   - Check TASKS tab: "Termux Restart" should appear

4. **Enable profile:**
   - Tap the profile name
   - Ensure toggle is ON (green)

### Method 2: Manual Setup

#### Profile 1: Termux Crash Monitor

1. **Create new profile:**
   - Tap **+** button
   - Select **Event** → **App** → **App Closed**
   - Package: `com.termux`
   - Check "Use Regex" if needed

2. **Create task "Termux Restart":**
   - Tap "New Task +"
   - Name: "Termux Restart"

3. **Add actions:**

   **Action 1: Wait**
   - Task → Wait
   - Seconds: 2
   - (Gives system time to clean up)

   **Action 2: Launch Termux**
   - App → Launch App
   - Package: `com.termux`
   - Activity: `com.termux.app.TermuxActivity`

   **Action 3: Wait**
   - Task → Wait
   - Seconds: 3
   - (Let Termux fully start)

   **Action 4: Run boot script**
   - System → Send Intent
   - Action: `com.termux.RUN_COMMAND`
   - Package: `com.termux`
   - Extra: `com.termux.RUN_COMMAND_ARGUMENTS:bash`
   - Extra: `com.termux.RUN_COMMAND_ARGUMENTS:-c`
   - Extra: `com.termux.RUN_COMMAND_ARGUMENTS:source ~/.bash_aliases && bash ~/.termux/boot/startup.sh`

   **Action 5: Notify**
   - Alert → Flash
   - Text: "Termux Restarted"

4. **Save and enable**

#### Profile 2: Wireless Debugging KeepAlive (Optional)

This requires **AutoInput** plugin.

1. **Create new profile:**
   - Tap **+** button
   - Select **State** → **Display** → **Display On**
   - (Runs when screen turns on)

2. **Create task:**
   - Name: "Check Wireless Debugging"

3. **Add actions:**

   **Action 1: Check if enabled** (requires shell)
   - Code → Run Shell
   - Command: `adb devices 2>/dev/null | grep -q device`
   - Store Exit Code: `%adb_status`
   - Continue Task After Error: ON

   **Action 2: If ADB not connected**
   - Task → If
   - Condition: `%adb_status != 0`

   **Action 3: Open Developer Settings**
   - App → Launch App
   - Package: `com.android.settings`
   - Activity: `com.android.settings.Settings$DevelopmentSettingsDashboardActivity`

   **Action 4: Wait**
   - Task → Wait
   - Seconds: 1

   **Action 5: Find and toggle wireless debugging**
   - Plugin → AutoInput → Action
   - Configuration:
     - Action: Click
     - Field Type: Text
     - Text: "Wireless debugging"

   **Action 6: Ensure it's ON**
   - Plugin → AutoInput → Action
   - Configuration:
     - Action: Toggle
     - Field Type: Id
     - Id: `android:id/switch_widget`
     - Check State: ON

   **Action 7: Go home**
   - System → Go Home

   **Action 8: End If**
   - Task → End If

## Configuration

### Disable Battery Optimization for Tasker

**Critical for reliability:**

1. Settings → Apps → Tasker
2. Battery → Unrestricted
3. Remove from battery optimization

Without this, Tasker may not run in background!

### Termux RUN_COMMAND Permission

Tasker needs permission to send commands to Termux:

1. Open Termux
2. Run: `termux-setup-storage` (if not done already)
3. The RUN_COMMAND permission is usually auto-granted
4. Test by running the Tasker task manually

### Test the Setup

1. **Test Termux restart:**
   - Force close Termux: Settings → Apps → Termux → Force Stop
   - Wait 5 seconds
   - Termux should auto-restart
   - Check if tmux sessions are running: `tmux ls`

2. **Test manually in Tasker:**
   - Open Tasker
   - Go to TASKS tab
   - Long press "Termux Restart"
   - Tap the play button (▶)
   - Verify Termux opens and runs boot script

3. **Check logs:**
   - Tasker → 3-dot menu → More → Run Log
   - Look for errors

## Troubleshooting

### Termux doesn't restart

**Check:**
1. Battery optimization disabled for Tasker?
2. Tasker has "Display over other apps" permission?
3. Profile is enabled (green toggle)?
4. Test manually - does the task work?

**Debug:**
- Run the task manually from TASKS tab
- Check Tasker Run Log for errors
- Verify package name: `com.termux`

### Boot script doesn't run

**Check:**
1. Intent action is exactly: `com.termux.RUN_COMMAND`
2. Arguments are correct (see Action 4 above)
3. Termux RUN_COMMAND permission granted?

**Test:**
```bash
# In Termux, test the command works:
source ~/.bash_aliases && bash ~/.termux/boot/startup.sh
```

### Wireless debugging doesn't enable

**Requirements:**
- AutoInput plugin installed
- AutoInput has Accessibility permission
- Developer options enabled on device
- Wireless debugging available on your Android version (11+)

**Alternative without AutoInput:**
- Use ADB command: `adb tcpip 5555`
- Run from Termux after connection
- Or use manual setup in Developer Options

### "Out of RAM" crashes persist

If Termux keeps crashing due to RAM:

1. **Reduce tmux sessions:**
   - Edit `~/.termux/boot/repos.conf`
   - Set some repos to `enabled: 0`

2. **Increase swap:**
   ```bash
   # Create swap file (requires root)
   # Or use app like "Swapper & Tools"
   ```

3. **Close other apps:**
   - Android keeps many apps in memory
   - Force stop unused apps

4. **Check memory usage:**
   ```bash
   free -h
   ps aux | head -20
   ```

## Advanced Options

### Delay restart on repeated crashes

To avoid crash loops, add delay logic:

```
Action: Variable Set
Name: %TermuxCrashes
To: %TermuxCrashes + 1

Action: If
%TermuxCrashes > 3

Action: Wait
Seconds: 30

Action: Variable Set
Name: %TermuxCrashes
To: 0

Action: End If
```

### Notify on crash

Add before restart:

```
Action: Notify
Title: Termux Crashed
Text: Restarting in 2 seconds...
Priority: 5
```

### Run additional recovery

Add to end of task:

```
Action: Send Intent
Action: com.termux.RUN_COMMAND
Extra: com.termux.RUN_COMMAND_PATH:/data/data/com.termux/files/home/git/termux-tools/adb-wireless-connect.sh
```

## Files

```
~/git/termux-tools/tasker/
├── Termux_Monitor.prf.xml          # Profile: Detect crashes
├── Termux_Restart.tsk.xml          # Task: Restart Termux
├── Wireless_Debugging_KeepAlive.tsk.xml  # Task: Enable wireless debugging
└── TASKER_SETUP.md                 # This guide
```

## How It Works

### Crash Detection Flow

```
Termux crashes/closes
       ↓
Tasker detects (App Closed event)
       ↓
Wait 2 seconds (cleanup)
       ↓
Launch Termux app
       ↓
Wait 3 seconds (startup)
       ↓
Send RUN_COMMAND intent
       ↓
Termux executes boot script
       ↓
All tmux sessions restored
       ↓
Flash notification "Termux Restarted"
```

### Why This Works

1. **App Closed event** triggers on any Termux termination
2. **RUN_COMMAND** is Termux's built-in automation intent
3. **Boot script** recreates entire environment
4. **Tasker runs in background** even when apps crash

## Limitations

1. **Won't fix kernel/system crashes** - Only app-level crashes
2. **Requires Tasker running** - If Tasker crashes, no recovery
3. **Battery optimization** - Must be disabled or Tasker won't run
4. **AutoInput required** - For wireless debugging automation
5. **Android 11+ only** - Wireless debugging is newer feature

## Tips

1. **Keep Tasker updated** - New Android versions need updates
2. **Test regularly** - Force stop Termux to verify it works
3. **Monitor battery** - Background automation uses some battery
4. **Use notification** - Know when crashes happen
5. **Combine with cron** - Cron maintains sessions, Tasker recovers crashes

## Alternative: Termux:Boot App

You can also use **Termux:Boot** app for startup (you already have this configured).

**Difference:**
- Termux:Boot: Runs on device boot
- Tasker: Runs when app crashes/closes

**Use both for complete coverage:**
- Boot → Termux:Boot starts sessions
- Crash → Tasker restarts sessions
- Maintenance → Cron keeps sessions alive

## Summary

With this setup:
- ✅ Termux auto-restarts on crash
- ✅ All tmux sessions restored automatically
- ✅ Wireless debugging kept enabled (optional)
- ✅ No manual intervention needed
- ✅ Works even with frequent crashes

**Result:** Resilient development environment that recovers from RAM issues automatically! 🎉
