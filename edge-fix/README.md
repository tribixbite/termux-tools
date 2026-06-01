# Edge Canary Privacy Fix

Modular pipeline to strip telemetry, tracking, and analytics from Microsoft Edge Canary for Android. Produces a re-signed split APK bundle that can be installed on any arm64 device.

## What it does

**Manifest (56 removals):**
- Tracking permissions: `AD_ID`, `ADSERVICES`, `RECEIVE_SMS`, `QUERY_ALL_PACKAGES`
- Device ID vendor queries: MSA, Samsung, Coolpad, OPPO
- Adjust SDK content provider (auto-initialization)
- Huawei HMS/AGConnect (8 components), Xiaomi Push (6), Google DataTransport/Firebase (6)
- KOOM heap monitoring, Citrix MITM proxy (4 components)
- Play Store stamp/split metadata

**DEX method stubs (23 methods across 3 DEX files):**
- OneAuth cross-app token sharing
- Intune MAM background handlers (neutered but kept in manifest)
- OneDS telemetry init + native library loader
- Microsoft LogManager (initialize, flush, upload, setTransmitProfile)
- Adjust SDK fully neutered (10 methods: tracking, lifecycle, attribution, push)
- Tencent Matrix trace-canary native callers

**Native library neutralization (5 files):**
- Citrix ctxlog/log4cpp, KOOM heap dump, Tencent Matrix trace-canary
- `System.loadLibrary()` calls replaced with `nop`

**Telemetry URL replacement (30+ endpoints to `127.0.0.1`):**
- Microsoft OneCollector + ARIA (9 regional collectors)
- Adjust SDK (8 domains, `.com` + `.io` variants)
- App Center crash reporting, ECS experiment flags
- Google Analytics, OAID advertising config, token share config

## Install (pre-built)

The build produces two install formats in `output/`:

- `EdgeCanary-VERSION-privacy-merged.apk` — a **single APK** (base + splits combined). Easiest: installs with any installer, no split juggling.
- `EdgeCanary-VERSION-privacy.apk` + `signed/split_*.apk` — the split bundle.

### First install (signature mismatch — wipes Edge data)

A self-signed build can't replace the Play Store version in place. The first
install from this keystore requires uninstalling the original, which **wipes Edge
data**.

```bash
adb uninstall com.microsoft.emmx.canary

# Single merged APK (recommended):
adb install output/EdgeCanary-VERSION-privacy-merged.apk

# …or the split bundle:
adb install-multiple \
  output/EdgeCanary-VERSION-privacy.apk \
  output/signed/split_chrome.apk \
  output/signed/split_config.en.apk \
  output/signed/split_on_demand.apk
```

### In-place update — NO data wipe

If the device is **already running a build signed with this same keystore**,
Android accepts an update because the signatures match — bookmarks, logins, and
settings are preserved. Do **not** uninstall first:

```bash
adb install -r output/EdgeCanary-VERSION-privacy-merged.apk   # merged, or
adb install-multiple -r \
  output/EdgeCanary-VERSION-privacy.apk output/signed/split_*.apk
```

This is why `edge-fix.keystore` must be kept stable across builds.

### Via SAI (no ADB needed)

