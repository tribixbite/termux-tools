# Edge Canary Privacy Build — APK Patch Pipeline

Rebuild Edge Canary with telemetry, trackers, and enterprise bloat stripped. Takes a stock `.apks` bundle (exported via AppManager), decompiles targeted components, patches manifest + DEX + native libs, reassembles, signs, and installs via ADB split-install.

## Overview

The pipeline neutralizes 56+ manifest components, 23 DEX methods, 30+ telemetry URLs, and strips ~36MB of unused native libraries. Telemetry endpoints are redirected to `127.0.0.1:18971` (the local telemetry sink on the tmx dashboard). The entire build runs on-device in Termux (no PC required).

**Build time:** ~3-5 minutes on device (baksmali/smali are the bottleneck).
**Disk space:** ~1GB free required in `$HOME` for working files.
**Output:** `edge-fix/output/EdgeCanary-<version>-privacy.apk` + signed split APKs.

## Build Command

```bash
# Auto-detect latest AppManager export
cd ~/git/termux-tools/edge-fix && bash build.sh

# Or specify a specific .apks file
cd ~/git/termux-tools/edge-fix && bash build.sh "/path/to/Edge Canary_146.0.3853.0.apks"
```

The `.apks` bundle is auto-detected from `~/storage/shared/AppManager/apks/Edge Canary_*.apks` (most recent by version sort). Export from AppManager: long-press Edge Canary > Export > APKs bundle.

## Pre-flight Checks

Before running the build, verify all prerequisites are met:

```bash
# 1. Required CLI tools
for cmd in apktool zipalign keytool python3 java; do
  command -v "$cmd" &>/dev/null && echo "[ok] $cmd" || echo "[MISSING] $cmd"
done

# 2. apksigner (Android SDK build-tools)
ls ~/android-tools/android-sdk/build-tools/*/apksigner 2>/dev/null || echo "[MISSING] apksigner — install Android SDK build-tools"

# 3. baksmali/smali standalone jars
ls ~/git/termux-tools/edge-fix/tools/{baksmali,smali}-3.0.9-fat.jar 2>/dev/null || echo "[MISSING] baksmali/smali jars"

# 4. Input .apks exists
ls ~/storage/shared/AppManager/apks/Edge\ Canary_*.apks 2>/dev/null || echo "[MISSING] No Edge Canary .apks export found"

# 5. Disk space (need ~1GB)
df -h "$HOME" | tail -1

# 6. ADB connected (for install step)
adb devices
```

### Installing Missing Prerequisites

```bash
# apktool, zipalign, keytool, java
pkg install apktool zipalign openjdk-17 -y

# apksigner (from Android SDK build-tools)
# Must be present at ~/android-tools/android-sdk/build-tools/<version>/apksigner

# baksmali/smali v3.0.9 (avoid apktool's bundled version — round-trip bugs)
cd ~/git/termux-tools/edge-fix/tools
curl -LO https://github.com/google/smali/releases/download/v3.0.9/baksmali-3.0.9-fat.jar
curl -LO https://github.com/google/smali/releases/download/v3.0.9/smali-3.0.9-fat.jar
```

## Pipeline Steps

The build script (`edge-fix/build.sh`) executes 5 steps:

### Step 1 — Extract .apks Bundle
Unzips the `.apks` bundle into `edge-fix/work/apks-extracted/`. Produces `base.apk` plus split APKs (`split_chrome.apk`, `split_config.en.apk`, `split_on_demand.apk`). Reads `info.json` for the version string.

### Step 2 — Patch AndroidManifest.xml
Decodes `base.apk` with `apktool d -s` (skip smali), runs `scripts/patch-manifest.py` which reads 5 config files:
- `config/strip-permissions.list` — removes AD_ID, ADSERVICES, SMS, QUERY_ALL_PACKAGES
- `config/strip-components.list` — removes services/receivers/providers (Adjust, HMS, Xiaomi Push, Firebase, Citrix, KOOM, Google DataTransport)
- `config/strip-metadata.list` — removes meta-data entries (HMS versions, Firebase registrations, Play Store stamps)
- `config/strip-queries.list` — removes vendor device ID package queries (MSA, Samsung, Coolpad, OPPO)
- `config/strip-libs.list` — (used in Step 4, not manifest)

Recompiles to binary XML format with `apktool b`.

