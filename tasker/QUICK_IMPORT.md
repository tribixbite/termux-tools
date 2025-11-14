# Quick Tasker Import Guide

Fast setup to auto-restart Termux on crashes.

## 1. Copy Files to Downloads

```bash
cp ~/git/termux-tools/tasker/*.xml ~/storage/downloads/
```

## 2. Install Tasker

- Get from Play Store: https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm
- Price: ~$3.49 (one-time purchase)

## 3. Import in Tasker

### Import Profile
1. Open Tasker
2. Tap **PROFILES** tab (bottom)
3. **Long press** anywhere on the screen → **Import**
4. Navigate to Downloads folder
5. Select **`Termux_Monitor.prf.xml`**
6. Tap to enable (should turn green)

### Import Task
1. Tap **TASKS** tab (bottom)
2. **Long press** anywhere → **Import**
3. Select **`Termux_Restart.tsk.xml`**

## 4. Disable Battery Optimization

**Critical step!**

1. Settings → Apps → Tasker
2. Battery → **Unrestricted**
3. Or: Battery optimization → Don't optimize

## 5. Test

1. Force stop Termux:
   - Settings → Apps → Termux → Force Stop

2. Wait 5 seconds

3. Termux should automatically:
   - Reopen
   - Run boot script
   - Restore all tmux sessions

4. Verify: `tmux ls`

## Troubleshooting

**Nothing happens:**
- Did you disable battery optimization?
- Is the profile enabled (green)?
- Check Tasker → Menu → More → Run Log

**Termux opens but sessions don't start:**
- Test manually: `source ~/.bash_aliases && bash ~/.termux/boot/startup.sh`
- Check intent action is: `com.termux.RUN_COMMAND`

## Optional: Wireless Debugging

Requires **AutoInput** plugin:
- https://play.google.com/store/apps/details?id=com.joaomgcd.autoinput
- Import `Wireless_Debugging_KeepAlive.tsk.xml`
- Grant AutoInput accessibility permission

## What You Get

✅ Termux auto-restarts on crash
✅ All tmux sessions restored
✅ No manual intervention needed
✅ Works even with frequent crashes

See **TASKER_SETUP.md** for detailed documentation.
