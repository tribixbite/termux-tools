#!/data/data/com.termux/files/usr/bin/bash
# flutter-termux-setup.sh — Patch Flutter SDK + Android NDK for Termux ARM64
#
# Applies all patches needed to build Flutter apps natively on Termux (aarch64).
# Idempotent: safe to re-run. Preserves originals as .x86 backups.
#
# Prerequisites (install manually before running):
#   - Flutter SDK at ~/flutter (glibc ARM64 variant from Flutter releases)
#   - Android SDK at ~/android-sdk with NDK 28.x (or 27.x)
#   - Termux packages: clang lld llvm cmake ninja rust openjdk-21 aapt2
#                      patchelf glibc-repo glibc-runner
#
# Usage:
#   bash tools/flutter-termux-setup.sh          # Apply all patches
#   bash tools/flutter-termux-setup.sh --check  # Dry run, report status only
#
# — opus 4.6

set -euo pipefail

# --- Configuration -----------------------------------------------------------

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="${HOME:-/data/data/com.termux/files/home}"
FLUTTER_DIR="${FLUTTER_DIR:-$TERMUX_HOME/flutter}"
SDK_DIR="${SDK_DIR:-$TERMUX_HOME/android-sdk}"
GLIBC_LD="$PREFIX/glibc/lib/ld-linux-aarch64.so.1"
GLIBC_LIB="$PREFIX/glibc/lib"
TERMUX_BASH="$PREFIX/bin/bash"
DRY_RUN=false

