# Edge Canary — Merge Split APKs into Single APK

Merge the 4 split APKs produced by `build.sh` into a single installable `.apk` file. The merged APK can be installed on any arm64 device with a simple `adb install` instead of `adb install-multiple`.

## Prerequisites

- Completed `build.sh` run (see `edge-build.md` skill)
- Java runtime (`pkg install openjdk-17`)
- APKEditor v1.4.8+ jar at `edge-fix/tools/APKEditor.jar`
- apksigner from Android SDK build-tools

### Install APKEditor (one-time)

```bash
cd ~/git/termux-tools/edge-fix/tools
curl -sL "https://github.com/REAndroid/APKEditor/releases/download/V1.4.8/APKEditor-1.4.8.jar" -o APKEditor.jar
java -jar APKEditor.jar --version
```

## Merge Process

The merge has 4 steps: stage splits, run APKEditor, fix resources.arsc, sign.

### Step 1 — Stage Split APKs

```bash
cd ~/git/termux-tools/edge-fix
mkdir -p $PREFIX/tmp/edge-splits

cp output/EdgeCanary-*-privacy.apk $PREFIX/tmp/edge-splits/base.apk
cp output/signed/split_chrome.apk  $PREFIX/tmp/edge-splits/
cp output/signed/split_config.en.apk $PREFIX/tmp/edge-splits/
cp output/signed/split_on_demand.apk $PREFIX/tmp/edge-splits/
```

### Step 2 — APKEditor Merge

APKEditor handles DEX renumbering (classes5-8.dex), manifest component merging (186 components from split_chrome), and asset copying.

```bash
cd ~/git/termux-tools/edge-fix

VERSION=$(ls output/EdgeCanary-*-privacy.apk | grep -oP '\d+\.\d+\.\d+\.\d+')
MERGED="output/EdgeCanary-${VERSION}-privacy-merged.apk"

java -jar tools/APKEditor.jar m \
    -i $PREFIX/tmp/edge-splits \
    -o "$MERGED"
```

Expected output — 8 DEX files mapped:
```
Added [base] classes.dex -> classes.dex
Added [base] classes2.dex -> classes2.dex
Added [base] classes3.dex -> classes3.dex
Added [base] classes4.dex -> classes4.dex
Added [split_chrome] classes.dex -> classes5.dex
Added [split_chrome] classes2.dex -> classes6.dex
Added [split_chrome] classes3.dex -> classes7.dex
Added [split_on_demand] classes.dex -> classes8.dex
```

### Step 3 — Fix resources.arsc (Critical)

APKEditor merges `resources.arsc` from `split_config.en.apk` into the base resource table. This **corrupts night-mode resource qualifiers**, breaking dark mode (white backgrounds, dark-on-dark text).

Fix: replace the merged `resources.arsc` with the original base one. The base already has default English strings, so the only loss is en-GB locale overrides (negligible).

```bash
cd ~/git/termux-tools/edge-fix

# Extract original base resources.arsc
unzip -o output/EdgeCanary-*-privacy.apk resources.arsc -d $PREFIX/tmp/

# Delete the corrupted merged resources.arsc
zip -d "$MERGED" resources.arsc

# Add back the original, stored uncompressed (Android requires this for targetSdk >= 30)
(cd $PREFIX/tmp && zip -0 ~/git/termux-tools/edge-fix/"$MERGED" resources.arsc)

# Verify: must show "Stored" (0% compression), size ~2,001,008 bytes
unzip -v "$MERGED" resources.arsc | grep resources
```

**Why `-0` is required:** Android rejects APKs targeting R+ (SDK 30+) if `resources.arsc` is deflate-compressed. The `-0` flag stores it uncompressed with 4-byte alignment.

### Step 4 — Sign

```bash
cd ~/git/termux-tools/edge-fix

APKSIGNER="$HOME/android-sdk/build-tools/35.0.0/apksigner"

"$APKSIGNER" sign \
    --ks edge-fix.keystore \
    --ks-key-alias edge-fix \
    --ks-pass "pass:edge-fix-key" \
    --key-pass "pass:edge-fix-key" \
    "$MERGED"

# Verify signature
"$APKSIGNER" verify "$MERGED"
```

### Cleanup

```bash
rm -rf $PREFIX/tmp/edge-splits $PREFIX/tmp/resources.arsc
```

