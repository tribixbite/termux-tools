#!/bin/bash
# Claude Code PreToolUse hook: auto-resize images before Read
# Prevents Anthropic API rejection for images >= 2000px or >= 4MB
# Resizes to a temp file and redirects Read — original file untouched

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only process image files
[[ "$FILE_PATH" =~ \.(png|jpg|jpeg|gif|webp|bmp|tiff|PNG|JPG|JPEG)$ ]] || exit 0

# File must exist
[[ -f "$FILE_PATH" ]] || exit 0

# Check file size (bytes)
SIZE=$(stat -c%s "$FILE_PATH" 2>/dev/null) || exit 0

# Check dimensions via identify (width height)
DIMS=$(identify -format '%w %h' "$FILE_PATH[0]" 2>/dev/null) || exit 0
WIDTH=${DIMS%% *}
HEIGHT=${DIMS##* }

# If under limits, pass through unchanged
if [[ $WIDTH -lt 2000 && $HEIGHT -lt 2000 && $SIZE -lt 4194304 ]]; then
  exit 0
fi

# Resize to temp file (non-destructive)
HASH=$(echo "$FILE_PATH" | md5sum | cut -d' ' -f1)
TMPBASE="${TMPDIR:-/data/data/com.termux/files/usr/tmp}"
TEMP="${TMPBASE}/claude-resized-${HASH}.jpg"

magick "$FILE_PATH[0]" -resize '1999x1999>' -quality 85 "$TEMP" 2>/dev/null || exit 0
[[ -f "$TEMP" ]] || exit 0

NEW_SIZE=$(stat -c%s "$TEMP" 2>/dev/null)

# Return updatedInput to redirect Read to resized copy
cat <<ENDJSON
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Hook auto-resized image from ${WIDTH}x${HEIGHT} ($(numfmt --to=iec $SIZE)) to fit API limits (max 1999px, <4MB). Now ${NEW_SIZE} bytes. Original: $FILE_PATH",
    "updatedInput": {
      "file_path": "$TEMP"
    }
  }
}
ENDJSON
