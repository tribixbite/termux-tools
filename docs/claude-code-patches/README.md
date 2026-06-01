# Claude Code v2.1.112 patch artifacts

The two files here are committed snapshots of what `install/modules/claude-code.sh` `patch_claude_cli()` does to the bundled JS.

| File | What it is |
|---|---|
| `v2.1.112-deltas.md` | Human-readable substring-level deltas for each hunk (4 total). Clean way to see exactly what content changed. |
| `v2.1.112-raw.diff` | Unified `diff -u bak current` between the unpatched bundle (`cli.js.bak-prepatch`) and the patched bundle. Most lines are very long because the bundle is largely minified-on-one-line; only the four hunks where the patcher edited content are present. |

## Two supported paths

v2.1.113 (and every version after) switched the package layout from a single bundled `cli.js` to a thin wrapper that copies a bun-compiled glibc binary from `optionalDependencies`. Both layouts now run on Termux:

| Version | Layout | How it runs on Termux | Model cap |
|---|---|---|---|
| 2.1.112 | bundled `cli.js` (~14 MB) | Direct (Node-compatible JS bundle). `patch_claude_cli()` sed-patches it. | Opus 4.7 |
| 2.1.158 | bun-compiled glibc binary (~240 MB) | `~/.local/bin/claude-next` launches it via `BUN_BINARY_PATH=<binary> ~/.bun/bin/bun-termux`, which userland-execs glibc's `ld-linux-aarch64.so.1` (no `grun`/`patchelf` needed). | **Opus 4.8** |

Verified by inspecting `package.json["main"]` across versions on the npm registry — the layout boundary is exact, not gradual.

`install/modules/claude-code.sh` installs whichever the `CCINSTALL_VERSION` env selects: the legacy `cli.js` path (default, `2.1.112`) or `_install_claude_binary` for `next`/`2.1.123+`. To make bare `claude` resolve to 4.8: `ln -sf ~/.local/bin/claude-next ~/.local/bin/claude` (`.local/bin` precedes `.bun/bin` on PATH).

### Byte-preserving patches for the binary

The bun-compiled binary embeds its JS in a bun-vfs blob keyed by internal byte offsets. A length-**changing** edit shifts every downstream offset and corrupts the binary (`--version` then reports the bun runtime version, e.g. `1.3.x`). But bun-vfs does **not** checksum the blob, so same-length overwrites are safe — verified end to end (patched 2.1.158 still reports its version and runs full inference). `_patch_claude_binary()` therefore blanks the two CLAUDE.md-conflicting directives with equal-length spaces rather than removing lines:

| # | Directive blanked | Opt-out |
|---|---|---|
| P3 | `NEVER commit changes unless the user explicitly asks you to.` (1×) | `CCPATCH_KEEP_NO_COMMIT=1` |
| P4 | `Default to writing no comments.` (2×: joined + array-literal forms) | `CCPATCH_KEEP_NO_COMMENTS=1` |

P5 (length caps) needs no patch on 2.1.158 — Anthropic already relaxed them to 60/250 words upstream. A backup is kept at `claude-binary.bak-prepatch`.

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
