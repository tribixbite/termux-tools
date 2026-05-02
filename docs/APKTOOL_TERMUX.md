# apktool on Termux — install + working APK round-trip

How to install `apktool` on aarch64 Termux and use it to **patch + re-sign**
an existing APK in a way that actually installs and runs. The naive default
recipe will look correct, install successfully, and silently break the app
in ways that aren't logged. The notes below capture the four traps that took
hours to find each.

## TL;DR

```bash
yes | pkg install apktool aapt2 zipalign apksigner openjdk-21
```

Then use `--no-src` and Termux's native `aapt2` for every rebuild:

```bash
apktool d -f --no-src -o foo_decoded foo.apk           # decode WITHOUT smali
# … edit foo_decoded/AndroidManifest.xml or res/* …
apktool b -f --use-aapt2 -a "$(command -v aapt2)" foo_decoded -o foo-patched.apk
zipalign -p -f 4 foo-patched.apk foo-aligned.apk
apksigner sign --ks my.keystore --ks-pass pass:android \
    --ks-key-alias my --key-pass pass:android \
    --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
    --out foo-signed.apk foo-aligned.apk
adb install -r foo-signed.apk
```

If you skip any of the flags above your APK will install but the app will
silently freeze on splash, refuse to update, or fail at the verifier with
no logcat output. The rest of this doc is *why*.

## 1. Install

Termux ships everything in `main` and `x11` repos:

```bash
pkg install apktool aapt2 zipalign apksigner openjdk-21
```

Versions seen working at the time of writing (Termux May 2026):

