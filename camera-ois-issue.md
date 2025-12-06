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

**Report Updated**: 2025-12-06 07:15 UTC
**Investigation Tool**: Claude Code with ADB
**Status**: RESOLVED
