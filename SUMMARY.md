# Termux-Tools Summary

Quick overview of the most important commands and features.

## 🎯 The Two Essential Commands

These work from **anywhere** - even inside Claude Code (`cc`) where Ctrl+b doesn't work:

```bash
tm <search>      # Switch to any window (fuzzy search)
tmgo <search>    # Send 'go' to any window (without switching)
```

## Why These Commands Matter

**The Problem:**
- You work in tmux with multiple Claude Code sessions
- Inside `cc`, Ctrl+b shortcuts don't work (Claude captures them)
- Traditional tmux navigation is broken

**The Solution:**
- `tm` and `tmgo` work from anywhere, even inside `cc`
- Fuzzy search by name (no need to remember window numbers)
- Auto-create windows if repo exists

## Quick Examples

### Switch Between Windows
```bash
tm clev       # → cleverkeys
tm un         # → Unexpected-Keyboard
tm custom     # → CustomCamera
```

### Resume Claude in Other Windows
```bash
# You're in cleverkeys, want Claude to continue in other windows
tmgo custom   # Send 'go' to CustomCamera, stay in cleverkeys
tmgo un       # Send 'go' to Unexpected-Keyboard
tmgo disc     # Send 'go' to discord-irc
```

### Create New Windows from Repos
```bash
tm bun        # Finds ~/git/bun-on-termux, creates window, starts cc
tm pop        # Finds ~/git/pop/popcorn-mobile, creates window
```

## All Commands

### Primary (Work in cc)
- `tm <search>` - Smart window switcher
- `tmgo <search>` - Send 'go' to window

### Session Management
- `tmb` - Attach to boot session
- `tmbi` - Show session info
- `tmbr` - Restart session
- `tmbk` - Kill session

### Window Shortcuts
- `tmb0-5` - Jump to window 0-5
- `tmbl` - List windows

### Repo Management
- `tmba <repo>` - Add repo temporarily
- `tmbp <repo>` - Add repo permanently

### Other Shortcuts (don't work in cc)
- `tn` / `tp` - Next/previous window
- `tsh` / `tsv` - Split horizontal/vertical
- `tz` - Zoom pane
- `td` - Detach

## Typical Workflow

### Morning Startup
```bash
# Device boots, tmux session auto-created with 6 windows
# Each window runs: cd repo && cc, then: go

# Attach to session
tmb

# Check all windows
tmbi
```

### During Development
```bash
# Switch between projects
tm clev       # Work on cleverkeys
tm custom     # Switch to CustomCamera
tm un         # Check Unexpected-Keyboard

# Resume Claude in background
tmgo clev     # Resume cleverkeys while staying where you are
tmgo custom   # Resume CustomCamera
```

### Add New Project
```bash
tm newproj    # Auto-creates if ~/git/newproj exists
# Or:
tmbp newproj  # Add permanently to startup
tmbr          # Restart to apply
```

## Documentation

- **README.md** - Complete setup guide
- **QUICK_REFERENCE.md** - Cheat sheet of all commands
- **TM_COMMAND.md** - Deep dive on `tm`
- **TMGO_COMMAND.md** - Deep dive on `tmgo`
- **TERMUX_BOOT_SETUP.md** - Boot configuration
- **TERMUX_BOOT_QUICKSTART.md** - Quick boot guide

## Installation

1. Copy configs:
   ```bash
   cp examples/startup.sh.example ~/.termux/boot/startup.sh
   cp examples/bash_aliases.example ~/.bash_aliases
   chmod +x ~/.termux/boot/startup.sh
   ```

2. Add to `~/.bashrc`:
   ```bash
   if [ -f ~/.bash_aliases ]; then
       . ~/.bash_aliases
   fi
   ```

3. Edit repos in `~/.termux/boot/startup.sh`

4. Test it:
   ```bash
   source ~/.bashrc
   ~/.termux/boot/startup.sh
   tm clev
   ```

## Key Features

✅ **Works inside cc/claude** - No Ctrl+b needed
✅ **Fuzzy search** - Partial name matching
✅ **Auto-create windows** - From ~/git/ repos
✅ **Boot automation** - 6 windows created on device boot
✅ **Stay focused** - `tmgo` sends commands without switching
✅ **Simple names** - `tm` and `tmgo` are 2-4 letters

## Remember

**Inside Claude Code, just type:**
```bash
tm <anything>      # Switch to any project
tmgo <anything>    # Resume Claude in any project
```

That's it! 🎉
