# Termux Tools

Collection of tools, scripts, and configurations for enhancing Termux productivity on Android.

## 🚀 Features

### 1. Tmux Multi-Instance Manager

Automatically start and manage multiple project sessions in **separate tmux instances** that persist across device reboots.

**What it does:**
- Creates separate tmux instance for each project on boot
- Automatically sends 'go' command to flagged projects (like cleverkeys)
- Provides fuzzy-search commands to switch between instances
- Easy repo management with automation flags

### 2. ADB Wireless Connection Automation

Keeps ADB wireless debugging connected automatically for seamless Android development.

**What it does:**
- Auto-detects and connects to ADB over WiFi
- Scans ports in reverse order (highest first) for faster connection
- Remembers last successful connection for instant reconnect
- Monitors and maintains connection via cron (every 5 minutes)
- Supports APK installation over wireless connection

**Primary Commands:**
```bash
# Switch to a tmux instance (fuzzy search)
tm clev        # Attach to cleverkeys (or any partial match)
tm un          # Attach to Unexpected-Keyboard
tm newproject  # Creates new instance if repo exists in ~/git/

# Send 'go' to an instance without switching
tmgo clev      # Send 'go' to cleverkeys, stay in current session
tmgo un        # Send 'go' to Unexpected-Keyboard

# List and manage instances
tmbs           # List all tmux sessions
tmbi           # Show detailed instance info
tmbr           # Restart all instances
```

**Quick Start:**
```bash
# Install required packages
pkg install tmux termux-api termux-boot

# Install Termux:Boot app from F-Droid
# https://f-droid.org/packages/com.termux.boot/

# Copy example configs
mkdir -p ~/.termux/boot
cp examples/startup.sh.example ~/.termux/boot/startup.sh
cp examples/repos.conf.example ~/.termux/boot/repos.conf
cp examples/bash_aliases.example ~/.bash_aliases
chmod +x ~/.termux/boot/startup.sh

# Source aliases in ~/.bashrc
echo 'if [ -f ~/.bash_aliases ]; then . ~/.bash_aliases; fi' >> ~/.bashrc
source ~/.bashrc

# Edit repos in repos.conf (add auto_go flags)
vim ~/.termux/boot/repos.conf

# Test it
~/.termux/boot/startup.sh
tmbs  # List all instances
tm clev  # Attach to cleverkeys
```

## 📚 Documentation

- **[SUMMARY.md](SUMMARY.md)** - Quick overview of features
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Command cheat sheet
- **[TM_COMMAND.md](TM_COMMAND.md)** - Deep dive on tm command
- **[TMGO_COMMAND.md](TMGO_COMMAND.md)** - Deep dive on tmgo command
- **[WORKFLOWS.md](WORKFLOWS.md)** - Real-world usage patterns
- **[TERMUX_BOOT_SETUP.md](TERMUX_BOOT_SETUP.md)** - Complete boot configuration guide
- **[TMUX_ALIASES_GUIDE.md](TMUX_ALIASES_GUIDE.md)** - Comprehensive alias reference

## 🛠️ Configuration Files

### `~/.termux/boot/repos.conf`

Defines repositories and automation flags.

**Example:**
```bash
# Format: REPOS["path"]="auto_go:enabled"
# auto_go: 1 = auto-send 'go', 0 = just start cc
# enabled: 1 = start on boot, 0 = skip

REPOS["$HOME/git/swype/cleverkeys"]="1:1"  # Auto-go enabled
REPOS["$HOME/git/swype/CustomCamera"]="0:1"
REPOS["$HOME/git/pop/popcorn-mobile"]="0:1"
```

See [examples/repos.conf.example](examples/repos.conf.example) for full configuration.

### `~/.termux/boot/startup.sh`

Reads repos.conf and creates separate tmux instance for each enabled project.

See [examples/startup.sh.example](examples/startup.sh.example) for implementation.

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

**The Real Workflow:**

When you're actively inside Claude Code (`cc`) - meaning you're in a conversation with Claude - you can't directly type bash commands. But you CAN:

1. **Ask Claude to run commands for you**: "tm clev", "tmgo custom"
2. **Or use these commands from a shell in another tmux pane/window**

Traditional tmux shortcuts (Ctrl+b) don't work because you're in Claude's interface.

**Use cases:**
- **Split pane workflow**: One pane with `cc` running, another pane with bash where you use `tm`/`tmgo`
- **Ask Claude**: Tell Claude "run tmgo 0" and Claude executes it for you
- **Between sessions**: Use `tm` to switch projects when NOT actively talking to Claude

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
