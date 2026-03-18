# Codebase Audit Findings — Round 2 — 2026-03-18

Status key: [ ] pending, [~] in progress, [x] fixed, [-] wontfix

## CRITICAL — Fix Now

- [-] **C1** `tools/fix-sensors.sh:28` — FALSE POSITIVE: word-splitting is intentional for space-separated package list
- [-] **C2** `claude-chrome-bridge.ts:368-379` — LOW: CDP timeout properly cleared in success/error handlers; close handler doesn't settle promise. Defensive code is adequate.
- [x] **C3** `claude-chrome-bridge.ts:1486-1497` — Unhandled promise rejection in CDP `handleNativeMessage()` — exception in catch hangs extension.
- [x] **C4** `claude-chrome-bridge.ts:1873-1888` — `pendingToolMap` timeout cleanup uses fragile `findIndex()` that can miss queued requests, leaving them in `busyTabs` indefinitely.
- [x] **C5** `dashboard/src/lib/api.ts:103,109,116,186,217` — All REST API functions lack HTTP status checks; non-JSON error pages cause silent parse failures.
- [x] **C6** `dashboard/src/pages/memory.astro:38,52-67` — XSS via innerHTML: session names interpolated without escaping.
- [x] **C7** `session.ts:274,611-652` — `handleClaudeStartup()` called async without await; concurrent startups race state transitions.
- [-] **C8** `ipc.ts:170-218` — FALSE POSITIVE: timeout cleared on all exit paths (data, error, close handlers all call clearTimeout)
- [x] **C9** `http.ts:80-84` — Server error handler doesn't close failed server before retry; multiple server objects leak.

## HIGH — Fix Soon

- [-] **H1** `tools/flutter-termux-setup.sh:162,223` — FALSE POSITIVE: already uses `|` delimiter
- [-] **H2** `tools/adb-wireless-connect.sh:53,57` — FALSE POSITIVE: empty HOST already checked at line 63
- [-] **H3** `tools/flutter-termux-setup.sh:122-137` — FALSE POSITIVE: sh -c `$1` properly quoted, {} passed as positional
- [x] **H4** `tools/crewind.sh:60,134` — Unescaped regex metacharacters in sed substitution with user input `$term`
- [-] **H5** `scripts/gen-og-animation.sh:125,148` — FALSE POSITIVE: $draws is quoted, $WEBP_ARGS intentionally word-split
- [-] **H6** `claude-chrome-bridge.ts:1410-1426` — LOW: readStdout already logs on close; no functional impact
- [-] **H7** `claude-chrome-bridge.ts:1937-1942` — FALSE POSITIVE: spawnNativeHost() is synchronous, no race
- [x] **H8** `claude-chrome-bridge.ts:1979-2008` — `pendingToolMap` grows unbounded; no MAX_PENDING_TOOLS limit
- [x] **H9** `claude-chrome-bridge.ts:416-426` — CDP Network event buffer: 500 events × N sessions, no global cap
- [-] **H10** `claude-chrome-bridge.ts:1704-1724` — Could not verify at reported lines; GIF handler not found
- [x] **H11** `dashboard/src/components/LogViewer.svelte:22-31` — SSE client leak: no onDestroy cleanup
- [x] **H12** `dashboard/src/components/BridgeStatus.svelte+AdbStatus.svelte:24-52` — Unbounded setInterval without cleanup on destroy
- [x] **H13** `dashboard/src/components/SessionTable.svelte:28-36` — No error feedback for session actions; failed API calls silently ignored
- [x] **H14** `daemon.ts:352-362` — Auto-tabs setTimeout not tracked for cleanup; fires after shutdown
- [-] **H15** `daemon.ts:1086-1101` — FALSE POSITIVE: clearTimeout on already-fired timer is a no-op
- [x] **H16** `session.ts:217-223` — `isInTmux()` lastIndexOf(")") can return -1; garbage parent PID parsing
- [-] **H17** `health.ts:82-86,123` — FALSE POSITIVE: config is user-authored, command execution is the point
- [x] **H18** `memory.ts:168-176` — execSync with session name interpolation; command injection via backticks

## MEDIUM — Schedule

