# Tmux Aliases Quick Reference

All aliases work without needing `Ctrl+b` - just type the command!

## Boot Session Management

| Alias | Description |
|-------|-------------|
| `tmb` | Attach to boot session |
| `tmbb` | Quick attach (creates if missing) |
| `tmbi` | Show session info |
| `tmbr` | Restart boot session |
| `tmbk` | Kill boot session |
| `tmbl` | List windows in boot session |
| `tmbs` | List all sessions |

## Window Navigation

| Alias | Description |
|-------|-------------|
| `tmb0-5` | Jump to window 0-5 (boot session) |
| `tn` | Next window |
| `tp` | Previous window |
| `tl` | Last window |
| `tw` | Interactive window list |
| `tmbw <search>` | Find window by name (fuzzy) |

## Window Management

| Alias | Description |
|-------|-------------|
| `tnw` | New window |
| `tk` | Kill current window |
| `trn <name>` | Rename window |

## Pane Management

| Alias | Description |
|-------|-------------|
| `tsh` | Split horizontally (left/right) |
| `tsv` | Split vertically (top/bottom) |
| `tkp` | Kill current pane |
| `tz` | Zoom/unzoom pane |

## Pane Navigation

| Alias | Description |
|-------|-------------|
| `t1-4` | Select pane 1-4 |
| `tu` | Move up |
| `tdown` | Move down |
| `tleft` | Move left |
| `tright` | Move right |

## Session Management

| Alias | Description |
|-------|-------------|
| `td` | Detach from session |
| `tls` | List all sessions |
| `tas <name>` | Attach to session |
| `tks <name>` | Kill session |

## Repo Management

| Command | Description |
|---------|-------------|
| `tmba <repo>` | Add repo temporarily |
| `tmbp <repo>` | Add repo permanently |

## Automation

| Command | Description |
|---------|-------------|
| `tsend <text>` | Send text to current window |
| `tsendw <N> <text>` | Send text to window N |

## Common Workflows

### Switch Between Projects
```bash
tmb0       # cleverkeys
tmb1       # CustomCamera
tmb4       # illustrate
tn         # Next project
tp         # Previous project
```

### Create Split View
```bash
tmb0       # Go to project
tsh        # Split horizontally
npm start  # In one pane
# Switch to other pane
tleft      # Or: tright, tu, tdown
htop       # Monitor in other pane
```

### Detach and Reattach
```bash
td         # Detach (keeps running)
# Later...
tmb        # Reattach
```

### Add New Project
```bash
# Temporary
tmba my-project

# Permanent
tmbp my-project
tmbr       # Restart to apply
```

### Send Commands to Windows
```bash
# Send to current window
tsend "npm install"

# Send to specific window
tsendw 0 "git pull"
tsendw 2 "npm test"
```

## Cheat Sheet

**Most Used:**
```
tmb     - Attach
tn/tp   - Next/Previous window
td      - Detach
tmb0-5  - Jump to window
tz      - Zoom pane
```

**Quick Navigation:**
```
tmb0    cleverkeys
tmb1    CustomCamera
tmb2    Unexpected-Keyboard
tmb3    popcorn-mobile
tmb4    illustrate
tmb5    discord-irc
```

**No More Ctrl+b!** 🎉

All these commands replace the need for `Ctrl+b` sequences. Just type the alias directly in your terminal.
