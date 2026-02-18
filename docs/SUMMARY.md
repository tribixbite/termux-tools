# Termux-Tools Summary

Quick overview of the most important commands and features.

## 🎯 The Two Essential Commands

These work from **anywhere** - even inside Claude Code (`cc`) where Ctrl+b doesn't work:

```bash
tm <search>      # Attach to any tmux session (fuzzy search)
tmgo <search>    # Send 'go' to any session (without switching)
```

## Why These Commands Matter

**The Problem:**
- You work with multiple Claude Code sessions in separate tmux instances
- When actively talking to Claude (`cc`), you can't type bash commands
- Traditional tmux Ctrl+b shortcuts don't work in Claude's interface

**The Solution:**
- Simple commands: `tm` and `tmgo`
- Ask Claude to run them for you
- Or use from bash shell in split pane
- Or use between Claude sessions
- Fuzzy search by name (no need to remember session names)
- Auto-create instances if repo exists
- Auto-send 'go' to flagged projects on boot

## Quick Examples

### Switch Between Projects
```bash
tm clev       # Attach to cleverkeys session
tm un         # Attach to Unexpected-Keyboard session
tm custom     # Attach to CustomCamera session
```

### Resume Claude in Other Sessions
```bash
# You're in cleverkeys, want Claude to continue in other projects
tmgo custom   # Send 'go' to CustomCamera, stay in cleverkeys
tmgo un       # Send 'go' to Unexpected-Keyboard
tmgo disc     # Send 'go' to discord-irc
```

### Create New Sessions from Repos
```bash
tm bun        # Finds ~/git/bun-on-termux, creates session, starts cc
tm pop        # Finds ~/git/pop/popcorn-mobile, creates session
```

## All Commands

### Primary (Work in cc)
- `tm <search>` - Smart session switcher
- `tmgo <search>` - Send 'go' to session

### Session Management
- `tmbs` - List all tmux sessions
- `tmbi` - Show detailed session info
- `tmbr` - Restart all sessions
- `tmbka` - Kill all sessions

### Repo Management
- `tmba <repo> [1]` - Add repo temporarily (1=auto-go)
- `tmbp <repo> [1]` - Add repo permanently to repos.conf

### Other Shortcuts (don't work in cc)
- `tsh` / `tsv` - Split horizontal/vertical
- `tz` - Zoom pane
- `td` - Detach from current session

## Typical Workflow

### Morning Startup
```bash
# Device boots, separate tmux instances auto-created for each project
# cleverkeys gets 'go' sent automatically (flagged in repos.conf)
# Other projects just start cc and wait

# List all sessions
tmbs

# Check status
tmbi

# Attach to main project
tm clev
```

### During Development
```bash
# Switch between projects (attaches to separate sessions)
tm clev       # Work on cleverkeys
tm custom     # Switch to CustomCamera
tm un         # Check Unexpected-Keyboard

# Resume Claude in background (sends 'go' to other sessions)
tmgo clev     # Resume cleverkeys while staying where you are
tmgo custom   # Resume CustomCamera
```

### Add New Project
```bash
tm newproj        # Auto-creates if ~/git/newproj exists
# Or:
tmba newproj 1    # Add temporarily with auto-go
tmbp newproj 1    # Add permanently to repos.conf with auto-go
tmbr              # Restart to apply changes
```

## Documentation

- **README.md** - Complete setup guide
- **ARCHITECTURE.md** - Separate instances architecture explained
- **QUICK_REFERENCE.md** - Cheat sheet of all commands
- **TM_COMMAND.md** - Deep dive on `tm`
- **TMGO_COMMAND.md** - Deep dive on `tmgo`
- **TERMUX_BOOT_SETUP.md** - Boot configuration
- **TERMUX_BOOT_QUICKSTART.md** - Quick boot guide

## Installation

1. Copy configs:
   ```bash
   mkdir -p ~/.termux/boot
   cp examples/startup.sh.example ~/.termux/boot/startup.sh
   cp examples/repos.conf.example ~/.termux/boot/repos.conf
   cp examples/bash_aliases.example ~/.bash_aliases
   chmod +x ~/.termux/boot/startup.sh
   ```

2. Add to `~/.bashrc`:
   ```bash
   if [ -f ~/.bash_aliases ]; then
       . ~/.bash_aliases
   fi
   ```

3. Edit repos in `~/.termux/boot/repos.conf` (set auto_go flags)

4. Test it:
   ```bash
   source ~/.bashrc
   ~/.termux/boot/startup.sh
   tmbs          # List all sessions
   tm clev       # Attach to cleverkeys
   ```

## Key Features

✅ **Works inside cc/claude** - No Ctrl+b needed
✅ **Fuzzy search** - Partial name matching
✅ **Auto-create sessions** - From ~/git/ repos
✅ **Boot automation** - Separate instances for each project
✅ **Selective auto-go** - Flag specific projects to auto-resume
✅ **Stay focused** - `tmgo` sends commands without switching
✅ **Simple names** - `tm` and `tmgo` are 2-4 letters
✅ **Complete isolation** - Each project in own tmux session

## Remember

**Inside Claude Code, just type:**
```bash
tm <anything>      # Attach to any project session
tmgo <anything>    # Send 'go' to any project
```

That's it! 🎉