- [-] **M1** `orchestrator/install.sh:38,55` — FALSE POSITIVE: already has error handling from round 1 (M10)
- [x] **M2** `tools/fix-sensors.sh:79` — No handling if `adb shell` fails
- [x] **M3** `tools/discwebp.sh:49` — `stat -c%s` without error handling; non-numeric comparison
- [x] **M4** `tools/check-fdroid-mr.sh:12` — Network failure returns "unknown" treated as valid state
- [-] **M5** `tools/restore-tabs.sh:100` — WONTFIX: tmux enforces safe session names, no special chars possible
- [-] **M6** `tools/adb-wireless-connect.sh:96-105` — WONTFIX: nmap greppable output format (-oG) is stable/documented
- [-] **M7** `tools/flutter-termux-setup.sh:315-325` — FALSE POSITIVE: already fixed in round 1 (H14)
- [x] **M8** `claude-chrome-bridge.ts:1364-1378` — `drainTabQueue()` race: failed `sendToolRequest()` after `queue.shift()` loses request
- [-] **M9** `bridge/src/cli.ts:780-805` — FALSE POSITIVE: JSON-RPC newline-delimited protocol guarantees no literal newlines
- [-] **M10** `claude-chrome-bridge.ts:1850-1862` — WONTFIX: bridge is a relay, extension validates methods
- [-] **M11** `edge-claude-ext/background.js:829-850` — FALSE POSITIVE: timer cleared at line 794 when response arrives
- [-] **M12** `edge-claude-ext/background.js:801-817` — FALSE POSITIVE: already uses port object identity (round 1 C1 fix)
- [-] **M13** `edge-claude-ext/popup.js:414-464` — FALSE POSITIVE: already fixed in round 1 (M6)
- [-] **M14** `dashboard/src/pages/memory.astro:22-75` — WONTFIX: separate pages, not concurrent SSE connections
- [-] **M15** `dashboard/src/lib/api.ts:120-140` — FALSE POSITIVE: already fixed in C5 (checkedJson)
- [-] **M16** `dashboard/src/components/ProcessManager.svelte:20-30` — WONTFIX: Set recreation cost negligible, Svelte reactivity requires new reference
- [x] **M17** `dashboard/src/components/AdbStatus.svelte:20-47` — No timeout on handleConnect(); infinite "scanning..."
- [x] **M18** `ipc.ts:62-78` — IPC buffer accumulation without size limit; OOM via malicious client
- [x] **M19** `daemon.ts:1194-1199` — Unbounded notification body for large session counts
- [-] **M20** `config.ts:145-165` — WONTFIX: config is local/user-authored, not untrusted input
- [x] **M21** `battery.ts:99-100` — Charging status misclassified when `plugged !== "UNPLUGGED"` overrides status

## LOW — Nice to Have

- [-] **L1** `orchestrator/install.sh:67,72,82` — WONTFIX: dashboard build is intentionally optional
- [-] **L2** `tools/adb-wireless-connect.sh:176,189` — WONTFIX: Termux locale is predictable (POSIX)
- [-] **L3** `scripts/gen-og-animation.sh:28-29` — WONTFIX: dev-only script, ImageMagick expected
- [-] **L4** `orchestrator/watchdog.sh:17-19` — WONTFIX: 5s timeout adequate; busy returns true not dead
- [-] **L5** `claude-chrome-bridge.ts:1735-1738` — WONTFIX: 0-pixel crop is edge case, Sharp rejects gracefully
- [-] **L6** `edge-claude-ext/content.js:14-20` — WONTFIX: 2^53 counter overflows after ~285 million years
- [-] **L7** `claude-chrome-bridge.ts:1714-1717` — WONTFIX: charset defaults to utf-8 for JSON content
- [-] **L8** `claude-chrome-bridge.ts:1800-1809` — WONTFIX: crx3 errors printed to stderr already
- [-] **L9** `site/src/components/CodeBlock.svelte:22-32` — WONTFIX: Clipboard API tried first, execCommand is acceptable fallback
- [-] **L10** `dashboard/src/layouts/Layout.astro:20-45` — WONTFIX: dashboard targets tablets/phones, not sub-320px screens
- [-] **L11** `dashboard/src/components/SessionTable.svelte:78-83` — WONTFIX: dashboard is a local tool, not public-facing
- [-] **L12** `daemon.ts:1397` — WONTFIX: 5s one-shot timer is cleaned up naturally, not a recurring leak
- [-] **L13** `config.ts:225-234` — WONTFIX: config validation handles this at load time
