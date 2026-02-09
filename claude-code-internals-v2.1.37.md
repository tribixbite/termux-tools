# Claude Code CLI v2.1.37 — Internal Features, Codenames & Hidden Configuration

> Binary analysis of `@anthropic-ai/claude-code@2.1.37`
> Built: 2026-02-07T18:38:23Z | Analyzed: 2026-02-09
> Internal CLI ID: `claude-cli-external-build-2137`

---

## Project Codename: TENGU

The internal codename for Claude Code is **Tengu**. All telemetry events (400+) are prefixed `tengu_`. Feature gates, A/B experiments, and analytics all use this namespace.

---

## Feature Gate System

Gates are controlled via **GrowthBook** (remote A/B testing framework):
- API host: `https://api.anthropic.com/`
- Cached locally in `cachedGrowthBookFeatures` in user settings (`~/.claude/settings.json`)
- Refreshed every 6 hours
- User attributes: `deviceId`, `sessionId`, `platform`, `organizationUUID`, `accountUUID`, `subscriptionType`, `rateLimitTier`, `firstTokenTime`, `email`, `appVersion`

### How to Override Feature Gates Locally

Feature gate values are cached in `~/.claude/settings.json` under `cachedGrowthBookFeatures`. You can:

1. **Edit the cache directly** — modify `~/.claude/settings.json` and set the feature value
2. **Use environment variables** — many gates have corresponding `ENABLE_*` / `DISABLE_*` env vars
3. **Use `ANTHROPIC_BETAS`** — comma-separated beta header strings to enable API-side features

```bash
# Example: enable session memory + SM compact
export ENABLE_CLAUDE_CODE_SM_COMPACT=true

# Example: enable agent teams
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true

# Example: force tool search on
export ENABLE_TOOL_SEARCH=true

# Example: enable startup profiling
export CLAUDE_CODE_PROFILE_STARTUP=1

# Example: set custom betas
export ANTHROPIC_BETAS="adaptive-thinking-2026-01-28,research-preview-2026-02-01"
```

---

## Feature Gates — Complete Reference

### Remote Feature Flags (`y8()` — value-based)

