# Termux Codex Agent Notes

These instructions capture environment-specific lessons from Codex sessions on Android/Termux.
More-specific repository instructions always take precedence.

## Sandbox and editing

- A Codex filesystem sandbox may fail before command execution with
  `bwrap: Can't read /proc/sys/kernel/overflowuid: Permission denied`. This can affect
  `apply_patch` and otherwise harmless read-only commands; it is an environment failure, not a
  repository failure.
- When the user has authorized the operation, request escalation rather than repeatedly retrying
  the same sandboxed command.
- If `apply_patch` is unavailable for that reason, use a reviewed standard unified diff:
  validate it with `git apply --check`, then apply it with `git apply`. Keep the index
  untouched until the diff has been reviewed. Do not replace this with broad scripted rewrites.
- For a requested file outside a Git worktree, read any existing file first and preserve it. If
  the patch helper cannot reach it, use the narrowest explicit write target and immediately read
  the result back.
- The Codex-bundled `rg` shim may point at a musl binary that Android cannot execute and report
  `required file not found`. Treat that as a tool failure, not as an empty search. Try the
  Termux-native binary if present; otherwise use `git grep`, `grep`, or `find`.

- Codex 0.157.1 still cannot sandbox on this host: user namespace creation returns
  `EINVAL`, mount namespace creation returns `EPERM`, and the legacy Landlock flag
  requires bubblewrap for app-server socket isolation. Do not present Proot or a
  disabled sandbox as an equivalent fix.
- After Codex updates, rerun `scripts/patch-codex-termux-dns.sh`: it now repairs the
  prepended `codex-path/rg` with the native Termux binary as well as DNS. Preserve
  mapped executables by rename before a package manager replaces their contents.

- Codex daemon staging rejects external package symlinks (`package link escapes
  its root`): copy native `rg` atomically into `codex-path/rg`, never symlink it.
- Codex 0.157.1's daemon socket root is hardcoded `/tmp/codex-daemon-<uid>` and
  ignores TMPDIR; Android returns EACCES. `codex features disable daemon_auto_start`
  enables normal foreground startup without changing sandbox/approval settings.
  Verify interactive startup after upgrades, not only `--version` and login.

- Prefer native temp-directory configuration/build fixes over PRoot. Export
  TMPDIR, TMP, and TEMP consistently; this host's Node and Bun currently preserve
  TMPDIR (verify instead of assuming a launcher strips it).
- Codex's static binary ignores LD_PRELOAD. Its daemon socket root is deliberately
  environment-independent; a native Android patch must change the shared fixed
  root for both listeners and sandbox exclusions, retaining UID/mode/symlink checks.
- `/tmp` here is tmpfs labeled `shell_data_file`, not merely a missing directory.
  Android forbids app-domain writes to that label; ADB chmod is not a global fix.
- Codex 0.159.3 foreground `remote-control` falls back from `/tmp/codex-rc-*`
  to `$PREFIX/tmp`, then still fails creating `/tmp/codex-daemon-<uid>` (strace
  verified). Disabling daemon_auto_start does not avoid this second path. The
  bubblewrap warning is not the immediate directory failure; do not claim that
  foreground mode alone enables mobile access to a Termux session.

## Long-running commands

- A long command can return a live session identifier rather than its final exit status. Poll
  that exact session until completion and record the final exit code and test count.
- Do not leave multiple monitor loops around one build. Respect repository-provided serialization
  wrappers and their memory/backoff policy.
- In CleverKeys specifically, every Gradle invocation goes through
  `scripts/gradle-guard.sh`; never follow a stale direct-`gradlew` example.

## Shared-tree Git safety

- At entry, inspect `git status`, recent commits, the handoff, and any remote WIP reference.
  A remote snapshot may be older than local commits or the current working tree.
- Never reset, restore, or overwrite a shared dirty tree. Stage only the reviewed paths for the
  current logical commit.
- After committing, update handoff language that still says “dirty”, “unstaged”, or “local HEAD”
  before making the documentation commit.
- Local commits and external publication are separate permissions. A request to commit does not
  authorize push, tag, release, issue, or merge-request actions.
- When a repository or user requires a model attribution, make it the final paragraph of every
  commit message and verify it with `git log -1 --format=%B`.

## Browser bridge painting sessions

- A bridge that stops answering `/health` can be blocked in a synchronous ADB
  probe of another connected phone. Inspect direct children of its server PID;
  terminating the exact hung read-only `adb ... shell pidof` child restored service
  without restarting the browser. Rediscover the local wireless port and verify
  its Edge PID before forwarding `chrome_devtools_remote` to port 9223.
- Hidden Android browser tabs can pause timers/promises while synchronous CDP
  evaluations still execute. A CDP timeout does not prove the action failed: read
  state before retrying painting or other mutations. Export the actual canvas to
  PNG rather than relying only on background-tab autosave.

- Verified on SM-S938U1 / Edge Canary 154: CDP `Input.dispatchMouseEvent` with
  `pointerType: "pen"`, `force`, `tiltX`, `tiltY`, and `twist` delivers trusted
  browser PointerEvents preserving these values. A temporary blank target can
  test this without touching artwork; close it and restore the original app.
  This proves browser injection only, not Android-wide or physical S Pen emulation.