## Install

```bash
# On same device (upgrade over existing patched install)
adb install -r "$MERGED"

# On a new device (first install — must uninstall stock Edge first if present)
adb uninstall com.microsoft.emmx.canary  # only if stock version installed
adb install "$MERGED"
```

**After install**, push command-line flags (same as split install):

```bash
FLAGS=$(grep -v '^#' config/command-line-flags.list | grep -v '^$' | tr '\n' ' ')
echo "_ $FLAGS" | adb shell "cat > /data/local/tmp/com.microsoft.emmx.canary-command-line"

# Push CFC extension
bash scripts/push-extension.sh

# Force-stop and relaunch
adb shell am force-stop com.microsoft.emmx.canary
adb shell am start -n com.microsoft.emmx.canary/com.google.android.apps.chrome.IntentDispatcher \
    -a android.intent.action.VIEW -d "https://example.com"
```

## All-in-One Script

```bash
cd ~/git/termux-tools/edge-fix

VERSION=$(ls output/EdgeCanary-*-privacy.apk | grep -oP '\d+\.\d+\.\d+\.\d+')
MERGED="output/EdgeCanary-${VERSION}-privacy-merged.apk"
APKSIGNER="$HOME/android-sdk/build-tools/35.0.0/apksigner"

# Stage
mkdir -p $PREFIX/tmp/edge-splits
cp output/EdgeCanary-*-privacy.apk $PREFIX/tmp/edge-splits/base.apk
cp output/signed/split_chrome.apk output/signed/split_config.en.apk \
   output/signed/split_on_demand.apk $PREFIX/tmp/edge-splits/

# Merge
java -jar tools/APKEditor.jar m -i $PREFIX/tmp/edge-splits -o "$MERGED"

# Fix resources.arsc
unzip -o output/EdgeCanary-*-privacy.apk resources.arsc -d $PREFIX/tmp/
zip -d "$MERGED" resources.arsc
(cd $PREFIX/tmp && zip -0 ~/git/termux-tools/edge-fix/"$MERGED" resources.arsc)

# Sign
"$APKSIGNER" sign --ks edge-fix.keystore --ks-key-alias edge-fix \
    --ks-pass "pass:edge-fix-key" --key-pass "pass:edge-fix-key" "$MERGED"

# Cleanup
rm -rf $PREFIX/tmp/edge-splits $PREFIX/tmp/resources.arsc

echo "Done: $MERGED ($(du -h "$MERGED" | cut -f1))"
```

## What the Merge Does

| Split APK | Contents | Merge Action |
|-----------|----------|--------------|
| `base.apk` | classes1-4.dex, manifest, resources, 11 arm64 native libs (210MB) | Base of merged APK |
| `split_chrome.apk` | classes5-7.dex, 186 manifest components, 4 asset files | DEX renumbered, components merged into manifest, assets copied |
| `split_config.en.apk` | English locale `.pak`, `resources.arsc` | Asset copied, **resources.arsc discarded** (replaced with base original) |
| `split_on_demand.apk` | classes8.dex | DEX renumbered, manifest merged |

## Known Issues

### Dark mode broken (white backgrounds, dark-on-dark menus)
Step 3 was skipped or `resources.arsc` was added compressed. Re-run step 3 with `zip -0` (store, no compression).

### `Failure [-124: ... resources.arsc ... stored uncompressed and aligned on a 4-byte boundary]`
The `resources.arsc` was added with deflate compression. Use `zip -0` not `zip` or `zip -j`.

### Signature mismatch on upgrade
The merged APK uses the same `edge-fix.keystore` as split installs. It can upgrade over any previous patched build. It **cannot** upgrade over a Play Store / stock install (different signing key — must uninstall first).

### APKEditor not found
Download from GitHub releases:
```bash
curl -sL "https://github.com/REAndroid/APKEditor/releases/download/V1.4.8/APKEditor-1.4.8.jar" \
    -o ~/git/termux-tools/edge-fix/tools/APKEditor.jar
```

### en-GB locale differences
The merged APK loses en-GB string overrides from `split_config.en.apk` because we discard its `resources.arsc`. The base APK's default English strings are used instead. This is cosmetic (e.g., "colour" vs "color") and has no functional impact.