| Gate Codename | Default | Feature | How to Enable |
|---|---|---|---|
| `tengu_amber_flint` | `true` | **Agent Teams** — multi-agent team coordination | Also requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true` |
| `tengu_cache_plum_violet` | `false` | Disables **microcompact** (tool result compaction) | Set to `true` in settings cache |
| `tengu_chomp_inflection` | ? | Internal optimization | Server-side only |
| `tengu_chrome_auto_enable` | ? | Auto-enable **Claude in Chrome** integration | `--chrome` CLI flag |
| `tengu_code_diff_cli` | ? | Code diff display in CLI | Server-side only |
| `tengu_compact_cache_prefix` | ? | Prompt cache optimization during compaction | Server-side only |
| `tengu_compact_streaming_retry` | ? | Retry logic for compact streaming | Server-side only |
| `tengu_copper_lantern` | `false` | **Extra usage promo** — "$50 free" for Pro/Max users | Server-side only |
| `tengu_coral_fern` | ? | Unknown | Server-side only |
| `tengu_cork_m4q` | ? | Unknown | Server-side only |
| `tengu_file_write_optimization` | ? | File write optimizations | Server-side only |
| `tengu_keybinding_customization_release` | ? | Custom keybinding support | Server-side only |
| `tengu_kv7_prompt_sort` | ? | Prompt sorting optimization | Server-side only |
| `tengu_marble_anvil` | `false` | **Adaptive Thinking / Clear Thinking** — `clear_thinking_20251015` with `keep:"all"` | `ANTHROPIC_BETAS=adaptive-thinking-2026-01-28` |
| `tengu_marble_kite` | ? | Unknown | Server-side only |
| `tengu_marble_lantern_disabled` | ? | Unknown (disables something) | Server-side only |
| `tengu_mcp_tool_search` | `true` | **Tool Search for MCP** — dynamic tool loading for MCP tools | `ENABLE_TOOL_SEARCH=true` |
| `tengu_oboe` | ? | Unknown | Server-side only |
| `tengu_penguin_mode_promo` | `{discountPercent:50, endDate:"Feb 16"}` | **Fast Mode promo pricing** — 50% discount | Server-side only |
| `tengu_penguins_enabled` | `true` | **Fast Mode (Penguin Mode)** — streaming Opus 4.6 | `/fast` command to toggle |
| `tengu_penguins_off` | `null` | **Fast Mode kill switch** — reason string when disabled | Server-side only |
| `tengu_permission_explainer` | ? | Permission request explanation | Server-side only |
| `tengu_pid_based_version_locking` | ? | PID-based version locking (auto-updater) | Server-side only |
| `tengu_plan_mode_interview_phase` | ? | Plan mode interview phase | `CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE` |
| `tengu_plum_vx3` | ? | Unknown | Server-side only |
| `tengu_pr_status_cli` | ? | PR status display in CLI | Server-side only |
| `tengu_quartz_lantern` | ? | Unknown | Server-side only |
| `tengu_quiet_fern` | `false` | Unknown — also sent to VS Code extension | Server-side only |
| `tengu_remote_backend` | ? | **Teleport / Remote sessions** backend | `CLAUDE_CODE_REMOTE=true` |
| `tengu_scarf_coffee` | ? | Unknown | Server-side only |
| `tengu_session_memory` | `false` | **Session Memory** — persistence across compactions | `ENABLE_CLAUDE_CODE_SM_COMPACT=true` |
| `tengu_silver_lantern` | `false` | **Opus 4.6 launch banner** in feed | Server-side only |
| `tengu_sm_compact` | `false` | **Session Memory Compaction** — auto-compact with memory | `ENABLE_CLAUDE_CODE_SM_COMPACT=true` |
| `tengu_system_prompt_global_cache` | `false` | **Global system prompt caching** (`cacheScope:"global"`) | `CLAUDE_CODE_FORCE_GLOBAL_CACHE=true` |
| `tengu_tool_search_unsupported_models` | `["haiku"]` | Models excluded from tool search | Server-side only |
| `tengu_tst_kx7` | `false` | **Tool search experiment** — enables below threshold | Server-side only |
| `tengu_tst_names_in_messages` | ? | Tool names in messages | Server-side only |
| `tengu_vinteuil_phrase` | ? | Unknown | Server-side only |
| `tengu_workout2` | ? | Unknown | Server-side only |
| `tengu_attribution_header` | ? | Attribution header | Server-side only |

### Boolean Gates (`sY()` — on/off)

| Gate Name | Feature | How to Enable |
|---|---|---|
| `tengu_c4w_usage_limit_notifications_enabled` | Usage limit notifications | Server-side only |
| `tengu_disable_bypass_permissions_mode` | Blocks `--dangerously-skip-permissions` | Server-side only |
| `tengu_scratch` | Unknown experimental | Server-side only |
| `tengu_streaming_tool_execution2` | **Streaming tool execution v2** — run tools while streaming | Server-side only |
| `tengu_thinkback` | **ThinkBack** — 2025 Year in Review | Enables `/think-back` command |
| `tengu_tool_pear` | **Strict tool schema** — `strict: true` on tool defs | Server-side only |
| `tengu_vscode_onboarding` | VS Code onboarding flow | Server-side only |
| `tengu_vscode_review_upsell` | VS Code review upsell | Server-side only |

### Dynamic Configs (`Rp()` — structured values)

| Config Name | Default | Purpose |
|---|---|---|
| `tengu_copper_lantern_config` | `{meridian: "2026-02-05T07:59:00Z"}` | Promo eligibility cutoff |
| `tengu_sm_config` | `{}` | Session memory config: `minTokens`, `minTextBlockMessages`, `maxTokens` |
| `tengu_1p_event_batch_config` | ? | First-party event batching |

---

## Hidden Slash Commands

These commands exist but are not shown in `/help`:

| Command | Description | Gate |
|---|---|---|
| `/output-style` | Set output style (verbose, concise, etc.) | None |
| `/rate-limit-options` | Options when rate-limited | None |
| `/remote-env` | Configure default remote environment for Teleport | None |
| `/security-review` | Security review of pending changes | None |
| `/tag` | Toggle searchable tag on current session | None |
| `/think-back` | 2025 Claude Code Year in Review | `tengu_thinkback` |
| `/thinkback-play` | Play thinkback animation | `tengu_thinkback` |
| `/upgrade` | Upgrade to Max plan | None |
| `/vim` | Toggle Vim/Normal editing modes | None |

---

## Major Hidden Features — Deep Dive

### 1. Fast Mode (Codename: "Penguins")

| Property | Value |
|---|---|
| Internal name | Penguin Mode |
| Master gate | `tengu_penguins_enabled` (default: `true`) |
| Kill switch | `tengu_penguins_off` (null = active) |
| API endpoint | `/api/claude_code_penguin_mode` |
| Promo config | `tengu_penguin_mode_promo` — 50% discount until Feb 16 |
| Requirements | First-party API, Opus 4.6 model, native binary |
| Toggle | `/fast` command |

### 2. Agent Teams (Codename: "Amber Flint")

| Property | Value |
|---|---|
| Gate | `tengu_amber_flint` (default: `true`) |
| Env var | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true` |
| Both required | Yes — gate AND env var must be enabled |
| Team env vars | `CLAUDE_CODE_TEAM_NAME`, `CLAUDE_CODE_AGENT_NAME`, `CLAUDE_CODE_TEAMMATE_COMMAND`, `CLAUDE_CODE_TASK_LIST_ID` |

