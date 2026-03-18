# Codebase Audit Findings — 2026-03-18

Status key: [ ] pending, [~] in progress, [x] fixed, [-] wontfix

## CRITICAL — Fix Now

- [x] **C1** `background.js:769-774` — `pendingPortRequests.clear()` wipes ALL tabs' pending requests when any single tab disconnects
- [x] **C2** `background.js:882-884` — `networkRequests` Map never cleaned on tab close
- [x] **C3** `content.js:10-20` — `refMap` grows unbounded across page navigations
- [x] **C4** `background.js:95-100` — Ping without pong validation; zombie WebSocket detection missing
- [x] **C5** `activity.ts:33` — `snapshots` Map never evicts dead sessions
- [x] **C6** `http.ts:207-210` — Request body read waits indefinitely (no timeout)
- [x] **C7** `daemon.ts` timers — `startXTimer()` functions don't clear existing interval before creating new
- [x] **C8** `gen-og-animation.sh:11` — `rm -rf` with unchecked `$PREFIX`
- [x] **C9** `build-crx.js:28-43` — PEM key temp file not cleaned up in try/finally
- [x] **C10** `watchdog.sh:23` — `daemon_alive()` has no timeout

## HIGH — Fix Soon

- [x] **H1** `activity.ts:167-195` — O(n²) /proc traversal every 15s
- [x] **H2** `memory.ts:179` — Blocking execSync("ps") in event loop
- [x] **H3** `http.ts:115-126` — SSE client cleanup race in concurrent pushEvent
- [x] **H4** `health.ts` + `daemon.ts` — State transitions not locked (health sweep vs IPC race) — wontfix: single-threaded JS, check-then-act is safe
- [x] **H5** `registry.ts:117` — `updateActivity()` never persists; crash loses data
- [x] **H6** `state.ts:214` — No validation on JSON.parse of state.json
- [x] **H7** `daemon.ts:81` — Unnecessary runtime `require("fs")` when already imported
- [x] **H8** `background.js:173-284` — No per-tab tool execution queue; parallel requests race
- [x] **H9** `background.js:762` — `msg.result` used without validation; `msg.error` ignored
- [x] **H10** `background.js:861-869` — `resolveTabId()` returns undefined when no tabs exist
- [x] **H11** `content.js:84-92` — Port reconnect backoff never resets on success
- [x] **H12** `cli.ts:770-788` — MCP JSON-RPC buffer unbounded
- [x] **H13** `discwebp.sh:36-50` — ffmpeg failure → moves broken file
- [x] **H14** `flutter-termux-setup.sh:259-273` — Symlink replace with no rollback
- [x] **H15** `adb-wireless-connect.sh:47-51` — `set +e` without trap leaks to parent

## MEDIUM — Schedule

- [ ] **M1** `config.ts:337-341` — `asString()` converts objects to "[object Object]"
- [ ] **M2** `session.ts:303-322` — Bare process PID valid even if child exits immediately
- [ ] **M3** `daemon.ts:313-319` — Up to 1s delay on shutdown due to polling interval
- [ ] **M4** `cli.ts:691` — `resp.json()` without Content-Type check
- [ ] **M5** `content.js:177-221` — O(n²) buildAccessibilityTree on large DOMs
- [ ] **M6** `popup.js:413-464` — Cascading intervals in refreshNetwork
- [ ] **M7** `check-fdroid-mr.sh:8,31` — TOCTOU race on state file
- [ ] **M8** `crewind.sh:52-54` — Unescaped regex in grep
- [ ] **M9** `restore-tabs.sh:36-50` — create_tab discards exit codes
- [ ] **M10** `install.sh:38,49` — Silenced errors cascade to misleading build failure
