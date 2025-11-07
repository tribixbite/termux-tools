# The `tm` Command - Smart Window Switcher

The single most important command for daily tmux usage, especially when working inside Claude Code (`cc`).

## Why `tm` is Primary

**Problem**: When you're inside Claude Code (`cc`), tmux's `Ctrl+b` shortcuts don't work because Claude takes over control keys.

**Solution**: The `tm` command works from anywhere - even inside `cc` sessions - making window switching seamless.

## Usage

```bash
tm <search>
```

Where `<search>` is any lowercase partial match of a window name or repo.

## How It Works

1. **Searches existing tmux windows** (case-insensitive partial match)
2. **If window found** → Switches to it immediately
3. **If not found** → Searches `~/git/` and subdirectories for matching repos
4. **If repo found** → Creates new window, runs `cc`, then sends `go`

## Examples

### Switch to Existing Windows

```bash
# Window: cleverkeys
tm clev
tm clever
tm key

# Window: Unexpected-Keyboard
tm un
tm unexpected
tm keyboard

# Window: CustomCamera
tm custom
tm camera
tm cam

# Window: discord-irc
tm disc
tm discord
tm irc

# Window: illustrate
tm illust
tm ill
```

### Create New Windows from Repos

If a window doesn't exist but a repo matches in `~/git/`:

```bash
# Repo: ~/git/bun-on-termux
tm bun          # Creates new window, runs: cd ~/git/bun-on-termux && cc, then: go

# Repo: ~/git/swype/CustomCamera (subdirectory)
tm camera       # Finds in subdirectories too

# Repo: ~/git/pop/popcorn-mobile
tm pop          # Creates new window for popcorn-mobile
tm popcorn
```

## Error Handling

### No Match Found

```bash
$ tm xyz
Window not found, searching ~/git/ for repos...
Error: No window or repo found matching 'xyz'

Available windows:
  0: cleverkeys
  1: CustomCamera
  2: Unexpected-Keyboard
  3: popcorn-mobile
  4: illustrate
  5: discord-irc
```

### Boot Session Not Running

```bash
$ tm clev
Error: boot-session doesn't exist. Run: tmbr
```

## Matching Rules

### Case-Insensitive
```bash
tm CLEV    # Works (matches cleverkeys)
tm Clev    # Works
tm clev    # Works
```

### Partial Matching
```bash
# Window: Unexpected-Keyboard
tm un              # ✓ Matches
tm expected        # ✓ Matches
tm keyboard        # ✓ Matches
tm u               # ✓ Matches (first window with 'u')
```

### First Match Wins
If multiple windows match, the first one found is selected:
```bash
# Windows: cleverkeys, discord-irc
tm c       # Matches cleverkeys (comes first)
tm d       # Matches discord-irc
```

### Subdirectory Scanning
Searches both `~/git/*` and `~/git/*/*`:
```bash
~/git/project                    # ✓ Found
~/git/swype/cleverkeys          # ✓ Found
~/git/pop/popcorn-mobile        # ✓ Found
~/git/nested/deep/project       # ✗ Only scans 2 levels
```

## Use Cases

### From Inside cc/claude

**Scenario**: You're working in cleverkeys and want to switch to CustomCamera.

**Traditional tmux** (doesn't work in cc):
```bash
Ctrl+b 1      # ✗ Doesn't work - Claude captures Ctrl+b
```

**With tm** (works everywhere):
```bash
tm custom     # ✓ Works perfectly!
```

### Quick Project Switching

```bash
# Morning: Start working on CustomCamera
tm custom

# Switch to Unexpected-Keyboard for quick check
tm un

# Back to CustomCamera
tm custom

# Need to work on new repo
tm bun        # Creates window if it doesn't exist
```

### One-Command Window Creation

Instead of:
```bash
tmux new-window -t boot-session:6 -n "new-project"
tmux send-keys -t boot-session:6 "cd ~/git/new-project && cc" C-m
sleep 0.5
tmux send-keys -t boot-session:6 "go" C-m
```

Just:
```bash
tm new
```

## Integration with Other Commands

### Check Current Windows

```bash
tmbl                  # List all windows
tm clev              # Switch to cleverkeys
```

### Add Repo Then Switch

```bash
tmbp my-project      # Add to startup.sh
tmbr                 # Restart boot session
tm my                # Switch to new window
```

### Quick Session Info

```bash
tmbi                 # Show session info with all windows
tm 0                # Won't work - use: tm <name>
```

## Advanced Usage

### Switching During Long Operations

If you're running a long command in one window:
```bash
# In cleverkeys, running tests...
npm test             # Takes 5 minutes

# Switch to another project without interrupting
tm disc              # Switch to discord-irc
# Work on something else
tm clev              # Come back when ready
```

### Creating Multiple New Windows

```bash
tm proj1             # Creates window for ~/git/proj1
tm proj2             # Creates window for ~/git/proj2
tm proj3             # Creates window for ~/git/proj3

# Now you have dynamic windows:
tmbl                 # See all windows
```

## Troubleshooting

### Search Too Generic

```bash
$ tm a
Found window: CustomCamera (window 1)
# If you wanted "android-project", be more specific:
$ tm android
```

### Repo Exists But Not Creating Window

Make sure boot-session is running:
```bash
tmbs                 # Check sessions
tmbr                 # Restart if needed
tm myrepo            # Try again
```

### Created Window Shows in Wrong Directory

The script uses the first matching directory:
```bash
~/git/test           # Found
~/git/test-project   # Not checked (first match used)

# Be more specific:
tm test-proj        # Matches test-project
```

## Comparison with Other Methods

| Method | Works in cc? | Requires exact name? | Auto-creates? |
|--------|--------------|---------------------|---------------|
| `tm <search>` | ✅ Yes | ❌ No (fuzzy) | ✅ Yes |
| `Ctrl+b 0-9` | ❌ No | ✅ Yes | ❌ No |
| `tmb0-5` | ⚠️ Limited | ✅ Yes | ❌ No |
| `tmbw <name>` | ⚠️ Limited | ❌ No (fuzzy) | ❌ No |
| `tn`/`tp` | ❌ No | N/A | ❌ No |

## Summary

**The `tm` command is your primary tool for window navigation in Termux tmux sessions.**

- ✅ Works from inside `cc`/claude
- ✅ Fuzzy matching (partial strings)
- ✅ Auto-creates windows for repos
- ✅ Case-insensitive
- ✅ Simple 2-letter command
- ✅ Scans subdirectories
- ✅ Clear error messages

**Remember**: `tm <anything>` and let it figure out what you mean!
