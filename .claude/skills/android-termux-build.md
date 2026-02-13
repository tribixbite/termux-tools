# Android Development on Termux ARM64

## Critical Build Rule
**NEVER** run `cd android && ./gradlew assembleDebug` directly — it will fail with AAPT2 errors on ARM64.
**ALWAYS** use the build script: `./build-and-install.sh` or `./build-and-install.sh clean`

## Build Script (`build-and-install.sh`)
The build script handles the full pipeline:
1. Web build (if Capacitor hybrid app)
2. Capacitor sync
3. Gradle build using custom ARM64 AAPT2 at `tools/aapt2-arm64/aapt2`
4. Multi-tier APK installation (termux-open → ADB wireless → manual copy)

```bash
./build-and-install.sh            # Standard build + install
./build-and-install.sh clean      # Clean build (slower, fixes stale cache issues)
```

## ADB Wireless Workflow
ADB auto-reconnects every 5 minutes via cron. Manual reconnect:
```bash
adb devices                       # Check connection
adb connect localhost:5555        # Reconnect if needed
pwrup                             # Scan and connect all ADB ports (bash alias)
```

### ADB Best Practices
- After changing UI/settings for tests, **restore original state** ("leave no trace")
- Never reboot device or clear app data without explicit permission
- Always grep existing logcat before clearing — verify timestamps match current test
- Screenshot capture: `adb shell screencap -p /sdcard/screenshot.png`

## APK Installation
Priority order (build script handles this):
1. `termux-open app/build/outputs/apk/debug/app-debug.apk` (opens Android installer)
2. `adb install -r app/build/outputs/apk/debug/app-debug.apk` (wireless ADB)
3. Manual copy to Downloads, install from file manager

## Testing
```bash
./test-adb.sh                     # Requires TestActivity in built APK
```

## Capacitor Hybrid Apps
For web apps wrapped with Capacitor:
```bash
bun run build                     # Build web assets
npx cap sync android              # Sync to android/ directory
./build-and-install.sh            # Build APK with custom AAPT2
```

## APK Signing
Release builds use keystore configured via environment variables:
```bash
$RELEASE_KEYSTORE                 # Path to .keystore file
$RELEASE_KEYSTORE_PASSWORD        # Keystore password
$RELEASE_KEY_ALIAS                # Key alias
$RELEASE_KEY_PASSWORD             # Key password
```

## Project Documentation
For Android projects, maintain specs in `docs/specs/` with a `docs/specs/README.md` table of contents. Update specs when architecture or features change.