if [[ "${1:-}" == "--check" || "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# --- Colors & output ---------------------------------------------------------

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

ok()     { echo -e "  ${GREEN}+${NC} $1"; }
skip()   { echo -e "  ${DIM}-${NC} $1 ${DIM}(already done)${NC}"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
fail()   { echo -e "  ${RED}x${NC} $1"; }
header() { echo -e "\n${BOLD}[$1]${NC}"; }
dry()    { echo -e "  ${BLUE}~${NC} $1 ${DIM}(dry run)${NC}"; }

PATCH_COUNT=0
SKIP_COUNT=0
WARN_COUNT=0

track_patch() { ((PATCH_COUNT++)) || true; }
track_skip()  { ((SKIP_COUNT++)) || true; }
track_warn()  { ((WARN_COUNT++)) || true; }

# --- Prerequisite checks -----------------------------------------------------

header "Prerequisites"

missing=()
for pkg in clang lld cmake ninja rustc java patchelf aapt2; do
  if ! command -v "$pkg" &>/dev/null; then
    missing+=("$pkg")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  fail "Missing commands: ${missing[*]}"
  echo "  Install with: pkg install clang lld llvm cmake ninja rust openjdk-21 aapt2 patchelf"
  exit 1
fi
ok "Required Termux packages found"

if [[ ! -f "$GLIBC_LD" ]]; then
  fail "glibc not found at $GLIBC_LD"
  echo "  Install with: pkg install glibc-repo && pkg install glibc-runner"
  exit 1
fi
ok "glibc loader found"

if [[ ! -d "$FLUTTER_DIR/bin/cache/dart-sdk" ]]; then
  fail "Flutter SDK not found at $FLUTTER_DIR"
  echo "  Download from https://docs.flutter.dev/get-started/install"
  exit 1
fi
ok "Flutter SDK found at $FLUTTER_DIR"

if [[ ! -d "$SDK_DIR" ]]; then
  fail "Android SDK not found at $SDK_DIR"
  exit 1
fi
ok "Android SDK found at $SDK_DIR"

# Find NDK versions
NDK_VERSIONS=()
for ndk_dir in "$SDK_DIR"/ndk/*/; do
  if [[ -d "$ndk_dir/build/cmake" ]]; then
    NDK_VERSIONS+=("$(basename "$ndk_dir")")
  fi
done

if [[ ${#NDK_VERSIONS[@]} -eq 0 ]]; then
  fail "No NDK found under $SDK_DIR/ndk/"
  exit 1
fi
ok "NDK versions: ${NDK_VERSIONS[*]}"

# Detect Termux clang version
TERMUX_CLANG_VER=$(clang --version 2>/dev/null | grep -oP 'clang version \K\d+' || echo "")
if [[ -z "$TERMUX_CLANG_VER" ]]; then
  fail "Cannot detect Termux clang version"
  exit 1
fi
ok "Termux clang version: $TERMUX_CLANG_VER"

# --- Section A: Patchelf Dart/Flutter binaries --------------------------------

header "Patchelf glibc binaries"

patched=0; skipped=0
# Collect ELF aarch64 files first, then process
elf_list=$(find "$FLUTTER_DIR/bin/cache" -type f -exec sh -c \
  'file "$1" 2>/dev/null | grep -q "ELF.*aarch64" && echo "$1"' _ {} \;)

while IFS= read -r elf; do
  [[ -z "$elf" ]] && continue
  current_interp=$(patchelf --print-interpreter "$elf" 2>/dev/null || true)
  if [[ "$current_interp" == "$GLIBC_LD" ]]; then
    ((skipped++)) || true
    continue
  fi
  if $DRY_RUN; then
    dry "patchelf $elf"
  else
    patchelf --set-interpreter "$GLIBC_LD" --set-rpath "$GLIBC_LIB" "$elf" 2>/dev/null && ((patched++)) || true
  fi
done <<< "$elf_list"

if [[ $patched -gt 0 ]]; then
  ok "Patched $patched ELF binaries"; track_patch
elif [[ $skipped -gt 0 ]]; then
  skip "All $skipped binaries already patched"
  track_skip
fi

# --- Section B: Fix shebangs — Flutter scripts --------------------------------

header "Fix shebangs — Flutter"

fix_shebangs() {
  local dir="$1" label="$2" count=0
  local scripts
  scripts=$(find "$dir" \( -name "*.sh" -o -name "dart" -o -name "flutter" \) -type f 2>/dev/null)
  while IFS= read -r script; do
    [[ -z "$script" ]] && continue
    first_line=$(head -1 "$script" 2>/dev/null || true)
    case "$first_line" in
      "#!/usr/bin/env bash"|"#!/usr/bin/env sh"|"#!/bin/bash"|"#!/bin/sh")
        if $DRY_RUN; then
          dry "fix shebang: $script"
        else
          sed -i "1s|^#!.*|#!${TERMUX_BASH}|" "$script"
          ((count++)) || true
        fi
        ;;
    esac
  done <<< "$scripts"
  if [[ $count -gt 0 ]]; then
    ok "Fixed $count shebangs in $label"; track_patch
  else
    skip "Shebangs OK in $label"; track_skip
  fi
}

fix_shebangs "$FLUTTER_DIR/bin" "Flutter scripts"

# --- Section C: NDK patches (per version) ------------------------------------

for NDK_VER in "${NDK_VERSIONS[@]}"; do
  NDK_DIR="$SDK_DIR/ndk/$NDK_VER"
  NDK_TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64"
  NDK_BIN="$NDK_TOOLCHAIN/bin"
  LEGACY_TC="$NDK_DIR/build/cmake/android-legacy.toolchain.cmake"
  MAIN_TC="$NDK_DIR/build/cmake/android.toolchain.cmake"

  # Skip NDKs without the expected toolchain layout
  if [[ ! -d "$NDK_BIN" ]]; then
    warn "NDK $NDK_VER: no toolchain bin dir, skipping"; track_warn
    continue
  fi

  # Detect NDK clang version from directory name
  NDK_CLANG_VER=""
  if [[ -d "$NDK_TOOLCHAIN/lib/clang" ]]; then
    for d in "$NDK_TOOLCHAIN/lib/clang"/*/; do
      [[ -d "$d" ]] || continue
      v=$(basename "$d")
      if [[ "$v" =~ ^[0-9]+$ && ! -L "${NDK_TOOLCHAIN}/lib/clang/$v" ]]; then
        NDK_CLANG_VER="$v"
        break
      fi
    done
    if [[ -z "$NDK_CLANG_VER" ]]; then
      NDK_CLANG_VER=$(ls -1 "$NDK_TOOLCHAIN/lib/clang/" 2>/dev/null | grep -E '^[0-9]+$' | sort -n | tail -1 || true)
    fi
  fi

  if [[ -z "$NDK_CLANG_VER" ]]; then
    warn "NDK $NDK_VER: cannot detect clang version, skipping resource dir patches"
  fi

  header "NDK $NDK_VER${NDK_CLANG_VER:+ (clang $NDK_CLANG_VER)}"

  # --- C.1: Fix NDK wrapper script shebangs ---
  shebang_count=0
  for script in "$NDK_BIN"/*; do
    [[ -f "$script" && ! -L "$script" ]] || continue
    first_line=$(head -c 100 "$script" 2>/dev/null | head -1 || true)
    if [[ "$first_line" == "#!/bin/bash" || "$first_line" == "#!/usr/bin/env bash" ]]; then
      if $DRY_RUN; then
        dry "fix shebang: $script"
      else
        sed -i "1s|^#!.*|#!${TERMUX_BASH}|" "$script"
        ((shebang_count++)) || true
      fi
    fi
  done
  if [[ $shebang_count -gt 0 ]]; then
    ok "Fixed $shebang_count NDK script shebangs"; track_patch
  else
    skip "NDK script shebangs OK"; track_skip
  fi

  # --- C.2: Replace x86_64 binaries with ARM64 symlinks ---
  # Determine the main clang binary name for this NDK
  clang_bin="clang-${NDK_CLANG_VER}"

  declare -A SYMLINKS=(
    ["$clang_bin"]="clang"
    ["lld"]="lld"
    ["llvm-ar"]="llvm-ar"
    ["llvm-objcopy"]="llvm-objcopy"
    ["llvm-objdump"]="llvm-objdump"
    ["llvm-nm"]="llvm-nm"
    ["llvm-readobj"]="llvm-readobj"
    ["llvm-readelf"]="llvm-readelf"
    ["llvm-strings"]="llvm-strings"
    ["llvm-symbolizer"]="llvm-symbolizer"
    ["llvm-cxxfilt"]="llvm-cxxfilt"
    ["llvm-dwp"]="llvm-dwp"
    ["llvm-profdata"]="llvm-profdata"
    ["llvm-cov"]="llvm-cov"
    ["llvm-size"]="llvm-size"
    ["llvm-dwarfdump"]="llvm-dwarfdump"
    ["llvm-rc"]="llvm-rc"
  )

  link_count=0
  for ndk_name in "${!SYMLINKS[@]}"; do
    termux_name="${SYMLINKS[$ndk_name]}"
    target="$NDK_BIN/$ndk_name"
    if [[ -f "$target" && ! -L "$target" ]]; then
      if $DRY_RUN; then
        dry "symlink $ndk_name -> $PREFIX/bin/$termux_name"
      else
        mv "$target" "${target}.x86"
        ln -sf "$PREFIX/bin/$termux_name" "$target"
        ((link_count++)) || true
      fi
    elif [[ -L "$target" ]]; then
      # Already a symlink
      true
    fi
  done
  if [[ $link_count -gt 0 ]]; then
    ok "Replaced $link_count x86_64 binaries with ARM64 symlinks"; track_patch
  else
    skip "NDK binaries already symlinked"; track_skip
  fi

  # --- C.3: Clang resource dir symlinks ---
  CLANG_LIB="$NDK_TOOLCHAIN/lib/clang"

  if [[ -z "$NDK_CLANG_VER" || ! -d "$CLANG_LIB" ]]; then
    skip "Clang resource dir patches skipped (no clang version detected)"; track_skip
  elif [[ -n "$TERMUX_CLANG_VER" && "$TERMUX_CLANG_VER" != "$NDK_CLANG_VER" ]]; then
    if [[ ! -L "$CLANG_LIB/$TERMUX_CLANG_VER" ]]; then
      if $DRY_RUN; then
        dry "symlink clang/$TERMUX_CLANG_VER -> $NDK_CLANG_VER"
      else
        ln -sf "$NDK_CLANG_VER" "$CLANG_LIB/$TERMUX_CLANG_VER"
        ok "Symlinked clang/$TERMUX_CLANG_VER -> $NDK_CLANG_VER"; track_patch
      fi
    else
      skip "clang/$TERMUX_CLANG_VER symlink exists"; track_skip
    fi
  fi

  # Per-API-level triple dirs with builtins/unwind/atomic symlinks
  if [[ -n "$NDK_CLANG_VER" && -d "$CLANG_LIB/$NDK_CLANG_VER" ]]; then
    api_count=0
    for api in 24 26 28 29 30 31 33 34 35; do
      triple_dir="$CLANG_LIB/$NDK_CLANG_VER/lib/aarch64-none-linux-android${api}"
      if [[ ! -d "$triple_dir" ]]; then
        if $DRY_RUN; then
          dry "create triple dir: aarch64-none-linux-android${api}"
        else
          mkdir -p "$triple_dir"
          ln -sf "../linux/libclang_rt.builtins-aarch64-android.a" "$triple_dir/libclang_rt.builtins.a"
          ln -sf "../linux/aarch64/libunwind.a" "$triple_dir/libunwind.a"
          ln -sf "../linux/aarch64/libatomic.a" "$triple_dir/libatomic.a"
          ((api_count++)) || true
        fi
      fi
    done
    if [[ $api_count -gt 0 ]]; then
      ok "Created $api_count API-level triple dirs with runtime symlinks"; track_patch
    else
      skip "API-level triple dirs exist"; track_skip
    fi
  fi

  # --- C.4: Sysroot triple symlink ---
  SYSROOT_LIB="$NDK_TOOLCHAIN/sysroot/usr/lib"
  if [[ -d "$SYSROOT_LIB/aarch64-linux-android" && ! -L "$SYSROOT_LIB/aarch64-none-linux-android" ]]; then
    if $DRY_RUN; then
      dry "symlink sysroot aarch64-none-linux-android -> aarch64-linux-android"
    else
      ln -sf aarch64-linux-android "$SYSROOT_LIB/aarch64-none-linux-android"
      ok "Sysroot triple symlink created"; track_patch
    fi
  else
    skip "Sysroot triple symlink exists"; track_skip
  fi

  # --- C.5: Patch android.toolchain.cmake (host detection) ---
  if [[ -f "$MAIN_TC" ]]; then
    if grep -q 'STREQUAL Linux OR CMAKE_HOST_SYSTEM_NAME STREQUAL Android' "$MAIN_TC"; then
      skip "android.toolchain.cmake host detection already patched"; track_skip
    else
      if $DRY_RUN; then
        dry "patch host detection in android.toolchain.cmake"
      else
        sed -i 's/CMAKE_HOST_SYSTEM_NAME STREQUAL Linux)/CMAKE_HOST_SYSTEM_NAME STREQUAL Linux OR CMAKE_HOST_SYSTEM_NAME STREQUAL Android)/g' "$MAIN_TC"
        ok "Patched android.toolchain.cmake host detection"; track_patch
      fi
    fi
  fi

  # --- C.6: Patch android-legacy.toolchain.cmake ---
  if [[ -f "$LEGACY_TC" ]]; then
    # C.6a: Host detection
    if grep -q 'STREQUAL Linux OR CMAKE_HOST_SYSTEM_NAME STREQUAL Android' "$LEGACY_TC"; then
      skip "Legacy toolchain host detection already patched"; track_skip
    else
      if $DRY_RUN; then
        dry "patch host detection in android-legacy.toolchain.cmake"
      else
        sed -i 's/CMAKE_HOST_SYSTEM_NAME STREQUAL Linux)/CMAKE_HOST_SYSTEM_NAME STREQUAL Linux OR CMAKE_HOST_SYSTEM_NAME STREQUAL Android)/g' "$LEGACY_TC"
        ok "Patched legacy toolchain host detection"; track_patch
      fi
    fi

    # C.6b: Static C++ linking
    if grep -q 'CMAKE_HOST_SYSTEM_NAME STREQUAL Android' "$LEGACY_TC" && grep -q 'nostdlib++' "$LEGACY_TC"; then
      skip "Legacy toolchain static C++ linking already patched"; track_skip
    else
      if $DRY_RUN; then
        dry "patch static C++ linking in android-legacy.toolchain.cmake"
      else
        # Replace the single-line static-libstdc++ with Android-host-aware block
        sed -i '/elseif(ANDROID_STL STREQUAL c++_static)/,/elseif(ANDROID_STL STREQUAL c++_shared)/{
          /elseif(ANDROID_STL STREQUAL c++_static)/c\
elseif(ANDROID_STL STREQUAL c++_static)\
  # On Termux (Android host), -static-libstdc++ is not handled correctly by\
  # the host clang. Use explicit flags to link libc++ statically instead.\
  if(CMAKE_HOST_SYSTEM_NAME STREQUAL Android)\
    list(APPEND ANDROID_LINKER_FLAGS "-nostdlib++")\
    list(APPEND ANDROID_CXX_STANDARD_LIBRARIES\
      "-l:libc++_static.a" "-l:libc++abi.a")\
  else()\
    list(APPEND ANDROID_LINKER_FLAGS "-static-libstdc++")\
  endif()
          /list(APPEND ANDROID_LINKER_FLAGS "-static-libstdc++")/d
          /elseif(ANDROID_STL STREQUAL c++_shared)/!{/^$/d}
        }' "$LEGACY_TC"
        ok "Patched legacy toolchain static C++ linking"; track_patch
      fi
    fi

    # C.6c: Resource dir flag
    if grep -q "resource-dir" "$LEGACY_TC"; then
      skip "Legacy toolchain resource dir already patched"; track_skip
    elif [[ -z "$NDK_CLANG_VER" ]]; then
      warn "Cannot patch resource-dir: clang version unknown"; track_warn
    else
      if $DRY_RUN; then
        dry "add -resource-dir flag to android-legacy.toolchain.cmake"
      else
        sed -i "s|-no-canonical-prefixes)|-no-canonical-prefixes\n  -resource-dir \${ANDROID_TOOLCHAIN_ROOT}/lib/clang/${NDK_CLANG_VER})|" "$LEGACY_TC"
        ok "Added -resource-dir to legacy toolchain compiler flags"; track_patch
      fi
    fi

    # C.6d: Prefab pkg_DIR scan
    if grep -q "_prefab_cmake" "$LEGACY_TC"; then
      skip "Legacy toolchain prefab scan already patched"; track_skip
    else
      if $DRY_RUN; then
        dry "add prefab pkg_DIR scan to android-legacy.toolchain.cmake"
      else
        # Insert after the CMAKE_LIBRARY_ARCHITECTURE line
        sed -i '/^set(CMAKE_LIBRARY_ARCHITECTURE "\${ANDROID_TOOLCHAIN_NAME}")/a\
\
# CMake 3.31+ changed find_package(CONFIG) search: CMAKE_FIND_ROOT_PATH entries\
# are no longer searched as package prefixes like cmake 3.22 did. AGP passes\
# prefab dirs via CMAKE_FIND_ROOT_PATH with configs at lib/<arch>/cmake/<pkg>/.\
# Scan prefab dirs for config packages and set <pkg>_DIR directly.\
foreach(_find_root ${CMAKE_FIND_ROOT_PATH})\
  if(NOT "${_find_root}" STREQUAL "${ANDROID_NDK}")\
    set(_prefab_cmake "${_find_root}/lib/${ANDROID_TOOLCHAIN_NAME}/cmake")\
    if(IS_DIRECTORY "${_prefab_cmake}")\
      file(GLOB _prefab_pkgs RELATIVE "${_prefab_cmake}" "${_prefab_cmake}/*")\
      foreach(_pkg ${_prefab_pkgs})\
        if(IS_DIRECTORY "${_prefab_cmake}/${_pkg}" AND NOT DEFINED ${_pkg}_DIR)\
          set(${_pkg}_DIR "${_prefab_cmake}/${_pkg}")\
        endif()\
      endforeach()\
    endif()\
  endif()\
endforeach()' "$LEGACY_TC"
        ok "Added prefab pkg_DIR scan to legacy toolchain"; track_patch
      fi
    fi
  fi
done

# --- Section D: SDK cmake/ninja replacement -----------------------------------

header "SDK cmake/ninja"

for cmake_dir in "$SDK_DIR"/cmake/*/bin; do
  [[ -d "$cmake_dir" ]] || continue
  for tool in cmake ninja; do
    if [[ -f "$cmake_dir/$tool" && ! -L "$cmake_dir/$tool" ]]; then
      if $DRY_RUN; then
        dry "symlink $cmake_dir/$tool -> $PREFIX/bin/$tool"
      else
        mv "$cmake_dir/$tool" "$cmake_dir/${tool}.x86"
        ln -sf "$PREFIX/bin/$tool" "$cmake_dir/$tool"
        ok "Replaced SDK $tool with Termux native"; track_patch
      fi
    else
      skip "SDK $tool already symlinked"; track_skip
    fi
  done
done

# --- Section E: SDK adb replacement ------------------------------------------

header "SDK adb"

SDK_ADB="$SDK_DIR/platform-tools"
if [[ -d "$SDK_ADB" ]]; then
  if [[ -f "$SDK_ADB/adb" && ! -L "$SDK_ADB/adb" ]]; then
    if $DRY_RUN; then
      dry "symlink adb -> $PREFIX/bin/adb"
    else
      mv "$SDK_ADB/adb" "$SDK_ADB/adb.x86"
      ln -sf "$PREFIX/bin/adb" "$SDK_ADB/adb"
      ok "Replaced SDK adb with Termux native"; track_patch
    fi
  else
    skip "SDK adb already symlinked"; track_skip
  fi
fi

# --- Section F: Termux CMake module patches -----------------------------------

header "Termux CMake modules"

# F.1: Android-Determine.cmake — host tag detection
ANDROID_DETERMINE=$(find "$PREFIX/share" -path "*/Platform/Android-Determine.cmake" 2>/dev/null | head -1)
if [[ -n "$ANDROID_DETERMINE" ]]; then
  if grep -q 'STREQUAL "Linux" OR CMAKE_HOST_SYSTEM_NAME STREQUAL "Android"' "$ANDROID_DETERMINE"; then
    skip "Android-Determine.cmake host detection already patched"; track_skip
  else
    if $DRY_RUN; then
      dry "patch Android-Determine.cmake"
    else
      # Patch the host tag detection
      sed -i 's/CMAKE_HOST_SYSTEM_NAME STREQUAL "Linux")/CMAKE_HOST_SYSTEM_NAME STREQUAL "Linux" OR CMAKE_HOST_SYSTEM_NAME STREQUAL "Android")/g' "$ANDROID_DETERMINE"
      # Ensure the else branch under the new Android match sets linux-x86_64
      # (NDK tools replaced with ARM64 symlinks under linux-x86_64 dir)
      if ! grep -q "NDK host tools are in linux-x86_64" "$ANDROID_DETERMINE"; then
        sed -i '/CMAKE_HOST_SYSTEM_PROCESSOR STREQUAL "x86_64"/,/set(CMAKE_ANDROID_NDK_TOOLCHAIN_HOST_TAG "linux-x86")/{
          s|set(CMAKE_ANDROID_NDK_TOOLCHAIN_HOST_TAG "linux-x86")|# On Termux (Android/aarch64), NDK host tools are in linux-x86_64\n      # but have been replaced with native ARM64 symlinks\n      set(CMAKE_ANDROID_NDK_TOOLCHAIN_HOST_TAG "linux-x86_64")|
        }' "$ANDROID_DETERMINE"
      fi
      ok "Patched Android-Determine.cmake"; track_patch
    fi
  fi
fi

# F.2: Determine-Compiler.cmake — Android host early-return
DETERMINE_COMPILER=$(find "$PREFIX/share" -path "*/Platform/Android/Determine-Compiler.cmake" 2>/dev/null | head -1)
if [[ -n "$DETERMINE_COMPILER" ]]; then
  if grep -q 'CMAKE_HOST_SYSTEM_NAME STREQUAL "Android"' "$DETERMINE_COMPILER"; then
    skip "Determine-Compiler.cmake Android host block already present"; track_skip
  else
    if $DRY_RUN; then
      dry "patch Determine-Compiler.cmake"
    else
      # Insert Android host block before the else/FATAL_ERROR
      sed -i '/CMAKE_HOST_SYSTEM_NAME STREQUAL "Windows"/,/message(FATAL_ERROR/{
        /^else()/i\
elseif(CMAKE_HOST_SYSTEM_NAME STREQUAL "Android")\
  # Natively compiling on an Android host does not use the NDK cross-compilation\
  # tools.\
  macro(__android_determine_compiler lang)\
    # Do nothing\
  endmacro()\
  if(NOT CMAKE_CXX_COMPILER_NAMES)\
    set(CMAKE_CXX_COMPILER_NAMES c++)\
  endif()\
  return()
      }' "$DETERMINE_COMPILER"
      ok "Patched Determine-Compiler.cmake with Android host block"; track_patch
    fi
  fi
fi

# --- Section G: Rustup shim ---------------------------------------------------

header "Rust tooling"

RUSTUP_SHIM="$PREFIX/bin/rustup"
if [[ -f "$RUSTUP_SHIM" ]] && grep -q "termux shim\|Shim for cargokit" "$RUSTUP_SHIM"; then
  skip "rustup shim already installed"; track_skip
else
  if $DRY_RUN; then
    dry "create rustup shim at $RUSTUP_SHIM"
  else
    cat > "$RUSTUP_SHIM" << 'RUSTUP_EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Shim for cargokit/flutter_vodozemac on Termux where Rust is installed via pkg
# instead of rustup. Emulates the subset of rustup commands cargokit needs.

case "$1" in
  toolchain)
    case "$2" in
      install)
        # Pretend to install; Termux already has the system toolchain
        echo "info: using existing Termux system toolchain"
        exit 0
        ;;
      list)
        # Report the system toolchain as "stable"
        echo "stable-aarch64-unknown-linux-android (default)"
        exit 0
        ;;
    esac
    ;;
  target)
    case "$2" in
      add)
        # Check if target is available in system rustc
        TARGET="${@: -1}"
        if rustc --print target-list 2>/dev/null | grep -qx "$TARGET"; then
          echo "info: target '$TARGET' available in system rustc"
          exit 0
        else
          echo "error: target '$TARGET' not available" >&2
          exit 1
        fi
        ;;
      list)
        if [[ "$*" == *"--installed"* ]]; then
          rustc --print target-list 2>/dev/null | grep -E "^(aarch64-linux-android|aarch64-unknown-linux|x86_64)" || true
          exit 0
        else
          rustc --print target-list 2>/dev/null
          exit 0
        fi
        ;;
    esac
    ;;
  component)
    # Pretend component add succeeded
    echo "info: component already available in system toolchain"
    exit 0
    ;;
  run)
    # `rustup run <toolchain> <cmd> [args...]` — skip toolchain, run cmd directly
    shift  # remove "run"
    shift  # remove <toolchain>
    exec "$@"
    ;;
  show)
    echo "Default host: aarch64-unknown-linux-android"
    echo ""
    echo "installed toolchains"
    echo "--------------------"
    echo "stable-aarch64-unknown-linux-android (default)"
    echo ""
    echo "active toolchain"
    echo "----------------"
    echo "stable-aarch64-unknown-linux-android (default)"
    echo "rustc $(rustc --version 2>/dev/null | cut -d' ' -f2)"
    exit 0
    ;;
  --version|-V)
    echo "rustup 1.27.0 (termux shim)"
    exit 0
    ;;
  *)
    echo "rustup shim: unhandled command '$*'" >&2
    exit 1
    ;;
