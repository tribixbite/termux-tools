# ADB Process Protection -- Android OOM Survival

Keep Termux and Edge Canary alive on Android by disabling the phantom process killer, exempting from Doze, pinning standby buckets, adjusting OOM scores, and managing wake locks. These protections are applied on boot by operad's `applyPhantomFix()` and can be verified/applied manually via ADB.

## The Full Protection Stack

All 6 protections must be applied together. Missing any one can result in Android killing Termux processes.

### 1. Phantom Process Killer -- Disable

Android 12+ kills background processes exceeding a 32-process limit. Set to MAX_INT to effectively disable.

```bash
adb shell device_config put activity_manager max_phantom_processes 2147483647

# Alternative: disable the monitoring entirely (persists across reboots)
adb shell settings put global settings_enable_monitor_phantom_procs false
```

**Verify:**
```bash
adb shell device_config get activity_manager max_phantom_processes
# Expected: 2147483647

adb shell settings get global settings_enable_monitor_phantom_procs
# Expected: null (not set) or "false"
```

### 2. Doze Whitelist

Exempt from Android's battery optimization (Doze mode). Without this, Android defers network, alarms, and jobs when the screen is off.

```bash
adb shell dumpsys deviceidle whitelist +com.termux
adb shell dumpsys deviceidle whitelist +com.microsoft.emmx.canary
```

**Verify:**
```bash
adb shell dumpsys deviceidle whitelist | grep -E 'termux|emmx'
# Expected: both packages listed
```

### 3. Active Standby Bucket

Pin the app to the ACTIVE bucket. Android assigns apps to standby buckets (ACTIVE, WORKING_SET, FREQUENT, RARE, RESTRICTED) based on usage. Lower buckets get fewer resources.

```bash
adb shell am set-standby-bucket com.termux ACTIVE
adb shell am set-standby-bucket com.microsoft.emmx.canary ACTIVE
```

**Verify:**
```bash
adb shell am get-standby-bucket com.termux
# Expected: 10 (ACTIVE)
```

### 4. Background Run Permission

Allow unrestricted background execution. Without this, Android throttles background work.

```bash
adb shell cmd appops set com.termux RUN_ANY_IN_BACKGROUND allow
adb shell cmd appops set com.microsoft.emmx.canary RUN_ANY_IN_BACKGROUND allow
```

**Verify:**
```bash
adb shell cmd appops get com.termux RUN_ANY_IN_BACKGROUND
# Expected: allow
```

### 5. OOM Score Adjustment

Set a low OOM score so the Linux kernel's OOM killer targets other processes first. `-900` is close to the minimum (`-1000` is reserved for critical system processes).

```bash
adb shell "echo -900 > /proc/$(pidof -s com.termux)/oom_score_adj"
```

**Verify:**
```bash
adb shell cat /proc/$(pidof -s com.termux)/oom_score_adj
# Expected: -900
```

**Note:** This does not persist across app restarts. Reapply after Termux is force-stopped or restarted. The operad daemon reapplies this on every boot.

### 6. Set-Inactive False

Prevent Android from marking the app as inactive (which reduces its priority).

```bash
adb shell am set-inactive com.termux false
adb shell am set-inactive com.microsoft.emmx.canary false
```

**Verify:**
```bash
adb shell am get-inactive com.termux
# Expected: Idle=false
```

## All-in-One Application

```bash
# Apply all protections for both Termux and Edge Canary
PKG_LIST="com.termux com.microsoft.emmx.canary"
adb shell device_config put activity_manager max_phantom_processes 2147483647
adb shell settings put global settings_enable_monitor_phantom_procs false
for pkg in $PKG_LIST; do
  adb shell dumpsys deviceidle whitelist +$pkg
  adb shell am set-standby-bucket $pkg ACTIVE
  adb shell cmd appops set $pkg RUN_ANY_IN_BACKGROUND allow
  adb shell am set-inactive $pkg false
done
# OOM adj (Termux only -- needs PID)
TPID=$(adb shell pidof -s com.termux)
[ -n "$TPID" ] && adb shell "echo -900 > /proc/$TPID/oom_score_adj"
```

## Wake Lock Lifecycle

**Acquire-only. NEVER release.**

```bash
# Acquire (run from Termux)
termux-wake-lock
```

`termux-wake-unlock` causes Android to kill background processes during the gap between unlock and re-lock. The OS-level wake lock persists even after SIGKILL -- this is desired behavior. The old startup script's `termux-wake-unlock` line was commented out for this reason.

Previous approaches that released the wake lock on shutdown (`clearStale()`, `release()`, `forceRelease()`) were all removed from the codebase.

## Target Packages

Both packages need protection:

| Package | Why |
|---|---|
| `com.termux` | Hosts the terminal, tmux, daemon, Claude Code sessions |
| `com.microsoft.emmx.canary` | Edge Canary with CFC bridge extension -- must stay alive for browser automation |

## When Protections Are Applied

1. **Boot:** operad `applyPhantomFix()` applies all 6 protections during `tmx boot`
2. **Config:** `adb.boot_delay_s` (default 15s) delays ADB commands on boot to wait for wireless debugging initialization
3. **Re-apply:** OOM score resets on app restart; other protections generally persist until reboot

## Process Group Killing

When killing Termux API wrapper processes, always kill the process **group**, not just the wrapper PID.

