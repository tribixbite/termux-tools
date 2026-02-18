#!/data/data/com.termux/files/usr/bin/bash
# Fix Samsung camera/sensors and Android phantom process killer
# Run via ADB after system updates reset these settings

echo "=== Post-Update Fix Script ==="
echo

# Check ADB connection
if ! adb devices 2>/dev/null | grep -q "device$"; then
    echo "❌ ADB not connected. Attempting to connect..."
    ~/git/termux-tools/tools/adb-wireless-connect.sh || exit 1
fi

echo "📱 Connected to device"
echo

# === FIX 1: Phantom Process Killer ===
echo "🔧 [1/2] Fixing Phantom Process Killer..."
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
adb shell "settings put global settings_enable_monitor_phantom_procs false"
echo "   ✅ Phantom process limit: unlimited"
echo

# === FIX 2: Samsung Sensor/Camera Packages ===
echo "🔧 [2/2] Enabling Samsung sensor/camera packages..."

PACKAGES=(
    "com.samsung.android.ssco"              # Samsung Sensor Core Operations - CRITICAL
    "com.samsung.android.mocca"             # Mocca Core Sensor - CRITICAL
    "com.samsung.android.camerasdkservice"  # Camera SDK Service
    "com.samsung.android.dsms"              # Device Security Management
    "com.samsung.oda.service"               # ODA Service
    "com.samsung.android.motionphoto.app"   # Motion Photo
    "com.samsung.sree"                      # Samsung Runtime Environment
    "com.samsung.android.mcfds"             # MCF Data Service
    "com.samsung.android.dbsc"              # DBSC
)

for pkg in "${PACKAGES[@]}"; do
    result=$(adb shell "pm enable $pkg" 2>&1)
    if echo "$result" | grep -q "new state: enabled"; then
        echo "   ✅ Enabled: $pkg"
    elif echo "$result" | grep -q "already enabled"; then
        echo "   ⏭️  Already enabled: $pkg"
    else
        echo "   ⚠️  $pkg: $result"
    fi
done

echo
echo "=== Fix Complete ==="
echo
echo "📊 Verification:"
echo "   Phantom procs: $(adb shell '/system/bin/device_config get activity_manager max_phantom_processes')"
echo "   Monitor disabled: $(adb shell 'settings get global settings_enable_monitor_phantom_procs')"
echo "   Sensors: $(adb shell 'dumpsys sensorservice | grep "Total"')"
echo
echo "💡 Reboot recommended if camera was broken"
