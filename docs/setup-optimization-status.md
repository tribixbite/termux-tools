# Setup Optimization Status Report

> Updated 2026-02-14 — opus-4-6

## Items 1-20: Status

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **Storage cleanup** | Done (user) | User handled to satisfaction |
| 2 | **Slim ~/git/CLAUDE.md** | Done | 257 → 27 lines. Claude-flow/SPARC removed. Archive at `docs/claude-md-archive.md` |
| 3 | **Slim ~/.claude/CLAUDE.md** | Done | 36 → 23 lines. Android build rules → `android-termux-build.md` skill |
| 4 | **Fix includeCoAuthoredBy** | Done | Set to `false` in `~/git/.claude/settings.json` — matches emdash convention |
| 5 | **Remove claudeFlow block** | Done | Removed from `~/git/.claude/settings.json`, archived |
| 6 | **Remove automation block** | Done | Removed from `~/git/.claude/settings.json`, archived |
| 7 | **Fix .bashrc duplicates** | Done | Removed duplicate `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (line 3) |
| 8 | **Disable PROFILE_STARTUP** | Done | Commented out in `.bashrc` — was adding startup latency |
| 9 | **Disable IS_COWORK** | Done | Commented out in `.bashrc` — undocumented, no effect |
| 10 | **Create bun-web-dev skill** | Done | `.claude/skills/bun-web-dev.md` — Bun+TS+Vite patterns, Termux-specific |
| 11 | **Create android-termux-build skill** | Done | `.claude/skills/android-termux-build.md` — ARM64 AAPT2, build script, ADB |
| 12 | **Create termux-screenshots skill** | Done | `.claude/skills/termux-screenshots.md` — API limits, resize, ADB capture |
| 13 | **Create termux-package-management skill** | Done | `.claude/skills/termux-package-management.md` — pacman, pkg, uv, force installs |
| 14 | **Create termux-project-scaffold skill** | Done | `.claude/skills/termux-project-scaffold.md` — TS/Bun project templates |
| 15 | **Create termux-storage-maintenance skill** | Done | `.claude/skills/termux-storage-maintenance.md` — cache cleanup, disk usage |
| 16 | **Create claude-code-internals skill** | Done | `.claude/skills/claude-code-internals.md` — env vars, binary patching, MCP |
| 17 | **Disable example-skills plugin** | Done | Set `false` in `~/.claude/settings.json` |
| 18 | **Add Playwright MCP server** | Done | Added to `~/.claude/settings.json` mcpServers |
| 19 | **Remove duplicate skills** | Done | Deleted `~/git/craftmatic/.claude/skills/x11-playwright-testing.md` |
| 20 | **Copy skills to global** | Done | 11 skills in `~/.claude/skills/` |

## Items 21-30: Status

| # | Item | Status | Notes |
|---|------|--------|-------|
| 21 | **Per-project .mcp.json files** | Done | Added to termux-tools, craftmatic, cleverkeys (swype/cleverkeys), popcorn-mobile (pop/popcorn-mobile), discord-irc |
| 22 | **Consolidate .bashrc** | Done | Collapsed 4 yt_dl10 variants (96 lines) → 1 function (15 lines). Removed duplicate opencode PATH entry |
| 23 | **Create git-workflow skill** | Done | `.claude/skills/git-workflow.md` — conventional commits, emdash signing, branch naming, PR workflow |
| 24 | **ADB cron health check** | Skipped | Per user request |
| 25 | **Remove stale env vars** | Skipped | Per user request. Secrets moved to `~/.secrets` (sourced from .bashrc) |
| 26 | **Audit tmux sessions** | Skipped | Per user request |
| 27 | **Create API-keys skill** | Done | `.claude/skills/api-keys-management.md` — ~/.secrets pattern, .env usage, leak scanning |
| 28 | **Node.js memory limit** | Done | Reduced `--max-old-space-size` from 4096 → 2048 (device has ~1.7GB free of 10GB) |
| 29 | **Git repo cleanup** | Not started | 60 repos in ~/git/ — archive inactive ones per storage-maintenance skill |
| 30 | **Hook-based screenshot resize** | Done | PreToolUse hook at `~/.claude/hooks/resize-image.sh` — auto-resizes images ≥2000px or ≥4MB before Read |

## File Changes Summary

### Created
- `docs/claude-md-archive.md` — full archive of removed CLAUDE.md content
- `.claude/skills/bun-web-dev.md`
- `.claude/skills/android-termux-build.md`
- `.claude/skills/termux-screenshots.md`
- `.claude/skills/termux-package-management.md`
- `.claude/skills/termux-project-scaffold.md`
- `.claude/skills/termux-storage-maintenance.md`
- `.claude/skills/claude-code-internals.md`
- `.claude/skills/git-workflow.md`
- `.claude/skills/api-keys-management.md`
- `.mcp.json` (termux-tools)
- `hooks/resize-image.sh`
- `~/.claude/hooks/resize-image.sh` (global hook)

### Modified
- `~/git/CLAUDE.md` — 257 → 27 lines
- `~/.claude/CLAUDE.md` — 36 → 23 lines
- `~/git/.claude/settings.json` — removed claudeFlow, automation; set includeCoAuthoredBy: false
- `~/.claude/settings.json` — disabled example-skills, added Playwright MCP, added PreToolUse hook
- `~/.bashrc` — consolidated yt_dl10, removed dups, NODE_OPTIONS 4G→2G, secrets → ~/.secrets

### .mcp.json added to
- `~/git/termux-tools/`
- `~/git/craftmatic/`
- `~/git/swype/cleverkeys/`
- `~/git/pop/popcorn-mobile/`
- `~/git/discord-irc/`

### Deleted
- `~/git/craftmatic/.claude/skills/x11-playwright-testing.md` (duplicate)

### Copied to global
- All 11 skills → `~/.claude/skills/`
