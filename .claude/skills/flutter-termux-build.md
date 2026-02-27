# Flutter on Termux ARM64

Build Flutter Android apps natively on Termux (aarch64) without an x86 host.

## Prerequisites

Install these Termux packages first:
```bash
pkg install clang lld llvm cmake ninja rust openjdk-21 aapt2 patchelf
# glibc is needed for Flutter's Dart VM (ships glibc-linked ARM64 binaries)
pkg install glibc-repo && pkg install glibc-runner
```

Then install Flutter SDK and Android SDK (commandlinetools).

## Setup Script

Run `tools/flutter-termux-setup.sh` to apply all Termux patches:
```bash
bash tools/flutter-termux-setup.sh          # Apply patches
bash tools/flutter-termux-setup.sh --check  # Dry run — show what would be patched
```

The script is idempotent. It patches:
- **Dart/Flutter ELF binaries**: patchelf to use Termux glibc loader
- **Script shebangs**: `#!/bin/bash` → `#!/data/data/com.termux/files/usr/bin/bash`
- **NDK x86_64 binaries**: replaced with symlinks to Termux native (clang, lld, llvm-*)
- **CMake toolchain files**: host detection for Android, static C++ linking, resource dir, prefab pkg_DIR scan
- **Clang resource dirs**: symlinks between Termux clang version and NDK clang version
- **SDK cmake/ninja/adb**: replaced with Termux native
- **Termux CMake modules**: Android host detection patches
- **Rust tooling**: rustup shim + cargo config for NDK linker
- **Pub-cache shebangs**: fix all `.sh` files
- **Cargokit**: linker wrapper early-exit + arm64-only debug build

## Building

```bash
cd <project>
unset LD_PRELOAD  # Required — glibc conflicts with termux-exec
export PATH="$HOME/flutter/bin:$PATH"
export ANDROID_SDK_ROOT="$HOME/android-sdk"
export ANDROID_HOME="$HOME/android-sdk"
export JAVA_HOME="$PREFIX/lib/jvm/java-21-openjdk"

flutter build apk --debug \
  --target-platform android-arm64 \
  --dart-define PLATFORM=android
```

## Per-Project `build.gradle` Changes

```groovy
android {
    ndkVersion = "28.2.13676358"  // must match installed NDK
    defaultConfig {
        ndk {
            abiFilters 'arm64-v8a'  // arm64-only, no cross-compilation
        }
    }
}
```

## Per-Project `gradle.properties`

```properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m
android.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2
```

## After `flutter pub get`

Re-run the setup script to patch new pub-cache shebangs and cargokit instances:
```bash
bash ~/git/termux-tools/tools/flutter-termux-setup.sh
```

## Common Errors

### `find_package(openssl REQUIRED CONFIG)` fails
CMake 3.31+ doesn't search `CMAKE_FIND_ROOT_PATH` as package prefixes. The setup script adds a prefab pkg_DIR scan to the toolchain. Re-run the script or verify the patch is present in `android-legacy.toolchain.cmake`.

### `rustup not found`
Cargokit requires rustup. The setup script creates a shim at `$PREFIX/bin/rustup`.

### `linking with run_build_tool.sh failed`
Cargokit uses `run_build_tool.sh` as both build tool and cargo linker wrapper. The setup script adds `_CARGOKIT_NDK_LINK_CLANG` early-exit to delegate to NDK clang directly.

### `target i686-linux-android not installed`
Cargokit adds x86/x64 debug targets. The setup script comments out the x86/x64 lines in `plugin.gradle`. If you get a fresh pub-cache copy, re-run the script.

### `LD_PRELOAD` / `libtermux-exec` errors
Always `unset LD_PRELOAD` before running Flutter commands. The glibc Dart VM conflicts with Termux's ld-preload library.

### AAPT2 errors
Ensure `android.aapt2FromMavenOverride` points to Termux's native aapt2 in `gradle.properties`.
