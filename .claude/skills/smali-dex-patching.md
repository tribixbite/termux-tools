# Smali/DEX Patching -- Android APK Code Modification

Modify Dalvik bytecode in Android APKs by disassembling DEX files to smali, patching the text-based smali, and reassembling. Used in the edge-fix pipeline to strip telemetry, stub methods, neutralize native library loads, and redirect URLs.

## Tools

### baksmali/smali v3.0.9 Standalone Jars

**Always use standalone jars, NOT apktool's bundled version.** Apktool's internal smali has round-trip bugs with Java 8+ interface static methods (`IncompatibleClassChangeError` on launch).

```bash
# Install (one-time)
cd ~/git/termux-tools/edge-fix/tools
curl -LO https://github.com/google/smali/releases/download/v3.0.9/baksmali-3.0.9-fat.jar
curl -LO https://github.com/google/smali/releases/download/v3.0.9/smali-3.0.9-fat.jar

# Disassemble DEX to smali
java -jar baksmali-3.0.9-fat.jar d classes.dex -o smali_out

# Reassemble smali to DEX
java -jar smali-3.0.9-fat.jar a smali_out -o classes-patched.dex
```

### apktool (Manifest Only)

Use apktool for manifest decode/rebuild (`-s` flag skips smali). Never use it for DEX work.

```bash
# Decode manifest only (skip smali disassembly)
apktool d -s base.apk -o decoded/

# Rebuild after manifest patches
apktool b decoded/ -o patched-base.apk
```

## Three Smali String Contexts

`replace-strings.py` handles three distinct string literal formats in smali:

### 1. `const-string` Instructions

The most common form. Loads a string literal into a register.

```smali
const-string v0, "https://telemetry.example.com/collect"
# also: const-string/jumbo for string pool index > 65535
const-string/jumbo v0, "https://telemetry.example.com/collect"
```

Regex pattern:
```python
r'(const-string(?:/jumbo)?\s+[vp]\d+,\s*")OLD_VALUE(")'
```

### 2. Annotation Values

Found in Retrofit `@Url`, `@BaseUrl`, and similar compile-time annotations.

```smali
.annotation runtime Lretrofit2/http/Url;
    value = "https://telemetry.example.com/api/v1"
.end annotation
```

Regex pattern:
```python
r'(value\s*=\s*")OLD_VALUE(")'
```

### 3. Static Field Initializers

Compile-time constant strings assigned directly in field declarations.

```smali
.field public static final ENDPOINT:Ljava/lang/String; = "https://telemetry.example.com"
```

Regex pattern:
```python
r'(\.field\s+.*:Ljava/lang/String;\s*=\s*")OLD_VALUE(")'
```

### Usage

```bash
python3 scripts/replace-strings.py <smali-file> <old-string> <new-string>

# Example: redirect telemetry URL to local sink
python3 scripts/replace-strings.py \
    smali_out/com/microsoft/telemetry/Config.smali \
    "https://mobile.events.data.microsoft.com" \
    "http://127.0.0.1:18971"
```

## Method Stubbing

Replace a method body with a safe default return. Preserves annotations, parameter declarations, and the method signature. Handles all return types.

### Return Type Mapping

| Smali Type | Java Type | Stub Body |
|---|---|---|
| `V` | void | `return-void` |
| `Z` | boolean | `const/4 v0, 0x0` + `return v0` |
| `B/C/S/I` | byte/char/short/int | `const/4 v0, 0x0` + `return v0` |
| `J` | long | `const-wide/16 v0, 0x0` + `return-wide v0` |
| `F` | float | `const/4 v0, 0x0` + `return v0` |
| `D` | double | `const-wide/16 v0, 0x0` + `return-wide v0` |
| `L...;` / `[...` | Object/array | `const/4 v0, 0x0` + `return-object v0` (returns null) |

### Usage

```bash
python3 scripts/stub-method.py <smali-file> <method-name>

# Example: stub all overloads of "initialize" in Adjust SDK
python3 scripts/stub-method.py \
    smali_out/com/adjust/sdk/Adjust.smali initialize
```

### Stub Body Example

Original method:
```smali
.method public static initialize(Lcom/adjust/sdk/AdjustConfig;)V
    .locals 4
    # 50 lines of initialization logic
    return-void
.end method
```

After stubbing:
```smali
.method public static initialize(Lcom/adjust/sdk/AdjustConfig;)V
    .locals 0

    return-void

.end method
```

### Returning true Instead of Default

For methods like `isDebugAndroid()` that need to return `true`:

```smali
.method public static isDebugAndroid()Z
    .locals 1

    # Patched: enable command-line flags on release builds
    const/4 v0, 0x1
    return v0

.end method
```

## System.loadLibrary() Neutralization

Replace `invoke-static` calls to `System.loadLibrary()` with `nop`. This prevents native telemetry `.so` files from loading while preserving bytecode structure (register counts, branch offsets remain valid).

```bash
python3 scripts/neutralize-loadlibrary.py <smali-file>

# Example: prevent Citrix MAM native lib from loading
python3 scripts/neutralize-loadlibrary.py \
    smali_out/com/citrix/mvpn/api/MvpnApi.smali
```

### What It Matches

```smali
# Before
invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V

# After
nop
```

Both `invoke-static` and `invoke-static/range` forms are handled.

**Important:** Only NOP the loadLibrary call AFTER you have also stripped the corresponding `.so` from the APK. Otherwise the library stays bundled but unused (wasted space). Conversely, stripping a `.so` without NOPping the loadLibrary causes `UnsatisfiedLinkError` at runtime.

## HttpsURLConnection Cast Downgrade

