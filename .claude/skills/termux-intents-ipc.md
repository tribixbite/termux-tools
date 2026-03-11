# Termux Intents & IPC — Creating Tabs, Running Commands

## Three Ways to Send Intents from Termux CLI

### 1. `termux-am` (Socket — fastest, may be down)
Connects to `/data/data/com.termux/files/apps/com.termux/termux-am/am.sock` socket server
run by the Termux app's Java process.

```bash
termux-am start \
  -n com.termux/.app.TermuxActivity \
  --es com.termux.execute.background true \
  -e com.termux.execute.command "tmux attach -t session"
```

**Status check:** `termux-am broadcast -a com.termux.test 2>/dev/null`
- "Could not connect to socket: No such file or directory" = socket server not running
- Env var: `$TERMUX_APP__AM_SOCKET_SERVER_ENABLED` (empty = enabled, "false" = disabled)
- Disable in `~/.termux/termux.properties`: `run-termux-am-socket-server=false`
- Socket server is managed by Termux app — cannot be restarted independently
- On our device (Termux 0.118.3): socket server is NOT running, socket dir empty

### 2. `am` (DalvikVM — reliable for intents)
Shell script at `/data/data/com.termux/files/usr/bin/am` that runs `app_process` with `am.apk`.
Sends intents through Android's activity manager as the Termux user.

**Bun gotcha:** Bun's glibc runner strips `LD_PRELOAD`. Must explicitly set
`LD_PRELOAD=$PREFIX/lib/libtermux-exec-ld-preload.so` for `am`/`app_process` to work.
Without it, `am` commands silently return exit 0 but intents never fire.

### 3. ADB shell `am` (System — works for services too)
Via `adb -s <serial> shell am ...`. Runs as shell user but Termux's
`RunCommandService` requires `com.termux.permission.RUN_COMMAND` (signature-level)
which the shell user doesn't have. Only useful for starting activities.

## Creating New Termux Tabs — Android 16 (SDK 36)

### Primary: TermuxService `service_execute` (WORKS on Android 16)

The `TermuxService` is already a foreground service when Termux is open, so it can
create new terminal sessions even under Android 16's background service restrictions.

```bash
PREFIX=${PREFIX:-/data/data/com.termux/files/usr}
LD_PRELOAD="$PREFIX/lib/libtermux-exec-ld-preload.so" am startservice \
  -n com.termux/.app.TermuxService \
  -a com.termux.service_execute \
  -d "file://$PREFIX/tmp/my-script.sh" \
  --esa com.termux.execute.arguments "arg1" \
  --ei com.termux.execute.session_action 0 \
  --es com.termux.execute.shell_name "my-tab-name"
```

**Key details:**
- Script path goes in `-d file://...` data URI (NOT an extra)
- Script must be `chmod +x`
- `session_action 0` = new foreground tab
- `shell_name` sets the session name (shows in Termux tab list)
- Stagger 1.5s between tab creations to avoid UI race conditions

### TermuxService `service_execute` Extras

| Extra | Type | Description |
|-------|------|-------------|
| `-d file://...` | data URI | Path to script/binary to execute |
| `com.termux.execute.arguments` | `--esa` (string array) | Comma-separated args |
| `com.termux.execute.session_action` | `--ei` (int) | 0=new tab, 1=bg, 2=attach |
| `com.termux.execute.shell_name` | `--es` (string) | Tab/session name |
| `com.termux.execute.cwd` | `--es` (string) | Working directory |
| `com.termux.execute.background` | `--ez` (boolean) | Run in background |

### TMX Orchestrator Integration

`session.ts` `createTermuxTab()` uses this approach:
1. Writes `$PREFIX/tmp/tmx-attach.sh` (sets OSC title + `exec tmux attach -t $1`)
2. Calls `am startservice` with TermuxService + `service_execute`
3. Fallback: `tmux switch-client` if TermuxService fails

### What DOESN'T Work on Android 16

| Method | Why it fails |
|--------|-------------|
| `RunCommandService` | Requires `com.termux.permission.RUN_COMMAND` (signature-level, only Termux plugins) |
| `am start TermuxActivity` + extras | `onNewIntent()` ignores execute extras for running instance |
| `am start --activity-multiple-task` | TermuxActivity is `singleTask` — only one instance |
| `TermuxFileReceiverActivity` | Opens file dialog, doesn't execute scripts |
| TIOCSTI key injection | Blocked on Linux 6.2+ (Android 15+) |

## Browser → Termux (CATEGORY_BROWSABLE Problem)

Chrome/Edge forcibly add `android.intent.category.BROWSABLE` to ALL `intent:` URIs
and strip the `component=` field. Termux's `TermuxFileReceiverActivity` only declares
`CATEGORY_DEFAULT` — so intent URIs from browsers **never reach Termux**.

### What works: `navigator.share()` (Web Share API)
Uses Android's native share sheet WITHOUT the BROWSABLE restriction:
```javascript
await navigator.share({ text: "https://cfcbridge.example.com/start" });
// User picks Termux from share sheet → TermuxFileReceiverActivity → termux-url-opener
```

**Limitation:** Cannot skip the share sheet picker (Android security).
**Limitation:** `navigator.share()` is NOT available in extension popup WebViews —
must open a regular tab first (use `chrome.tabs.update()`, not `chrome.tabs.create()`
which dies when popup closes).

## Kotlin Usage (CleverKeys)

CleverKeys uses `RunCommandService` as a preset for short-swipe gesture intents:
```kotlin
IntentDefinition(
    name = "Termux Command",
    targetType = IntentTargetType.SERVICE,
    action = "com.termux.RUN_COMMAND",
    packageName = "com.termux",
    className = "com.termux.app.RunCommandService",
    extras = mapOf(
        "com.termux.RUN_COMMAND_PATH" to "/data/data/com.termux/files/usr/bin/echo",
        "com.termux.RUN_COMMAND_ARGUMENTS" to "Hello",
        "com.termux.RUN_COMMAND_BACKGROUND" to "true"
    )
)
```

Note: This only works from apps that hold `com.termux.permission.RUN_COMMAND`
(signature-level — Termux plugins like Termux:Tasker, Termux:Widget, or same-signed apps).

## Bash Pitfalls

- `((var++))` returns exit code 1 when var=0 (0 is falsy) — crashes scripts with `set -e`.
  Use `var=$((var + 1))` instead.
- `sleep 1.5` between tab creations to avoid UI race conditions.
- Always quote session names in tmux commands: `tmux attach -t '$session'`

## Key Files
- `orchestrator/src/session.ts` `createTermuxTab()` — creates real Termux tabs via TermuxService
- `tools/restore-tabs.sh` — bash restore script (uses old RunCommandService approach)
- `~/.termux/tasker/startup.sh` — old boot script (replaced by tmx)
- `/data/data/com.termux/files/usr/bin/termux-am` — socket client wrapper (bash)
- `/data/data/com.termux/files/usr/bin/am` — DalvikVM am wrapper (sh)
