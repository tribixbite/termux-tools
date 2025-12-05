# Camera OIS Driver Issue - Updated December 5, 2025

## ROOT CAUSE IDENTIFIED

**The camera failure is caused by missing GYROSCOPE sensor, NOT a disabled package.**

The lsm6dsv_0 IMU chip is only registering its Accelerometer - the Gyroscope is not initializing. Without gyroscope data, OIS (Optical Image Stabilization) cannot function, causing the camera to crash.

## Evidence

### 1. Gyroscope Missing from Sensor List
```bash
$ adb shell "dumpsys sensorservice"
Total 24 h/w sensors, 24 running 0 disabled clients:
lsm6dsv_0 Accelerometer Non-wakeup (handle=0x0000000b)  # <-- NO GYROSCOPE!
9-axis fusion disabled (0 clients)  # <-- CONFIRMS MISSING GYRO/MAG
```

**Expected**: lsm6dsv_0 should register BOTH Accelerometer AND Gyroscope
**Actual**: Only Accelerometer is present

### 2. Sensor Enable Errors
```
E Unihal: Failed to enable sensor: ret=-19, sensor=GYROSCOPE
E Unihal: Failed to enable sensor: ret=-19, sensor=ROTATION_VECTOR
E CamX: [Gravity] Sensor probe failed during boot, is probe: 0, conn state: 3
```

Error -19 = ENODEV (No such device)

### 3. SSC_DAEMON Pending Sensors
```
I SSC_DAEMON: printFactoryDebugLog:333, pendingSuidCnt:7
I SSC_DAEMON: printFactoryDebugLog:344, Pending dataType:mag
I SSC_DAEMON: printFactoryDebugLog:344, Pending dataType:mag_cal
I SSC_DAEMON: printFactoryDebugLog:344, Pending dataType:auto_rotation
I SSC_DAEMON: printFactoryDebugLog:344, Pending dataType:pressure
E SSC_DAEMON: sendFactoryCmdToAlgo error algo_id:21
```

Multiple sensors waiting for gyro/mag data that will never arrive.

### 4. Galaxy Sensors App Confirms
The Galaxy Sensors app (it.ale32thebest.galaxysensors) shows:
- ✅ Temperature: 31.7°C
- ✅ Humidity: 31.7%
- ✅ Light: 0.00 lux
- ✅ Pressure: 1,013.1 hPa
- ✅ Altitude: 1.0 m
- ❌ **NO Gyroscope displayed**
- ❌ **NO Magnetometer displayed**

### 5. Stopped Init Services
```
[init.svc.sensor_copy_registry]: [stopped]
[init.svc.vendor-sensor-sh]: [stopped]
```
These services handle sensor initialization but cannot be started without root.

## Why OIS Fails

1. OIS (Optical Image Stabilization) requires real-time gyroscope data
2. Gyroscope sensor is not registering from lsm6dsv_0 chip
3. Camera HAL tries to initialize OIS → FastRPC call succeeds
4. OIS driver requests gyroscope data → No response (sensor doesn't exist)
5. OIS init fails with error 0x4e (user error)
6. Camera HAL crashes with SIGSEGV trying to use NULL OIS handle

## Technical Details

### IMU Chip: lsm6dsv_0 (STMicroelectronics)
- **Should have**: Accelerometer + Gyroscope (6-axis IMU)
- **Registering**: Accelerometer ONLY

### Config Files Exist
```
/vendor/etc/sensors/config/lsm6dsv_0.json
  - Contains .accel config ✓
  - Contains .gyro config ✓
```

The gyro config exists but the driver isn't registering it.

### Magnetometer: AK991x
- Config exists: `pakala_ak991x_0.json`
- Status: Also not registering (SSC_DAEMON shows "Pending dataType:mag")

## Possible Causes

### 1. Hardware Failure
- Gyroscope portion of lsm6dsv_0 chip may be damaged
- Can't rule out without factory diagnostics

### 2. Sensor Registry Corruption
- Output path: `/mnt/vendor/persist/sensors/registry/registry`
- Registry may be corrupted preventing gyro init
- Services that rebuild registry are stopped

### 3. Driver/Firmware Issue
- Gyro driver may have failed during boot
- No kernel dmesg access to verify without root

### 4. Previous Debloating
- If Galaxy Sensors app was used to disable sensors, changes may persist
- However, gyro is a hardware sensor - unlikely to be software-disabled

## Investigation History

| Action | Result |
|--------|--------|
| Enabled Samsung Image Enhancer | Camera still fails |
| Enabled Samsung Face Service | Camera still fails |
| Enabled Galaxy Sensors app | Confirmed gyro missing |
| Checked disabled packages (403) | None camera/sensor related |
| Verified lsm6dsv_0.json config | Gyro config exists |
| Checked sensor init services | Both stopped |

## Potential Fixes (Require Root)

### Option 1: Clear Sensor Registry
```bash
# Would require root
rm -rf /mnt/vendor/persist/sensors/registry/*
reboot
```
Forces sensor subsystem to rebuild registry from config files.

### Option 2: Start Stopped Services
```bash
# Would require root
start sensor_copy_registry
start vendor-sensor-sh
```

### Option 3: Factory Reset Sensors
Samsung service menu `*#0*#` → Sensor test may reinitialize sensors.

## Fixes Without Root

### 1. Samsung Service Menu
- Dial `*#0*#` → Go to Sensor test
- May trigger sensor reinitialization

### 2. Factory Reset (Last Resort)
- Full factory reset may restore sensor registry
- **Warning**: Data loss

### 3. Samsung Service Center
- If gyroscope hardware is damaged, requires repair
- Samsung Members app → Support → Service request

## Device Information

- **Model**: Samsung Galaxy S23 FE (SM-S938U1)
- **Chipset**: Qualcomm Snapdragon 8 Gen 1 (soc_id: 618)
- **Android**: 15
- **Kernel**: 6.6.77-android15-8-31998796-abogkiS938USQS6BYIF-4k
- **IMU**: STMicro lsm6dsv_0 (6-axis)
- **Magnetometer**: AKM AK991x (not working)
- **OIS**: Present (requires gyro)

## Summary

**This is NOT a disabled package issue.** The gyroscope sensor hardware/driver is not registering with the Android sensor service. Without gyroscope data, OIS cannot function and the camera crashes.

**Recommended**: Try Samsung service menu `*#0*#` sensor test first. If that doesn't work, the gyroscope may be physically damaged or require a factory reset to reinitialize the sensor registry.

---

**Report Updated**: 2025-12-05 01:20 UTC
**Investigation Tool**: Claude Code with ADB
**Device**: Samsung Galaxy S23 FE (SM-S938U1)