```bash
# WRONG -- orphans the actual termux-api child process
kill $PID

# CORRECT -- kills the wrapper AND its forked termux-api child
kill -STOP -$PID    # signal the process group (note the minus sign)
```

**Why:** `termux-notification`, `termux-battery-status`, `termux-toast`, etc. are bash scripts that fork `/usr/libexec/termux-api <Command>`. Killing only the bash wrapper PID leaves the real `termux-api` process orphaned (PPID becomes 1/init). The orphaned process holds resources indefinitely.

In TypeScript (operad session.ts):
```typescript
// Use detached: true + kill process group
const child = spawn(cmd, args, { detached: true });
// Later, to kill:
process.kill(-child.pid!, "SIGKILL");  // negative PID = process group
```

### spawnSync Timeout Caveat

`spawnSync` with `timeout` sends SIGTERM to the wrapper, but the forked `termux-api` child survives. Either:
- Call `/usr/libexec/termux-api` directly (bypass the bash wrapper)
- Use `killSignal: "SIGKILL"` in spawnSync options
- Use a `killedByTimeout` flag -- the child "exit" event fires AFTER SIGKILL (from process reaping), which can undo timeout handler state changes

## ADB Multi-Device Handling

When multiple devices are listed (including offline/unauthorized ones), bare `adb shell` fails with "more than one device/emulator".

### resolveAdbSerial() Pattern

The operad daemon auto-detects the correct device:

1. Run `adb devices` to list all devices
2. Filter for online devices (skip `offline`, `unauthorized`)
3. Prefer `127.0.0.1`, `localhost`, or own-IP serials (local device) over external phones
4. Cache the resolved serial with 30-second TTL
5. Pass `-s <serial>` to all subsequent ADB commands

```bash
# Manual multi-device usage
SERIAL=$(adb devices | grep -v offline | grep -v 'List of' | head -1 | cut -f1)
adb -s "$SERIAL" shell ...
```

### isLocalAdbDevice() Validation

Before applying phantom fix protections, verify the target device is the local device (not an externally connected phone). Protections should only be applied to the device running Termux.

## ADB Auto-Reconnect

Wireless debugging ports change on every reconnect cycle. The daemon handles this with:

- `resolveAdbSerial()` with 30s TTL cache -- stale serials are automatically refreshed
- Cron job reconnects ADB every 5 minutes (`pwrup` alias scans common port ranges)
- When serial lookup fails, daemon falls back to scanning `adb devices` fresh

```bash
# Manual reconnect
adb devices                          # List current connections
adb connect 127.0.0.1:XXXXX         # Connect to new port
pwrup                                # Scan and connect all ADB ports (alias)
```

## Common Failure Modes

### Silent SIGKILL Deaths

Daemon gets SIGKILL'd by Android with no log entry, no signal handler fires. Pattern: survives overnight with wake lock, dies every 20min-5hrs during active phone use. 14 of 24 observed daemon starts had NO preceding shutdown log.

**Mitigation stack:**
1. Wake lock (acquire, never release)
2. Watchdog script (`watchdog.sh`) -- bash loop that detects daemon death and restarts
3. All 6 ADB protections applied
4. Crash-safe trace log (`appendFileSync`, no open FD) -- last line shows what daemon was doing before death

### Phantom Process Killer Resets

`device_config` values can be reset by system updates or Google Play Services config pushes. The `settings put global` approach is more persistent but some OEMs ignore it.

**Check after system updates:**
```bash
adb shell device_config get activity_manager max_phantom_processes
```

### OOM Score Resets on App Restart

The `/proc/PID/oom_score_adj` value is tied to the process. When Termux restarts (or is force-stopped and relaunched), the PID changes and the OOM score resets to default. operad reapplies on every boot.

### Doze Re-engagement

Some OEMs have aggressive battery optimization that overrides the standard Doze whitelist. Check manufacturer-specific settings:

```bash
# Samsung
adb shell cmd appops set com.termux AUTO_REVOKE_PERMISSIONS_IF_UNUSED ignore

# Xiaomi
adb shell cmd appops set com.termux MIUI_LOCK allow
```

## Verification Script

Run after boot or after applying protections to confirm everything is active:

```bash
echo "=== Process Protection Status ==="
echo ""

echo "Phantom killer:"
adb shell device_config get activity_manager max_phantom_processes
adb shell settings get global settings_enable_monitor_phantom_procs

echo ""
echo "Doze whitelist:"
adb shell dumpsys deviceidle whitelist | grep -E 'termux|emmx'

echo ""
echo "Standby buckets:"
for pkg in com.termux com.microsoft.emmx.canary; do
  echo "  $pkg: $(adb shell am get-standby-bucket $pkg)"
done

echo ""
echo "Background run:"
for pkg in com.termux com.microsoft.emmx.canary; do
  echo "  $pkg: $(adb shell cmd appops get $pkg RUN_ANY_IN_BACKGROUND)"
done

echo ""
echo "OOM score (Termux):"
TPID=$(adb shell pidof -s com.termux)
[ -n "$TPID" ] && adb shell cat /proc/$TPID/oom_score_adj || echo "  Termux not running"

echo ""
echo "Inactive status:"
for pkg in com.termux com.microsoft.emmx.canary; do
  echo "  $pkg: $(adb shell am get-inactive $pkg)"
done

echo ""
echo "Wake lock:"
adb shell dumpsys power | grep -i "wake lock" | head -5
```
