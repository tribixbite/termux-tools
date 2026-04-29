# Claude Code System Prompt — Analysis & Patch Rationale

Snapshot date: 2026-04-29. Based on Claude Code v2.1.112 bundled JS.

The Claude Code system prompt is **not a single string** — it's runtime-assembled by the `j0(messages, modelMeta, opts)` function from a header literal plus a sequence of `XT(name, generator)` dynamic sections plus several static body builders (`P6A`, `W6A`, `D6A`, `Z6A`, `f6A`, `V6A`). When `process.env.CLAUDE_CODE_SIMPLE` is set, only a 2-line stub is sent.

```
Tb1 ("You are Claude Code, Anthropic's official CLI for Claude.")
+ XT("anti_verbosity")            ← brevity rules
+ XT("thinking_guidance")         ← thinking budget hints
+ XT("session_guidance")          ← prior-session pointer
+ XT("memory")                    ← auto-memory dir + types
+ XT("ant_model_override")        ← ANTHROPIC_MODEL handling
+ XT("env_info_simple")           ← cwd / git / OS / model lines
+ XT("language")                  ← non-English locale handling
+ XT("output_style")              ← /output-style switcher
+ XT("bg-session")                ← background-session note
+ XT("scratchpad")                ← scratchpad usage
+ XT("frc")                       ← agent-collab guidance
+ XT("summarize_tool_results")    ← when to summarize
+ XT("numeric_length_anchors")    ← "≤25 words / ≤100 words" caps
+ XT("brief")                     ← terse-mode toggle
+ XT("focus_mode")                ← /focus toggle
+ P6A(O)                          ← output-style prefix
+ W6A()                           ← main "what you do" body
+ (keepCodingInstructions ? D6A() : null)   ← coding standards bullets
+ Z6A()                           ← "Doing tasks" header + tone bullets
+ f6A(toolNames)                  ← tool descriptions inline
+ V6A()                           ← git workflow + PR creation steps
+ ...Zk6() ? [F16] : []           ← legacy section (rare)
+ ...H                            ← the assembled XT sections
```

## What's worth patching for our setup

We patch in three categories. **Compatibility** patches are mandatory for Termux to function; **alignment** patches resolve direct conflicts with our `~/.claude/CLAUDE.md`; **comfort** patches relax instruction caps that don't materially affect quality.

### Compatibility (mandatory)

| Patch | Phrase / pattern | Why |
|---|---|---|
| 1 | `[...MB,"inherit"]` → `[...(MB||[]),"inherit"]` | v2.1.56 only — fixed upstream by 2.1.112. No-op now. |
| 2 | `` `/tmp/claude-mcp-browser-bridge-` `` → `` `${z2()}/claude-mcp-browser-bridge-` `` | `/tmp/` doesn't exist on Termux; `z2()` is Anthropic's smart-tmpdir helper. |

### Alignment (default-on, opt-out via env)

| Patch | Phrase | Default | Opt-out env | Reason |
|---|---|---|---|---|
| 3 | `- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive` | strip | `CCPATCH_KEEP_NO_COMMIT=1` | Direct conflict: our CLAUDE.md says "after every round of work, make a conventional commit". |
| 4 | `"Default to writing no comments. Only add one when the WHY is non-obvious: …"` | strip | `CCPATCH_KEEP_NO_COMMENTS=1` | Direct conflict: our CLAUDE.md says "use properly typed DRY production level code with explanatory comments" + "write a # TODO comment for unfinished or flagged for fix/refactor items". |

### Comfort (default-on, opt-out)

| Patch | Phrase | Change | Opt-out env |
|---|---|---|---|
| 5 | `Length limits: keep text between tool calls to ≤25 words. Keep final responses to ≤100 words` | `≤60 words` / `≤250 words` | `CCPATCH_KEEP_TIGHT_LENGTH=1` |

The 25-word inter-tool cap forces the model to truncate state explanations during multi-step builds; 60 words is enough for a sentence with a number and a path. The 100-word final-response cap clips medium answers; 250 is closer to "a useful paragraph" without inviting wall-of-text.

## Phrases worth flagging upstream (generic feedback)

Items I would push back on if I were reviewing Anthropic's prompt in a code review. None blocks usage; all add either friction or correctness risk for power users.

### 1. The 25/100-word length anchors are too aggressive
Located in `XT("numeric_length_anchors", () => "Length limits: keep text between tool calls to ≤25 words. Keep final responses to ≤100 words unless the task requires more detail.")`. The 25-word inter-tool cap fights against the "give short updates at key moments" rule three sections later — between-tool updates that include a finding, a path, a number, and a decision routinely exceed 25 words even when written terse. **Suggested fix**: bump to 50/200 OR remove the numeric anchor entirely (the qualitative "be terse" instructions elsewhere already cover it).

### 2. "Default to writing no comments" actively undermines users with explicit comment policies
Many real codebases require comments (regulated industries, libraries with public APIs, projects with junior engineers, projects with strong CLAUDE.md preferences for explanatory comments). The current phrasing — `"Default to writing no comments. Only add one when the WHY is non-obvious"` — creates persistent friction the user must fight via repeated CLAUDE.md instructions. **Suggested fix**: replace with `"Match the surrounding code's comment density and the project's documented style. If neither is established, prefer comments that explain WHY rather than WHAT."`