1. Install [SAI (Split APKs Installer)](https://f-droid.org/packages/com.aefyr.sai.fdroid/) on the target device
2. Bundle the APKs into a single file:
   ```bash
   cd output
   zip EdgeCanary-privacy.apks \
     EdgeCanary-*-privacy.apk \
     signed/split_chrome.apk \
     signed/split_config.en.apk \
     signed/split_on_demand.apk
   ```
3. Transfer `EdgeCanary-privacy.apks` to the target device
4. Open it with SAI to install

### Via Quick Share

Copy the 4 signed APKs to shared storage, then send via Quick Share / Nearby Share:
```bash
mkdir -p ~/storage/shared/edge-fix
cp output/EdgeCanary-*-privacy.apk ~/storage/shared/edge-fix/base.apk
cp output/signed/split_*.apk ~/storage/shared/edge-fix/
```
On the receiving device, install the 4 APKs together using SAI or ADB.

## Build from your installed Canary (easiest)

`build-from-device.sh` pulls the split APKs from the Edge Canary already
installed on a connected device, bundles them, and runs the full pipeline — no
APKMirror download or AppManager export needed.

```bash
./build-from-device.sh                 # build only → output/
./build-from-device.sh --install       # build, then in-place update (no wipe)
./build-from-device.sh -s <serial>     # pick a device when several are connected
```

The result is signed with `edge-fix.keystore`. The **first** switch from the
Play Store build needs an uninstall (signature mismatch wipes data); after that,
every rebuild updates in place because the signature matches. Requires `adb`
plus the build prerequisites below.

## Build from source

### Prerequisites

- `apktool` 2.10+
- `zipalign` + `apksigner` (Android SDK build-tools)
- `python3`
- `java` (JDK 11+)
- `baksmali` + `smali` v3.0.9 fat jars in `tools/`

### Build

```bash
# Auto-detect latest Edge Canary .apks from AppManager exports
./build.sh

# Or specify the input bundle
./build.sh /path/to/Edge_Canary_VERSION.apks
```

Output goes to `output/`. A signing keystore is auto-generated on first run at `edge-fix.keystore` — keep it consistent across builds to allow in-place updates without uninstalling.

### Reapply to a new release

1. Export the new Edge Canary from AppManager (or download from APKMirror)
2. Run `./build.sh /path/to/new.apks`
3. Install as above

## Architecture

```
build.sh                          # 6-step pipeline orchestrator
config/
  # manifest surgery (read by patch-manifest.py)
  strip-permissions.list          # <uses-permission> names to remove
  strip-components.list           # activity|service|provider|receiver names
  strip-queries.list              # <queries> package names (device-ID probes)
  strip-metadata.list             # <meta-data> names to remove
  # DEX surgery (read by build.sh)
  targeted-stubs.list             # per-method stubs (smali_path|method_name)
  neutralize-libs.list            # files with loadLibrary calls to NOP
  replace-urls.list               # telemetry URLs to redirect to 127.0.0.1
  strip-classes.list              # whole smali package trees to delete
  # APK assembly
  strip-libs.list                 # native .so files to drop (~36MB saved)
  # runtime (not used by build.sh)
  command-line-flags.list         # Chromium flags pushed by push-flags.sh
  smali-stubs.list                # legacy whole-class stub list (unused;
                                  #   superseded by targeted-stubs.list)
scripts/
  patch-manifest.py               # XML-based manifest surgery
  patch-manifest.sh               # wrapper for manifest patching
  stub-method.py                  # replace method body with safe return default
  neutralize-loadlibrary.py       # replace System.loadLibrary with nop
  replace-strings.py              # replace const-string/annotation URL values
  patch-commandline.py            # patch BuildInfo.isDebugAndroid() → true
  patch-dex-strings.py            # binary DEX string replacement (disabled)
  push-flags.sh                   # push command-line flags to /data/local/tmp
  push-extension.sh               # sideload the CFC extension over ADB
tools/
  baksmali-3.0.9-fat.jar          # standalone DEX decompiler (not in git)
  smali-3.0.9-fat.jar             # standalone DEX compiler (not in git)
  APKEditor.jar                   # merges splits → single APK (Step 6)
```

Pipeline steps: (1) extract `.apks`, (2) patch manifest, (3) patch DEX
(method stubs, loadLibrary NOPs, URL redirects, class stripping, `BuildInfo`
command-line gate), (4) assemble — copy original APK and replace only the
patched DEX + manifest, strip unused libs/assets, (5) sign all APKs, (6) merge
splits into a single installable APK and re-sign.

The pipeline copies the original APK and replaces only the patched files (DEX + manifest), preserving all resources, native libs, and unmodified DEX files byte-for-byte.

## Known limitations

- **classes4.dex is unpatched** — contains interfaces with static methods that cause `IncompatibleClassChangeError` after baksmali/smali round-trip. Binary string replacement also fails (breaks DEX string table sort order). Three URLs remain active: Chrome variations seed, crash reporter (already invalid domain), rewards API.
- **Chromium UMA metrics** — baked into native `.so` libs with no Java entry point.
- **User-configurable telemetry** — account sync, search suggestions, Copilot features are controlled via Edge settings at runtime.