### Step 3 — Patch DEX (baksmali/smali)
Uses standalone baksmali/smali v3.0.9 (not apktool's bundled version) to avoid `IncompatibleClassChangeError` on Java 8+ interface static methods. Only decompiles DEX files that need changes.

Three patch types applied via config files:
- `config/targeted-stubs.list` — 23 methods stubbed across 3 DEX files (OneAuth, Intune MAM, OneDS, LogManager, Adjust SDK, Tencent Matrix)
- `config/neutralize-libs.list` — `System.loadLibrary()` calls NOP'd for Citrix, KOOM, Matrix, Bing Opus, MSAOAID
- `config/replace-urls.list` — 30+ telemetry endpoint URLs replaced with `http://127.0.0.1:18971`
- `config/strip-classes.list` — entire package trees deleted (Huawei HMS, Xiaomi Push)

Also patches `BuildInfo.isDebugAndroid()` to return `true` so Chromium command-line flags file is read on release builds without `android:debuggable=true`.

### Step 4 — Assemble Patched APK
Copies original `base.apk`, strips `META-INF/` signatures, strips native libraries listed in `config/strip-libs.list` (~36MB saved: Citrix, KOOM, Matrix, Crashpad, ARCore, Bing Opus, MSAOAID, learning tools), strips HMS/GRS/JLatexMath assets, replaces patched manifest + DEX files.

### Step 5 — Sign All APKs
Generates a signing keystore if needed (`edge-fix.keystore`), then `zipalign -p 4` + `apksigner` (v1/v2/v3 signatures) for base.apk and all split APKs. All splits must share the same signing key.

## Post-Build: Install

```bash
# Must uninstall original first (different signing key)
adb uninstall com.microsoft.emmx.canary

# Install base + all splits
adb install-multiple \
  ~/git/termux-tools/edge-fix/output/EdgeCanary-*-privacy.apk \
  ~/git/termux-tools/edge-fix/output/signed/split_chrome.apk \
  ~/git/termux-tools/edge-fix/output/signed/split_config.en.apk \
  ~/git/termux-tools/edge-fix/output/signed/split_on_demand.apk
```

**WARNING:** Uninstalling Edge Canary will lose all browser data (bookmarks, history, passwords, tabs). Sync data to a Microsoft account first.

## Post-Build: Push Flags + Extension

After installing, push the command-line flags and CFC extension:

```bash
# Push Chromium command-line flags (memory limits, Copilot disable, host-resolver rules)
bash ~/git/termux-tools/edge-fix/scripts/push-flags.sh

# Push CFC extension for sideloading via --load-extension
bash ~/git/termux-tools/edge-fix/scripts/push-extension.sh

# Force-stop and relaunch Edge to pick up flags
adb shell am force-stop com.microsoft.emmx.canary
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
  -a android.intent.action.VIEW -d "https://example.com"
```

## Post-Build: Verify

### 1. App launches without crash
```bash
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
  -a android.intent.action.VIEW -d "https://example.com"
# Should load normally, no crash dialog
```

### 2. Telemetry sink is receiving redirected requests
```bash
# Check if the tmx dashboard telemetry sink (port 18971) is receiving hits
curl -s http://127.0.0.1:18971/stats 2>/dev/null || echo "Telemetry sink not running"

# Or watch logcat for blocked telemetry
adb logcat -d | grep -i 'OneCollector\|aria\|adjust\|appcenter' | tail -10
```

### 3. Command-line flags are active
```bash
# Navigate to edge://version in the browser, check "Command Line" section
# Or verify via logcat:
adb logcat -d -s chromium | grep 'command.line\|flags' | tail -5
```

### 4. CFC extension loaded
```bash
curl -s http://127.0.0.1:18963/health | python3 -m json.tool
# Should show "clients": 1 (extension connected to bridge)
```

### 5. Copilot UI removed
Take a screenshot and verify no Copilot button in toolbar, no AI suggestions in address bar, no Copilot card on new tab page.

## Config Files Reference

| File | Purpose | Format |
|------|---------|--------|
| `config/strip-permissions.list` | Manifest permissions to remove | One permission per line |
| `config/strip-components.list` | Manifest components to remove | `type\|fully.qualified.ClassName` |
| `config/strip-metadata.list` | Manifest meta-data to remove | `android:name` value per line |
| `config/strip-queries.list` | Manifest package queries to remove | Package name per line |
| `config/targeted-stubs.list` | DEX methods to stub (return default) | `smali_path\|method_name` |
| `config/neutralize-libs.list` | DEX files with loadLibrary to NOP | Smali file path per line |
| `config/replace-urls.list` | Telemetry URLs to redirect | URL per line (replaced with `http://127.0.0.1:18971`) |
| `config/strip-classes.list` | Smali package trees to delete | Package dir prefix per line |
| `config/strip-libs.list` | Native .so files to remove from APK | Zip entry path per line (`lib/arm64-v8a/libXXX.so`) |
| `config/command-line-flags.list` | Chromium flags pushed to device | One flag per line (joined at push time) |

All config files support `#` comments and blank lines.

## Common Issues

### `IncompatibleClassChangeError` on launch
A DEX file was round-tripped through baksmali/smali but contains Java 8+ interface static methods that break during reassembly. The build script avoids this by only decompiling DEX files listed in the targeted config files. If a new config entry targets a class in `classes4.dex` (known problematic), use binary string replacement or `--host-resolver-rules` flags instead.

### `apktool` resource ID renumbering
Apktool's full decode/rebuild changes resource IDs, breaking runtime lookups. The build script uses `apktool d -s` (skip smali) for manifest-only decode, and standalone baksmali/smali for DEX work, avoiding this entirely.

### Split APK signature mismatch
All APKs in an `install-multiple` must be signed with the same key. The build script re-signs all splits (not just base). If you get `INSTALL_FAILED_INVALID_APK`, check that `edge-fix.keystore` exists and wasn't regenerated between builds.

### `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
Must uninstall the original Edge Canary first (`adb uninstall com.microsoft.emmx.canary`) because the signing key differs. This loses browser data.

### `INSTALL_FAILED_INSUFFICIENT_STORAGE`
The signed base APK is ~259MB. Ensure sufficient device storage. Delete old `edge-fix/work/` and `edge-fix/output/` to reclaim ~1GB.

### Build fails on "apksigner not found"
Install Android SDK build-tools. The script searches multiple paths under `~/android-tools/android-sdk/build-tools/` and `~/android-sdk/build-tools/`. Ensure at least one version (34.0.0 or 35.0.0) is installed.

### classes4.dex can't be patched
Known limitation. `classes4.dex` contains interfaces with static methods that break baksmali/smali round-trip. Telemetry URLs in that DEX are handled via `--host-resolver-rules` in the command-line flags file instead. The `BuildInfo.isDebugAndroid()` patch does work in classes4 because `BuildInfo` itself is a simple class.

### Flags not taking effect after install
Chromium reads flags from `/data/local/tmp/chrome-command-line` only when `debug_app` is set. Re-run `push-flags.sh` after each install (it sets `settings put global debug_app com.microsoft.emmx.canary`). Then force-stop and relaunch Edge.

## Key Files

| File | Purpose |
|------|---------|
| `edge-fix/build.sh` | Master build pipeline (bash) |
| `edge-fix/scripts/patch-manifest.py` | XML manifest patcher (ElementTree) |
| `edge-fix/scripts/stub-method.py` | Smali method body stubber |
| `edge-fix/scripts/neutralize-loadlibrary.py` | NOP System.loadLibrary calls |
| `edge-fix/scripts/replace-strings.py` | Smali const-string URL replacer |
| `edge-fix/scripts/patch-commandline.py` | Patch BuildInfo.isDebugAndroid() |
| `edge-fix/scripts/push-flags.sh` | Push command-line flags via ADB |
| `edge-fix/scripts/push-extension.sh` | Push CFC extension files via ADB |
| `edge-fix/tools/baksmali-3.0.9-fat.jar` | Standalone baksmali (DEX disassembler) |
| `edge-fix/tools/smali-3.0.9-fat.jar` | Standalone smali (DEX assembler) |
| `edge-fix/edge-fix.keystore` | APK signing key (auto-generated on first build) |

## Adding New Patches

### To block a new telemetry URL
Add the URL to `config/replace-urls.list`. If the URL is in a DEX file that's already being round-tripped (classes.dex, classes2.dex, classes3.dex), it will be patched via smali string replacement. If it's in classes4.dex, add it to `--host-resolver-rules` in `config/command-line-flags.list` instead.

### To stub a new method
Add `smali_classesN/com/package/ClassName.smali|methodName` to `config/targeted-stubs.list`. The smali path prefix determines which DEX file gets decompiled.

### To remove a new manifest component
Add `type|fully.qualified.ClassName` to `config/strip-components.list`. Types: `service`, `receiver`, `provider`, `activity`.

### To strip a new native library
Add `lib/arm64-v8a/libXXX.so` to `config/strip-libs.list`. Only strip libs whose ALL Java callers have been stubbed or NOP'd — otherwise you'll get `UnsatisfiedLinkError` at runtime.
