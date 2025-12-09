# Camera OIS Driver Issue - RESOLVED December 6, 2025

## ISSUE RESOLVED ✓

**Root cause: Disabled Samsung sensor packages prevented gyroscope initialization.**

The following packages were disabled (during previous debloating) and needed to be re-enabled:

```bash
# CRITICAL - These were the key packages causing the issue:
pm enable com.samsung.android.ssco          # Samsung Sensor Core Operations
pm enable com.samsung.android.mocca         # Mocca Core Sensor
pm enable com.samsung.android.camerasdkservice  # Camera SDK Service

# Additional packages enabled for full functionality:
pm enable com.samsung.android.dsms
pm enable com.samsung.oda.service
pm enable com.samsung.android.motionphoto.app
pm enable com.samsung.sree
pm enable com.samsung.android.mcfds
pm enable com.samsung.android.dbsc
```

**After enabling + reboot:**
- Sensors: 24 → 40 (gyroscope now registered)
- Camera: Working with OIS functional
- Gyroscope: `lsm6dsv_0 Gyroscope Non-wakeup` now appears in sensorservice

---

## Original Problem Description

The camera was crashing due to missing gyroscope sensor data required for OIS (Optical Image Stabilization).

### Symptoms
- Camera app crashed immediately on launch
- `dumpsys sensorservice` showed only 24 sensors (no gyroscope)
- OIS errors: `FastRPC error 0x4e`
- SSC_DAEMON: `sendFactoryCmdToAlgo error algo_id:21`

### Root Cause Analysis

The gyroscope was detected in SSC_DAEMON's `_suid_map` but failed to initialize because `com.samsung.android.ssco` (Samsung Sensor Core Operations) was disabled.

Key evidence:
```
I SSC_DAEMON: printFactoryDebugLog:348, _suid_map dataType:gyro  # Gyro detected
E SSC_DAEMON: sendFactoryCmdToAlgo error algo_id:21              # But init fails
```

The sensor init services remained stopped even after reboot:
```
[init.svc.sensor_copy_registry]: [stopped]
[init.svc.vendor-sensor-sh]: [stopped]
```

### Why Previous Fixes Failed

1. **Rebooting alone didn't work** - The disabled packages prevented sensor initialization on every boot
2. **Cannot start init services without root** - `start sensor_copy_registry` requires root
3. **Sensor HAL restart requires root** - Cannot kill/restart the sensor HAL process
4. **Service menu `*#0*#`** - Couldn't help because the sensor framework was broken

### The Fix

Simply re-enabling `com.samsung.android.ssco` and `com.samsung.android.mocca` allowed the sensor subsystem to properly initialize on reboot.

## Device Information

- **Model**: Samsung Galaxy S23 FE (SM-S938U1)
- **Chipset**: Qualcomm Snapdragon 8 Gen 1 (soc_id: 618)
- **Android**: 15
- **IMU**: STMicro lsm6dsv_0 (6-axis)
- **OIS**: Present (requires gyro)

## Lesson Learned

**DO NOT disable these Samsung packages when debloating:**
- `com.samsung.android.ssco` - Required for sensor operations
- `com.samsung.android.mocca` - Required for sensor algorithms
- `com.samsung.android.camerasdkservice` - Required for camera functions

---

## Recurring Issue - December 9, 2025

### Scenario: Packages Enabled But Gyro Missing

On December 9, 2025, the gyroscope was again missing despite packages being enabled:

**State Check:**
```bash
# All packages show enabled=1
dumpsys package com.samsung.android.ssco | grep "User 0:"
# stopped=true, enabled=1  ← Enabled but stopped

dumpsys package com.samsung.android.mocca | grep "User 0:"
# stopped=false, enabled=1 ← Running

dumpsys sensorservice | grep Total
# Total 24 h/w sensors ← Missing gyro (should be 40)
```

**Key Finding: Kernel sees gyro, HAL doesn't initialize it**
```bash
ls /sys/class/sensors/
# gyro_sensor exists! ← Kernel/driver layer works

# But SSC_DAEMON algo_id:21 (gyroscope algorithm) failed to load at boot
```

### Why Reboot is Required (Without Root)

The gyroscope algorithm initialization happens at boot time. Without root access, these cannot be done:

1. **Cannot restart sensor HAL**: `android.hardware.sensors-service.multihal` (PID 1892)
2. **Cannot restart SSC daemon**: `factory.ssc` (PID 1994)
3. **Cannot write to sysfs**: `/sys/class/sensors/gyro_sensor/` requires root
4. **Cannot re-run init services**: `vendor-sensor-sh` is oneshot
5. **Cannot send BOOT_COMPLETED**: Requires system permission

### Distinction from Previous Issue

| Scenario | Package State | Fix Required |
|----------|---------------|--------------|
| **Dec 6** | DISABLED (enabled=0/4) | Enable packages + reboot |
| **Dec 9** | ENABLED but stopped (enabled=1, stopped=true) | Reboot only |

### Resolution

**A reboot is required** when:
- Packages are enabled (`enabled=1`)
- But gyroscope is missing from sensorservice
- And kernel shows `/sys/class/sensors/gyro_sensor/` exists

The algo_id:21 (gyroscope algorithm) needs to reinitialize at boot time. No userspace workaround exists without root.

### Quick Diagnostic Commands

```bash
# Check sensor count (should be ~40, not 24)
adb shell "dumpsys sensorservice | grep Total"

# Check if gyro sysfs exists (kernel level)
adb shell "ls /sys/class/sensors/ | grep gyro"

# Check package states
adb shell "dumpsys package com.samsung.android.ssco | grep 'stopped=\|enabled='"
adb shell "dumpsys package com.samsung.android.mocca | grep 'stopped=\|enabled='"

# If gyro_sensor exists in sysfs but not in sensorservice → reboot needed
```

---

**Report Updated**: 2025-12-09 00:35 UTC
**Investigation Tool**: Claude Code with ADB
**Status**: REQUIRES REBOOT for current instance
