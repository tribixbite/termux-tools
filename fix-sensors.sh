#!/bin/bash
# Fix disabled Samsung packages after phantom killer / debloating
# Camera/gyro/sensor issues may require enabling these packages
#
# ROOT CAUSE: Gyroscope algo_id:21 fails in SSC_DAEMON at boot
# EVIDENCE:
#   - /sys/devices/virtual/sensors/gyro_sensor/ exists but is EMPTY (no name/vendor/calibration)
#   - /sys/devices/virtual/sensors/accelerometer_sensor/ has all attributes (same lsm6dsv_0 chip!)
#   - sensorservice shows 24 sensors but no gyro
#   - Error -19 (ENODEV) when trying to enable gyroscope
# CONCLUSION: Gyro init fails at SLPI/SSC level - cannot restart without ROOT or REBOOT
# Package enabling prepares for next reboot
#
# IMPORTANT: com.samsung.android.ssco MUST be enabled for camera to work!
# This was the root cause of camera failures - SSCO was disabled (enabled=0)
#
# ONE-LINER (copy-paste if camera fails after debloating):
# adb shell "for p in com.samsung.android.ssco com.samsung.android.mocca com.samsung.sree com.samsung.android.visionintelligence com.samsung.android.aicore com.samsung.android.cameraxservice com.samsung.android.camerasdkservice com.samsung.android.app.cameraassistant com.samsung.android.bixbyvision.framework com.sec.android.app.hwmoduletest com.sem.factoryapp com.sec.android.diagmonagent; do pm enable \$p 2>/dev/null; done"

PACKAGES="
com.samsung.android.ssco
com.samsung.android.mocca
com.sec.android.app.hwmoduletest
com.sem.factoryapp
com.sec.factory.camera
com.samsung.android.providers.factory
com.samsung.android.visionintelligence
com.samsung.android.engineapp.camerashift
com.samsung.android.app.cameraassistant
com.samsung.android.imageenhancer
com.samsung.android.singletake.service
com.samsung.android.visual.cloudcore
com.samsung.android.vision.model
com.samsung.android.liveeffectservice
com.samsung.android.photoremasterservice
com.samsung.android.motionphoto.app
com.samsung.android.location
com.samsung.android.samsungpositioning
com.samsung.android.dsms
com.samsung.oda.service
com.samsung.sree
com.samsung.android.mcfds
com.samsung.android.dbsc
com.samsung.android.aremoji
com.samsung.android.aremojieditor
com.samsung.android.app.dofviewer
com.samsung.android.sdk.handwriting
com.samsung.android.internal.overlay.config.default_contextual_search
com.samsung.android.rubin.app
com.sec.automation
com.samsung.faceservice
com.samsung.android.cameraxservice
com.samsung.android.camerasdkservice
com.samsung.android.aicore
com.samsung.android.memoryguardian
com.samsung.android.appbooster
com.sec.android.diagmonagent
com.samsung.android.bixbyvision.framework
com.samsung.android.bixby.agent
com.samsung.android.bixby.wakeup
com.samsung.android.aware.service
com.samsung.android.sidegesturepad
com.sec.android.easyonehand
com.samsung.android.smartface.overlay
"

echo "Enabling camera/sensor packages..."
for pkg in $PACKAGES; do
  result=$(adb shell "pm enable $pkg" 2>&1)
  if [[ "$result" == *"new state: enabled"* ]]; then
    echo "  ✓ $pkg"
  fi
done

echo ""
echo "Check gyro: adb shell 'dumpsys sensorservice | grep -i gyro'"
echo "If still failing, reboot: adb reboot"
