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

# Loopback endpoint for this phone's own adbd. Wireless debugging's TLS port
# changes every time adbd restarts, and adbd restarts on any USB function
# switch (e.g. a screen lock/unlock with "Default USB configuration" set).
# The legacy TCP listener enabled by `adb tcpip` keeps the same port across
# adbd restarts until reboot, and loopback does not depend on Wi-Fi.
LOOPBACK_SERIAL="127.0.0.1:5555"

# Connect to the loopback listener if adbd already has it open.
try_loopback() {
    timeout 5 adb connect "$LOOPBACK_SERIAL" >/dev/null 2>&1 || true
    sleep 0.3
    adb devices 2>/dev/null | grep -q "^$LOOPBACK_SERIAL[[:space:]]*device"
}

# After a wireless-debugging connection succeeds, open the loopback listener
# (needed once per boot) and switch to it. `adb tcpip` restarts adbd, which
# drops the wireless serial; that is expected.
promote_to_loopback() {
    local wireless="$1"
    echo "   Enabling loopback listener on port 5555 (once per boot)..."
    adb -s "$wireless" tcpip 5555 >/dev/null 2>&1 || return 1
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 1
        if try_loopback; then
            adb disconnect "$wireless" >/dev/null 2>&1 || true
            # The fresh transport can flap to "offline" for a few seconds while
            # adbd finishes starting; wait until a shell command goes through.
            local j
            for j in 1 2 3 4 5 6 7 8 9 10; do
                timeout 5 adb -s "$LOOPBACK_SERIAL" shell true >/dev/null 2>&1 && return 0
                sleep 1
                timeout 5 adb connect "$LOOPBACK_SERIAL" >/dev/null 2>&1 || true
            done
            return 1
        fi
    done
    return 1
}

