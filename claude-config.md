# Claude Code Configuration Export

> Exported from `~/.claude/CLAUDE.md` and `~/git/CLAUDE.md` — 2026-02-09

---

## Global Settings

| Setting | Value |
|---|---|
| **Commits** | Conventional commits after every round of work; update working `*.md` file |
| **`go` command** | Proceed with next `*.md` tasks; update ordering to match priority; add recommendations; use adb to test if applicable |
| **Screenshots dir** | `~/storage/shared/DCIM/Screenshots` |
| **Screenshot limits** | No dimension >= 2000px, file size < 4MB; compress/convert if either exceeded |
| **Build process** | Always use `./build-and-install.sh` (or `./build-and-install.sh clean`), never raw gradle |
| **Build toolchain** | Custom ARM64 AAPT2 at `tools/aapt2-arm64/aapt2`; handles web build → capacitor sync → gradle → APK install |
| **APK install methods** | `termux-open`, ADB wireless, or manual copy |
| **Testing** | `./test-adb.sh` (requires TestActivity in built APK) |
| **Language preference** | TypeScript over JavaScript, Kotlin over Java |
| **Code standard** | Properly typed, DRY, production-level with explanatory comments |
| **UI default** | Slick modern dark mode; mobile-friendly; touchscreen-compatible; full viewport |
| **Docs** | Check/update/create specs in `docs/specs/` with `docs/specs/README.md` ToC |
| **TODO comments** | Required for all unfinished or flagged-for-fix/refactor items |
| **Uncertainty** | Use zen-mcp, web search, or ask user when unsure |
| **Testing** | Run and test code independently before asking user to test manually |

---

## Project Settings (termux-tools)

| Setting | Value |
|---|---|
| **External comments** | Never post comments/replies/questions on GitHub/GitLab without per-instance approval |
| **ADB — leave no trace** | After changing UI/settings for tests, restore original state |
| **ADB — no reboot** | Never reboot or clear app data without explicit permission |
| **ADB — reconnect** | ADB auto-reconnects upon disconnect (every ~5 min) |
| **ADB — logcat** | Grep existing logcat before clearing; verify timestamps match current test |
| **Commit signing** | Emdash + model version (e.g., `— opus-4-6`); no "Claude" or "Co-Authored-By" |
| **Code style** | ES modules (`import`/`export`), `async`/`await`, destructured imports, `const`/`let` over `var` |
| **Type system** | TypeScript for all new code |
| **Documentation** | JSDoc comments for public APIs |
| **Workflow** | Typecheck → test → commit |
| **Task coordination** | Use TodoWrite for complex multi-step tasks |
| **Memory** | Store important info in Memory for cross-agent coordination |

---

## Restrictions (NEVER)

| Rule | Details |
|---|---|
| **No duplicate files** | Never create `script_fixed.py`, `file_new.ts`, etc. — modify the original in-place |
| **No git destruction** | Never `git reset`, `revert`, `discard`, `rewrite`, or `force` without explicit special permission |
| **No embellishment** | No celebration, hyperbole, or exaggeration |
| **No stubs** | Never insert simplified, truncated, shortened, stubbed, condensed, or placeholder values/functions |
| **No raw gradle** | Never run `cd android && ./gradlew ...` — always use `./build-and-install.sh` |
| **No unauthorized push** | Never push a release (tag, version bump, `git push`) without explicit permission or direct request |
| **No unauthorized reboot** | Never reboot device or clear app data without per-instance permission |
| **No unauthorized comments** | Never post on GitHub/GitLab on behalf of user without per-instance approval |

---

## Required Actions (ALWAYS)

| Rule | Details |
|---|---|
| **Thoroughness** | Take time to do tasks fully and properly |
| **Transparency** | Summarize any compromises, unfinished work, missing features, issues, or errors |
| **Research first** | Use zen-mcp, web search, or ask when unsure |
| **Production code** | Properly typed, DRY, with explanatory comments |
| **TODO markers** | Comment `# TODO` for unfinished or flagged items |
| **Self-test** | Run and test code independently before asking user to test |
| **Dark mode default** | Slick modern dark UI, mobile-friendly, full viewport |
| **ARM64 builds** | Use `./build-and-install.sh` for all Android builds |
| **Specs maintenance** | Check, update, or create specs in `docs/specs/` |
