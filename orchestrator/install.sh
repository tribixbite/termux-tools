#!/data/data/com.termux/files/usr/bin/bash
# install.sh — TMX Orchestrator installer for Termux
# Usage: bash install.sh
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME="${HOME:-/data/data/com.termux/files/home}"
TMX_DIR="$(cd "$(dirname "$0")" && pwd)"

info()  { printf '\033[32m[tmx]\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m[tmx]\033[0m %s\n' "$1"; }
error() { printf '\033[31m[tmx]\033[0m %s\n' "$1" >&2; }

# ── Prerequisites ─────────────────────────────────────────────────────────────

info "Checking prerequisites..."

if ! command -v tmux &>/dev/null; then
  info "Installing tmux..."
  pkg install -y tmux
fi

if ! command -v bun &>/dev/null; then
  error "Bun is required but not installed."
  error "See: https://github.com/nickspaargaren/bun-on-termux"
  exit 1
fi

if ! command -v node &>/dev/null; then
  info "Installing Node.js (needed for esbuild)..."
  pkg install -y nodejs-lts
fi

# ── Install dependencies ─────────────────────────────────────────────────────

info "Installing dependencies..."
cd "$TMX_DIR"
if ! bun install --cwd "$TMX_DIR" --backend=copyfile; then
  error "bun install failed (exit $?)"
  exit 1
fi

# Fix Android-specific native binaries if the script exists
if [ -f "$TMX_DIR/../scripts/fix-android-binaries.mjs" ]; then
  if ! node "$TMX_DIR/../scripts/fix-android-binaries.mjs"; then
    error "fix-android-binaries failed (exit $?)"
    exit 1
  fi
fi

# ── Build ─────────────────────────────────────────────────────────────────────

info "Building tmx daemon..."
cd "$TMX_DIR"
bun run build

if [ ! -f "$TMX_DIR/dist/tmx.js" ]; then
  error "Build failed — dist/tmx.js not found"
  exit 1
fi

# ── Build dashboard ──────────────────────────────────────────────────────────

if [ -d "$TMX_DIR/dashboard" ]; then
  info "Building dashboard..."
  cd "$TMX_DIR/dashboard"
  bun install --cwd "$TMX_DIR/dashboard" --backend=copyfile 2>/dev/null || true

  # Fix Android native binaries for Astro/Vite/Rollup
  if [ -f "$TMX_DIR/../scripts/fix-android-binaries.mjs" ]; then
    cd "$TMX_DIR/dashboard"
    node "$TMX_DIR/../scripts/fix-android-binaries.mjs" 2>/dev/null || true
  fi

  # Install rollup android binary if missing
  if [ ! -d "$TMX_DIR/dashboard/node_modules/@rollup/rollup-android-arm64" ]; then
    cd "$TMX_DIR/dashboard"
    npm install @rollup/rollup-android-arm64 --no-save 2>/dev/null || true
  fi

  cd "$TMX_DIR/dashboard"
  bun run build 2>/dev/null || warn "Dashboard build failed (non-fatal)"
fi

# ── Symlink ──────────────────────────────────────────────────────────────────

info "Creating symlink..."
mkdir -p "$HOME/.local/bin"
ln -sf "$TMX_DIR/dist/tmx.js" "$HOME/.local/bin/tmx"
chmod +x "$TMX_DIR/dist/tmx.js"

# Ensure ~/.local/bin is in PATH
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
  warn "Add to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ── Config ───────────────────────────────────────────────────────────────────

CONFIG_DIR="$HOME/.config/tmx"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/tmx.toml" ]; then
  info "Creating default config at $CONFIG_DIR/tmx.toml"
  cp "$TMX_DIR/tmx.toml.example" "$CONFIG_DIR/tmx.toml"
  info "Edit $CONFIG_DIR/tmx.toml to configure your sessions."
else
  info "Config already exists at $CONFIG_DIR/tmx.toml"
fi

# ── State directories ────────────────────────────────────────────────────────

mkdir -p "$HOME/.local/share/tmx/logs"

# ── Done ─────────────────────────────────────────────────────────────────────

info "Installation complete."
info ""
info "  Edit config:   $CONFIG_DIR/tmx.toml"
info "  Start daemon:  tmx boot"
info "  Check status:  tmx status"
info "  Dashboard:     http://127.0.0.1:18970"
