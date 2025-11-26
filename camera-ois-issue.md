# Camera OIS Driver Issue - November 26, 2025

## Summary

After enabling Samsung Face Service via ADB, the camera **still fails** due to persistent OIS (Optical Image Stabilization) driver communication errors.

## What Was Fixed

✅ **Samsung Image Enhancer** - Enabled (was disabled)
✅ **Samsung Face Service** - Enabled via ADB command:
```bash
adb shell "pm install-existing --user 0 com.samsung.faceservice"
```

Both packages are now `enabled=1` and their processes are running.

## Remaining Issue

### OIS Driver FastRPC Failure

**Error**:
```
E vendor.samsung.hardware.camera.provider-service_64:
  Error 0x4e: remote_handle64_invoke failed for handle 0xb4000079160736d0,
  interface libois_channel_skel.so method 2 on domain 4
  (sc 0x2020000) (errno Success) (user err 0x4e)

E CamX: [ERROR][NCS] OIS Channel[0] Fail to send init message
E CamX: [ERROR][SENSOR] OIS submodule creation failed
```

### Camera HAL Crash

**Fatal Error**:
```
F libc: Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0
F DEBUG: #00 pc 0000000000653d94 /vendor/lib64/hw/camera.qcom.so
        (CamX::LPAIOIS::IsOISDriverOutputSync()+84)
```

**Crash Location**: `/data/tombstones/tombstone_05`

**Backtrace**:
```
#00 CamX::LPAIOIS::IsOISDriverOutputSync()+84
#01 CamX::LPAIOIS::AcquireResources()+76
#02 CamX::SensorNode::AcquireResources()+212
#03 CamX::Pipeline::CallNodeAcquireResources()+372
#04 CamX::Pipeline::StreamOn()+2692
```

## Technical Analysis

### What's Happening

1. **OIS PD Handle Opens Successfully** (handle 0x100)
2. **DSP Library Loads** (`/vendor/dsp/adsp/libois_channel_skel.so`)
3. **FastRPC Invoke to Method 2 FAILS** with user error 0x4e
4. **OIS Channel Init Fails** - cannot send init message to OIS actuator
5. **Camera HAL Crashes** - NULL pointer dereference when checking OIS sync status

### Error Code 0x4e Analysis

FastRPC error `0x4e` (decimal 78) typically indicates:
- Communication failure with DSP (Digital Signal Processor)
- OIS actuator not responding
- Missing firmware/calibration data
- Hardware failure

### Why Reboot Didn't Help

After reboot:
- Face Service processes are running (PIDs 751, 1911)
- FastRPC call progresses further (errno Success instead of Operation not permitted)
- But OIS driver still fails with user err 0x4e
- Camera HAL still crashes attempting to use NULL OIS handle

## Possible Root Causes

### 1. Hardware Failure
OIS actuator hardware may be physically damaged or disconnected. The FastRPC communication to the DSP succeeds, but the DSP cannot communicate with the physical OIS motor.

### 2. Missing Calibration Data
OIS calibration data may have been wiped or corrupted. This data is typically stored in:
- `/mnt/vendor/persist/camera/`
- `/data/vendor/camera/`
- Device-specific EFS partition

### 3. Firmware Issue
OIS firmware on the DSP may be missing or incompatible after system updates.

### 4. Additional Disabled Package
There may be another Samsung package that provides OIS-specific functionality that is still disabled.

## Device Information

- **Model**: Samsung Galaxy S23 FE (SM-S938U1)
- **Chipset**: Qualcomm Snapdragon (pa3q)
- **Android**: Version 15
- **OIS Hardware**: Yes (confirmed in camera characteristics)

## Disabled Samsung Packages Remaining

403 total disabled packages (down from 406 after enabling Image Enhancer and Face Service).

**Not camera-related**:
- com.samsung.android.app.spage
- com.samsung.android.waterplugin
- com.android.samsung.utilityapp
- com.samsung.android.scryptowallet
- com.samsung.android.tvplus
- com.samsung.android.goodlock
- com.samsung.android.honeyboard
- com.samsung.android.shealthmonitor
- com.weather.samsung
- com.samsung.android.app.reminder
- com.samsung.android.knox.zt.framework
- com.samsung.android.stickercenter
- com.samsung.familyhub
- com.samsung.android.galaxycontinuity

## Investigation Actions Taken

1. ✅ Enabled Samsung Image Enhancer
2. ✅ Enabled Samsung Face Service via ADB
3. ✅ Rebooted device
4. ✅ Verified Face Service processes running
5. ✅ Analyzed tombstone crash logs
6. ✅ Checked SELinux denials (none found)
7. ✅ Verified Bixby Vision enabled
8. ✅ Checked sensor services (all working)
9. ✅ Verified no magnetometer hardware present (expected)

## Recommended Next Steps

### 1. Check Camera Calibration Data
```bash
adb shell "ls -la /mnt/vendor/persist/camera/"
adb shell "ls -la /data/vendor/camera/"
```

### 2. Test Without OIS
Try launching a third-party camera app that doesn't require OIS, or check if Samsung Camera has a setting to disable OIS.

### 3. Check for OIS-Specific Packages
Search for any remaining disabled packages related to actuators, motors, or calibration.

### 4. Factory Camera Test
```bash
adb shell "am start -n com.sec.factory.camera/.Camera"
```
Samsung's factory camera app may bypass OIS requirements.

### 5. Hardware Diagnosis
If all software fixes fail, this may indicate hardware failure requiring:
- Camera module replacement
- Service center diagnosis
- Warranty claim

## Comparison with Previous Fix

**Previous Incident**: Bixby Vision Framework disabled → Enable → Camera works

**Current Incident**:
- Bixby Vision: Already enabled ✓
- Image Enhancer: Was disabled → Enabled → Camera still fails
- Face Service: Was disabled → Enabled → Camera still fails with OIS crash

**Pattern Break**: This incident does NOT follow the pattern of "enable disabled Samsung package → camera works". The OIS hardware/driver failure suggests a deeper issue than just disabled packages.

## Conclusion

While Face Service was successfully enabled via ADB, the camera remains non-functional due to OIS driver communication failure. This appears to be either:
1. Hardware failure (OIS actuator)
2. Missing/corrupt calibration data
3. Firmware issue
4. An unidentified disabled package providing OIS-specific functionality

**Status**: Camera issue NOT resolved. Further investigation or hardware diagnosis required.

---

**Report Generated**: 2025-11-26 09:25 UTC
**ADB Fix Provided By**: Gemini 2.5 Pro AI model
**Device**: Samsung Galaxy S23 FE (SM-S938U1)