When replacing HTTPS telemetry URLs with HTTP (`http://127.0.0.1:18971`), the connection object is no longer an `HttpsURLConnection`. Any `check-cast` to `javax/net/ssl/HttpsURLConnection` will throw `ClassCastException` at runtime.

### Fix

Change the cast to the parent class `java/net/HttpURLConnection`:

```smali
# Before (crashes with HTTP URLs)
check-cast v0, Ljavax/net/ssl/HttpsURLConnection;

# After (works with both HTTP and HTTPS)
check-cast v0, Ljava/net/HttpURLConnection;
```

### Scope Restriction

Only apply this fix in telemetry/experimentation packages (e.g., `com/microsoft/applications/events/`, `com/microsoft/telemetry/`). **Do NOT change casts in identity/auth code** -- those legitimately need HTTPS and the URLs are not replaced.

The build script (`build.sh`) handles this automatically by scanning only the smali directories of replaced-URL classes.

## BuildInfo.isDebugAndroid() Patch

Chromium reads command-line flags from `/data/local/tmp/<pkg>-command-line` only when `BuildInfo.isDebugAndroid()` returns true (normally checks `ApplicationInfo.FLAG_DEBUGGABLE`). Setting `android:debuggable=true` in the manifest exposes the app to JDWP debugging attacks.

Instead, patch the method itself to always return true:

```bash
python3 scripts/patch-commandline.py <smali-root-dir>
```

Two strategies (auto-selected):
1. **Preferred:** Patch `BuildInfo.isDebugAndroid()` body to `const/4 v0, 0x1; return v0`
2. **Fallback:** Patch `CommandLine.initFromFile()` to NOP the `if-eqz` branch after the debug check

## DEX Replacement in APK

After reassembly, replace DEX files inside the APK:

```bash
# Copy patched DEX with the correct name
cp classes-patched.dex classesN.dex

# Replace inside APK (stored, no compression -- Android requires this)
cd work_dir
zip -j output.apk classesN.dex

# Or replace from a specific directory
(cd smali_output && zip -j /path/to/base.apk classes.dex)
```

**After DEX replacement**, strip `META-INF/` signatures (they're now invalid) and re-sign:
```bash
zip -d base.apk 'META-INF/*'
zipalign -p 4 base.apk base-aligned.apk
apksigner sign --ks keystore.ks base-aligned.apk
```

## classes4.dex Limitation

`classes4.dex` in Edge Canary contains Java 8+ interface static methods that break the baksmali/smali round-trip. Disassembling and reassembling this DEX produces bytecode that causes `IncompatibleClassChangeError` on launch.

### Workarounds

1. **Chromium command-line flags:** For URL-based telemetry, use `--host-resolver-rules` to redirect domains at the network layer:
   ```
   --host-resolver-rules="MAP telemetry.example.com 127.0.0.1:18971"
   ```
   Add to `config/command-line-flags.list` and push with `scripts/push-flags.sh`.

2. **Binary string replacement:** For simple string swaps where the old and new strings are the same byte length, use `sed` or a binary patcher directly on the DEX without disassembly.

3. **Avoid targeting classes4.dex entirely:** Route patches through other DEX files when possible. The `BuildInfo.isDebugAndroid()` patch works in classes4 because `BuildInfo` is a simple class without interface static methods.

## Config File Format

Each config file is plain text, one entry per line. Lines starting with `#` are comments. Blank lines are ignored.

| File | Format | Example |
|---|---|---|
| `targeted-stubs.list` | `smali_path\|method_name` | `smali_classes2/com/adjust/sdk/Adjust.smali\|onCreate` |
| `neutralize-libs.list` | smali file path | `smali_classes2/com/citrix/mvpn/api/MvpnApi.smali` |
| `replace-urls.list` | URL to redirect | `https://mobile.events.data.microsoft.com` |
| `strip-classes.list` | package dir prefix | `com/huawei/hms` |

## Common Issues

### IncompatibleClassChangeError on Launch
A DEX containing Java 8+ interface static methods was round-tripped through baksmali/smali. Only decompile DEX files you actually need to patch. Never round-trip classes4.dex.

### Method Stub Breaks Callers
Returning null (`const/4 v0, 0x0; return-object v0`) from a method whose callers don't null-check will cause NPE. For methods that must return a non-null value, consider returning a stub object or an empty string instead of null.

### Register Count Mismatch
Stubbed methods use `.locals 0` (void) or `.locals 1` (return value) or `.locals 2` (wide types). If the method uses parameter registers (`pN`) in annotations, the register count is separate from `.locals` -- this is handled correctly by the stub script.

### URL Replacement Length Mismatch
`const-string` values are stored in the DEX string pool with length prefixes. baksmali/smali handles arbitrary-length replacements correctly during round-trip. Binary replacement without disassembly requires same-length strings.

## Key Files

| File | Purpose |
|---|---|
| `edge-fix/scripts/replace-strings.py` | Smali string replacement (3 contexts) |
| `edge-fix/scripts/stub-method.py` | Method body stubber (all return types) |
| `edge-fix/scripts/neutralize-loadlibrary.py` | NOP System.loadLibrary calls |
| `edge-fix/scripts/patch-commandline.py` | Patch isDebugAndroid() to return true |
| `edge-fix/tools/baksmali-3.0.9-fat.jar` | Standalone DEX disassembler |
| `edge-fix/tools/smali-3.0.9-fat.jar` | Standalone DEX assembler |
| `edge-fix/config/targeted-stubs.list` | Methods to stub |
| `edge-fix/config/neutralize-libs.list` | loadLibrary calls to NOP |
| `edge-fix/config/replace-urls.list` | Telemetry URLs to redirect |
| `edge-fix/config/strip-classes.list` | Package trees to delete |
