# Termux Storage & Maintenance

## Check Disk Usage
```bash
df -h /data                                # Overall filesystem usage
du -sh ~/*/ | sort -rh | head -20          # Largest directories in home
du -sh ~/git/*/ | sort -rh | head -20      # Largest git repos
```

## Cache Cleanup

### Bun
```bash
rm -rf ~/.bun/install/cache/*              # Bun package cache
bun pm cache rm                            # Official cache clear
```

### npm
```bash
npm cache clean --force                    # npm cache
rm -rf ~/.npm/_cacache                     # Manual npm cache removal
```

### Node modules (per-project)
```bash
# Remove node_modules from inactive projects
rm -rf ~/git/<project>/node_modules
```

### Python / uv
```bash
uv cache clean                             # uv package cache
rm -rf ~/.cache/uv                         # Manual uv cache
pip cache purge                            # pip cache
```

### Gradle (Android projects)
```bash
rm -rf ~/.gradle/caches                    # Gradle download cache
rm -rf ~/.gradle/daemon                    # Gradle daemon logs
# Per-project: cd <project> && ./gradlew clean (via build script)
```

### General
```bash
rm -rf ~/.cache/*                          # All user caches
```

## Claude Code Cleanup
```bash
du -sh ~/.claude/debug/                    # Debug logs (can grow large)
rm -rf ~/.claude/debug/*                   # Safe to delete
# Conversation logs are in ~/.claude/projects/ — usually keep these
```

## Find Large Files
```bash
find ~ -type f -size +100M 2>/dev/null | head -20         # Files > 100MB
find ~/git -name "node_modules" -type d -maxdepth 3       # All node_modules
find ~/git -name ".gradle" -type d -maxdepth 3            # All .gradle dirs
```

## Archive Inactive Repos
```bash
# Compress and move to shared storage
tar czf ~/storage/shared/archive/repo.tar.gz -C ~/git repo/
rm -rf ~/git/repo                          # After confirming archive
```

## Termux-specific Cleanup
```bash
pkg clean                                  # Clean pacman package cache
pacman -Sc                                 # Remove old cached packages
pacman -Scc                                # Remove ALL cached packages (aggressive)
```

## tmux Session Cleanup
```bash
tmux list-sessions                         # View all sessions
tmux kill-session -t <name>                # Kill specific session
tmux kill-server                           # Kill all sessions (use carefully)
```

## Maintenance Checklist
1. Check `df -h /data` — keep at least 5GB free
2. Clear Bun/npm/Gradle caches
3. Remove node_modules from unused projects
4. Clear `~/.claude/debug/`
5. Archive inactive repos
6. Kill stale tmux sessions
7. Run `pkg upgrade` for security updates