```bash
# Enable agent teams
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true
```

### 3. Session Memory

| Property | Value |
|---|---|
| Memory gate | `tengu_session_memory` (default: `false`) |
| Compact gate | `tengu_sm_compact` (default: `false`) |
| Env enable | `ENABLE_CLAUDE_CODE_SM_COMPACT=true` |
| Env disable | `DISABLE_CLAUDE_CODE_SM_COMPACT=true` |
| Config | `tengu_sm_config` — `{minTokens, minTextBlockMessages, maxTokens}` |

```bash
# Enable session memory with compaction
export ENABLE_CLAUDE_CODE_SM_COMPACT=true
```

### 4. Teleport / Remote Sessions

| Property | Value |
|---|---|
| Gate | `tengu_remote_backend` |
| Hidden command | `/remote-env` |
| Env vars | `CLAUDE_CODE_REMOTE`, `CLAUDE_CODE_REMOTE_SESSION_ID`, `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`, `CLAUDE_CODE_CONTAINER_ID` |
| Telemetry | `tengu_teleport_*` events |

### 5. Adaptive Thinking / Clear Thinking

| Property | Value |
|---|---|
| Gate | `tengu_marble_anvil` (default: `false`) |
| Beta header | `adaptive-thinking-2026-01-28` |
| Behavior | Enables `clear_thinking_20251015` edits with `keep:"all"` |

```bash
export ANTHROPIC_BETAS="adaptive-thinking-2026-01-28"
```

### 6. Chrome Integration

| Property | Value |
|---|---|
| Gate | `tengu_chrome_auto_enable` |
| CLI flags | `--chrome`, `--no-chrome`, `--chrome-native-host`, `--claude-in-chrome-mcp` |
| Tool name | `claude-in-chrome` |

```bash
claude --chrome
```

### 7. Cowork Mode

| Property | Value |
|---|---|
| CLI flag | `--cowork` |
| Env vars | `CLAUDE_CODE_IS_COWORK`, `CLAUDE_CODE_USE_COWORK_PLUGINS` |

### 8. Plan Mode V2

| Property | Value |
|---|---|
| Agent count | `CLAUDE_CODE_PLAN_V2_AGENT_COUNT` |
| Explore agents | `CLAUDE_CODE_PLAN_V2_EXPLORE_AGENT_COUNT` |
| Interview phase | `CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE` |
| Required mode | `CLAUDE_CODE_PLAN_MODE_REQUIRED` / `--plan-mode-required` |

### 9. ULTRACLAUDE.md

| Property | Value |
|---|---|
| Path | `~/.claude/ULTRACLAUDE.md` |
| Internal ref | `ExperimentalUltraClaudeMd` |
| Current status | Maps to same path as User CLAUDE.md — placeholder for future use |

### 10. Tool Search (TST)

| Property | Value |
|---|---|
| Gate | `tengu_mcp_tool_search` (default: `true`) |
| Experiment | `tengu_tst_kx7` — force-enable below threshold |
| Env | `ENABLE_TOOL_SEARCH` — values: `true`, `false`, `auto`, `auto:N` (0-100%) |
| Beta | `tool-search-tool-2025-10-19` |
| Unsupported | `["haiku"]` — models that lack tool_reference support |

---

## API Beta Headers — Complete List

Pass via `ANTHROPIC_BETAS` env var (comma-separated) or `anthropic-beta` HTTP header:

