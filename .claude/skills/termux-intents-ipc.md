# Termux Intents & IPC — Creating Tabs, Running Commands

## Three Ways to Send Intents from Termux CLI

### 1. `termux-am` (Socket — fastest, may be down)
Connects to `/data/data/com.termux/files/apps/com.termux/termux-am/am.sock` socket server
run by the Termux app's Java process. Can directly create terminal sessions/tabs.

```bash
termux-am start \
  -n com.termux/.app.TermuxActivity \
  --es com.termux.execute.background true \
  -e com.termux.execute.command "tmux attach -t session" \
  -e com.termux.execute.title "My Tab"
```

**Status check:** `termux-am broadcast -a com.termux.test 2>/dev/null`
- "Could not connect to socket: Connection refused" = socket server down (common after crash)
- Env var: `$TERMUX_APP__AM_SOCKET_SERVER_ENABLED` (empty = enabled, "false" = disabled)
- Disable in `~/.termux/termux.properties`: `run-termux-am-socket-server=false`
- Socket server is managed by Termux app — cannot be restarted independently

### 2. `am` (DalvikVM — reliable, but limited)
Shell script at `/data/data/com.termux/files/usr/bin/am` that runs `app_process` with `am.apk`.
Sends intents through Android's activity manager as the Termux user.

```bash
# This sends the intent but does NOT create new terminal tabs
am start -n com.termux/.app.TermuxActivity \
  --es com.termux.execute.command "echo hello"
# Result: "Activity not started, intent has been delivered to currently running top-most instance."
# The extras are ignored by onNewIntent() — no new session is created.
```

**Key limitation:** `am start` to an already-running TermuxActivity delivers the intent
via `onNewIntent()`, but the activity does NOT process `com.termux.execute.*` extras
to create new terminal sessions. Only useful for starting the activity itself.

### 3. `/system/bin/am` (System — permission denied from Termux)
The real Android activity manager. Runs as shell user (uid 2000).

```bash
/system/bin/am start -n com.termux/.app.TermuxActivity
# SecurityException: Permission Denial: package=com.android.shell does not belong to uid=10364
```

**Never works from Termux** — UID mismatch between shell and Termux app user.

## Creating New Termux Tabs (Reliable Method)

Use `RunCommandService` via the DalvikVM `am` command. This is the **only reliable
method** when `termux-am` socket is down.

```bash
am startservice \
  -n com.termux/com.termux.app.RunCommandService \
  -a com.termux.RUN_COMMAND \
  --es com.termux.RUN_COMMAND_PATH "/data/data/com.termux/files/usr/bin/bash" \
  --esa com.termux.RUN_COMMAND_ARGUMENTS "-c,tmux attach -t session_name" \
  --ez com.termux.RUN_COMMAND_BACKGROUND false \
  --es com.termux.RUN_COMMAND_SESSION_ACTION "0"
```

### RunCommandService Extras

| Extra | Type | Description |
|-------|------|-------------|
| `com.termux.RUN_COMMAND_PATH` | `--es` (string) | Path to executable |
| `com.termux.RUN_COMMAND_ARGUMENTS` | `--esa` (string array) | Comma-separated args |
| `com.termux.RUN_COMMAND_BACKGROUND` | `--ez` (boolean) | Run in background (no UI) |
| `com.termux.RUN_COMMAND_SESSION_ACTION` | `--es` (string) | `"0"` = new foreground tab |

### SESSION_ACTION Values
- `"0"` — New session, switch to it (creates visible tab)
- `"1"` — New session, don't switch
- `"2"` — Attach to existing session (by name)
- `"3"` — New session, show in notification

### Auto-detect Pattern (restore-tabs.sh)

```bash
AM_METHOD=""
if termux-am broadcast -a com.termux.test 2>/dev/null | grep -q "Broadcast completed"; then
  AM_METHOD="termux-am"
else
  AM_METHOD="run-command-service"
fi

create_tab() {
  local cmd="$1"
  if [[ "$AM_METHOD" == "termux-am" ]]; then
    termux-am start -n com.termux/.app.TermuxActivity \
      --es com.termux.execute.background true \
      -e com.termux.execute.command "$cmd" 2>/dev/null
  else
    am startservice -n com.termux/com.termux.app.RunCommandService \
      -a com.termux.RUN_COMMAND \
      --es com.termux.RUN_COMMAND_PATH "/data/data/com.termux/files/usr/bin/bash" \
      --esa com.termux.RUN_COMMAND_ARGUMENTS "-c,$cmd" \
      --ez com.termux.RUN_COMMAND_BACKGROUND false \
      --es com.termux.RUN_COMMAND_SESSION_ACTION "0" >/dev/null 2>&1
  fi
}
```

## Browser → Termux (CATEGORY_BROWSABLE Problem)

Chrome/Edge forcibly add `android.intent.category.BROWSABLE` to ALL `intent:` URIs
and strip the `component=` field. Termux's `TermuxFileReceiverActivity` only declares
`CATEGORY_DEFAULT` — so intent URIs from browsers **never reach Termux**.

### What doesn't work from browser extensions
- `intent:#Intent;action=android.intent.action.SEND;...;end` — BROWSABLE added, Termux filtered out
- `chrome.tabs.create({ url: "intent:..." })` — same BROWSABLE problem
- Programmatic `<a href="intent:...">` clicks — blocked on Android
- `window.location.href = "intent:..."` — Edge puts it in address bar

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

## Bash Pitfalls

- `((var++))` returns exit code 1 when var=0 (0 is falsy) — crashes scripts with `set -e`.
  Use `var=$((var + 1))` instead.
- `sleep 1` between tab creations to avoid UI race conditions.
- Always quote session names in tmux commands: `tmux attach -t '$session'`

## Key Files
- `tools/restore-tabs.sh` — auto-restore Termux tabs for tmux sessions
- `~/.termux/tasker/startup.sh` — boot script that creates tmux sessions + calls restore-tabs
- `~/.termux/bootold/start.sh` — old boot script with `termux-am` tab creation pattern
- `/data/data/com.termux/files/usr/bin/termux-am` — socket client wrapper (bash)
- `/data/data/com.termux/files/usr/bin/am` — DalvikVM am wrapper (sh)
- `edge-claude-ext/launcher.js` — browser → Termux via navigator.share()
