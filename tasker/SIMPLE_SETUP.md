# Simple Tasker Setup (Works Every Time)

Forget complex XML imports - here's what actually works reliably.

## Goal

When Termux crashes → Tasker reopens it automatically

You can then:
- Tap a widget to restore sessions, or
- Run one command to restore everything

## Setup (5 minutes)

### Part 1: Tasker Auto-Relaunch

1. **Open Tasker**

2. **Create Profile:**
   - Tap **+** button
   - Select **Event** → **App** → **App Closed**
   - Package: `com.termux` (type it in)
   - Tap back (←)

3. **Create Task:**
   - Tap **+ New Task**
   - Name: `Relaunch Termux`
   - Tap ✓

4. **Add Actions:**

   **Action 1:**
   - Tap **+**
   - **Task** → **Wait**
   - Seconds: `2`
   - Tap back (←)

   **Action 2:**
   - Tap **+**
   - **App** → **Launch App**
   - Application: Scroll to **Termux**
   - Tap back (←)

   **Action 3:**
   - Tap **+**
   - **Alert** → **Flash**
   - Text: `Termux Restarted`
   - Tap back (←)

5. **Save:**
   - Tap back (←) twice
   - Profile should be enabled (green)

6. **Disable Battery Optimization:**
   - Settings → Apps → Tasker → Battery → **Unrestricted**

### Part 2: One-Tap Session Restore

**Option A: Termux:Widget (Recommended)**

1. Install **Termux:Widget** from F-Droid
2. In Termux, run:
   ```bash
   mkdir -p ~/.shortcuts
   cat > ~/.shortcuts/restore.sh << 'EOF'
   #!/data/data/com.termux/files/usr/bin/bash
   source ~/.bash_aliases && bash ~/.termux/boot/startup.sh
   EOF
   chmod +x ~/.shortcuts/restore.sh
   ```
3. Long-press home screen → Widgets → Termux:Widget
4. Place widget on home screen
5. Widget shows: **restore.sh**

**Option B: Manual Command**

After Termux reopens, just run:
```bash
bash ~/.termux/boot/startup.sh
```

## How It Works

```
Termux crashes (out of RAM)
         ↓
Tasker detects it closed
         ↓
Wait 2 seconds
         ↓
Relaunch Termux (shows "Termux Restarted")
         ↓
You: Tap widget OR run command
         ↓
All sessions restored!
```

## Test It

1. **Force stop Termux:**
   ```
   Settings → Apps → Termux → Force Stop
   ```

2. **Wait 5 seconds**

3. **Termux should open automatically** with flash message "Termux Restarted"

4. **Restore sessions:**
   - Tap the widget, OR
   - Run: `bash ~/.termux/boot/startup.sh`

5. **Verify:**
   ```bash
   tmux ls
   # Should show: cleverkeys, customcamera, etc.
   ```

## Why This Is Better

### What Doesn't Work Reliably:
- ❌ Complex XML imports (syntax changes)
- ❌ Tasker sending commands to Termux (permission issues)
- ❌ Automated script execution (security restrictions)

### What Works Every Time:
- ✅ Tasker detects app closed (simple event)
- ✅ Tasker relaunches Termux (no permissions needed)
- ✅ Widget runs script (Termux permission, works perfectly)
- ✅ Or manual command (always works)

## Result

**Before:** Termux crashes → You notice 10 minutes later → Manually restart → Manually restore sessions → 5 minutes lost

**After:** Termux crashes → Reopens in 2 seconds → Flash notification alerts you → Tap widget → Back to work in 3 seconds

**That's a huge win!** 🎉

## Optional Enhancements

### Add to Widget: Status Check

```bash
cat > ~/.shortcuts/status.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
echo "=== Tmux Sessions ==="
tmux ls 2>/dev/null || echo "No sessions running"
echo ""
echo "=== ADB Connection ==="
adb devices | grep device || echo "Not connected"
EOF
chmod +x ~/.shortcuts/status.sh
```

Now you have two widgets:
- **restore.sh** - Restore all sessions
- **status.sh** - Check what's running

### Make Restore Faster

Add to `~/.bashrc`:
```bash
alias recover='bash ~/.termux/boot/startup.sh'
```

Then after crash, just type: `recover`

## Troubleshooting

**Tasker doesn't relaunch Termux:**
- Check battery optimization is disabled
- Check profile is enabled (green toggle)
- Test by force stopping Termux

**Widget doesn't show:**
- Run: `ls -la ~/.shortcuts/`
- Should show `restore.sh` as executable
- Reinstall Termux:Widget if needed

**Sessions don't restore:**
- Test manually: `bash ~/.termux/boot/startup.sh`
- Check: `cat ~/.termux/boot.log | tail`
- Verify repos.conf has projects enabled

## Summary

You now have:
1. ✅ Automatic Termux relaunch on crash (Tasker)
2. ✅ One-tap session restore (Widget)
3. ✅ Simple, reliable, no permission issues
4. ✅ Works even when RAM is low

**This is the practical, working solution!**
