#!/bin/bash
# Convert video to animated WebP for Discord autoplay (under 10MB, crisp text)
# Usage: discwebp [file] - converts most recent screen recording or specified file
#
# Features:
#   - No arg: converts most recent screen recording
#   - Filename only: looks in Screen recordings folder
#   - Full path: uses exact path
#   - Auto-reduces quality until <10MB
#
# Settings optimized for crisp text:
#   - 720p max dimension with lanczos scaling
#   - Unsharp filter for edge enhancement
#   - 12fps, quality 70 (auto-reduces if needed)

RECDIR="$HOME/storage/shared/DCIM/Screen recordings"
input="$1"
quality=70
tmp="$HOME/.dwebp_tmp.webp"

# No arg: find most recent screen recording
if [[ -z "$input" ]]; then
  input=$(ls -t "$RECDIR"/*.mp4 2>/dev/null | head -1)
  [[ -z "$input" ]] && { echo "No screen recordings found in $RECDIR"; exit 1; }
# Arg without path: look in screen recordings dir
elif [[ "$input" != */* ]]; then
  [[ -f "$RECDIR/$input" ]] && input="$RECDIR/$input"
fi

[[ ! -f "$input" ]] && { echo "File not found: $input"; exit 1; }

output="${input%.*}_discord.webp"
echo "Converting: $(basename "$input")"
echo "Output: $(basename "$output")"

while [[ $quality -ge 50 ]]; do
  echo "Trying quality=$quality..."
  ffmpeg -y -i "$input" \
    -vf "scale=w=720:h=720:force_original_aspect_ratio=decrease:flags=lanczos,fps=12,unsharp=5:5:1.2:5:5:0.6" \
    -c:v libwebp -preset picture -loop 0 -quality $quality -compression_level 4 -an \
    "$tmp" 2>/dev/null
  size=$(stat -c%s "$tmp" 2>/dev/null)
  if [[ $size -le 10000000 ]]; then
    mv "$tmp" "$output"
    echo "Done: $(numfmt --to=iec $size) @ q=$quality"
    echo "$output"
    exit 0
  fi
  echo "$(numfmt --to=iec $size) > 10MB, reducing quality..."
  quality=$((quality-5))
done

echo "Failed: couldn't get under 10MB"
rm -f "$tmp"
exit 1
