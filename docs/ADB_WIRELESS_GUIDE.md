# ADB Wireless Connection Automation

Automatically maintain ADB wireless debugging connection for seamless Android development.

## Features

### Improvements Over Original

1. **Reversed Port Scanning** - Tries highest ports first (50000 → 30000)
2. **Connection State Persistence** - Remembers last successful connection
3. **Smart Reconnection** - Tries last known connection before scanning
4. **Monitor Mode** - Keeps connection alive with automatic reconnection
5. **Better Error Handling** - More robust connection verification
6. **Cron Integration** - Automated periodic connection checks

## Installation

The script is located at `~/git/termux-tools/tools/adb-wireless-connect.sh` and is automatically set up in crontab to run every 5 minutes.

### Prerequisites

```bash
# Install required packages
pkg install android-tools nmap

# Enable wireless debugging on target Android device:
# Settings → Developer Options → Wireless Debugging
```

## Usage

### Manual Connection

```bash
# Auto-detect device IP and connect
./adb-wireless-connect.sh

# Specify device IP
./adb-wireless-connect.sh 192.168.1.100

# Connect and install APK
./adb-wireless-connect.sh 192.168.1.100 path/to/app.apk
```

### Monitor Mode (Keep-Alive)

```bash
# Run in foreground with status updates
./adb-wireless-connect.sh --monitor

# Run in background (recommended for automation)
./adb-wireless-connect.sh --monitor > ~/adb-monitor.log 2>&1 &
```

### Automated Maintenance (Already Configured)

The crontab entry automatically:
- Checks connection every 5 minutes
- Reconnects if disconnected
- Uses cached last-known-good connection for speed

```bash
# View cron job
crontab -l | grep adb

# Disable automation (comment out cron job)
crontab -e

# View connection logs
cat ~/.cache/adb-wireless-state
```

## How It Works

### Port Scanning Order (Reversed)

**Previous behavior:**
```
Trying: 30000, 30001, 30002, ... 49999, 50000, 5555
```

**New behavior:**
```
Trying: 50000, 49999, 49998, ... 30001, 30000, 5555
```

Android's wireless debugging typically uses higher ports (40000+), so checking them first is faster.

### Connection Persistence

```bash
# Last successful connection saved to:
~/.cache/adb-wireless-state

# Format:
192.168.1.100:45555
2025-11-12 07:30:15
```

On next run:
1. Try cached connection first (instant if still valid)
2. If failed, scan ports starting from highest
3. Save new connection when found

### Smart Reconnection

```
┌─────────────────────────────────────┐
│ Is there a cached connection?       │
└──────────┬──────────────────────────┘
           │
           ├─ Yes → Try connecting
           │        ├─ Success → Done ✓
           │        └─ Failed → Scan ports
           │
           └─ No  → Scan ports
                    ├─ Check 50000 (highest)
                    ├─ Check 49999
                    ├─ ...
                    ├─ Check 30000
                    └─ Check 5555 (fallback)
```

## Automation Details

### Cron Job (Every 5 Minutes)

```bash
*/5 * * * * bash -c "source ~/.bash_aliases && cd ~/git/termux-tools/tools && ./adb-wireless-connect.sh >/dev/null 2>&1"
```

**What it does:**
- Checks if ADB is connected
- If not connected, attempts reconnection
- Uses cached connection for speed
- Runs silently (no output)

**Why every 5 minutes:**
- Balance between responsiveness and resource usage
- WiFi can drop connections randomly
- Ensures connection is restored quickly

### Monitor Mode (Continuous)

```bash
# Add to boot startup for persistent monitoring
echo './adb-wireless-connect.sh --monitor >> ~/adb-monitor.log 2>&1 &' >> ~/.termux/boot/startup.sh
```

**What it does:**
- Checks connection every 30 seconds
- Immediate reconnection on disconnect
- Logs all activity to file

## Troubleshooting

### Connection Won't Establish

```bash
# 1. Verify wireless debugging is enabled on device
# Settings → Developer Options → Wireless Debugging

# 2. Check if both devices are on same network
ifconfig | grep wlan0 -A 1

# 3. Manually specify IP if auto-detect fails
./adb-wireless-connect.sh 192.168.1.100

# 4. Install nmap for better port scanning
pkg install nmap

# 5. Check connection state
cat ~/.cache/adb-wireless-state
```

### Connection Keeps Dropping

```bash
# Enable monitor mode for persistent connection
./adb-wireless-connect.sh --monitor &

# Or add to boot startup
echo './adb-wireless-connect.sh --monitor > ~/adb-monitor.log 2>&1 &' >> ~/.termux/boot/startup.sh
```

### Check Cron Job Status

```bash
# View cron logs (if crond started with -s)
logcat | grep crond

# Manually test cron command
bash -c "source ~/.bash_aliases && cd ~/git/termux-tools/tools && ./adb-wireless-connect.sh"

# Check if crond is running
pgrep -a crond
```

## Examples

### Daily Development Workflow

```bash
# Morning: Device boots, ADB auto-connects within 5 minutes (cron)
# During day: Connection maintained automatically
# Compile and install: ./build-and-install.sh (uses existing ADB connection)
# Connection drops: Auto-reconnects within 5 minutes
```

### Manual Reconnect Anytime

```bash
# Quick reconnect using cached connection
./adb-wireless-connect.sh
# Output: ✅ Reconnected to 192.168.1.100:45555 (instant)

# Force full scan (if IP changed)
rm ~/.cache/adb-wireless-state
./adb-wireless-connect.sh
```

### Install APK Remotely

```bash
# Build and install in one command
./adb-wireless-connect.sh 192.168.1.100 ~/git/my-app/app-debug.apk

# Or use with build scripts
cd ~/git/my-android-project
./build-and-install.sh  # Uses existing ADB connection
```

## Files

```
~/git/termux-tools/
├── tools/adb-wireless-connect.sh      # Main script
├── ADB_WIRELESS_GUIDE.md        # This guide
└── examples/
    └── adb-monitor.service      # Optional: systemd-like service

~/.cache/
└── adb-wireless-state           # Connection persistence cache

Crontab:
*/5 * * * * ... adb-wireless-connect.sh  # Auto-maintain connection
```

## Tips

1. **Install nmap** for faster, more reliable port scanning:
   ```bash
   pkg install nmap
   ```

2. **Keep WiFi stable** - ADB over WiFi requires stable network
   - Avoid aggressive battery savers
   - Keep WiFi always on in developer options

3. **Use monitor mode** for critical development sessions:
   ```bash
   tmux new -s adb-monitor './adb-wireless-connect.sh --monitor'
   ```

4. **Check logs** if issues persist:
   ```bash
   # Cron output (if redirected)
   ~/adb-cron.log

   # Monitor mode output
   ~/adb-monitor.log
   ```

## Integration with Build Scripts

The `build-and-install.sh` scripts automatically use the active ADB connection:

```bash
# In your Android project
./build-and-install.sh

# Script detects existing ADB connection
# → Uses wireless connection if available
# → Falls back to USB if wireless fails
# → Prompts to enable wireless debugging if neither works
```

No manual intervention needed - everything just works! 🎉