| Beta String | Feature | Status |
|---|---|---|
| `adaptive-thinking-2026-01-28` | Adaptive/clear thinking | Active |
| `advanced-tool-use-2025-11-20` | Advanced tool use | Active |
| `context-1m-2025-08-07` | 1M token context window | Active |
| `context-management-2025-06-27` | Context management | Active |
| `effort-2025-11-24` | Effort level control | Active |
| `files-api-2025-04-14` | Files API | Active |
| `fine-grained-tool-streaming-2025-05-14` | Fine-grained tool streaming | Active |
| `interleaved-thinking-2025-05-14` | Interleaved thinking | Active |
| `mcp-servers-2025-12-04` | MCP server support | Active |
| `prompt-caching-scope-2026-01-05` | Global prompt cache scope | Active |
| `research-preview-2026-02-01` | **Research preview** | New |
| `skills-2025-10-02` | Skills support | Active |
| `structured-outputs-2025-12-15` | Structured outputs | Active |
| `token-counting-2024-11-01` | Token counting | Active |
| `tool-examples-2025-10-29` | Tool examples | Active |
| `tool-search-tool-2025-10-19` | Tool search | Active |
| `web-search-2025-03-05` | Web search | Active |
| `oauth-2025-04-20` | OAuth | Active |

---

## Environment Variables — Complete Reference

### Core

| Variable | Purpose |
|---|---|
| `CLAUDE_API_KEY` | API key |
| `CLAUDE_CONFIG_DIR` | Config directory override |
| `CLAUDE_PROJECT_DIR` | Project directory override |
| `CLAUDE_DEBUG` | Debug mode |
| `CLAUDE_TMPDIR` / `CLAUDE_CODE_TMPDIR` | Temp directory |
| `CLAUDE_ENV_FILE` | Environment file path |
| `CLAUDE_PLUGIN_ROOT` | Plugin root directory |
| `CLAUDE_REPL_MODE` | REPL mode |
| `CLAUDE_SESSION_ID` | Session ID override |

### Model

| Variable | Purpose |
|---|---|
| `ANTHROPIC_MODEL` | Model override |
| `ANTHROPIC_SMALL_FAST_MODEL` | Small/fast model name |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Default haiku override |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Default sonnet override |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Default opus override |
| `CLAUDE_CODE_EFFORT_LEVEL` | Effort level |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Subagent model |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Max output tokens |
| `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` | Max file read tokens |

### API / Network

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Primary API key |
| `ANTHROPIC_AUTH_TOKEN` | Auth token |
| `ANTHROPIC_BASE_URL` | Base URL override |
| `ANTHROPIC_BETAS` | Beta features (comma-separated) |
| `ANTHROPIC_CUSTOM_HEADERS` | Custom API headers |
| `ANTHROPIC_LOG` | API logging |
| `CLAUDE_CODE_API_BASE_URL` | Custom API base URL |
| `CLAUDE_CODE_EXTRA_BODY` | Extra body params |
| `CLAUDE_CODE_MAX_RETRIES` | Max API retries |
| `CLAUDE_CODE_SSE_PORT` | SSE port |
| `CLAUDE_CODE_CLIENT_CERT` | Client certificate |
| `CLAUDE_CODE_CLIENT_KEY` | Client key |
| `CLAUDE_CODE_HOST_HTTP_PROXY_PORT` | HTTP proxy port |
| `CLAUDE_CODE_HOST_SOCKS_PROXY_PORT` | SOCKS proxy port |

