# Manual Tasker Setup (No Import Needed)

Step-by-step manual creation - works on all Tasker versions.

## Profile: Termux Crash Monitor

### Step 1: Create Profile

1. Open **Tasker**
2. Tap **PROFILES** tab (bottom)
3. Tap **+** (bottom right)
4. Select **Event**

### Step 2: Configure Event

1. Select **System** → **Logcat Entry**
   - Component: `ActivityManager`
   - Filter: `*termux*`
   - Or use: **App** → **App Closed** → Package: `com.termux`

2. Tap back (←) to save

### Step 3: Create Task "Termux Restart"

When prompted "Task Selection", tap **+ New Task**
- Name: `Termux Restart`
- Tap checkmark (✓)

### Step 4: Add Actions

**Action 1 - Wait:**
1. Tap **+** button
2. Select **Task** → **Wait**
3. Seconds: `2`
4. Tap back (←)

**Action 2 - Launch Termux:**
1. Tap **+**
2. Select **App** → **Launch App**
3. Application: Scroll and select **Termux**
4. Tap back (←)

**Action 3 - Wait Again:**
1. Tap **+**
2. Select **Task** → **Wait**
3. Seconds: `3`
4. Tap back (←)

**Action 4 - Run Boot Script:**
1. Tap **+**
2. Select **Code** → **Run Shell**
3. Command:
   ```bash
   am broadcast -a com.termux.RUN_COMMAND --es com.termux.RUN_COMMAND_PATH '/data/data/com.termux/files/home/.termux/boot/startup.sh' -n com.termux/com.termux.app.RunCommandReceiver
   ```
4. Check **Use Root**: NO
5. Check **Continue Task After Error**: YES
6. Tap back (←)

**Action 5 - Notify:**
1. Tap **+**
2. Select **Alert** → **Flash**
3. Text: `Termux Restarted`
4. Tap back (←)

### Step 5: Save and Enable

1. Tap back (←) to exit task editing
2. Tap back (←) to exit profile
3. Profile should show with green toggle ON
4. If toggle is OFF, tap the profile name to enable

## Alternative: Simpler Shell Command

If the `am broadcast` doesn't work, use this for Action 4 instead:

1. Tap **+**
2. Select **Code** → **Run Shell**
3. Command:
   ```bash
   su -c "am startservice --user 0 -n com.termux/com.termux.app.TermuxService; sleep 2; am broadcast -a com.termux.service.ACTION_EXECUTE --es com.termux.execute.command 'source ~/.bash_aliases && bash ~/.termux/boot/startup.sh' -n com.termux/.app.TermuxService" || am start -n com.termux/.app.TermuxActivity
   ```
4. Tap back (←)

## Even Simpler: Just Relaunch

If commands fail, minimal restart (Actions 1-2 only):

1. Wait 2 seconds
2. Launch Termux
3. (Manually run `tmux ls` and start sessions if needed)

## Test the Setup

1. **Force stop Termux:**
   - Settings → Apps → Termux → Force Stop

2. **Wait 5 seconds**

3. **Check if Termux opened**

4. **Open Termux and run:**
   ```bash
   tmux ls
   ```

5. If sessions aren't running, the command didn't execute - use simpler version

## Critical: Disable Battery Optimization

**This is required or Tasker won't work in background!**

1. Settings → Apps → Tasker
2. Battery → **Unrestricted**
3. Or: Battery optimization → Tasker → **Don't optimize**

## Troubleshooting

### Tasker doesn't trigger

- Check profile is enabled (green toggle)
- Check battery optimization is disabled
- Try changing event from "App Closed" to "Logcat Entry"

### Termux opens but sessions don't start

The `am broadcast` command might not have permission. Try:

1. Open Termux manually
2. Run: `bash ~/.termux/boot/startup.sh`
3. This should work, but Tasker automation might not

**Workaround:**
- Just have Tasker relaunch Termux
- You manually run the boot script once Termux opens
- Still better than nothing!

### Alternative Approach: Termux:Widget

If Tasker commands don't work:

1. Install **Termux:Widget** from F-Droid
2. Create script: `~/.shortcuts/restart.sh`
   ```bash
   #!/data/data/com.termux/files/usr/bin/bash
   bash ~/.termux/boot/startup.sh
   ```
3. Make executable: `chmod +x ~/.shortcuts/restart.sh`
4. Add widget to home screen
5. Tap widget after Termux restarts

## What Actually Works

**Most reliable setup:**

1. **Tasker Profile:** Detect when Termux closes
2. **Tasker Task:**
   - Wait 2 seconds
   - Launch Termux
   - (That's it - keep it simple!)
3. **You manually:** Tap widget or run boot script

**This guarantees:**
- Termux reopens automatically ✓
- You know it crashed (Termux is open) ✓
- One-tap to restore sessions ✓
- No permission issues ✓

Much better than manual force-stop and relaunch!
