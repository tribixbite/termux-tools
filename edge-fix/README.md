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

## From scratch on a new phone (full reproduction)

End-to-end: build the slimmed dark-mode Edge Canary and provision it with the CFC
bridge extension + CDP. Runs entirely on-device in Termux (no PC).

### 0. Prerequisites (one-time)

```bash
pkg install apktool zipalign openjdk-17 python3 android-tools   # adb, apksigner-adjacent
# apksigner comes from Android SDK build-tools; any recent version works:
ls ~/android-sdk/build-tools/*/apksigner   # e.g. 30.0.3
# standalone baksmali/smali v3.0.9 fat jars (avoid apktool's buggy round-trip):
ls tools/{baksmali,smali}-3.0.9-fat.jar
# APKEditor is only needed for the (discouraged) merged APK:
ls tools/APKEditor.jar
```

Two Termux gotchas the build depends on:

- **apktool / apksigner are `#!/bin/bash` wrapper scripts.** Under a plain Termux
  shell they run fine (libtermux-exec rewrites the shebang). If you invoke the
  build from an automation harness that strips `LD_PRELOAD`, prefix it:
  `LD_PRELOAD=$PREFIX/lib/libtermux-exec.so bash -c './build.sh …'`.
- **apktool must know the APK's `compileSdk` attributes.** Edge 154 declares
  `android:nativeService` (API 37). Install a matching framework once, or the
  manifest recompile fails with `attribute … not found`:
  ```bash
  apktool if ~/android-sdk/platforms/android-37/android.jar   # match Edge's compileSdk
  # (if you lack android-37, pull a device framework: adb pull /system/framework/framework-res.apk, then: apktool if framework-res.apk)
  ```

### 1. Get the stock Edge Canary bundle

Download the Canary from APKMirror/APKPure (a zip of `base.apk`, `chrome.apk`,
`config.en.apk`, `on_demand.apk`). Rename the splits to the `split_*` names
`build.sh` expects, add an `info.json`, and zip into a `.apks`:

```bash
mkdir -p work/154-src && unzip -o com.microsoft.emmx.canary.zip -d work/154-src
cd work/154-src
cp chrome.apk split_chrome.apk; cp config.en.apk split_config.en.apk; cp on_demand.apk split_on_demand.apk
V=$($PREFIX/bin/aapt2 dump badging base.apk | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")
echo "{\"version_name\":\"$V\"}" > info.json
zip -0 -j ../Edge_Canary_$V.apks base.apk split_* info.json
cd ../..
```

### 2. Build (slim + patch + sign)

```bash
LD_PRELOAD=$PREFIX/lib/libtermux-exec.so bash -c './build.sh work/Edge_Canary_<version>.apks'
```

Cross-version drift is expected (obfuscated names move). Targets prefixed with
`?` in the config are explicitly optional and may be skipped; every other target
is required and aborts the build if it cannot be patched. If it crashes on launch
after install, the usual causes are documented in `../.claude/memory` and this
repo's history: vendor-SDK class strips (xiaomi/huawei) that newer Edge hard-references, or a
stripped `android:nativeService` attribute. The current `config/` is tuned to
avoid both on 154.

### 3. Install the SPLIT bundle + set up CFC

```bash
# provisions ONE device: split install + CFC extension + flags + debug_app
./setup-cfc-device.sh <adb-serial>
```

`setup-cfc-device.sh` installs the splits (never the merged APK), pushes the
unpacked CFC extension to `/data/local/tmp/cfc-ext`, writes the Chromium
command-line flags (max V8/GPU memory for WebGL + telemetry DNS null-routing +
`--load-extension`), and sets `debug_app` so Edge reads them. Then set
**Settings → Appearance → Dark**.

For the CFC bridge itself (WebSocket server + MCP relay + CRX build) see the
`cfc-edge-bridge.md` skill. The bridge is a Termux process on `localhost:18963`;
a device's extension reaches a bridge running on the same host, or over
`adb reverse tcp:18963 tcp:18963` to a bridge on your build host.

