#!/data/data/com.termux/files/usr/bin/bash
#
# install-antigravity-termux.sh
#
# Installs Google's Antigravity CLI ("agy") on Termux (Android / bionic libc).
#
# This is a Termux-aware rewrite of the upstream installer at
#   https://antigravity.google/cli/install.sh
# which assumes a glibc Linux host and does not work as-is on Termux.
#
# Why a rewrite is needed
# -----------------------
# antigravity ships ONLY as a glibc-linked Go binary (ELF interpreter
# /lib/ld-linux-<arch>.so), and Termux runs on bionic behind Android's app-level
# seccomp filter. Two gaps have to be bridged at launch time:
#
#   1. glibc loader  - bionic has no /lib/ld-linux-aarch64.so.1. We bind Termux's
#                      glibc-package loader into place with proot and exec the binary
#                      directly. We do NOT patchelf the interpreter: rewriting a Go
#                      binary's program headers corrupts its pclntab and the process
#                      then dies with SIGSEGV. The Termux glibc loader already carries
#                      $PREFIX/glibc/lib as its built-in search path, so binding the
#                      loader alone is enough to resolve libc.so.6 and friends.
#
#   2. faccessat2    - the Go runtime issues raw faccessat2(439) syscalls (Go bypasses
#                      libc and traps directly with `svc`). Android's seccomp answers
#                      with SIGSYS, killing the process during package init
#                      (os/exec.LookPath -> unix.Eaccess). proot (ptrace) transparently
#                      rewrites faccessat2 -> the permitted faccessat(48). An LD_PRELOAD
#                      shim (e.g. the bun-on-termux technique) cannot help here, because
#                      it only intercepts libc-level calls and Go never makes one.
#
# Net runtime dependencies: proot + the Termux `glibc` runtime. grun/glibc-runner is
# NOT invoked at runtime -- we bind the loader and exec the binary ourselves, so
# /proc/self/exe is the real binary and antigravity's background self-update and auth
# re-exec (both of which act on os.Executable) keep working correctly.
#
# Usage: install-antigravity-termux.sh [-d|--dir <custom-bin-dir>]
#
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
DOWNLOAD_BASE_URL="https://antigravity-cli-auto-updater-974169037036.us-central1.run.app"
INSTALL_DIR="$HOME/.local/lib/antigravity"   # holds the (unpatched) glibc binary
BIN_DIR="$HOME/.local/bin"                    # holds the proot launcher named 'agy'

# --- option parsing -------------------------------------------------------------
while [ "$#" -gt 0 ]; do
    case "$1" in
        -d|--dir) [ -n "${2:-}" ] || { echo "[ERROR] missing path for --dir" >&2; exit 1; }
                  BIN_DIR="$2"; shift ;;
        -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
        *) echo "[ERROR] unknown parameter: $1" >&2; exit 1 ;;
    esac
    shift
done

WRAPPER="$BIN_DIR/agy"
BINARY="$INSTALL_DIR/antigravity"

log() { printf '  %s\n' "$*"; }
ok()  { printf '\033[32m\xe2\x9c\x93\033[0m %s\n' "$*"; }
die() { printf '\033[31mFatal:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. platform detection ------------------------------------------------------
case "$(uname -m)" in
    aarch64|arm64) arch="arm64"; loader_name="ld-linux-aarch64.so.1" ;;
    x86_64|amd64)  arch="amd64"; loader_name="ld-linux-x86-64.so.2" ;;
    *) die "unsupported architecture $(uname -m); antigravity ships only arm64/amd64 glibc builds" ;;
esac
# Termux uses the glibc package (never musl), so always the plain linux_<arch> build.
platform="linux_${arch}"
ok "Platform: $platform (Termux/bionic -> glibc build, run via proot)"

# --- 2. dependency checks -------------------------------------------------------
command -v proot >/dev/null 2>&1 || die "'proot' is required. Install it with: pkg install proot"
SYS_LOADER="$PREFIX/glibc/lib/$loader_name"
[ -f "$SYS_LOADER" ] || die "glibc loader missing at $SYS_LOADER. Install the glibc runtime with: pkg install glibc-runner"
ok "Dependencies present (proot + glibc loader)"

