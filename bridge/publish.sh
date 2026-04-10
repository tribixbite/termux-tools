#!/usr/bin/env bash
# Publish claude-chrome-android to npm with OTP
# Usage: bun publish.sh <otp>  OR  ./publish.sh <otp>
set -euo pipefail

OTP="${1:-}"
if [ -z "$OTP" ]; then
  echo "Usage: bun publish.sh <otp>" >&2
  exit 1
fi

cd "$(dirname "$0")"

# Rebuild CRX + CLI before publishing
echo "Building CRX..."
node ../scripts/build-crx.js
cp ../dist/claude-code-bridge-v*.crx dist/claude-code-bridge.crx 2>/dev/null || true

echo "Building CLI..."
node build.cjs

VERSION=$(node -e "console.log(require('./package.json').version)")
echo "Publishing claude-chrome-android@$VERSION..."
npm publish --otp="$OTP"

echo "Done: https://www.npmjs.com/package/claude-chrome-android/v/$VERSION"
