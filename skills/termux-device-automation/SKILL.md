---
name: termux-device-automation
description: Use when scheduling cron jobs, sending termux-notification alerts, or setting up recurring watchers on this Termux device — especially when a notification silently never appears (exit 0, no error), crontab entries never fire, sv/crond won't start, or an F-Droid API poll misses fields.
---

# Termux Device Automation (cron + notifications + API watchers)

## Overview

Recurring automation on this device = cronie + termux-notification + a poll script. Every layer has a silent failure mode; this skill lists them with the verified fixes (all reproduced 2026-07-15).

## Notifications: silent failure modes

`termux-notification` can exit 0 and deliver NOTHING. Differential diagnosis:

| Symptom | Cause | Fix / test |
|---|---|---|
| exit 0, no notification | Android 13+ POST_NOTIFICATIONS denied for **Termux:API** app | Settings → Apps → Termux:API → Notifications → Allow |
| command hangs (needs `timeout`) | com.termux.api app not installed | `pm list packages \| rg termux` (pm works unprivileged). Exit 0 + silence RULES OUT this case — missing app hangs, it never exits clean |
| everything above unclear | — | `termux-toast "x"` + `termux-vibrate -d 400` use the same app but need no permission — if those work, it's the permission |
| INTERMITTENT: sometimes works, sometimes hangs/drops (perms fine, app installed) | Termux:API app frozen by battery optimization / phantom-process killing; broadcasts sit unserviced, clients hang forever | `termux-api-start` (starts its KeepAliveService) then retry; Settings → Apps → Termux:API → Battery → Unrestricted for a durable fix. In cron scripts ALWAYS `timeout 25 termux-notification ...` — hung clients pile up as zombies. Kill stuck ones: `pgrep -fl "libexec/termux-api"` then `kill -9` |

`dumpsys`/`appops` are NOT accessible from Termux (no adb) — you can neither inspect nor grant the permission non-interactively; the Settings toggle is the only path. Use the toast differential to diagnose.

## Cron: crond is not running by default

- cronie is installed; `crontab -l` may even show entries — but **crond is dead** and termux-services (`sv`, `runsvdir`) is absent despite `$PREFIX/var/service/` existing. `sv-enable crond` fails silently.
- Fix: run `crond` directly (`pgrep crond || crond`).
- Boot persistence: `~/.termux/boot/crond.sh` (already exists). Termux:Boot (must be installed AND opened once to activate) runs every file in `~/.termux/boot/`; boot scripts need `chmod +x` and the absolute shebang below. **Never append to `startup.sh`** — it is a symlink into `~/git/operad/watchdog.sh` and ends in a blocking `while true` loop; code after it never runs.
- Cron env is minimal: scripts need the absolute shebang `#!/data/data/com.termux/files/usr/bin/bash` AND `export PATH=/data/data/com.termux/files/usr/bin:$PATH`. Login-profile shims (the broken `grep -G` / `curl` functions) are NOT loaded in cron — plain `curl` is safe there.
- Verify the daemon actually executes jobs: install `* * * * * touch $PREFIX/tmp/cron-probe`, wait 70 s, check file, remove entry. (`$PREFIX/tmp`, never `/tmp` — unwritable on Termux.)

## Working example: F-Droid release watcher

`~/.local/bin/check-fdroid-cleverkeys.sh` (crontab `*/10`) — permanent new-version notifier. Pattern: poll API → compare against state file (`~/.cache/fdroid-cleverkeys-last-code`) → notify on increase → update state. First run seeds silently.

F-Droid API gotchas (`f-droid.org/api/v1/packages/<appid>`):
- `suggestedVersionCode` is top-level; **`suggestedVersionName` does not exist**. Match `packages[]` by `versionCode` and read its `versionName`: `{"suggestedVersionCode": 104003, "packages": [{"versionName": "1.4.0", "versionCode": 104003}, ...]}`
- Parse with python3 (`json.load`), not jq/grep, and wrap in try/except printing a sentinel — cron has no stderr you'll ever see.

## Common mistakes

- Trusting exit 0 from termux-notification → always confirm delivery once per device.
- One-shot watchers that self-disarm when a permanent one was wanted (or vice versa) — decide explicitly; state-file compare gives permanent, marker-file + crontab self-removal gives one-shot.
- Editing `startup.sh` for boot tasks (blocking loop + foreign repo) — separate file in `~/.termux/boot/`.
