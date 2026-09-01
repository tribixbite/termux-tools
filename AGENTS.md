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
