# Codebase Audit Findings — Round 3 (Extension + Bridge) — 2026-03-18

Status key: [ ] pending, [~] in progress, [x] fixed, [-] wontfix

## CRITICAL — Fix Now

- [-] **C1** `claude-chrome-bridge.ts:1463-1464` — readStdout/readStderr fire-and-forget (LOW: streams close naturally, but unhandled rejection on abnormal close). Fixed with `.catch()`.
- [-] **C2** `claude-chrome-bridge.ts:368-379` — FALSE POSITIVE: CDP sendCommand double-settlement; settled flag already exists.
- [-] **C3** `claude-chrome-bridge.ts:839` — FALSE POSITIVE: pendingPortRequests.port IS set at creation (line 839).
- [x] **C4** `edge-claude-ext/background.js:779` — pendingPortRequests no size cap; unbounded growth if tabs don't respond. Added MAX_PENDING_PORT_REQUESTS=100.

## HIGH — Fix Soon

- [x] **H4** `claude-chrome-bridge.ts:387-395` — CDP pending commands not rejected on WS close; hang until individual 15s timeouts. Now rejected immediately.
- [x] **H5** `claude-chrome-bridge.ts:410` — `data.id !== undefined` catches string IDs from CDP events; changed to `typeof data.id === "number"`.
- [x] **H6** `edge-claude-ext/background.js:708` — GIF recorder no max duration; setInterval timer leaks if stop_recording never called. Added 60s hard cap.

## MEDIUM — Schedule

- [-] **M1** `claude-chrome-bridge.ts:432` — Buffer off-by-one: `> 200` after push correctly caps at 200. Leave as-is (Gemini confirmed correct).

## LOW — Nice to Have

- [x] **L2** `edge-claude-ext/content.js:14-20` — O(n) refMap scan in getOrCreateRef. Added WeakMap reverse index for O(1) lookup.
