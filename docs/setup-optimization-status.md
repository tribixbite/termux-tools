# Setup Optimization Status Report

> Updated 2026-02-13 — opus-4-6

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
| 20 | **Copy skills to global** | Done | 9 skills in `~/.claude/skills/` (7 new + termux-pdf + x11-playwright) |

## Items 21+: New Suggestions

| # | Item | Priority | Description |
|---|------|----------|-------------|
| 21 | **Per-project .mcp.json files** | Medium | Add `.mcp.json` to active web projects (craftmatic, etc.) with project-specific MCP servers (filesystem, custom tools) |
| 22 | **Consolidate .bashrc** | Medium | `.bashrc` is 290 lines with duplicate function definitions (`yt_dl10` appears 2x, `y3t-dl10`/`y33t-dl10` are variants). Move functions to `~/.bash_functions` or `~/bin/` scripts |
| 23 | **Create git-workflow skill** | Low | Conventional commits, branch naming, PR templates, rebase patterns — standardize across projects |
| 24 | **ADB cron health check** | Low | The auto-reconnect cron could log connection status to `/tmp/adb-health.log` for debugging stale connections |
| 25 | **Remove stale env vars** | Low | `.bashrc` has `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `CIRCUP_WEBWORKFLOW_PASSWORD`, ORE mining wallet config — review if still needed |
| 26 | **Audit tmux sessions** | Low | 9 sessions found during audit. Kill unused ones to free memory (see `tmux list-sessions`) |
| 27 | **Create API-keys skill** | Low | Skill for managing API keys safely — where to store, how to rotate, `.env` patterns, `--env-file` usage |
| 28 | **Node.js memory limit** | Info | `.bashrc` sets `NODE_OPTIONS="--max-old-space-size=4096"` — verify this is appropriate for available RAM |
| 29 | **Git repo cleanup** | Low | 60 repos in `~/git/` — many likely inactive. Archive unused ones to shared storage per storage-maintenance skill |
| 30 | **Hook-based screenshot resize** | Medium | Create a Claude Code hook that auto-resizes screenshots when the Read tool targets image files — prevents the "image too large" errors permanently |

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

### Modified
- `~/git/CLAUDE.md` — 257 → 27 lines
- `~/.claude/CLAUDE.md` — 36 → 23 lines
- `~/git/.claude/settings.json` — removed claudeFlow, automation; set includeCoAuthoredBy: false
- `~/.claude/settings.json` — disabled example-skills, added Playwright MCP
- `~/.bashrc` — removed duplicate env var, disabled PROFILE_STARTUP and IS_COWORK

### Deleted
- `~/git/craftmatic/.claude/skills/x11-playwright-testing.md` (duplicate)

### Copied to global
- All 9 skills → `~/.claude/skills/`