## Install (pre-built)

> ⚠️ **Install the SPLIT bundle, NOT the merged APK.** The merged single APK
> (`*-privacy-merged.apk`, produced by the APKEditor merge) **breaks Edge's dark
> theme** — Appearance=Dark renders as a light chrome — because the merge rebuilds
> and renumbers the combined `resources.arsc`, which breaks DayNight resolution.
> The merge also previously dropped a sandboxed-renderer service class. Only use
> the merged APK if you truly can't do a split install, and expect light chrome.

The build produces these in `output/`:

- `output/signed/{base,split_chrome,split_config.en,split_on_demand}.apk` — the **split bundle** (use this).
- `EdgeCanary-VERSION-privacy-merged.apk` — single APK (convenient but breaks dark mode; see warning).

### First install (signature mismatch — wipes Edge data)

A self-signed build can't replace the Play Store version in place. The first
install from this keystore requires uninstalling the original, which **wipes Edge
data**.

```bash
adb uninstall com.microsoft.emmx.canary
adb install-multiple \
  output/signed/base.apk \
  output/signed/split_chrome.apk \
  output/signed/split_config.en.apk \
  output/signed/split_on_demand.apk
```

### In-place update — NO data wipe

If the device is **already running a build signed with this same keystore**,
Android accepts an update because the signatures match — bookmarks, logins, and
settings are preserved. Do **not** uninstall first:

```bash
adb install-multiple -r output/signed/base.apk output/signed/split_*.apk
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
  targeted-stubs.list             # required/optional per-method stubs
  neutralize-libs.list            # required/optional loadLibrary calls to NOP
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
  patch-commandline.py            # enable flags + suppress per-tab warning
  patch-dex-strings.py            # binary DEX string replacement (disabled)
  push-flags.sh                   # push command-line flags to /data/local/tmp
  push-extension.sh               # sideload the CFC extension over ADB
tools/
  baksmali-3.0.9-fat.jar          # standalone DEX decompiler (not in git)
  smali-3.0.9-fat.jar             # standalone DEX compiler (not in git)
  APKEditor.jar                   # merges splits → single APK (Step 6)
```

Pipeline steps: (1) extract `.apks`, (2) patch manifest, (3) patch DEX
(method stubs, loadLibrary NOPs, URL redirects, class stripping, Chromium
command-line behavior), (4) assemble — copy original APK and replace only the
patched DEX + manifest, strip unused libs/assets, (5) sign and verify all APKs,
(6) optionally merge splits into a single installable APK and re-sign.

Every DEX is patched before that exact smali tree is assembled. The build
verifies that the manifest and patched DEX bytes inserted into the APK match
their generated files, then checks ZIP alignment, signatures, and signer
equality across the base and splits.

DEX config entries are required by default and fail the build when their class,
method, or loadLibrary call is absent. Prefix a path with `?` only for a
known version-dependent target; optional misses are reported in the build log.

## Known limitations

- **The merged single APK breaks the dark theme.** APKEditor's merge rebuilds the combined `resources.arsc` across base+splits, and the reprocessed table breaks Edge's DayNight resolution (Dark → light chrome). It also previously dropped a sandboxed-service class. **Install the split bundle** (`adb install-multiple` or SAI) — see the warning under _Install_.
- **classes4.dex gets only the required command-line warning patch.** Edge 154
  keeps `org/chromium/base/CommandLine` there, so that DEX is round-tripped and
  byte-checked. URL-only targets in the same DEX remain unchanged because binary
  DEX string replacement breaks string-table ordering. Device-test new Edge
  versions because older smali toolchains had interface-static-method issues.
- **Chromium UMA metrics** — baked into native `.so` libs with no Java entry point.
- **User-configurable telemetry** — account sync, search suggestions, Copilot features are controlled via Edge settings at runtime.
