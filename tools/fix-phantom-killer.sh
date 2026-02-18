#!/data/data/com.termux/files/usr/bin/bash
# Fix Android's phantom process killer
# Requires ADB connection

echo "=== Android Phantom Process Killer Fix ==="
echo

# Check if adb is connected
if ! adb devices 2>/dev/null | grep -q "device$"; then
    echo "❌ ADB not connected. Run: adbc"
    exit 1
fi

echo "📱 Current phantom process limit:"
adb shell "/system/bin/device_config get activity_manager max_phantom_processes"

echo
echo "🔧 Setting limit to 2147483647 (effectively unlimited)..."
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"

echo
echo "✅ New limit:"
adb shell "/system/bin/device_config get activity_manager max_phantom_processes"

echo
echo "💡 This setting persists across reboots on some devices."
echo "   If processes still get killed after reboot, re-run this script."
