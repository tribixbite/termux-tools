# Architecture Overview

## Separate Tmux Instances Model

Each project runs in its own **separate tmux session** instead of windows in a single boot-session.

### Why Separate Instances?

**Previous Architecture (Windows):**
- One `boot-session` with multiple windows (0, 1, 2, 3, 4, 5)
- Had to track window numbers
- Required switching between windows in same session
- Limited automation capabilities

**New Architecture (Separate Instances):**
- Each project gets its own tmux session named after the project
- Example: `cleverkeys`, `customcamera`, `unexpected-keyboard`, `popcorn-mobile`
- Complete isolation between projects
- Can automate 'go' command per project
- Fuzzy search by name instead of numbers

### Key Components

#### 1. repos.conf
Configuration file defining which repos to auto-start and automation flags.

```bash
# Format: REPOS["path"]="auto_go:enabled"
REPOS["$HOME/git/swype/cleverkeys"]="1:1"  # auto_go=1, enabled=1
REPOS["$HOME/git/swype/CustomCamera"]="0:1" # auto_go=0, enabled=1
```

**Flags:**
- `auto_go`: 1 = automatically send 'go' after cc starts, 0 = just start cc
- `enabled`: 1 = start on boot, 0 = skip

#### 2. startup.sh
Boot script that reads repos.conf and creates separate tmux instances.

```bash
# Load config
source "$HOME/.termux/boot/repos.conf"

# Create instance for each repo
for repo in "${!REPOS[@]}"; do
  session_name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
  tmux new-session -d -s "$session_name" -c "$repo"
  tmux send-keys -t "$session_name" "cc" Enter

  # Auto-send 'go' if flagged
  if [ "$auto_go" = "1" ]; then
    tmux send-keys -t "$session_name" "go" Enter
  fi
done
```

#### 3. bash_aliases
Functions that work with session names instead of window numbers.

**tm (session switcher):**
- Fuzzy search for session name
- Auto-creates if repo exists in ~/git/
- Example: `tm clev` attaches to cleverkeys session

**tmgo (remote command sender):**
- Sends 'go' to any session without switching
- Fixed Enter key issue (was C-m, now Enter)
- Example: `tmgo clev` sends 'go' to cleverkeys

### Workflow Examples

#### Attach to a project
```bash
tm clev        # Fuzzy match: attaches to 'cleverkeys' session
tm un          # Fuzzy match: attaches to 'unexpected-keyboard' session
```

#### Send 'go' without switching
```bash
# You're in cleverkeys, want to resume popcorn-mobile
tmgo pop       # Sends 'go' to popcorn-mobile, stay in cleverkeys
```

#### List all instances
```bash
tmbs           # List all tmux sessions
tmbi           # Show detailed info
```

#### Add new project
```bash
# Temporary (this session only)
tmba my-new-project 1    # Create with auto-go

# Permanent (add to repos.conf)
tmbp my-new-project 1    # Add to config with auto-go flag
```

#### Restart all instances
```bash
tmbr           # Kill all and recreate from repos.conf
```

### Session Naming Convention

Session names are derived from repo folder names:
- Convert to lowercase
- Replace non-alphanumeric chars with hyphens
- Examples:
  - `cleverkeys` → `cleverkeys`
  - `CustomCamera` → `customcamera`
  - `Unexpected-Keyboard` → `unexpected-keyboard`
  - `popcorn-mobile` → `popcorn-mobile`

### Benefits Over Windows Architecture

1. **Complete Isolation**: Each project is independent
2. **No Window Numbering**: Use names instead of numbers
3. **Selective Automation**: Flag specific projects for auto-go
4. **Fuzzy Search**: `tm clev` is easier than `tmb0`
5. **Easier Mental Model**: One session = one project
6. **Better Organization**: Sessions listed by name in `tmbs`
7. **Remote Control**: Send commands to any session from anywhere

### Migration from Windows

**Old commands:**
```bash
tmb            # Attach to boot-session
tmb0           # Switch to window 0
tmb1           # Switch to window 1
tmbl           # List windows
tmgo 0         # Send 'go' to window 0
```

**New commands:**
```bash
tmbs           # List all sessions
tm clev        # Attach to cleverkeys
tm custom      # Attach to customcamera
tmgo clev      # Send 'go' to cleverkeys
tmbi           # Show detailed info
```

### Configuration Files

**~/.termux/boot/repos.conf:**
- Defines which repos to auto-start
- Sets automation flags per repo
- Easy to enable/disable projects

**~/.termux/boot/startup.sh:**
- Reads repos.conf
- Creates separate tmux instances
- Handles auto-go automation

**~/.bash_aliases:**
- Provides tm/tmgo commands
- Session management functions
- General tmux shortcuts
