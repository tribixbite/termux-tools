#!/data/data/com.termux/files/usr/bin/bash

# ADB Wireless Connection Script for Termux
# Automatically finds and connects to ADB over WiFi with connection monitoring
# Usage: ./adb-wireless-connect.sh [host_ip] [apk_path]
#        ./adb-wireless-connect.sh --monitor  (keep connection alive)

HOST_IP="$1"
APK_PATH="$2"
STATE_FILE="$HOME/.cache/adb-wireless-state"
MONITOR_MODE=false

# Check for monitor mode
if [ "$1" = "--monitor" ] || [ "$1" = "-m" ]; then
    MONITOR_MODE=true
fi

# Create cache directory
mkdir -p "$(dirname "$STATE_FILE")"

# Function to check if currently connected
is_connected() {
    adb devices 2>/dev/null | grep -q "device$" && return 0 || return 1
}

# Function to get current connection
get_current_connection() {
    adb devices 2>/dev/null | grep "device$" | head -1 | awk '{print $1}'
}

# Function to save connection state
save_state() {
    local host_port="$1"
    echo "$host_port" > "$STATE_FILE"
    echo "$(date '+%Y-%m-%d %H:%M:%S')" >> "$STATE_FILE"
}

# Function to load last known connection
load_last_connection() {
    if [ -f "$STATE_FILE" ]; then
        head -1 "$STATE_FILE"
    fi
}

# Function to find and connect to ADB wireless
connect_adb_wireless() {
    # Save shell's errexit state
    case $- in *e*) was_e=1;; esac
    set +e

    # Get host IP from wlan0 or use provided host
    if [ -n "$1" ]; then
        HOST="$1"
    else
        # Try to get wlan0 IP
        HOST=$(ifconfig 2>/dev/null | awk '/wlan0/{getline; if(/inet /) print $2}')

        # Fallback to any non-loopback interface
        if [ -z "$HOST" ]; then
            HOST=$(ifconfig 2>/dev/null | awk '/inet / && !/127.0.0.1/{print $2; exit}')
        fi
    fi

    if [ -z "$HOST" ]; then
        echo "❌ Could not determine device IP address"
        echo "   Please provide host IP as argument: $0 <host_ip>"
        echo "   Example: $0 192.168.1.100"
        [ -n "$was_e" ] && set -e
        return 1
    fi

    echo "📱 Scanning for ADB on host: $HOST"

    # Try last known connection first
    LAST_CONN=$(load_last_connection)
    if [ -n "$LAST_CONN" ]; then
        echo "   Trying last known connection: $LAST_CONN"
        if adb connect "$LAST_CONN" >/dev/null 2>&1; then
            sleep 0.5
            if adb devices | grep -q "^$LAST_CONN[[:space:]]*device"; then
                echo "✅ Reconnected to $LAST_CONN"
                export ADB_DEVICE="$LAST_CONN"
                [ -n "$was_e" ] && set -e
                return 0
            fi
        fi
        echo "   Last connection failed, scanning for new port..."
    fi

    # Disconnect any existing connections
    echo "   Disconnecting existing ADB connections..."
    adb disconnect -a >/dev/null 2>&1

    # Build list of ports to try (reversed order - highest first)
    PORTS="5555"

    # Check if nmap is available for port scanning
    if command -v nmap &>/dev/null; then
        echo "   Scanning ports 30000-50000 for ADB (highest first)..."
        SCANNED_PORTS=$(nmap -p 30000-50000 --open -oG - "$HOST" 2>/dev/null | \
            awk -F"Ports: " '/Ports:/{
                n=split($2,a,/, /);
                for(i=1;i<=n;i++){
                    if (a[i] ~ /open/){
                        split(a[i],f,"/");
                        print f[1]
                    }
                }
            }' | sort -rn)  # Reverse numeric sort (highest first)

        if [ -n "$SCANNED_PORTS" ]; then
            # Add scanned ports before 5555 (so they're tried first)
            PORTS="$SCANNED_PORTS 5555"
            echo "   Found open ports (trying highest first): $(echo $SCANNED_PORTS | tr '\n' ' ')"
        fi
    else
        echo "   Note: Install nmap for automatic port scanning: pkg install nmap"
        echo "   Trying common ports only..."
        # Add common high ports when nmap not available (reversed)
        PORTS="45555 42555 40555 37555 5555"
    fi

    # Try to connect to each port
    for port in $PORTS; do
        echo -n "   Trying $HOST:$port... "

        if adb connect "$HOST:$port" >/dev/null 2>&1; then
            # Wait and verify connection
            for i in 1 2 3; do
                sleep 0.5
                if adb devices | grep -q "^$HOST:$port[[:space:]]*device"; then
                    echo "✅ connected!"
                    export ADB_DEVICE="$HOST:$port"
                    save_state "$HOST:$port"
                    [ -n "$was_e" ] && set -e
                    return 0
                fi
            done
            echo "⚠️  failed to verify"
            adb disconnect "$HOST:$port" >/dev/null 2>&1
        else
            echo "❌ no response"
        fi
    done

    echo "❌ No working ADB port found on $HOST"
    [ -n "$was_e" ] && set -e
    return 1
}