# Function to find and connect to ADB wireless
# Commands that may fail use || true instead of set +e to avoid leaking to caller
connect_adb_wireless() {
    # This phone's own adbd over loopback: fixed port, survives Wi-Fi changes
    # and adbd restarts. Only applies when no explicit host was given.
    if [ -z "$1" ] && try_loopback; then
        echo "✅ Connected to $LOOPBACK_SERIAL (loopback)"
        export ADB_DEVICE="$LOOPBACK_SERIAL"
        save_state "$LOOPBACK_SERIAL"
        return 0
    fi

    # Get host IP from wlan0 or use provided host
    if [ -n "$1" ]; then
        HOST="$1"
    else
        # Try to get wlan0 IP
        HOST=$(ifconfig 2>/dev/null | awk '/wlan0/{getline; if(/inet /) print $2}' || true)

        # Fallback to any non-loopback interface
        if [ -z "$HOST" ]; then
            HOST=$(ifconfig 2>/dev/null | awk '/inet / && !/127.0.0.1/{print $2; exit}' || true)
        fi
    fi

    if [ -z "$HOST" ]; then
        echo "❌ Could not determine device IP address"
        echo "   Please provide host IP as argument: $0 <host_ip>"
        echo "   Example: $0 192.168.1.100"
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
                if [ -z "$1" ] && [ "$LAST_CONN" != "$LOOPBACK_SERIAL" ] && promote_to_loopback "$LAST_CONN"; then
                    echo "✅ Switched to $LOOPBACK_SERIAL (loopback)"
                    export ADB_DEVICE="$LOOPBACK_SERIAL"
                    save_state "$LOOPBACK_SERIAL"
                fi
                return 0
            fi
        fi
        echo "   Last connection failed, scanning for new port..."
    fi

    # Drop stale entries for this host only; other test phones connected to
    # the same adb server (shared between agents) must stay connected.
    echo "   Disconnecting stale connections to $HOST..."
    for stale in $(adb devices 2>/dev/null | awk -v h="$HOST:" 'index($1, h) == 1 {print $1}'); do
        adb disconnect "$stale" >/dev/null 2>&1 || true
    done

    # Build list of ports to try (reversed order - highest first)
    PORTS="5555"

    # Check if nmap is available for port scanning
    if command -v nmap &>/dev/null; then
        echo "   Fast scanning ports 30000-50000..."
        # Use -T4 for faster timing, --min-rate for speed
        SCANNED_PORTS=$(nmap -T4 --min-rate 1000 -p 30000-50000 --open -oG - "$HOST" 2>/dev/null | \
            awk -F"Ports: " '/Ports:/{
                n=split($2,a,/, /);
                for(i=1;i<=n;i++){
                    if (a[i] ~ /open/){
                        split(a[i],f,"/");
                        print f[1]
                    }
                }
            }' | sort -rn)

        if [ -n "$SCANNED_PORTS" ]; then
            PORTS="$SCANNED_PORTS 5555"
            echo "   Found open ports: $(echo $SCANNED_PORTS | tr '\n' ' ')"
        fi
    else
        echo "   Note: Install nmap for faster scanning: pkg install nmap"
        echo "   Trying common ports..."
        PORTS="45555 42555 40555 37555 5555"
    fi

    # Parallel connection attempts (try up to 5 ports simultaneously)
    echo "   Attempting parallel connections..."
    FOUND_PORT=""

    # Function to try a single port
    try_port() {
        local p=$1 h=$2
        if timeout 2 adb connect "$h:$p" >/dev/null 2>&1; then
            sleep 0.3
            if adb devices 2>/dev/null | grep -q "^$h:$p[[:space:]]*device"; then
                echo "$p"
                return 0
            fi
            adb disconnect "$h:$p" >/dev/null 2>&1 || true
        fi
        return 1
    }
    export -f try_port

    # Try ports in parallel, stop on first success
    for port in $PORTS; do
        echo -n "   Trying $HOST:$port... "
        if timeout 3 adb connect "$HOST:$port" >/dev/null 2>&1; then
            sleep 0.3
            if adb devices | grep -q "^$HOST:$port[[:space:]]*device"; then
                echo "✅ connected!"
                export ADB_DEVICE="$HOST:$port"
                save_state "$HOST:$port"
                if [ -z "$1" ] && promote_to_loopback "$HOST:$port"; then
                    echo "✅ Switched to $LOOPBACK_SERIAL (loopback)"
                    export ADB_DEVICE="$LOOPBACK_SERIAL"
                    save_state "$LOOPBACK_SERIAL"
                fi

                return 0
            fi
            echo "⚠️  auth pending"
            adb disconnect "$HOST:$port" >/dev/null 2>&1 || true
        else
            echo "❌"
            # A timed-out probe can leave an "offline" entry behind
            adb disconnect "$HOST:$port" >/dev/null 2>&1 || true
        fi
    done

    echo "❌ No working ADB port found on $HOST"
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
    adb -s "$ADB_DEVICE" shell getprop ro.product.model 2>/dev/null | sed 's/^/   Model: /'
    adb -s "$ADB_DEVICE" shell getprop ro.build.version.release 2>/dev/null | sed 's/^/   Android: /'
    adb -s "$ADB_DEVICE" shell getprop ro.product.manufacturer 2>/dev/null | sed 's/^/   Manufacturer: /'
    echo

    # If APK path provided, install it
    if [ -n "$APK_PATH" ] && [ -f "$APK_PATH" ]; then
        echo "📦 Installing APK: $APK_PATH"

        # Get package name from APK
        PACKAGE=$(aapt dump badging "$APK_PATH" 2>/dev/null | grep package: | awk '{print $2}' | cut -d"'" -f2)

        if [ -n "$PACKAGE" ]; then
            echo "   Package: $PACKAGE"
            echo "   Uninstalling old version..."
            adb -s "$ADB_DEVICE" uninstall "$PACKAGE" 2>/dev/null || true
        fi

        echo "   Installing new version..."
        if adb -s "$ADB_DEVICE" install -r "$APK_PATH"; then
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
