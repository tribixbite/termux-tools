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

- [ ] **H1** `tools/flutter-termux-setup.sh:162,223` — sed with `/` delimiter breaks on paths containing `/`
- [ ] **H2** `tools/adb-wireless-connect.sh:53,57` — No error checking if `ifconfig` fails; empty HOST variable
- [ ] **H3** `tools/flutter-termux-setup.sh:122-137` — `find -exec sh -c` with filenames; injection risk
- [ ] **H4** `tools/crewind.sh:60,134` — Unescaped regex metacharacters in sed substitution with user input `$term`
- [ ] **H5** `scripts/gen-og-animation.sh:125,148` — Unquoted `$draws` and `$WEBP_ARGS` variable expansion
- [ ] **H6** `claude-chrome-bridge.ts:1410-1426` — Native host `readStdout()` loop: killed process exits silently with no log
- [ ] **H7** `claude-chrome-bridge.ts:1937-1942` — Race in native host spawn: two concurrent WS connections both spawn duplicates
- [ ] **H8** `claude-chrome-bridge.ts:1979-2008` — `pendingToolMap` grows unbounded; no MAX_PENDING_TOOLS limit
- [ ] **H9** `claude-chrome-bridge.ts:416-426` — CDP Network event buffer: 500 events × N sessions, no global cap
- [ ] **H10** `claude-chrome-bridge.ts:1704-1724` — GIF: single bad frame returns HTTP 500 for entire request
- [ ] **H11** `dashboard/src/components/LogViewer.svelte:22-31` — SSE client leak: no onDestroy cleanup
- [ ] **H12** `dashboard/src/components/BridgeStatus.svelte+AdbStatus.svelte:24-52` — Unbounded setInterval without cleanup on destroy
- [ ] **H13** `dashboard/src/components/SessionTable.svelte:28-36` — No error feedback for session actions; failed API calls silently ignored
- [ ] **H14** `daemon.ts:352-362` — Auto-tabs setTimeout not tracked for cleanup; fires after shutdown
- [ ] **H15** `daemon.ts:1086-1101` — Auto-restart timer cleanup race on shutdown; stale timer handle
- [ ] **H16** `session.ts:217-223` — `isInTmux()` lastIndexOf(")") can return -1; garbage parent PID parsing
- [ ] **H17** `health.ts:82-86,123` — Custom health command passed to execSync without shell escaping; injection risk
- [ ] **H18** `memory.ts:168-176` — execSync with session name interpolation; command injection via backticks

## MEDIUM — Schedule

- [ ] **M1** `orchestrator/install.sh:38,55` — Partial error handling on bun install/build
- [ ] **M2** `tools/fix-sensors.sh:79` — No handling if `adb shell` fails
- [ ] **M3** `tools/discwebp.sh:49` — `stat -c%s` without error handling; non-numeric comparison
- [ ] **M4** `tools/check-fdroid-mr.sh:12` — Network failure returns "unknown" treated as valid state
- [ ] **M5** `tools/restore-tabs.sh:100` — Unquoted `$session` in command string
- [ ] **M6** `tools/adb-wireless-connect.sh:96-105` — Hardcoded nmap output format; silent parse failure
- [ ] **M7** `tools/flutter-termux-setup.sh:315-325` — Symlinks created without verifying targets exist
- [ ] **M8** `claude-chrome-bridge.ts:1364-1378` — `drainTabQueue()` race: failed `sendToolRequest()` after `queue.shift()` loses request
- [ ] **M9** `bridge/src/cli.ts:780-805` — MCP JSON-RPC buffer splits on newlines within JSON strings
- [ ] **M10** `claude-chrome-bridge.ts:1850-1862` — No schema validation of `body.method` against MCP_TOOLS
- [ ] **M11** `edge-claude-ext/background.js:829-850` — `executeViaPort()` timeout not cleared before retry
- [ ] **M12** `edge-claude-ext/background.js:801-817` — Port disconnect cleanup race with new port
- [ ] **M13** `edge-claude-ext/popup.js:414-464` — Cascading interval refreshes on rapid tab switching
- [ ] **M14** `dashboard/src/pages/memory.astro:22-75` — Duplicate SSE connection violating shared store design
- [ ] **M15** `dashboard/src/lib/api.ts:120-140` — `fetchBridgeHealth()` no HTTP status validation
- [ ] **M16** `dashboard/src/components/ProcessManager.svelte:20-30` — Unnecessary Set recreation per handleStop() call
- [ ] **M17** `dashboard/src/components/AdbStatus.svelte:20-47` — No timeout on handleConnect(); infinite "scanning..."
- [ ] **M18** `ipc.ts:62-78` — IPC buffer accumulation without size limit; OOM via malicious client
- [ ] **M19** `daemon.ts:1194-1199` — Unbounded notification body for large session counts
- [ ] **M20** `config.ts:145-165` — TOML array parsing has no depth/size limit; stack overflow risk
- [ ] **M21** `battery.ts:99-100` — Charging status misclassified when `plugged !== "UNPLUGGED"` overrides status

## LOW — Nice to Have

- [ ] **L1** `orchestrator/install.sh:67,72,82` — Errors suppressed with `2>/dev/null || true` without logging
- [ ] **L2** `tools/adb-wireless-connect.sh:176,189` — Date format locale-dependent
- [ ] **L3** `scripts/gen-og-animation.sh:28-29` — ImageMagick `convert` availability not checked
- [ ] **L4** `orchestrator/watchdog.sh:17-19` — 5s daemon_alive() timeout may be too short under load
- [ ] **L5** `claude-chrome-bridge.ts:1735-1738` — `/crop` endpoint: clamped width/height can be 0
- [ ] **L6** `edge-claude-ext/content.js:14-20` — `refCounter` integer overflow on long-lived pages
- [ ] **L7** `claude-chrome-bridge.ts:1714-1717` — GIF endpoint missing charset=utf-8 in Content-Type
- [ ] **L8** `claude-chrome-bridge.ts:1800-1809` — CRX build: generic error without actual runSync() output
- [ ] **L9** `site/src/components/CodeBlock.svelte:22-32` — Deprecated `document.execCommand("copy")` fallback
- [ ] **L10** `dashboard/src/layouts/Layout.astro:20-45` — Squeeze on ultra-small screens (<320px)
- [ ] **L11** `dashboard/src/components/SessionTable.svelte:78-83` — Missing aria-label on Unicode button icons
- [ ] **L12** `daemon.ts:1397` — Battery timer initial poll not tracked for cleanup
- [ ] **L13** `config.ts:225-234` — Health defaults for unknown session types silently ignored