# Function to monitor and maintain connection
monitor_connection() {
    echo "🔄 Starting ADB connection monitor..."
    echo "   Checking every 30 seconds, reconnecting if needed"
    echo "   Press Ctrl+C to stop"
    echo

    while true; do
        if is_connected; then
            CURRENT=$(get_current_connection)
            echo "[$(date '+%H:%M:%S')] ✓ Connected to $CURRENT"
        else
            echo "[$(date '+%H:%M:%S')] ⚠️  Not connected, attempting reconnect..."
            if connect_adb_wireless "$HOST_IP"; then
                echo "[$(date '+%H:%M:%S')] ✅ Reconnected successfully"
            else
                echo "[$(date '+%H:%M:%S')] ❌ Reconnect failed, will retry..."
            fi
        fi
        sleep 30
    done
}

# Main script
if [ "$MONITOR_MODE" = true ]; then
    monitor_connection
    exit 0
fi

echo "=== ADB Wireless Connection Tool ==="
echo

# Check if adb is installed
if ! command -v adb &>/dev/null; then
    echo "❌ ADB not found. Install with: pkg install android-tools"
    exit 1
fi

# Try to connect
if connect_adb_wireless "$HOST_IP"; then
    echo
    echo "✅ Successfully connected to device at $ADB_DEVICE"
    echo

    # Show device info
    echo "📱 Device Information:"
    adb shell getprop ro.product.model 2>/dev/null | sed 's/^/   Model: /'
    adb shell getprop ro.build.version.release 2>/dev/null | sed 's/^/   Android: /'
    adb shell getprop ro.product.manufacturer 2>/dev/null | sed 's/^/   Manufacturer: /'
    echo

    # If APK path provided, install it
    if [ -n "$APK_PATH" ] && [ -f "$APK_PATH" ]; then
        echo "📦 Installing APK: $APK_PATH"

        # Get package name from APK
        PACKAGE=$(aapt dump badging "$APK_PATH" 2>/dev/null | grep package: | awk '{print $2}' | cut -d"'" -f2)

        if [ -n "$PACKAGE" ]; then
            echo "   Package: $PACKAGE"
            echo "   Uninstalling old version..."
            adb uninstall "$PACKAGE" 2>/dev/null || true
        fi

        echo "   Installing new version..."
        if adb install -r "$APK_PATH"; then
            echo
            echo "✅ APK installed successfully!"

            if [[ "$PACKAGE" == *"keyboard"* ]]; then
                echo
                echo "📝 To enable the keyboard:"
                echo "   1. Go to Settings → System → Languages & input → Virtual keyboard"
                echo "   2. Enable the new keyboard"
                echo "   3. Switch to it using the keyboard selector"
            fi
        else
            echo "❌ Installation failed"
        fi
    else
        echo "💡 Tips:"
        echo "   • To install an APK: $0 $HOST <apk_path>"
        echo "   • To monitor connection: $0 --monitor"
        echo "   • Connection state saved to: $STATE_FILE"
        echo "   • To list packages: adb shell pm list packages"
        echo "   • To uninstall: adb uninstall <package_name>"
        echo "   • To disconnect: adb disconnect"
    fi
else
    echo
    echo "❌ Could not establish ADB connection"
    echo

    # Copy 'wifidebug' to clipboard for quick access
    if command -v termux-clipboard-set &>/dev/null; then
        echo "wifidebug" | termux-clipboard-set
        echo "📋 Copied 'wifidebug' to clipboard - paste to enable wireless debugging"
        echo
    fi

    echo "💡 Troubleshooting:"
    echo "   1. Enable Developer Options on target device"
    echo "   2. Enable 'Wireless debugging' or 'ADB over network'"
    echo "   3. Note the IP address and port shown"
    echo "   4. Make sure both devices are on the same network"
    echo "   5. Try: $0 <device_ip>"
    echo "   6. Install nmap for automatic port scanning: pkg install nmap"
    exit 1
fi
