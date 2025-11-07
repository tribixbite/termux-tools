# Termux Tools

Collection of tools, scripts, and configurations for enhancing Termux productivity on Android.

## 🚀 Features

### Tmux Boot Session Manager

Automatically start and manage multiple project sessions in tmux that persist across device reboots.

**What it does:**
- Creates tmux sessions on boot with one window per project
- Runs custom commands (like `cc` then `go`) in each window
- Provides aliases for quick navigation between projects
- Easy repo management (add/remove projects dynamically)

**Primary Commands:**
```bash
# From inside cc/claude or anywhere
tm clev        # Switch to cleverkeys (or any partial match)
tm un          # Switch to Unexpected-Keyboard
tm newproject  # Creates window if repo exists in ~/git/

# Send 'go' to a window without switching
tmgo clev      # Send 'go' to cleverkeys, stay in current window
tmgo 0         # Send 'go' to window 0 by number
tmgo un        # Send 'go' to Unexpected-Keyboard
```

**Quick Start:**
```bash
# Install required packages
pkg install tmux termux-api termux-boot

# Install Termux:Boot app from F-Droid
# https://f-droid.org/packages/com.termux.boot/

# Copy example configs
cp examples/startup.sh.example ~/.termux/boot/startup.sh
cp examples/bash_aliases.example ~/.bash_aliases
chmod +x ~/.termux/boot/startup.sh

# Source aliases in ~/.bashrc
echo 'if [ -f ~/.bash_aliases ]; then . ~/.bash_aliases; fi' >> ~/.bashrc
source ~/.bashrc

# Edit repos in startup.sh
vim ~/.termux/boot/startup.sh

# Test it
~/.termux/boot/startup.sh
tmb  # Attach to boot session
```

## 📚 Documentation

- **[TERMUX_BOOT_QUICKSTART.md](TERMUX_BOOT_QUICKSTART.md)** - Quick reference for boot session setup
- **[TERMUX_BOOT_SETUP.md](TERMUX_BOOT_SETUP.md)** - Complete boot configuration guide
- **[TMUX_ALIASES_GUIDE.md](TMUX_ALIASES_GUIDE.md)** - Comprehensive alias reference
- **[SETUP_CHANGES.md](SETUP_CHANGES.md)** - Summary of system changes

## 🛠️ Configuration Files

### `~/.termux/boot/startup.sh`

Creates tmux session with windows for each project directory.

**Example:**
```bash
repos=(
  "$HOME/git/project1"
  "$HOME/git/project2"
  "$HOME/git/project3"
)
```

See [examples/startup.sh.example](examples/startup.sh.example) for full configuration.

### `~/.bash_aliases`

Provides convenient aliases for tmux session management.

**Key commands:**
- `tm <search>` - **PRIMARY: Smart fuzzy window switcher (works in cc!)**
- `tmgo <search>` - **Send 'go' to window without switching (works in cc!)**
- `tmb` - Attach to boot session
- `tmb0-5` - Switch to specific window
- `tmba <repo>` - Add repo temporarily
- `tmbp <repo>` - Add repo permanently
- `tmbr` - Restart session
- `tmbi` - Show session info

See [examples/bash_aliases.example](examples/bash_aliases.example) for full aliases.

## 🎯 Common Commands

```bash
# PRIMARY: Smart Window Switcher (works inside cc/claude!)
tm clev      # Switch to cleverkeys (partial match)
tm un        # Switch to Unexpected-Keyboard
tm bun       # Creates window if repo exists in ~/git/

# Send 'go' to Window (works inside cc/claude!)
tmgo clev    # Send 'go' to cleverkeys without switching
tmgo 0       # Send 'go' to window 0
tmgo un      # Send 'go' to Unexpected-Keyboard

# Session Management
tmb          # Attach to boot session
tmbi         # Show session info
tmbr         # Restart session
tmbk         # Kill session

# Navigation (when not inside cc)
tmb0         # Switch to window 0
tmb1         # Switch to window 1
tmbw camera  # Find window by name (fuzzy)

# Adding Repos
tmba my-project      # Add temporarily to current session
tmbp my-project      # Add permanently to startup.sh
```

### Why `tm` and `tmgo` are Primary

When you're inside Claude Code (`cc`), tmux's `Ctrl+b` shortcuts don't work because Claude takes over those keys. The `tm` and `tmgo` commands work from anywhere - even inside `cc` - making them the most useful commands for daily development.

**Use cases:**
- `tm` - Switch to a different project window
- `tmgo` - Send 'go' to resume Claude in another window while staying in your current window

## 📦 Installation

### Method 1: Manual Installation

1. Copy example files to your home directory:
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

3. Edit `~/.termux/boot/startup.sh` to add your repos

4. Reload configuration:
   ```bash
   source ~/.bashrc
   ```

5. Test it:
   ```bash
   ~/.termux/boot/startup.sh
   tmb
   ```

### Method 2: Quick Install Script

```bash
# TODO: Create install.sh script
```

## 🔧 Customization

### Change Command Run in Windows

Edit `~/.termux/boot/startup.sh`:

```bash
# Change from 'cc' to your command
tmux send-keys -t boot-session:0 "cd '$repo' && your-command" C-m
```

### Add More Repos

**Temporary:**
```bash
tmba ~/git/new-project
```

**Permanent:**
```bash
tmbp new-project
tmbr  # Restart to apply
```

**Manual:**
```bash
vim ~/.termux/boot/startup.sh
# Add to repos array: "$HOME/git/new-project"
tmbr  # Restart
```

### Modify Window Aliases

Edit `~/.bash_aliases` to add more window shortcuts:
```bash
alias tmb6='tmux select-window -t boot-session:6'
alias tmb7='tmux select-window -t boot-session:7'
```

## 🐛 Troubleshooting

### Boot Session Not Starting

1. Verify Termux:Boot is installed:
   ```bash
   pm list packages | grep termux.boot
   ```

2. Check startup script is executable:
   ```bash
   ls -l ~/.termux/boot/startup.sh
   chmod +x ~/.termux/boot/startup.sh
   ```

3. Test manually:
   ```bash
   ~/.termux/boot/startup.sh
   ```

4. Check logs:
   ```bash
   cat ~/.termux/boot.log
   ```

### Aliases Not Working

```bash
# Reload bash configuration
source ~/.bashrc

# Or start new shell
exec bash

# Verify aliases loaded
alias | grep tmb
```

### tmux Session Not Found

```bash
# Check if session exists
tmux ls

# Create session
~/.termux/boot/startup.sh

# Or use quick attach (auto-creates)
tmbb
```

## 📋 Requirements

- Termux (latest version)
- tmux: `pkg install tmux`
- termux-api: `pkg install termux-api`
- Termux:Boot app (from F-Droid)
- Termux:API app (from F-Droid, for wake-lock)

## 🤝 Contributing

Contributions welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## 📄 License

MIT License - feel free to use and modify as needed.

## 🔗 Related Projects

- [bun-on-termux](https://github.com/yourusername/bun-on-termux) - Run Bun JavaScript runtime on Termux
- [termux-desktop](https://github.com/yourusername/termux-desktop) - Desktop environment setup for Termux

## 📞 Support

- GitHub Issues: Report bugs or request features
- Documentation: See docs above for detailed guides
- Termux Wiki: https://wiki.termux.com/

## 🎉 Credits

Built for the Termux community to make mobile development more productive.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
