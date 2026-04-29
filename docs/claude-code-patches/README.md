# Claude Code v2.1.112 patch artifacts

The two files here are committed snapshots of what `install/modules/claude-code.sh` `patch_claude_cli()` does to the bundled JS.

| File | What it is |
|---|---|
| `v2.1.112-deltas.md` | Human-readable substring-level deltas for each hunk (4 total). Clean way to see exactly what content changed. |
| `v2.1.112-raw.diff` | Unified `diff -u bak current` between the unpatched bundle (`cli.js.bak-prepatch`) and the patched bundle. Most lines are very long because the bundle is largely minified-on-one-line; only the four hunks where the patcher edited content are present. |

## Why pinned at v2.1.112

v2.1.113 (and every version after) switched the package layout from a single bundled `cli.js` to a thin wrapper that copies a platform-native binary from `optionalDependencies`:

| Version | Layout | Termux compatibility |
|---|---|---|
| 2.1.112 | bundled `cli.js` (~14 MB) | Direct (current pin) |
| 2.1.113+ | `bin/claude.exe` placeholder + `linux-arm64{,musl}` native binary (~240 MB) | Native binaries hardcode `/lib/ld-{linux,musl}-aarch64.so.1` interpreters absent on bionic — only run via `grun` + `patchelf --set-interpreter` |

Verified by inspecting `package.json["main"]` across versions on the npm registry — the boundary is exact, not gradual.

## Patches applied

| # | Type | Action |
|---|---|---|
| 1 | compat | (no-op on 2.1.112+) MB null guard for `[...MB,"inherit"]` |
| 2 | compat | Replace `` `/tmp/claude-mcp-browser-bridge-` `` with `` `${z2()}/claude-mcp-browser-bridge-` `` (z2() = Anthropic's smart-tmpdir helper) |
| 3 | alignment | Strip `- NEVER commit changes unless the user explicitly asks you to. ...` |
| 4 | alignment | Strip `"Default to writing no comments. Only add one when..."` JS string from `D6A()` array |
| 5 | comfort | Relax inter-tool word cap 25 → 60 / final-response cap 100 → 250 |

Patches 3-5 are opt-out via env vars (`CCPATCH_KEEP_NO_COMMIT=1`, `CCPATCH_KEEP_NO_COMMENTS=1`, `CCPATCH_KEEP_TIGHT_LENGTH=1`); patches 1-2 are always applied.

## How to regenerate after a fresh install

```bash
# After bun install -g @anthropic-ai/claude-code@2.1.112
source install/lib/common.sh
source install/modules/claude-code.sh
patch_claude_cli   # creates cli.js.bak-prepatch on first run
diff -u "$CLI_JS_GLOBAL.bak-prepatch" "$CLI_JS_GLOBAL" > docs/claude-code-patches/v2.1.112-raw.diff
```