### Auth / OAuth

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_OAUTH_CLIENT_ID` | OAuth client ID |
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token |
| `CLAUDE_CODE_CUSTOM_OAUTH_URL` | Custom OAuth URL |
| `CLAUDE_CODE_SESSION_ACCESS_TOKEN` | Session access token |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | Skip Bedrock auth |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH` | Skip Vertex auth |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` | Skip Foundry auth |

### Providers

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_USE_BEDROCK` | Use AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX` | Use Google Vertex |
| `CLAUDE_CODE_USE_FOUNDRY` | Use Anthropic Foundry |
| `ANTHROPIC_BEDROCK_BASE_URL` | Bedrock base URL |
| `ANTHROPIC_VERTEX_BASE_URL` | Vertex base URL |
| `ANTHROPIC_VERTEX_PROJECT_ID` | Vertex project ID |
| `ANTHROPIC_FOUNDRY_API_KEY` | Foundry API key |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Foundry base URL |

### Feature Enables

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Agent teams |
| `CLAUDE_CODE_ENABLE_TASKS` / `ENABLE_TASKS` | Background tasks |
| `CLAUDE_CODE_ENABLE_CFC` / `ENABLE_CFC` | Unknown (CFC) |
| `ENABLE_TOOL_SEARCH` | Tool search (`true`/`false`/`auto`/`auto:N`) |
| `ENABLE_MCP_CLI` / `ENABLE_EXPERIMENTAL_MCP_CLI` | MCP CLI mode |
| `ENABLE_MCP_CLI_ENDPOINT` | MCP CLI endpoint |
| `ENABLE_MCP_LARGE_OUTPUT_FILES` | Large MCP outputs |
| `ENABLE_CLAUDEAI_MCP_SERVERS` | Claude.ai MCP servers |
| `ENABLE_CLAUDE_CODE_SM_COMPACT` | Session memory compact |
| `ENABLE_SESSION_PERSISTENCE` | Session persistence |
| `ENABLE_AUTO_PIN` | Auto-pinning |
| `ENABLE_BETA_TRACING_DETAILED` | Detailed beta tracing |
| `ENABLE_DELEGATE_ACCESS_RIGHTS` | Delegate access rights |
| `ENABLE_OUTLIER_DETECTION` | Outlier detection |
| `ENABLE_PROMPT_SUGGESTION` | Prompt suggestions |
| `ENABLE_SDK_FILE_CHECKPOINTING` | SDK file checkpointing |
| `USE_API_CONTEXT_MANAGEMENT` | API context management |
| `USE_BUILTIN_RIPGREP` | System ripgrep |
| `FORCE_AUTOUPDATE_PLUGINS` | Force plugin updates |

### Feature Disables

| Variable | Purpose |
|---|---|
| `DISABLE_AUTOUPDATER` | Auto-updater |
| `DISABLE_AUTO_COMPACT` | Auto-compaction |
| `DISABLE_AUTO_MEMORY` | Auto-memory |
| `DISABLE_COMPACT` | All compaction |
| `DISABLE_MICROCOMPACT` | Microcompact only |
| `DISABLE_INTERLEAVED_THINKING` | Interleaved thinking |
| `DISABLE_PROMPT_CACHING` | All prompt caching |
| `DISABLE_PROMPT_CACHING_HAIKU` | Haiku prompt cache |
| `DISABLE_PROMPT_CACHING_OPUS` | Opus prompt cache |
| `DISABLE_PROMPT_CACHING_SONNET` | Sonnet prompt cache |
| `DISABLE_TELEMETRY` / `DISABLE_ERROR_REPORTING` | Telemetry |
| `DISABLE_BUILTIN_AGENTS` | Built-in agents |
| `DISABLE_PLUGIN_AUTOLOAD` | Plugin auto-load |
| `DISABLE_PAGE_SKIPPING` | Page skipping |
| `DISABLE_FEEDBACK_SURVEY` | Surveys |
| `DISABLE_COST_WARNINGS` | Cost warnings |
| `DISABLE_BUG_COMMAND` | `/bug` command |
| `DISABLE_DOCTOR_COMMAND` | `/doctor` command |
| `DISABLE_FEEDBACK_COMMAND` | `/feedback` command |
| `DISABLE_BACKGROUND_TASKS` | Background tasks |

### Shell / Sandbox

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_SHELL` | Custom shell |
| `CLAUDE_CODE_SHELL_PREFIX` | Shell prefix command |
| `CLAUDE_CODE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | Maintain working dir |
| `CLAUDE_CODE_BASH_NO_LOGIN` | No login shell |
| `CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR` | Show sandbox indicator |
| `CLAUDE_CODE_BUBBLEWRAP` | Bubblewrap sandbox |

### IDE

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_AUTO_CONNECT_IDE` | Auto-connect IDE |
| `CLAUDE_CODE_IDE_HOST_OVERRIDE` | IDE host override |
| `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL` | Skip auto-install |