esac
RUSTUP_EOF
    chmod +x "$RUSTUP_SHIM"
    ok "Created rustup shim"; track_patch
  fi
fi

# Cargo config for NDK linker
CARGO_CONFIG="$TERMUX_HOME/.cargo/config.toml"
# Find the latest NDK for cargo config
LATEST_NDK="${NDK_VERSIONS[-1]}"
NDK_CLANG_BIN="$SDK_DIR/ndk/$LATEST_NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"

if [[ -f "$CARGO_CONFIG" ]] && grep -q "aarch64-linux-android" "$CARGO_CONFIG"; then
  skip "Cargo config already has aarch64-linux-android target"; track_skip
else
  if $DRY_RUN; then
    dry "create $CARGO_CONFIG with NDK linker"
  else
    mkdir -p "$(dirname "$CARGO_CONFIG")"
    cat > "$CARGO_CONFIG" << CARGO_EOF
[target.aarch64-linux-android]
# NDK clang (symlinked to Termux's native clang) for linking Android targets
linker = "${NDK_CLANG_BIN}/aarch64-linux-android24-clang"
ar = "${NDK_CLANG_BIN}/llvm-ar"
CARGO_EOF
    ok "Created cargo config with NDK linker"; track_patch
  fi
fi

# --- Section H: Fix pub-cache shebangs ----------------------------------------

