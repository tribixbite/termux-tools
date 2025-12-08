#!/bin/bash
# Fix disabled Samsung sensor/system packages after phantom killer
#
# ONE-LINER (copy-paste this if it happens again):
# adb shell "pm enable com.samsung.android.ssco; pm enable com.samsung.android.mocca; pm enable com.samsung.android.dsms; pm enable com.samsung.oda.service; pm enable com.samsung.android.motionphoto.app; pm enable com.samsung.sree; pm enable com.samsung.android.mcfds; pm enable com.samsung.android.dbsc" && adb reboot

PACKAGES="
com.samsung.android.ssco
com.samsung.android.mocca
com.samsung.android.dsms
com.samsung.oda.service
com.samsung.android.motionphoto.app
com.samsung.sree
com.samsung.android.mcfds
com.samsung.android.dbsc
"

echo "Enabling packages..."
for pkg in $PACKAGES; do
  adb shell "pm enable $pkg" 2>/dev/null
done

echo "Done. Rebooting..."
adb reboot
