# Termux Boot Architecture

## Overview

The boot automation system creates separate tmux instances for each project when your Android device boots, using the Termux:Boot app.

## Directory Structure

Following XDG Base Directory specification:

```
~/.termux/boot/          # Executable boot scripts (read by Termux:Boot)
├── startup.sh           # Main boot script
├── cui                  # Other boot scripts...
├── play
└── vnc

~/.config/termux-boot/   # Configuration files (XDG_CONFIG_HOME)
└── repos.conf           # Repository automation config

~/.local/share/termux-boot/logs/  # Log files (XDG_DATA_HOME)
├── boot.log             # Boot process log
└── discord-bot.log      # Discord-IRC bot output
```

## How Termux:Boot Works

1. **On device boot**, Termux:Boot app automatically:
   - Looks for executable files in `~/.termux/boot/`
   - Executes them **alphabetically** in separate processes
   - Each script runs independently (one error doesn't affect others)

2. **Execution order** (alphabetical):
   - `cui` → `play` → `start.sh` → `startup.sh` → `vnc`

3. **Best practices**:
   - Use numeric prefixes for specific ordering: `01-script.sh`, `02-script.sh`
   - Keep scripts focused on single responsibility
   - Log errors for debugging

## Wake Lock Management

**What are wake locks?**
- Android mechanism to prevent CPU from sleeping
- Essential during startup to ensure all processes complete
- Must be released after to prevent battery drain

**Usage in startup.sh:**
```bash
termux-wake-lock        # Acquire at start
# ... create tmux sessions ...
termux-wake-unlock      # Release at end
```

**Why release?**
- Without release: device CPU stays awake forever
- Battery drains quickly (even when screen is off)
- Device gets hot from constant CPU activity
- Think: "hold door open while moving furniture, then close it"

## Error Handling

The improved startup.sh includes:

1. **Error counting**: Tracks failed session creations
2. **Error logging**: All errors logged to `boot.log`
3. **Notifications**: Shows success/error status in notification
4. **Graceful degradation**: One failed session doesn't stop others
5. **Exit codes**: Returns proper exit code on critical errors

Example:
```bash
if ! tmux new-session -d -s "$session_name" -c "$repo" 2>> "$BOOT_LOG"; then
  echo "[$(date)] ERROR: Failed to create session: $session_name" >> "$BOOT_LOG"
  error_count=$((error_count + 1))
  continue  # Keep going with other sessions
fi
```

## Discord-Bot Logging

The discord-irc bot output is captured to a persistent log file:

**Command:**
```bash
NODE_ENV=development bun ../discord-irc/dist/lib/cli.js 2>&1 | tee -a '$BOT_LOG'
```

**What this does:**
- `2>&1` - Redirect stderr to stdout (capture all output)
- `tee -a` - Write to file AND display in tmux session
- `-a` - Append (don't overwrite on restart)

**Benefits:**
- Debug bot issues without being in tmux session
- Persistent log survives tmux crashes
- Can grep/search logs for specific events
- Track bot uptime and connection issues

**View logs:**
```bash
# Watch bot log in real-time
tail -f ~/.local/share/termux-boot/logs/discord-bot.log

# Search for connection issues
grep -i "error\|disconnect" ~/.local/share/termux-boot/logs/discord-bot.log

# Check when bot last started
grep "irc-disc v" ~/.local/share/termux-boot/logs/discord-bot.log | tail -1
```

## Configuration Files

### repos.conf

Located in `~/.config/termux-boot/repos.conf` (XDG-compliant)

**Format:**
```bash
REPOS["path/to/repo"]="auto_go:enabled"
```

**Fields:**
- `auto_go`: `1` = auto-send 'go' after Claude starts, `0` = just start Claude
- `enabled`: `1` = start on boot, `0` = skip

**Example:**
```bash
# Auto-start Claude and send 'go' immediately
REPOS["$HOME/git/swype/cleverkeys"]="1:1"

# Start Claude but wait for manual 'go'
REPOS["$HOME/git/illustrate"]="0:1"

# Disabled - won't start on boot
REPOS["$HOME/git/old-project"]="0:0"
```

### Backward Compatibility

startup.sh checks both locations for repos.conf:
1. New: `~/.config/termux-boot/repos.conf` (preferred)
2. Old: `~/.termux/boot/repos.conf` (fallback)

This allows gradual migration without breaking existing setups.

## Multiple Boot Scripts

If you have multiple scripts in `~/.termux/boot/`:

**Potential conflicts:**
- Multiple scripts trying to start same services
- Race conditions if scripts depend on each other
- Resource contention (CPU, memory)

**Solutions:**
1. **Consolidate**: Move logic into single `startup.sh`
2. **Prefix ordering**: Use `01-first.sh`, `02-second.sh` for dependencies
3. **Mutual exclusion**: Check if service already running before starting

**Example check:**
```bash
# Only start if not already running
if ! pgrep -x crond > /dev/null; then
  crond -s -P
fi
```

## Status Notifications

The script sends Android notifications with boot status:

**Success:**
```
Title: Termux Boot
Content: ✓ Started 6 sessions
```

**With errors:**
```
Title: Termux Boot
Content: ⚠ Started 6 sessions (2 errors)
```

Check logs for details: `cat ~/.local/share/termux-boot/logs/boot.log`

## Troubleshooting

**Sessions not starting:**
1. Check Termux:Boot is installed and granted permissions
2. Verify `startup.sh` is executable: `ls -l ~/.termux/boot/startup.sh`
3. Check logs: `cat ~/.local/share/termux-boot/logs/boot.log`
4. Test manually: `bash ~/.termux/boot/startup.sh`

**Wake lock not releasing:**
- Check if script completed (no `exit` before unlock)
- Manual release: `termux-wake-unlock`
- List wake locks: `termux-wake-lock` (shows current status)

**Bot not logging:**
- Verify log directory exists: `ls -la ~/.local/share/termux-boot/logs/`
- Check tmux command: `tmux capture-pane -t discord-bot -p`
- Ensure `tee` command in send-keys worked properly

**Config not found:**
- Error means repos.conf missing from both locations
- Create it: `cp ~/git/termux-tools/examples/repos.conf.example ~/.config/termux-boot/repos.conf`
- Edit repos to match your setup

## Maintenance

**Log rotation:**
Bot logs can grow large over time. Consider periodic cleanup:

```bash
# Keep last 1000 lines of bot log
tail -1000 ~/.local/share/termux-boot/logs/discord-bot.log > /tmp/bot.log
mv /tmp/bot.log ~/.local/share/termux-boot/logs/discord-bot.log

# Or add to cron for automatic weekly cleanup:
# 0 0 * * 0 tail -1000 ~/.local/share/termux-boot/logs/discord-bot.log > /tmp/bot.log && mv /tmp/bot.log ~/.local/share/termux-boot/logs/discord-bot.log
```

**Regular checks:**
```bash
# Verify all expected sessions running
tmux list-sessions

# Check recent boot logs
tail -50 ~/.local/share/termux-boot/logs/boot.log

# Verify cron is running
pgrep -x crond
```
