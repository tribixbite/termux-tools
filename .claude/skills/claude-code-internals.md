# Claude Code Internals Quick Reference

## Key Environment Variables

### Enabled features (set in ~/.bashrc)
```bash
CLAUDE_CODE_ENABLE_CFC=true                # Chrome browser integration
CLAUDE_CODE_USE_NATIVE_FILE_SEARCH=true    # Native file search
ENABLE_TOOL_SEARCH=true                    # Dynamic MCP tool loading
CLAUDE_CODE_FORCE_GLOBAL_CACHE=true        # Prompt cache (cost reduction)
CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true  # File versioning/rollback
ENABLE_CLAUDE_CODE_SM_COMPACT=true         # Smart compaction
ENABLE_SESSION_PERSISTENCE=true            # Session persistence
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true  # Agent teams
ENABLE_EXPERIMENTAL_MCP_CLI=true           # MCP CLI mode
CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true  # Prompt suggestions
```

### Performance-related
```bash
BASH_DEFAULT_TIMEOUT_MS=300000             # 5min default bash timeout
BASH_MAX_TIMEOUT_MS=600000                 # 10min max bash timeout
BASH_MAX_OUTPUT_LENGTH=500000              # Max bash output chars
MAX_THINKING_TOKENS=20000                  # Thinking budget
CLAUDE_CODE_MAX_OUTPUT_TOKENS=8192         # Max output tokens
MCP_TIMEOUT=60000                          # MCP connection timeout
MCP_TOOL_TIMEOUT=120000                    # MCP tool execution timeout
```

### Beta headers
```bash
ANTHROPIC_BETAS="adaptive-thinking-2026-01-28,research-preview-2026-02-01,prompt-caching-scope-2026-01-05"
```

## Binary Patching

### Methodology
Claude Code CLI is a minified JS bundle at:
`~/.claude/local/lib/node_modules/@anthropic-ai/claude-code/cli.js`

Feature gates use GrowthBook patterns:
- `y8("gate_name",!1)` — value-based gate, default false
- `sY("gate_name")` — boolean gate check
- `Rp("gate_name",default)` — config/value gate

### Patching command pattern
```bash
CLI=~/.claude/local/lib/node_modules/@anthropic-ai/claude-code/cli.js
# Flip a gate from false to true:
sed -i 's/y8("gate_name",!1)/y8("gate_name",!0)/g' "$CLI"
```

### Applied patches (known working)
```bash
# Auto-memory (tengu_oboe)
sed -i 's/y8("tengu_oboe",!1)/y8("tengu_oboe",!0)/g' "$CLI"

# Past session context (tengu_coral_fern)
sed -i 's/y8("tengu_coral_fern",!1)/y8("tengu_coral_fern",!0)/g' "$CLI"

# Extended thinking (tengu_thinkback) — uses isEnabled pattern
sed -i 's/isEnabled("tengu_thinkback")/true/g' "$CLI"
```

### Patchable gates (14)
| Gate | Function | Description |
|------|----------|-------------|
| tengu_oboe | y8 | Auto-memory |
| tengu_coral_fern | y8 | Past session context |
| tengu_thinkback | sY | Extended thinking |
| tengu_haiku_thinking | y8 | Haiku model thinking |
| tengu_compact_with_model | y8 | Model-based compaction |
| tengu_midturn_compact | y8 | Mid-turn compaction |
| tengu_agentic_compact | y8 | Agentic compaction |
| tengu_caching_scope | Rp | Caching scope control |
| tengu_context_capping | y8 | Context capping |
| tengu_adaptive_thinking | y8 | Adaptive thinking |
| tengu_projects | y8 | Projects feature |
| tengu_team_agents | y8 | Team agents |
| tengu_plan_mode | y8 | Plan mode |
| tengu_todo | y8 | Todo system |

### Server-dependent gates (do NOT patch)
These require server-side support and will error if enabled client-only:
`tengu_research`, `tengu_mcp_connector`, `tengu_artifacts`, `tengu_citations`, `tengu_web_search_provider`, `tengu_memory_v2`

## MCP Server Config

### Global config: `~/.claude/settings.json`
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-playwright"]
    }
  }
}
```

### Per-project config: `.mcp.json` in project root
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

## Plugin Management
In `~/.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "context7@claude-plugins-official": true,
    "claude-md-management@claude-plugins-official": true
  }
}
```

## Full Reference
See `~/git/termux-tools/claude-code-internals-v2.1.37.md` for the complete document with detailed analysis.