header "Pub-cache shebangs"

PUB_CACHE="$TERMUX_HOME/.pub-cache"
if [[ -d "$PUB_CACHE" ]]; then
  pub_count=0
  while IFS= read -r -d '' script; do
    first_line=$(head -1 "$script")
    case "$first_line" in
      "#!/usr/bin/env bash"|"#!/usr/bin/env sh"|"#!/bin/bash"|"#!/bin/sh")
        if $DRY_RUN; then
          dry "fix shebang: $script"
        else
          sed -i "1s|^#!.*|#!${TERMUX_BASH}|" "$script"
          ((pub_count++)) || true
        fi
        ;;
    esac
  done < <(find "$PUB_CACHE" -name "*.sh" -type f -print0 2>/dev/null)
  if [[ $pub_count -gt 0 ]]; then
    ok "Fixed $pub_count pub-cache script shebangs"; track_patch
  else
    skip "Pub-cache shebangs OK"; track_skip
  fi
else
  skip "No pub-cache directory found (will fix on first flutter pub get)"; track_skip
fi

# --- Section I: Patch cargokit (for Rust Flutter plugins) ---------------------

header "Cargokit patches"

# Find all cargokit run_build_tool.sh files in pub-cache
cargokit_count=0
while IFS= read -r -d '' build_tool; do
  cargokit_dir=$(dirname "$build_tool")

  # I.1: Add linker wrapper early-exit
  if ! grep -q "_CARGOKIT_NDK_LINK_CLANG" "$build_tool"; then
    if $DRY_RUN; then
      dry "patch linker wrapper in $build_tool"
    else
      # Insert after shebang + set -e
      sed -i '/^set -e$/a\
\
# When invoked as a cargo linker wrapper (via CARGO_TARGET_*_LINKER),\
# delegate directly to NDK clang instead of running the full build tool.\
if [[ -n "$_CARGOKIT_NDK_LINK_CLANG" ]]; then\
  exec "$_CARGOKIT_NDK_LINK_CLANG" "$_CARGOKIT_NDK_LINK_TARGET" "$@"\
fi' "$build_tool"
      ok "Patched linker wrapper in $(basename "$(dirname "$cargokit_dir")")/cargokit"; track_patch
      ((cargokit_count++)) || true
    fi
  else
    skip "Linker wrapper already patched in $(basename "$(dirname "$cargokit_dir")")/cargokit"; track_skip
  fi

  # I.2: Patch plugin.gradle — comment out x86/x64 debug platforms
  PLUGIN_GRADLE="$cargokit_dir/gradle/plugin.gradle"
  if [[ -f "$PLUGIN_GRADLE" ]]; then
    if grep -q '// if (buildType == "debug")' "$PLUGIN_GRADLE"; then
      skip "plugin.gradle x86/x64 already commented out"; track_skip
    elif grep -q 'platforms.add("android-x86")' "$PLUGIN_GRADLE"; then
      if $DRY_RUN; then
        dry "comment out x86/x64 in $PLUGIN_GRADLE"
      else
        sed -i 's|^\(\s*\)if (buildType == "debug") {|\1// On Termux ARM64, only build for the native architecture.\n\1// The x86/x64 debug targets require cross-compilation toolchains.\n\1// if (buildType == "debug") {|' "$PLUGIN_GRADLE"
        sed -i 's|^\(\s*\)platforms.add("android-x86")|\1// platforms.add("android-x86")|' "$PLUGIN_GRADLE"
        sed -i 's|^\(\s*\)platforms.add("android-x64")|\1// platforms.add("android-x64")|' "$PLUGIN_GRADLE"
        # Comment out the closing brace of the if block
        # This is tricky — the brace is shared. Look for the pattern after the x64 line
        sed -i '/\/\/ platforms.add("android-x64")/{n;s|^\(\s*\)}|\1// }|}' "$PLUGIN_GRADLE"
        ok "Commented out x86/x64 debug platforms in plugin.gradle"; track_patch
      fi
    fi
  fi

