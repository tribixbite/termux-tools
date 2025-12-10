#!/bin/bash
# Fix disabled Samsung packages after phantom killer / debloating
# Camera/gyro/sensor issues may require enabling these packages
#
# ROOT CAUSE: Gyroscope fails when sensor init services are stopped:
#   - sensor_copy_registry: stopped
#   - vendor-sensor-sh: stopped
# These can only restart on REBOOT (or with root: start sensor_copy_registry)
#
# IMPORTANT: com.samsung.android.ssco MUST be enabled for camera to work!
# This was the root cause of camera failures - SSCO was disabled (enabled=0)
#
# ONE-LINER (copy-paste if camera fails):
# adb shell "pm enable com.samsung.android.ssco; pm enable com.samsung.android.mocca; pm enable com.sec.android.app.hwmoduletest; pm enable com.sem.factoryapp; pm enable com.sec.factory.camera; pm enable com.samsung.android.providers.factory; pm enable com.samsung.android.visionintelligence; pm enable com.samsung.android.engineapp.camerashift; pm enable com.samsung.android.app.cameraassistant; pm enable com.samsung.android.imageenhancer; pm enable com.samsung.android.singletake.service; pm enable com.samsung.android.visual.cloudcore; pm enable com.samsung.android.vision.model; pm enable com.samsung.android.liveeffectservice; pm enable com.samsung.android.photoremasterservice; pm enable com.samsung.android.motionphoto.app; pm enable com.samsung.android.location; pm enable com.samsung.android.samsungpositioning"

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
