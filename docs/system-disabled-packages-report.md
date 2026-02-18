# System Disabled/Stopped Packages Report - November 26, 2025

## Summary

After enabling Face Service and Image Enhancer for camera troubleshooting, analyzed the system for other stopped or frozen processes/packages.

## Statistics

- **Total Disabled Packages**: 403 (down from 406 after enabling 3 packages)
- **Stopped Packages**: 232 packages have `stopped=true` flag
- **Samsung Disabled Packages**: 14

## Process Status

All Samsung system processes checked are in **normal "S" (sleeping) state** - no frozen or zombie processes detected.

Sample Samsung processes running normally:
- `vendor.samsung.hardware.camera.provider-service_64` (PID 10099) - **Crashes due to OIS**
- `com.samsung.faceservice` (PID 751) - Running after enablement
- `vendor.samsung.hardware.biometrics.face-service` (PID 1911) - Running
- `com.samsung.android.wifi.ai` (PID 11109) - Running
- `com.samsung.android.service.aircommand` (PID 8768) - Running

## Disabled Samsung Packages

### Non-Camera-Related (14 packages)

1. **com.android.samsung.utilityapp** - Samsung Utilities
2. **com.samsung.android.app.reminder** - Samsung Reminders
3. **com.samsung.android.app.spage** - Samsung Free (News feed)
4. **com.samsung.android.galaxycontinuity** - Galaxy Continuity features
5. **com.samsung.android.goodlock** - Good Lock customization
6. **com.samsung.android.honeyboard** - Samsung Keyboard
7. **com.samsung.android.knox.zt.framework** - Knox Zero Trust framework
8. **com.samsung.android.scryptowallet** - Samsung Blockchain Wallet
9. **com.samsung.android.shealthmonitor** - Samsung Health Monitor
10. **com.samsung.android.stickercenter** - Sticker Center
11. **com.samsung.android.tvplus** - Samsung TV Plus
12. **com.samsung.android.waterplugin** - Water resistance notification
13. **com.samsung.familyhub** - Family Hub features
14. **com.weather.samsung** - Samsung Weather

### Analysis

**None of the disabled Samsung packages appear to be camera-related or system-critical.**

All disabled packages are feature apps that can be safely disabled:
- Social/entertainment features (TV Plus, Stickers)
- Productivity apps (Reminders, Keyboard alternative)
- Samsung ecosystem features (Continuity, Family Hub)
- Enterprise/security (Knox ZT)
- Financial (Blockchain Wallet)

## Camera-Related Packages Status

✅ **Enabled** (Previously Disabled, Now Fixed):
- `com.samsung.android.imageenhancer` - Image Enhancer (enabled manually)
- `com.samsung.faceservice` - Face Service (enabled via ADB)

✅ **Always Enabled** (Never Disabled):
- `com.samsung.android.bixbyvision.framework` - Bixby Vision
- `com.samsung.android.aicore` - AI Core
- `com.samsung.android.vision.model` - Vision Model
- `com.samsung.android.visionintelligence` - Vision Intelligence
- `com.samsung.android.camerasdkservice` - Camera SDK Service
- `com.samsung.android.cameraxservice` - CameraX Service

## System Services Status

### Normal HAL Service Errors

Many HAL services show "FAILED_TRANSACTION" or "Can't find service" in dumpsys output. This is **NORMAL** and indicates:
- Services are busy/protected
- Insufficient permissions for dumpsys
- Services not relevant to current hardware configuration

### Notable Service Status

**Face Detection**:
- ✅ `android.hardware.biometrics.face.IFace/default` - Present (shows FAILED_TRANSACTION on dump, normal)
- ✅ `vendor.samsung.hardware.biometrics.face-service` - Running (PID 1911)

**Camera**:
- ⚠️ `vendor.samsung.hardware.camera.provider-service_64` - Running but **crashes on OIS init**

**Sensors**:
- ✅ All sensor hardware functioning (24 sensors active)
- ❌ No magnetometer hardware (expected for this device)

## "Stopped" Flag Analysis

232 packages have the `stopped=true` flag. This is **NORMAL Android behavior**:

**What "stopped" means**:
- Package has not been launched since boot
- Android sets this flag automatically
- Does NOT mean frozen, disabled, or malfunctioning
- Flag clears when app/service is launched

**This is different from "disabled"**:
- Disabled = User/system explicitly disabled (403 packages)
- Stopped = Just hasn't run yet since boot (232 packages)

## Conclusion

### Camera Issue Root Cause

The camera failure is **NOT** caused by disabled/stopped system packages. All relevant Samsung camera packages are enabled and running.

**Actual Issue**: OIS (Optical Image Stabilization) driver hardware/firmware failure
- FastRPC error 0x4e communicating with OIS actuator
- Camera HAL crashes with SIGSEGV
- See `camera-ois-issue.md` for full technical analysis

### System Health

**Overall system state: HEALTHY**

- All critical Samsung system services running normally
- No frozen or zombie processes detected
- Disabled packages are non-essential feature apps
- HAL service errors in dumpsys are normal

**No additional packages need to be enabled** to fix the camera. The OIS issue requires:
- Hardware diagnosis
- Calibration data recovery
- Or service center repair

## Device Information

- **Model**: Samsung Galaxy S23 FE (SM-S938U1)
- **Android**: Version 15
- **Total Packages**: ~800 installed
- **Disabled**: 403 (50%)
- **Stopped**: 232 (29%)

## Commands Used

```bash
# Count disabled packages
adb shell "pm list packages -d | wc -l"

# List disabled Samsung packages
adb shell "pm list packages -d" | grep samsung

# Count stopped packages
adb shell "dumpsys package | grep -E 'stopped=true' | wc -l"

# Check process states
adb shell "ps -A | grep samsung"

# Check service status
adb shell "dumpsys activity services | grep samsung"

# Check for service errors
adb shell "dumpsys | grep -E 'Can.t find service|Service .* not found'"
```

---

**Report Generated**: 2025-11-26 14:30 UTC
**Device**: Samsung Galaxy S23 FE (SM-S938U1)
**Analysis**: System health check after camera troubleshooting