done < <(find "$PUB_CACHE" -name "run_build_tool.sh" -path "*/cargokit/*" -type f -print0 2>/dev/null)

if [[ $cargokit_count -eq 0 ]] && ! $DRY_RUN; then
  skip "No unpatched cargokit instances found"; track_skip
fi

# --- Section J: gradle.properties template ------------------------------------

header "Gradle config"

GRADLE_PROPS_TEMPLATE="$TERMUX_HOME/.gradle/gradle.properties"
if [[ -f "$GRADLE_PROPS_TEMPLATE" ]] && grep -q "aapt2FromMavenOverride" "$GRADLE_PROPS_TEMPLATE"; then
  skip "Global gradle.properties already configured"; track_skip
else
  if $DRY_RUN; then
    dry "create global gradle.properties with Termux settings"
  else
    mkdir -p "$(dirname "$GRADLE_PROPS_TEMPLATE")"
    # Append rather than overwrite to preserve existing settings
    {
      echo ""
      echo "# Termux ARM64 Flutter build settings"
      echo "org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m"
      echo "android.aapt2FromMavenOverride=$PREFIX/bin/aapt2"
    } >> "$GRADLE_PROPS_TEMPLATE"
    ok "Added Termux settings to global gradle.properties"; track_patch
  fi
fi

# --- Summary ------------------------------------------------------------------

echo ""
echo -e "${BOLD}== Summary ==${NC}"
if $DRY_RUN; then
  echo -e "  Mode: ${BLUE}dry run${NC} (no changes made)"
fi
echo -e "  Patches applied: ${GREEN}${PATCH_COUNT}${NC}"
echo -e "  Already done:    ${DIM}${SKIP_COUNT}${NC}"
if [[ $WARN_COUNT -gt 0 ]]; then
  echo -e "  Warnings:        ${YELLOW}${WARN_COUNT}${NC}"
fi
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo "  1. Set environment: unset LD_PRELOAD"
echo "  2. Build Flutter app:"
echo "     cd <project> && flutter build apk --debug --target-platform android-arm64"
echo "  3. If using Rust plugins (vodozemac), re-run this script after 'flutter pub get'"
echo "     to patch any new cargokit instances in ~/.pub-cache"
