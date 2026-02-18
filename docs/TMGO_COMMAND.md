# The `tmgo` Command - Send 'go' Without Switching

Companion to the `tm` command, `tmgo` sends the 'go' command to any window without switching to it.

## Why `tmgo` Exists

**Scenario**: You're at a bash prompt (or talking to Claude) and want to resume Claude Code in another window.

**Without tmgo:**
1. Switch to the target window: `tm clev`
2. Type: `go`
3. Switch back to your window: `tm current`

**With tmgo:**
1. Send go: `tmgo clev` (or ask Claude: "tmgo clev")
2. Keep working in current window

**Real usage**:
- Ask Claude: "tmgo 0" and Claude runs it for you
- Use from bash prompt when not in Claude session
- Use from a split pane while Claude runs in another pane

## Usage

```bash
tmgo <search|number>
```

Where:
- `<search>` = Lowercase partial match of window name
- `<number>` = Direct window number (0, 1, 2, etc.)

## Examples

### Send 'go' by Window Name

```bash
tmgo clev      # Send 'go' to cleverkeys
tmgo un        # Send 'go' to Unexpected-Keyboard
tmgo custom    # Send 'go' to CustomCamera
tmgo disc      # Send 'go' to discord-irc
tmgo illust    # Send 'go' to illustrate
```

### Send 'go' by Window Number

```bash
tmgo 0         # Send 'go' to window 0
tmgo 1         # Send 'go' to window 1
tmgo 2         # Send 'go' to window 2
tmgo 5         # Send 'go' to window 5
```

## Common Workflows

### Resume Multiple Claude Sessions

```bash
# You're in cleverkeys, want to resume work in other windows
tmgo custom    # Resume CustomCamera cc
tmgo un        # Resume Unexpected-Keyboard cc
tmgo disc      # Resume discord-irc cc

# All windows now have Claude working
# You're still in cleverkeys
```

### Batch Start Work

```bash
# From any window, start Claude in all other projects
tmgo 0
tmgo 1
tmgo 2
tmgo 3
tmgo 4
tmgo 5

# All windows now processing their tasks
```

### Resume After Pausing Claude

```bash
# You paused Claude in several windows
# Resume them all without switching

tmgo clev
tmgo custom
tmgo un
```

## How It Works

1. **Parse input**: Determine if it's a number or search term
2. **Find window**:
   - If number: Verify window exists
   - If search: Fuzzy match window name (case-insensitive)
3. **Send command**: `tmux send-keys -t boot-session:N "go" C-m`
4. **Stay put**: Don't switch windows

## Error Handling

### Window Not Found by Name

```bash
$ tmgo xyz
Error: No window found matching 'xyz'

Available windows:
  0: cleverkeys
  1: CustomCamera
  2: Unexpected-Keyboard
  3: popcorn-mobile
  4: illustrate
  5: discord-irc
```

### Window Not Found by Number

```bash
$ tmgo 99
Error: Window 99 doesn't exist

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
$ tmgo clev
Error: boot-session doesn't exist. Run: tmbr
```

## Use Cases

### 1. Multi-Window Development

You're debugging in cleverkeys, but want Claude to continue work in CustomCamera:

```bash
# In cleverkeys window
tm clev                   # Switch to cleverkeys (if not already there)
# Debug something...

tmgo custom              # Resume Claude in CustomCamera
# Keep debugging while CustomCamera processes in background
```

### 2. Round-Robin Task Distribution

Distribute tasks across multiple windows:

```bash
# Window 0: Start code review
tmgo 0

# Window 1: Run tests
tmgo 1

# Window 2: Update documentation
tmgo 2

# Window 3: Refactor component
tmgo 3

# All tasks now running in parallel!
```

### 3. Resume After Device Sleep

Device went to sleep, all Claude sessions paused:

```bash
# Quick resume all windows
for i in {0..5}; do tmgo $i; done

# Or resume specific ones
tmgo clev
tmgo custom
tmgo un
```

### 4. Pause and Resume Workflow

Working on cleverkeys, need to step away:

```bash
# Pause Claude (Ctrl+C or type something)
# Go do something else...

# Return and resume without switching
tmgo clev
# Claude continues from where it left off
```

## Comparison with Other Methods

| Method | Stays in current window? | Works in cc? | Fuzzy search? |
|--------|-------------------------|--------------|---------------|
| `tmgo <search>` | ✅ Yes | ✅ Yes | ✅ Yes |
| `tsendw <N> "go"` | ✅ Yes | ✅ Yes | ❌ No (number only) |
| Switch + type 'go' | ❌ No | ❌ No | N/A |
| `Ctrl+b N` + go | ❌ No | ❌ No | N/A |

## Technical Details

### Window Matching

**By number:**
```bash
tmgo 0    # Direct match, no fuzzy search needed
```

**By name:**
```bash
# Case-insensitive partial matching
tmgo CLEV     # Matches "cleverkeys"
tmgo clev     # Matches "cleverkeys"
tmgo ever     # Matches "cleverkeys"
```

### Command Execution

The actual tmux command:
```bash
tmux send-keys -t boot-session:<N> "go" C-m
```

Where:
- `-t boot-session:<N>` = Target window N in boot-session
- `"go"` = The text to send
- `C-m` = Press Enter

### No Window Switching

Unlike `tm` which uses `tmux select-window`, `tmgo` only uses `tmux send-keys`, so your current window stays selected.

## Tips

### Send to Multiple Windows

```bash
# Loop through all windows
for i in {0..5}; do tmgo $i; sleep 0.5; done

# Or selectively
for name in clev custom un disc; do tmgo $name; done
```

### Create Aliases for Common Patterns

Add to `~/.bash_aliases`:
```bash
alias goall='for i in {0..5}; do tmgo $i; done'
alias goclev='tmgo clev'
alias gocustom='tmgo custom'
```

### Check Window Before Sending

```bash
tmbl                  # List windows first
tmgo 3                # Send to window 3
```

## Related Commands

- `tm <search>` - Switch to window (and optionally create)
- `tsendw <N> <text>` - Send any text to window N
- `tsend <text>` - Send text to current window

## Summary

**`tmgo` is perfect for:**
- ✅ Resuming Claude sessions without switching windows
- ✅ Batch starting work across multiple windows
- ✅ Staying focused in your current window
- ✅ Working from inside `cc` where Ctrl+b doesn't work

**Quick reference:**
```bash
tmgo clev      # Send to cleverkeys by name
tmgo 0         # Send to window 0 by number
tmgo un        # Send to Unexpected-Keyboard
```
