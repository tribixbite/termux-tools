# Crontab Automation Guide

Overview of all automated tasks configured via crontab.

## Current Automation

### Claude Code Session Keep-Alive (Every 10 minutes)

Automatically sends 'go' to keep Claude active in project sessions:

```cron
*/10 * * * * bash -c "source ~/.bash_aliases && tmgo clever"
*/10 * * * * bash -c "source ~/.bash_aliases && tmgo illus"
*/10 * * * * bash -c "source ~/.bash_aliases && tmgo cam"
*/10 * * * * bash -c "source ~/.bash_aliases && tmgo mobile"
```

**Projects automated:**
- **cleverkeys** - Keyboard development
- **illustrate** - Illustration project
- **customcamera** - Camera app development
- **popcorn-mobile** - Popcorn mobile app

**Why 10 minutes:**
- Prevents Claude Code sessions from timing out
- Maintains context across long development sessions
- Keeps all projects actively processing tasks

### ADB Wireless Connection (Every 5 minutes)

Maintains wireless debugging connection:

```cron
*/5 * * * * bash -c "source ~/.bash_aliases && cd ~/git/termux-tools/tools && ./adb-wireless-connect.sh >/dev/null 2>&1"
```

**What it does:**
- Checks if ADB is connected
- Reconnects if connection dropped
- Uses cached last-known connection for speed
- Silent operation (no notifications)

**Why 5 minutes:**
- WiFi can drop randomly
- Faster reconnection than manual intervention
- Critical for continuous development workflow

### Boot Startup (@reboot)

Initializes complete development environment on device boot:

```cron
@reboot bash -c "source ~/.bash_aliases && bash ~/.termux/boot/startup.sh"
```

**What it does:**
- Creates separate tmux instance for each project
- Auto-sends 'go' to flagged projects (cleverkeys)
- Starts crond for scheduled tasks
- Loads bash aliases and functions

## Adding New Automation

### Add Project to Claude Keep-Alive

```bash
# Edit crontab
crontab -e

# Add line (replace 'projectname' with fuzzy match):
*/10 * * * * bash -c "source ~/.bash_aliases && tmgo projectname"

# Example for discord-irc:
*/10 * * * * bash -c "source ~/.bash_aliases && tmgo discord"
```

### Test Before Adding

```bash
# Test the command manually first:
bash -c "source ~/.bash_aliases && tmgo projectname"

# Should output:
# Found session: project-full-name
# ✓ Sent 'go' to session: project-full-name
```

### Adjust Timing

```cron
# Every 5 minutes
*/5 * * * * command

# Every 10 minutes (default for tmgo)
*/10 * * * * command

# Every 30 minutes
*/30 * * * * command

# Every hour
0 * * * * command

# Once per day at 3 AM
0 3 * * * command
```

## Managing Crontab

### View Current Jobs

```bash
crontab -l
```

### Edit Jobs

```bash
crontab -e
```

### Remove All Jobs

```bash
crontab -r
```

### Backup Jobs

```bash
crontab -l > ~/crontab-backup-$(date +%Y%m%d).txt
```

### Restore Jobs

```bash
crontab ~/crontab-backup-20251112.txt
```

## Troubleshooting

### Job Not Running

```bash
# 1. Check if crond is running
pgrep -a crond

# 2. If not running, start it
crond -s -P

# 3. Test the command manually
bash -c "source ~/.bash_aliases && tmgo projectname"

# 4. Check cron logs (if available)
logcat | grep crond
```

### Command Works Manually But Not in Cron

**Problem:** Cron has minimal environment, functions not loaded

**Solution:** Always use full command format:
```bash
bash -c "source ~/.bash_aliases && tmgo projectname"
```

**Don't do this:**
```bash
tmgo projectname  # ✗ Function not available in cron environment
```

### Session Not Found

```bash
# Check if tmux session exists
tmux list-sessions

# Check session name matches fuzzy search
tmux list-sessions | grep -i "searchterm"

# Restart boot sessions if needed
~/.termux/boot/startup.sh
```

## Best Practices

1. **Test commands manually** before adding to cron
2. **Use `source ~/.bash_aliases`** to load functions
3. **Redirect output** for silent operation: `>/dev/null 2>&1`
4. **Choose appropriate intervals** (don't spam every minute)
5. **Document your jobs** in this file when adding new ones
6. **Backup crontab** before major changes

## Example Workflows

### Development Session

```
06:00 - Device boots
     → Boot script creates tmux instances
     → crond starts
06:00-06:10 - First cron cycle
     → ADB reconnects (5 min)
     → Claude sessions get 'go' (10 min)
All day - Automated maintenance
     → ADB checks every 5 min
     → Claude keep-alive every 10 min
     → Developer works without interruption
```

### Adding New Project

```bash
# 1. Add project to boot config
vim ~/.termux/boot/repos.conf
# Add: REPOS["$HOME/git/new-project"]="0:1"

# 2. Restart sessions
~/.termux/boot/startup.sh

# 3. Test tmgo command
tmgo new

# 4. Add to crontab if desired
crontab -e
# Add: */10 * * * * bash -c "source ~/.bash_aliases && tmgo new"
```

## Current Schedule Summary

| Time | Task | Target | Purpose |
|------|------|--------|---------|
| @reboot | Boot startup | All projects | Initialize environment |
| */5 min | ADB connect | Wireless debugging | Maintain connection |
| */10 min | tmgo clever | cleverkeys | Keep Claude active |
| */10 min | tmgo illus | illustrate | Keep Claude active |
| */10 min | tmgo cam | customcamera | Keep Claude active |
| */10 min | tmgo mobile | popcorn-mobile | Keep Claude active |

## Files

```
~/.cache/crontab/
└── crontab.bak              # Automatic backup on each edit

~/git/termux-tools/
├── tools/adb-wireless-connect.sh  # ADB automation script
├── CRONTAB_AUTOMATION.md    # This guide
└── examples/
    └── crontab.example      # Example crontab configuration
```

## Notes

- Cron jobs run with minimal environment - always source needed files
- crond must be running for jobs to execute (auto-started in boot script)
- Job output is typically discarded unless redirected
- Minutes are offset naturally (ADB every 5, tmgo every 10)
- All jobs use `bash -c` to ensure proper shell context