# --- 3. fetch + parse the release manifest --------------------------------------
log "Querying release manifest for $platform ..."
manifest_json="$(curl -fsSL "$DOWNLOAD_BASE_URL/manifests/$platform.json")" \
    || die "could not download the release manifest (check your connection/firewall)"

# POSIX JSON value reader (the manifest is one key:value per line; no jq needed).
parse_json_key() { printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'; }
version="$(parse_json_key "$manifest_json" version)"
url="$(parse_json_key "$manifest_json" url)"
sha512="$(parse_json_key "$manifest_json" sha512)"
[ -n "$url" ] && [ -n "$sha512" ] || die "failed to parse the release manifest (url/sha512 missing)"
ok "Latest version: ${version:-unknown}"

# --- 4. download + checksum-verify ----------------------------------------------
STAGING="$(mktemp -d "$PREFIX/tmp/agy-install.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
payload="$STAGING/payload"
log "Downloading release package ..."
curl -fsSL -o "$payload" "$url" || die "download failed from $url"
actual_hash="$(sha512sum "$payload" | cut -d' ' -f1)"
[ "$actual_hash" = "$sha512" ] || die "checksum mismatch -- refusing to install (expected $sha512, got $actual_hash)"
ok "Downloaded and SHA-512 verified"

# --- 5. stage the (unpatched) binary --------------------------------------------
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
case "$url" in
    *.tar.gz*) tar -xzf "$payload" -C "$STAGING" antigravity \
                   || die "extraction failed (archive has no 'antigravity' member)"
               src_bin="$STAGING/antigravity" ;;
    *)         src_bin="$payload" ;;
esac
cp -f "$src_bin" "$BINARY"      # installed as-is -- never patchelf'd (see header)
chmod +x "$BINARY"
ok "Binary installed: $BINARY"

# --- 6. write the proot launcher ------------------------------------------------
# Install-time values ($PREFIX, $BINARY, ...) are expanded now and baked in;
# runtime references are escaped (\$) so they evaluate when 'agy' is invoked.
cat > "$WRAPPER" <<EOF
#!$PREFIX/bin/bash
# Antigravity CLI launcher for Termux -- generated by install-antigravity-termux.sh.
# antigravity is a glibc Go binary; Termux is bionic + seccomp. We bind the glibc
# loader where the binary's PT_INTERP expects it and exec the binary directly under
# proot, which also rewrites the Go runtime's raw faccessat2(439) syscall (SIGSYS on
# Android) to the permitted faccessat(48). See the installer script for full details.
set -euo pipefail
BINARY="$BINARY"
SYS_LOADER="$SYS_LOADER"
LOADER_NAME="$loader_name"

[ -x "\$BINARY" ]     || { echo "agy: binary missing at \$BINARY -- re-run install-antigravity-termux.sh" >&2; exit 1; }
[ -f "\$SYS_LOADER" ] || { echo "agy: glibc loader missing at \$SYS_LOADER -- run: pkg install glibc-runner" >&2; exit 1; }
command -v proot >/dev/null 2>&1 || { echo "agy: 'proot' not installed -- run: pkg install proot" >&2; exit 1; }

exec proot -b "\$SYS_LOADER:/lib/\$LOADER_NAME" "\$BINARY" "\$@"
EOF
chmod +x "$WRAPPER"
ok "Launcher installed: $WRAPPER"

# --- 7. verify ------------------------------------------------------------------
# NOTE: we deliberately do NOT run antigravity's own `install` subcommand: it copies
# os.Executable() to ~/.local/bin/agy, which would overwrite our proot launcher with
# the raw (unrunnable-on-bionic) glibc binary. We configure PATH ourselves below.
reported="$("$WRAPPER" --version 2>/dev/null | head -1 || true)"
[ -n "$reported" ] || die "post-install check failed: '$WRAPPER --version' produced no output"
ok "Verified: agy --version -> $reported"
[ -z "$version" ] || [ "$reported" = "$version" ] || log "note: reported version ($reported) differs from manifest ($version)"

# --- 8. PATH guidance -----------------------------------------------------------
case ":$PATH:" in
    *":$BIN_DIR:"*) ok "$BIN_DIR is already on PATH -- start with:  agy" ;;
    *) printf '\n%s is not on your PATH yet. Add it:\n  echo '\''export PATH="%s:$PATH"'\'' >> ~/.bashrc && . ~/.bashrc\n' "$BIN_DIR" "$BIN_DIR" ;;
esac
