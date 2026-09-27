#!/data/data/com.termux/files/usr/bin/bash
# Patch the native Codex CLI binary to make c-ares DNS work on Termux.
#
# Codex's bundled resolver opens the absolute path /etc/resolv.conf. Android's
# read-only /system/etc does not provide that file to Termux, so device-code
# login can fail before it reaches OpenAI. The existing claude-channel patcher
# safely replaces that literal with the equal-length /sdcard/dns.conf path.
#
# Usage:
#   scripts/patch-codex-termux-dns.sh
#   scripts/patch-codex-termux-dns.sh /path/to/native/codex
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly DEFAULT_CODEX_BINARY="$HOME/.bun/install/global/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex"
readonly CODEX_BINARY="${1:-${CODEX_BINARY:-$DEFAULT_CODEX_BINARY}}"
readonly PATCH_MODULE="$REPOSITORY_ROOT/claude-channel/src/patch.ts"
readonly BACKUP_PATH="$CODEX_BINARY.bak-prepatch"

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [native-codex-binary]" >&2
  exit 2
fi

if [ ! -f "$CODEX_BINARY" ]; then
  echo "Codex binary not found: $CODEX_BINARY" >&2
  echo "Pass its native binary path as the first argument or set CODEX_BINARY." >&2
  exit 1
fi

if [ ! -f "$PATCH_MODULE" ]; then
  echo "Patch module not found: $PATCH_MODULE" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to load $PATCH_MODULE" >&2
  exit 1
fi

if [ ! -e "$BACKUP_PATH" ]; then
  cp -p -- "$CODEX_BINARY" "$BACKUP_PATH"
  echo "Created backup: $BACKUP_PATH"
fi

temporary_binary="$(mktemp "$(dirname -- "$CODEX_BINARY")/.codex-patched.XXXXXX")"
trap 'rm -f -- "$temporary_binary"' EXIT
cp -p -- "$CODEX_BINARY" "$temporary_binary"

cd -- "$REPOSITORY_ROOT"
env -u BUN_BINARY_PATH bun -e '
  import { existsSync, readFileSync, writeFileSync } from "node:fs";
  import {
    PATCH_TARGETS,
    RESOLV_CONTENT,
    RESOLV_FROM,
    RESOLV_REDIRECT_PATH,
    patchBuffer,
  } from "./claude-channel/src/patch.ts";

  const binaryPath = process.argv[1];
  const buffer = readFileSync(binaryPath);
  const originalLength = buffer.length;
  const existingRedirects = countOccurrences(buffer, RESOLV_REDIRECT_PATH);
  const result = patchBuffer(buffer, PATCH_TARGETS);
  const replacements = result.occurrences[RESOLV_FROM] ?? 0;

  if (buffer.length !== originalLength) {
    throw new Error("patch changed byte length and would corrupt the binary");
  }
  if (replacements === 0 && existingRedirects === 0) {
    throw new Error(`resolver literal not found: ${RESOLV_FROM}`);
  }

  if (!existsSync(RESOLV_REDIRECT_PATH) || readFileSync(RESOLV_REDIRECT_PATH).length === 0) {
    writeFileSync(RESOLV_REDIRECT_PATH, RESOLV_CONTENT);
    console.log(`Created resolver configuration: ${RESOLV_REDIRECT_PATH}`);
  }

  writeFileSync(binaryPath, buffer);
  console.log(replacements > 0
    ? `Replaced ${replacements} resolver path occurrence(s).`
    : `Already patched (${existingRedirects} redirect occurrence(s)).`);

  function countOccurrences(haystack: Buffer, value: string): number {
    const needle = Buffer.from(value, "latin1");
    let count = 0;
    let offset = 0;
    for (;;) {
      const index = haystack.indexOf(needle, offset);
      if (index < 0) return count;
      count += 1;
      offset = index + needle.length;
    }
  }
' "$temporary_binary"

mv -f -- "$temporary_binary" "$CODEX_BINARY"
trap - EXIT

echo "Patched atomically: $CODEX_BINARY"

# Codex prepends its bundled tools to PATH. The upstream musl rg needs an
# interpreter Android lacks; use the installed bionic build after each update.
bundled_rg="$(dirname -- "$CODEX_BINARY")/../codex-path/rg"
native_rg="${PREFIX:-/data/data/com.termux/files/usr}/bin/rg"
if [ -f "$bundled_rg" ] && [ -x "$native_rg" ]; then
  "$native_rg" --version >/dev/null
  if [ ! -L "$bundled_rg" ]; then
    if [ ! -e "$bundled_rg.bak-prepatch" ]; then
      cp -p -- "$bundled_rg" "$bundled_rg.bak-prepatch"
    fi
    temporary_rg_dir="$(mktemp -d "$(dirname -- "$bundled_rg")/.codex-rg.XXXXXX")"
    trap 'rm -f -- "$temporary_rg_dir/rg"; rmdir -- "$temporary_rg_dir"' EXIT
    ln -s -- "$native_rg" "$temporary_rg_dir/rg"
    mv -Tf -- "$temporary_rg_dir/rg" "$bundled_rg"
    rmdir -- "$temporary_rg_dir"
    trap - EXIT
  fi
  "$bundled_rg" --version >/dev/null
  echo "Verified Termux search tool: $bundled_rg"
fi