| Package    | Version    | Notes |
|------------|-----------|-------|
| apktool    | 2.x       | Java jar wrapped in a shell script. Bundles a stale x86_64 `aapt2` that fails ELF-exec on aarch64. |
| aapt2      | 35.0.x    | Termux-native aarch64 build. Use this, not apktool's bundled one. |
| zipalign   | 35.0.x    | From `build-tools`. |
| apksigner  | 33.0.1+   | The package is just `apksigner` (not `apksigner-commandline` — that name doesn't exist in any Termux repo). |
| openjdk-21 | 21.x      | Bring your own JRE. apktool/apksigner won't run without one. |

Verify:

```bash
apktool --version       # → 2.x
aapt2 version           # → Android Asset Packaging Tool 2 ...
file "$(command -v aapt2)"   # → ASCII text executable (it's a wrapper script)
zipalign -h 2>&1 | head -1   # → Zip alignment utility
apksigner --version     # → 0.9 or higher
java -version 2>&1 | head -1 # → openjdk version "21..."
```

## 2. Trap #1 — apktool's bundled aapt2 isn't aarch64

apktool ships a vendored `aapt2` binary inside its jar and extracts it on
each build into `$TMPDIR/brut_util_Jar_*.tmp`. That binary is x86-64 ELF;
on aarch64 Termux the kernel rejects it:

```
brut.androlib.exceptions.AndrolibException: brut.common.BrutException:
  could not exec (exit code = 2): [/.../brut_util_Jar_*.tmp, compile, ...]
W: ELF: not found
W: Syntax error: "(" unexpected
```

Always pass `--use-aapt2 -a "$(command -v aapt2)"` to point apktool at
Termux's native aapt2:

```bash
apktool b -f --use-aapt2 -a "$(command -v aapt2)" base_decoded -o base-patched.apk
```

(`--use-aapt2` alone isn't enough — apktool will still extract its own bundled
binary first. The `-a <path>` makes it use yours.)

## 3. Trap #2 — `apktool d` rebakes DEX by default; ART hangs on the result

This is the most painful failure mode because it gives **no error**. The
rebuilt APK installs fine, the process starts, the splash screen appears,
and then nothing. No crash, no logcat, no tombstone. `dumpsys` shows the
process alive with one thread parked in `futex_wait_queue_me` and
`libflutter.so` / `libapp.so` never loaded.

What's happening: `apktool d` extracts every `classes*.dex` to smali source.
`apktool b` re-encodes that smali back to DEX. The encoder's output is
**byte-different** from Google's d8/dexlib output — same semantics, different
encoding. ART's verifier on Android 14+ sometimes hangs indefinitely on the
mismatched bytecode.

Fix: pass `--no-src` so apktool never touches the DEX files:

```bash
apktool d -f --no-src -o base_decoded base.apk
# now base_decoded/ has AndroidManifest.xml + res/ but NO smali/
apktool b -f --use-aapt2 -a "$(command -v aapt2)" base_decoded -o base-patched.apk
# rebuild copies the original classes*.dex straight into the new ZIP
```

If you need to actually edit DEX (modify Java code), reach for a different
tool — `dexlib2` directly, or `jadx` + recompile, or [LSPatch] / [APKEditor].
`apktool b` is fine for resource-only patches; everything else lies.

## 4. Trap #3 — `<meta-data android:resource="@null"/>` is rejected on install

Some apps (anything that uses an old Firebase Messaging template) ship:

```xml
<meta-data android:name="com.google.firebase.messaging.default_notification_icon"
           android:resource="@null"/>
```

apktool decodes `@null` faithfully, re-encodes it as a null reference in
binary AXML, and the platform installer on Android 14+ rejects it:

```
INSTALL_PARSE_FAILED_MANIFEST_MALFORMED:
  Failed parse during installPackageLI: ... <meta-data> requires an
  android:value or android:resource attribute
```

Replace `@null` with any valid resource ID before rebuilding:

```bash
sed -i 's|default_notification_icon" android:resource="@null"|default_notification_icon" android:resource="@mipmap/ic_launcher"|' \
  base_decoded/AndroidManifest.xml
```

(The behavioural difference is purely cosmetic — Firebase will use the app
icon as the fallback notification icon. The original `@null` was the same
thing in spirit, just a stricter parser now.)

## 5. Trap #4 — split APKs need ALL splits re-signed with the same key

Modern apps ship as bundles: `base.apk` plus `split_config.arm64_v8a.apk`,
`split_config.en.apk`, `split_config.xxhdpi.apk`, etc. PackageManager
requires every split in a single install to be signed by the **same**
certificate.

If you only re-sign `base.apk` and try to install the original splits
alongside it, the install fails with `INSTALL_FAILED_INVALID_APK` or
`INCONSISTENT_CERTIFICATES`. Sign every split with the same keystore:

```bash
for s in base-patched.apk split_config.arm64_v8a.apk split_config.en.apk split_config.xxhdpi.apk; do
    zipalign -p -f 4 "$s" "aligned-$s"
    apksigner sign --ks my.keystore --ks-pass pass:android \
        --ks-key-alias my --key-pass pass:android \
        --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
        --out "signed-$s" "aligned-$s"
done

adb install-multiple -r --user 0 \
    signed-base-patched.apk \
    signed-split_config.arm64_v8a.apk \
    signed-split_config.en.apk \
    signed-split_config.xxhdpi.apk
```

`--v1-signing-enabled false` matters: Android 11+ rejects v1-only
signatures on split APKs. v2 + v3 both must be enabled.

`zipalign -p` is mandatory for any APK that has `extractNativeLibs="false"`
in its manifest — native `.so` files inside the ZIP must be page-aligned
to 16384 bytes (modern devices) or 4096 bytes (older devices) so they can
be `mmap()`'d directly from the APK without extraction. Run `zipalign -p -c -v 4`
to verify alignment after signing — `apksigner` may rewrite the central
directory and you should re-check.

## 6. Generating a keystore (one-time)

```bash
keytool -genkey -v -keystore my.keystore -alias my \
    -storepass android -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=local-dev,O=local,OU=local,L=local,S=local,C=US"
```

Same store + alias for every signing run keeps the certificate stable, which
matters because:

- Once you've installed an APK signed with `my.keystore`, you can update it
  with another APK signed by the same key. Switch keys → must uninstall first
  (which wipes app data — including any encrypted credentials, OAuth tokens,
  cached certs the app cares about).
- Save the keystore. Losing it means every future install of that
  package on every device requires a full uninstall.

`-storepass android -keypass android` is the convention for debug-style
keystores; lock both with stronger passwords if the keystore goes anywhere
beyond your dev machine.

## 7. Verifying the result

After signing, before installing:

```bash
apksigner verify --print-certs signed-base.apk        # should print your DN
apksigner verify --verbose signed-base.apk            # confirms v2 + v3
zipalign -p -c -v 4 signed-base.apk | grep -E 'OK|FAIL'   # alignment sanity
```

After installing:

```bash
adb shell dumpsys package <pkg> | grep -E 'flags|versionName|userId'
# look for the flag you patched (DEBUGGABLE etc.)
adb shell pidof <pkg>                # process is alive
adb shell run-as <pkg> id            # debuggable=true unlocks this
```

If the app freezes on splash and `pidof` reports 1 thread + parked in
`futex_wait_queue_me` — it's Trap #2. Re-decode with `--no-src`.

## 8. Common patches

| What | Where | One-liner |
|------|-------|-----------|
| Make app debuggable | `<application>` in AndroidManifest.xml | `sed -i 's|<application |<application android:debuggable="true" |' AndroidManifest.xml` |
| Trust user CAs | `res/xml/network_security_config.xml` (only honoured if app's manifest references one) | Add `<certificates overridePins="true" src="user" />` inside `<base-config><trust-anchors>` |
| Allow cleartext | `<base-config>` in NSC | `cleartextTrafficPermitted="true"` |
| Allow backup (for `adb backup`) | `<application>` | Replace `android:allowBackup="false"` with `"true"` |
| Lower minSdk for older devices | `<uses-sdk>` | `android:minSdkVersion="24"` (lower at your own risk) |

`debuggable="true"` is doing the most lifting in any RE workflow:
- `adb shell run-as <pkg>` works (no root needed, sees app's private dir)
- Frida attaches via JDWP, no Zygisk required
- lldb attaches via `lldbserver` running under run-as
- `<network-security-config>`'s `<debug-overrides>` block activates,
  trusting user-installed CAs with `overridePins="true"` — the
  proper-use-case hook for traffic interception.

## 9. References

- Production example in this org: `~/git/x2d/runtime/handy_extract/patch_handy_debuggable.sh`
  — patches Bambu Handy v3.19.0 (Flutter app, ~180 MB split bundle, Promon
  shield, anti-tamper hardened). Hits all four traps in this doc; the script
  is annotated with what failed without each fix.
- apktool docs: https://apktool.org/docs/the-basics/decoding-and-rebuilding
- aapt2 docs: https://developer.android.com/tools/aapt2
- apksigner docs: https://developer.android.com/tools/apksigner
- Android 16K page support (the page-alignment requirement):
  https://developer.android.com/guide/practices/page-sizes

[LSPatch]: https://github.com/JingMatrix/LSPatch
[APKEditor]: https://github.com/REAndroid/APKEditor
