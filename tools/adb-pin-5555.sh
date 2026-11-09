#!/data/data/com.termux/files/usr/bin/bash
# Keep LAN test phones reachable on a fixed adb port (5555).
#
# Why: an unrooted phone cannot set persist.adb.tcp.port, and its wireless-debugging
# TLS port changes on every adbd restart and every reboot. `adb tcpip 5555` opens a
# fixed listener that survives adbd restarts but NOT a reboot. This script, run from
# cron, restores it: for each phone not answering on :5555 it scans the phone's
# wireless-debugging range, connects through the rotated port (the host is already
# paired, so no code is needed) and re-runs `adb tcpip 5555`.
#
# Limit: it needs Wireless debugging to still be ON after the reboot. If the phone
# turned it off, nothing on the host can reach it until someone re-enables it.
#
# Usage: adb-pin-5555.sh [ip ...]   (default: the IPs in ~/.config/adb-pin-5555.list)

set -u
LIST="$HOME/.config/adb-pin-5555.list"
LOG="$HOME/.cache/adb-pin-5555.log"
mkdir -p "$(dirname "$LOG")"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# A phone is "pinned" when a shell command goes through on ip:5555.
pinned() {
    timeout 6 adb connect "$1:5555" >/dev/null 2>&1
    timeout 6 adb -s "$1:5555" shell true >/dev/null 2>&1
}

repin() {
    local ip="$1" port
    # Wireless debugging picks a port in 30000-49999 on current Android builds.
    for port in $(nmap -T4 --min-rate 1000 -p 30000-49999 --open -n -oG - "$ip" 2>/dev/null |
                  awk -F'Ports: ' '/Ports:/{print $2}' | tr ',' '\n' | awk -F/ '{gsub(/ /,"",$1); print $1}'); do
        timeout 6 adb connect "$ip:$port" 2>/dev/null | awk '/connected to/{f=1} END{exit !f}' || continue
        if timeout 6 adb -s "$ip:$port" shell true >/dev/null 2>&1; then
            adb -s "$ip:$port" tcpip 5555 >/dev/null 2>&1
            sleep 4
            adb disconnect "$ip:$port" >/dev/null 2>&1
            if pinned "$ip"; then log "$ip re-pinned to 5555 via $port"; return 0; fi
        fi
        adb disconnect "$ip:$port" >/dev/null 2>&1
    done
    log "$ip not reachable (wireless debugging off, phone asleep off-network, or new IP)"
    return 1
}

ips=("$@")
if [ ${#ips[@]} -eq 0 ] && [ -f "$LIST" ]; then
    mapfile -t ips < <(awk '!/^#/ && NF{print $1}' "$LIST")
fi

for ip in "${ips[@]}"; do
    pinned "$ip" || repin "$ip"
done
