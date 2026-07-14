#!/data/data/com.termux/files/usr/bin/bash
# Build the Printing Press Library Go CLIs (digg / arxiv / techmeme) on Termux.
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# The last30days skill's auto-setup runs:
#     bunx @mvanhorn/printing-press-library install <name> --cli-only
# which does `go install github.com/mvanhorn/printing-press-library/.../cmd/<bin>@latest`.
# Each CLI's go.mod declares `go 1.26.5`, but Termux's pacman only packages
# Go 1.26.3, and Google does NOT publish an android/arm64 Go toolchain for the
# `go` command to auto-download. So the build dies with:
#     go: download go1.26.5 for android/arm64: toolchain not available
#
# FIX: clone the monorepo, lower the `go 1.26.5` directive to the installed
# 1.26.3 (none of these CLIs use 1.26.5-only language/stdlib features), pin
# GOTOOLCHAIN=local so `go` never tries to fetch a toolchain, and build natively.
# Result: real android/arm64 binaries in ~/.local/bin, no proot needed at runtime.
#
# Re-run this after Termux ships Go >= 1.26.5 to drop the patch, or whenever you
# want to refresh the CLIs. Idempotent: overwrites the binaries in place.
#
# Usage:  bash scripts/build-printing-press-clis.sh [digg arxiv techmeme ...]
#         (no args = all three)
set -euo pipefail

REPO="https://github.com/mvanhorn/printing-press-library"
WORK="${TMPDIR:-$PREFIX/tmp}/ppl-build"
BIN_DIR="$HOME/.local/bin"
GO_MIN_LOCAL="1.26.3"   # the version we down-patch go.mod to (must match installed Go major.minor)

# name -> repo path (from registry.json) and cmd binary name
declare -A MOD_PATH=(
  [digg]="library/media-and-entertainment/digg"
  [arxiv]="library/other/arxiv"
  [techmeme]="library/productivity/techmeme"
)
declare -A CLI_BIN=(
  [digg]="digg-pp-cli"
  [arxiv]="arxiv-pp-cli"
  [techmeme]="techmeme-pp-cli"
)

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(digg arxiv techmeme)

command -v go >/dev/null || { echo "ERROR: go not installed (pkg install golang)"; exit 1; }
echo "Using $(go version)"
mkdir -p "$BIN_DIR"

# Fresh shallow clone (monorepo ~100MB + deps; the Go module cache in ~/go is reused).
rm -rf "$WORK"
echo "Cloning $REPO ..."
git clone --depth 1 "$REPO" "$WORK"

for name in "${targets[@]}"; do
  mod="${MOD_PATH[$name]:-}"; bin="${CLI_BIN[$name]:-}"
  if [ -z "$mod" ] || [ -z "$bin" ]; then
    echo "SKIP: unknown CLI '$name'"; continue
  fi
  dir="$WORK/$mod"
  if [ ! -f "$dir/go.mod" ]; then
    echo "SKIP: $name — go.mod not found at $dir"; continue
  fi
  echo "=== building $bin ($mod) ==="
  # Down-patch the version gate to the locally installed toolchain.
  sed -i "s/^go 1\.26\.5/go ${GO_MIN_LOCAL}/" "$dir/go.mod"
  ( cd "$dir" && GOTOOLCHAIN=local GOFLAGS=-mod=mod go build -o "$BIN_DIR/$bin" "./cmd/$bin" )
  if [ -x "$BIN_DIR/$bin" ]; then
    echo "OK: $BIN_DIR/$bin  ($("$BIN_DIR/$bin" --version 2>/dev/null | head -1))"
  else
    echo "FAIL: $bin did not build"; exit 1
  fi
done

# Leave the Go module cache populated (fast rebuilds) but drop the big clone.
rm -rf "$WORK"

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *) echo "NOTE: add '$BIN_DIR' to PATH so the last30days engine (and Digg) can find these." ;;
esac
echo "Done. digg-pp-cli activates Digg in last30days doctor; arxiv/techmeme feed papers & tech headlines."
