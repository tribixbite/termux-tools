# Real-World Workflows with Claude Code

How to actually use `tm` and `tmgo` when working with Claude Code sessions.

## The Reality

When you're **actively in a Claude Code session** (typing to Claude), you can't directly execute bash commands. You're in Claude's interface, not at a bash prompt.

## Three Ways to Use These Commands

### 1. Ask Claude to Run Them (Recommended)

**How it works**: Just tell Claude what command to run.

```
You: tm clev
Claude: *executes command and switches to cleverkeys window*

You: tmgo 0
Claude: *sends 'go' to window 0*

You: tmgo custom
Claude: *sends 'go' to CustomCamera window*
```

**Advantages**:
- ✅ Simple - just tell Claude what you want
- ✅ No need to exit Claude session
- ✅ Claude confirms what happened

**Use when**:
- You're actively working with Claude
- You want to switch projects
- You want to resume Claude in other windows

### 2. Split Pane Setup (Power Users)

**Setup**: Create a split pane before starting Claude.

```bash
# In your tmux window
tsh              # Split horizontal (or tsv for vertical)

# Pane 1 (top/left): Run Claude Code
cc
go

# Pane 2 (bottom/right): Keep bash shell
# Use tm/tmgo commands here
```

**Switch between panes**:
```bash
Ctrl+b arrow-keys    # Traditional tmux
# Or from bash pane:
t1                   # Select pane 0 (Claude pane)
t2                   # Select pane 1 (bash pane)
```

**Workflow**:
```bash
# Pane 1: Claude Code running
# You're working with Claude...

# Pane 2: Bash shell
tm custom           # Switch entire window to CustomCamera
tmgo clev           # Send 'go' to cleverkeys
tmgo 0              # Send 'go' to window 0
```

**Advantages**:
- ✅ Claude keeps running while you execute commands
- ✅ Can see both Claude and bash
- ✅ Direct control without asking Claude

**Use when**:
- You frequently switch between projects
- You want to monitor Claude while using commands
- You're comfortable with split panes

### 3. Between Claude Sessions

**How it works**: Exit Claude, run command, restart Claude.

```bash
# In Claude Code session
Ctrl+D              # Exit Claude

# Now at bash prompt
tm custom           # Switch to CustomCamera window
cc                  # Start Claude again
go                  # Continue where you left off
```

**Advantages**:
- ✅ Full control at bash prompt
- ✅ Can run any commands you want

**Use when**:
- Switching projects between work sessions
- Ending work on one project, starting another
- Don't need Claude running continuously

## Common Real-World Scenarios

### Scenario 1: Working on Multiple Projects

You're working in cleverkeys, want to also start work in CustomCamera:

**Method 1 - Ask Claude**:
```
You: I'm going to switch to CustomCamera now. Run: tm custom
Claude: *executes tm custom, switches windows*
You: go
```

**Method 2 - Split pane**:
```bash
# Pane 1: Claude in cleverkeys
# Pane 2: Bash
tm custom           # Switch windows
```

**Method 3 - Exit and switch**:
```bash
Ctrl+D              # Exit Claude
tm custom           # Switch
cc                  # Restart Claude in new project
go
```

### Scenario 2: Resume Claude in Other Windows

You're working in cleverkeys, want Claude to continue in other projects without leaving:

**Method 1 - Ask Claude** (Recommended):
```
You: Resume work in other windows. Run these:
tmgo custom
tmgo un
tmgo disc

Claude: *executes all three commands*
✓ Sent 'go' to CustomCamera
✓ Sent 'go' to Unexpected-Keyboard
✓ Sent 'go' to discord-irc
```

**Method 2 - Split pane**:
```bash
# Pane 1: Claude in cleverkeys (still working)
# Pane 2: Bash
tmgo custom
tmgo un
tmgo disc
```

### Scenario 3: Batch Resume All Windows

Morning startup - resume all Claude sessions:

**Method 1 - Ask Claude**:
```
You: Resume all windows. Run:
for i in {0..5}; do tmgo $i; done

Claude: *executes loop*
✓ Sent 'go' to all 6 windows
```

**Method 2 - Bash prompt**:
```bash
# Before starting any Claude session
for i in {0..5}; do tmgo $i; done
# Or individually:
tmgo 0
tmgo 1
tmgo 2
tmgo 3
tmgo 4
tmgo 5
```

### Scenario 4: Create New Project Window

You need to work on a new repo:

**Method 1 - Ask Claude**:
```
You: Create a window for bun-on-termux. Run: tm bun
Claude: *executes tm bun*
Window not found, searching ~/git/ for repos...
Found repo: bun-on-termux at ~/git/bun-on-termux
Creating new window for bun-on-termux...
✓ Created window 6: bun-on-termux
```

**Method 2 - Bash prompt**:
```bash
Ctrl+D              # Exit current Claude session
tm bun              # Create new window
cc                  # Start Claude in new window
go
```

## Recommended Setup for Daily Use

### Option A: Ask Claude (Simplest)

1. Start Claude in any window: `cc` then `go`
2. When you need to switch or send commands, just tell Claude:
   - "tm custom" to switch
   - "tmgo 0" to send go to window 0
   - "tmgo clev" to send go to cleverkeys
3. Claude executes and confirms

### Option B: Split Pane (Power User)

1. Create split in each window:
   ```bash
   tsh              # Horizontal split
   ```

2. Top pane: Claude Code
   ```bash
   cc
   go
   ```

3. Bottom pane: Bash shell
   - Use `tm`/`tmgo` commands
   - Switch with `t1`/`t2`

### Option C: Dedicated Command Window

1. Keep window 0 as "command window" (no Claude)
2. Windows 1-5: Run Claude in projects
3. In window 0:
   ```bash
   tm 1              # Switch to project window
   tmgo 1            # Send go to project window
   ```

## Tips

1. **Naming is important**: Use short, unique parts of names
   ```bash
   tm clev           # Better than: tm cleverkeys
   tm un             # Better than: tm Unexpected-Keyboard
   ```

2. **Claude remembers context**: You can chain commands
   ```
   You: Switch to custom, then send go to clev and un
   Claude: *executes all three*
   ```

3. **Use numbers when unsure**:
   ```bash
   tmbl              # List windows first
   tm 3              # Use window number
   ```

4. **Batch operations**: Ask Claude to loop
   ```
   You: Send go to windows 0 through 3
   Claude: *executes for loop*
   ```

## Summary

**When actively in Claude**: Ask Claude to run commands for you
**When at bash prompt**: Run commands directly
**Power users**: Use split panes for both Claude and bash

The key insight: `tm` and `tmgo` are bash commands. When you're talking to Claude, you're not at a bash prompt - so either ask Claude to run them, or use a split pane setup.