### 3. "NEVER commit changes unless explicitly asked" creates a CLAUDE.md priority footgun
Per the `using-superpowers` skill's stated priority order (user CLAUDE.md > skills > system prompt), a CLAUDE.md that says "commit after every round of work" overrides this. But the agent — having read the system prompt first — defaults to NOT committing and often forgets the override. **Suggested fix**: weaken to "Default to not committing; commit only when (a) the user explicitly asks, OR (b) a project's CLAUDE.md mandates it as workflow."

### 4. Implicit assumption that tools support a host filesystem
References like "Stop hooks, custom system prompts, etc." and "Status line" assume CLI/desktop. On Termux/Android, `/tmp/` doesn't exist, paths are non-standard (`$PREFIX/tmp/`), and several behaviors fail silently. **Suggested fix**: emit `os.tmpdir()` everywhere instead of literals; the `z2()` helper Anthropic ships is the right pattern but it's not used in the chrome-bridge socket location until v2.1.112+.

### 5. Repeated tone instructions across sections
"Tone and style", "Text output", "Doing tasks", and the per-task brevity hints all ask for "short responses". This compounds: a user gets a one-line answer to a question that warrants a paragraph. **Suggested fix**: consolidate into one tone section; let dynamic sections like `numeric_length_anchors` adjust per-context.

### 6. Tool advice goes stale fast
The prompt names specific tools (`TaskCreate` in some refs, `TodoWrite` in others — the v2.1.112 bundle still mentions `TodoWrite` in older sections after `TaskCreate` was introduced). Inconsistent naming makes debugging harder. **Suggested fix**: dynamic interpolation of canonical tool names from the registry rather than hardcoded strings.

### 7. "Don't add features … bug fix doesn't need surrounding cleanup"
Reasonable default but bad fit for any CLAUDE.md that asks for refactors-during-fixes. The `D6A()` array of D-prescriptions ("Don't…") is rigid; CLAUDE.md is the right place for the user to override and the prompt should make that clearer. **Suggested fix**: prefix `D6A()`'s contents with `"Default behaviors (override via CLAUDE.md if your project has different conventions):"`

## Synergy with our `~/.claude/CLAUDE.md`

| CLAUDE.md directive | Default system-prompt position | Conflict? | Resolved by |
|---|---|---|---|
| commit after every round of work | NEVER commit unless asked | Hard conflict | Patch 3 strips the negative |
| use explanatory comments | Default to no comments | Hard conflict | Patch 4 strips the negative |
| use properly typed DRY production code | "Don't add features beyond task" + "no half-finished" | Compatible | No patch needed |
| do everything to ACTUALLY RUN AND TEST code | Several pro-test bullets | Aligned | No patch needed |
| use ts over js, kotlin over java | Not in default prompt | Compatible | No patch needed |
| default to slick modern dark mode UI | Not in default prompt | Compatible | No patch needed |
| NEVER post comments on external platforms without approval | Not in default prompt | Compatible | No patch needed |
| NEVER `git reset/revert/discard/rewrite/force` without permission | "Carefully consider reversibility" + "destructive operations require user confirmation" | Aligned | No patch needed |
| NEVER push a release without permission | "Hard-to-reverse operations… check with user" | Aligned | No patch needed |
| ALWAYS take time to do tasks fully | "Don't half-finish implementations" | Aligned | No patch needed |
| ALWAYS summarize compromises/unfinished work | "Trust but verify… an agent's summary describes what it intended" | Aligned | No patch needed |
| `do not mention 'Claude' in commit messages` | Not in default prompt | Compatible (commit-message guidance section says use the `Co-Authored-By: Claude…` line — but our CLAUDE.md tells us not to. Patch 3 doesn't touch this; we override at message level.) | No binary patch (would require sed on the example template, which is fragile) |
| sign with em-dash + model version | Not in default prompt | Compatible — same caveat as above | Manual override |
| `inline learning capture` triggers | Not in default prompt | Compatible | No patch needed |

The two conflicts (commit / comments) are removed by patches 3 and 4, leaving CLAUDE.md instructions to land cleanly with no opposing force in the default prompt.

## When a patch breaks

The default prompt evolves with each Claude Code release. If a phrase Anthropic ships changes wording, our `grep -qF -- '<sentinel>'` pre-checks fall through to "not needed" and the corresponding sed substitution doesn't run. **The binary still works** (no patch is required for correctness; patches 3-5 are alignment/comfort, not compatibility). The .bak-prepatch backup remains intact.

If `~/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js` disappears entirely (as in v2.1.123, where the layout switched to platform-native binaries via optionalDependencies), the script's first guard prints a warning and exits — no harm done, but the patches don't apply. As of 2026-04, **stay on v2.1.112** until either (a) Anthropic ships a Termux/bionic-compatible native binary, or (b) we extend the patcher to handle the native ELF binaries (sed on a Bun-compiled binary works for **length-preserving** substitutions only — patches 3 and 4 would need same-length placeholder text instead of deletion).
