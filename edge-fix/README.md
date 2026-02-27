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

Requires uninstalling the Play Store version first (signature mismatch).

### Via ADB

```bash
adb uninstall com.microsoft.emmx.canary
adb install-multiple \
  output/EdgeCanary-VERSION-privacy.apk \
  output/signed/split_chrome.apk \
  output/signed/split_config.en.apk \
  output/signed/split_on_demand.apk
```

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
build.sh                          # 5-step pipeline orchestrator
config/
  targeted-stubs.list             # methods to stub (smali_path|method_name)
  neutralize-libs.list            # files with loadLibrary calls to NOP
  replace-urls.list               # telemetry URLs to redirect to 127.0.0.1
scripts/
  patch-manifest.py               # XML-based manifest surgery
  patch-manifest.sh               # wrapper for manifest patching
  stub-method.py                  # replace method body with safe return default
  neutralize-loadlibrary.py       # replace System.loadLibrary with nop
  replace-strings.py              # replace const-string/annotation URL values
  patch-dex-strings.py            # binary DEX string replacement (disabled)
tools/
  baksmali-3.0.9-fat.jar          # standalone DEX decompiler (not in git)
  smali-3.0.9-fat.jar             # standalone DEX compiler (not in git)
```

The pipeline copies the original APK and replaces only the patched files (DEX + manifest), preserving all resources, native libs, and unmodified DEX files byte-for-byte.

## Known limitations

- **classes4.dex is unpatched** — contains interfaces with static methods that cause `IncompatibleClassChangeError` after baksmali/smali round-trip. Binary string replacement also fails (breaks DEX string table sort order). Three URLs remain active: Chrome variations seed, crash reporter (already invalid domain), rewards API.
- **Chromium UMA metrics** — baked into native `.so` libs with no Java entry point.
- **User-configurable telemetry** — account sync, search suggestions, Copilot features are controlled via Edge settings at runtime.