### Profiling / Debug

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_PROFILE_STARTUP` | Startup profiling (set to `1`) |
| `CLAUDE_CODE_PROFILE_QUERY` | Query profiling |
| `CLAUDE_CODE_PERFETTO_TRACE` | Perfetto trace file |
| `CLAUDE_CODE_DEBUG_LOGS_DIR` | Debug logs dir |
| `CLAUDE_CODE_DIAGNOSTICS_FILE` | Diagnostics file |

### Tuning

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE` | Override auto-compact % threshold |
| `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` | Override blocking context limit |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | Max concurrent tool use |
| `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS` | Glob timeout |
| `CLAUDE_CODE_GLOB_HIDDEN` | Include hidden files in glob |
| `CLAUDE_CODE_GLOB_NO_IGNORE` | Don't respect gitignore |
| `MCP_TOOL_TIMEOUT` | MCP tool timeout (ms) |

### Misc

| Variable | Purpose |
|---|---|
| `CLAUDE_CODE_FORCE_FULL_LOGO` | Force full logo display |
| `CLAUDE_CODE_SYNTAX_HIGHLIGHT` | Syntax highlighting |
| `CLAUDE_CODE_TAGS` | Session tags |
| `CLAUDE_CODE_ACCESSIBILITY` | Accessibility mode |
| `CLAUDE_CODE_TMUX_PREFIX` | Tmux prefix |
| `CLAUDE_CODE_TMUX_SESSION` | Tmux session |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | Extra CLAUDE.md dirs |

---

## Model IDs — Complete List

| Short Name | Full ID | Version |
|---|---|---|
| Opus 4.6 | `claude-opus-4-6` / `claude-opus-4-6-v1` | Current default |
| Opus 4.5 | `claude-opus-4-5-20251101` | Previous |
| Opus 4.1 | `claude-opus-4-1-20250805` | Previous |
| Opus 4.0 | `claude-opus-4-20250514` | Previous |
| Sonnet 4.5 | `claude-sonnet-4-5-20250929` | Current |
| Sonnet 4.0 | `claude-sonnet-4-20250514` | Previous |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | Current |
| Sonnet 3.7 | `claude-3-7-sonnet-20250219` | Legacy |
| Sonnet 3.5 | `claude-3-5-sonnet-20241022` | Legacy |
| Haiku 3.5 | `claude-3-5-haiku-20241022` | Legacy |
| Opus 3 | `claude-3-opus-20240229` | Legacy |

---

## Permission Modes

| Mode | Behavior |
|---|---|
| `default` | Prompts for dangerous operations |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | Skip all checks (requires `--dangerously-skip-permissions`) |
| `plan` | Planning only, no tool execution |
| `delegate` | Leader restricted to Teammate + Task tools only |
| `dontAsk` | Deny if not pre-approved, never prompt |

---

## Themes

| Theme | Description |
|---|---|
| `dark` | Default dark |
| `light` | Light mode |
| `dark-daltonized` | Colorblind-friendly dark |
| `light-daltonized` | Colorblind-friendly light |
| `dark-ansi` | ANSI colors only (dark) |
| `light-ansi` | ANSI colors only (light) |

---

## Notification Channels

`auto` (default), `iterm2` (OSC 9), `terminal_bell`, `kitty` (OSC 99), `ghostty` (OSC 777), `iterm2_with_bell`, `notifications_disabled`

---

## Hook Event Types (15)

`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`, `Setup`, `TeammateIdle`, `TaskCompleted`

---

## Update Channels

- `latest` (default)
- `stable` (opt-in)

---

## Quick-Start: Enable Everything

```bash
# ~/.bashrc or ~/.zshrc — add these to enable hidden features

# Agent Teams
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true

# Session Memory with Compaction
export ENABLE_CLAUDE_CODE_SM_COMPACT=true

# Force Tool Search
export ENABLE_TOOL_SEARCH=true

# Startup Profiling (writes to ~/.claude/startup-perf/)
export CLAUDE_CODE_PROFILE_STARTUP=1

# Debug Logging
export CLAUDE_CODE_DEBUG_LOGS_DIR="$HOME/.claude/debug-logs"

# Custom Model Defaults
# export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-6"
# export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-5-20250929"

# Enable All Betas
export ANTHROPIC_BETAS="adaptive-thinking-2026-01-28,research-preview-2026-02-01,context-1m-2025-08-07,files-api-2025-04-14"

# Disable Telemetry (optional)
# export DISABLE_TELEMETRY=true

# Performance Tuning
# export CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=8
# export CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE=80
# export CLAUDE_CODE_GLOB_TIMEOUT_SECONDS=30
```

---

*Analysis performed on the bundled cli.js (561KB) from `@anthropic-ai/claude-code@2.1.37` installed via bun.*
