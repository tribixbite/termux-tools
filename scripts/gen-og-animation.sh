#!/usr/bin/env bash
# Generate animated WebP OG image for termux.party
# Shows a tmx boot sequence with sessions coming online
set -euo pipefail

OUT_DIR="${PREFIX}/tmp/og-frames"
FINAL="${1:-site/public/og.webp}"
W=1200
H=630

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Colors
BG="#0d1117"
GREEN="#4ade80"
CYAN="#22d3ee"
YELLOW="#facc15"
DIM="#6b7280"
WHITE="#e5e7eb"
ACCENT="#10b981"
BORDER="#1e293b"

# Font (use available monospace)
FONT="JetBrains-Mono"
convert -list font 2>/dev/null | grep -qi jetbrains || FONT="DejaVu-Sans-Mono"
convert -list font 2>/dev/null | grep -qi dejavu || FONT="monospace"

# Sessions to animate
SESSIONS=("termux-x11" "playwright" "termux-tools" "stoatally" "cleverkeys" "craftmatic" "torch" "digr")
STATUSES=("service" "service" "claude" "claude" "claude" "claude" "claude" "claude")

generate_frame() {
  local frame_num=$1
  local outfile="$OUT_DIR/frame_$(printf '%03d' $frame_num).png"

  # Build the draw commands
  local draws=""

  # Background
  draws="$draws fill '$BG' rectangle 0,0 $W,$H"

  # Top border accent line
  draws="$draws fill '$ACCENT' rectangle 0,0 $W,3"

  # Title: "tmx"
  draws="$draws fill '$GREEN' font-size 72 font '$FONT' gravity NorthWest text 60,40 'tmx'"

  # Subtitle
  draws="$draws fill '$DIM' font-size 20 text 280,62 'orchestrator'"

  # Divider line
  draws="$draws fill '$BORDER' rectangle 60,120 1140,121"

  # "$ tmx boot" command line
  local cmd_alpha=255
  if [ $frame_num -lt 3 ]; then
    cmd_alpha=$((frame_num * 85))
  fi
  draws="$draws fill '$CYAN' font-size 24 text 60,140 '\$ tmx boot'"

  # Boot progress bar
  local progress=$((frame_num * 100 / 24))
  if [ $progress -gt 100 ]; then progress=100; fi
  local bar_w=$((progress * 500 / 100))
  draws="$draws fill '$BORDER' rectangle 60,190 560,206"
  if [ $bar_w -gt 0 ]; then
    draws="$draws fill '$ACCENT' rectangle 60,190 $((60 + bar_w)),206"
  fi
  draws="$draws fill '$DIM' font-size 14 text 580,192 '${progress}%'"

  # Session list
  local y=240
  local visible_count=$(( (frame_num - 2) ))
  if [ $visible_count -lt 0 ]; then visible_count=0; fi
  if [ $visible_count -gt ${#SESSIONS[@]} ]; then visible_count=${#SESSIONS[@]}; fi

  for i in $(seq 0 $((${#SESSIONS[@]} - 1))); do
    local name="${SESSIONS[$i]}"
    local stype="${STATUSES[$i]}"

    if [ $i -lt $visible_count ]; then
      # Session is visible
      local frames_since=$(( frame_num - 2 - i ))

      if [ $frames_since -ge 6 ]; then
        # Running state (green dot)
        draws="$draws fill '$GREEN' circle $((80)),$(($y + 8)) $((86)),$(($y + 8))"
        draws="$draws fill '$WHITE' font-size 18 text 100,$y '$name'"
        draws="$draws fill '$GREEN' font-size 14 text 400,$y 'running'"
        if [ "$stype" = "claude" ]; then
          draws="$draws fill '$DIM' font-size 12 text 500,$y 'claude'"
        else
          draws="$draws fill '$DIM' font-size 12 text 500,$y 'service'"
        fi
      elif [ $frames_since -ge 3 ]; then
        # Starting state (yellow dot)
        draws="$draws fill '$YELLOW' circle $((80)),$(($y + 8)) $((86)),$(($y + 8))"
        draws="$draws fill '$WHITE' font-size 18 text 100,$y '$name'"
        draws="$draws fill '$YELLOW' font-size 14 text 400,$y 'starting'"
      else
        # Just appeared (dim)
        draws="$draws fill '$DIM' circle $((80)),$(($y + 8)) $((86)),$(($y + 8))"
        draws="$draws fill '$DIM' font-size 18 text 100,$y '$name'"
        draws="$draws fill '$DIM' font-size 14 text 400,$y 'pending'"
      fi
    fi
    y=$((y + 40))
  done

  # Status bar at bottom
  local running=$(( visible_count > 6 ? visible_count - 2 : (visible_count > 2 ? visible_count - 2 : 0) ))
  if [ $frame_num -ge 20 ]; then running=${#SESSIONS[@]}; fi
  draws="$draws fill '$BORDER' rectangle 0,590 $W,$H"
  draws="$draws fill '$DIM' font-size 14 text 60,600 'termux.party'"
  draws="$draws fill '$ACCENT' font-size 14 text 400,600 '▶ ${running}/${#SESSIONS[@]} sessions'"

  # Final "Boot complete" flash on last frames
  if [ $frame_num -ge 22 ]; then
    draws="$draws fill '$GREEN' font-size 16 text 700,600 '✓ boot complete'"
  fi

  convert -size "${W}x${H}" xc:"$BG" -draw "$draws" "$outfile"
}

echo "Generating 26 frames..."
for i in $(seq 0 25); do
  generate_frame $i
  printf "."
done
echo " done"

# Hold last frame longer (loop pause)
for i in $(seq 26 35); do
  cp "$OUT_DIR/frame_025.png" "$OUT_DIR/frame_$(printf '%03d' $i).png"
done

# Create animated WebP
echo "Assembling animated WebP..."
WEBP_ARGS=""
for f in "$OUT_DIR"/frame_*.png; do
  cwebp -quiet -q 85 "$f" -o "${f%.png}.webp"
  WEBP_ARGS="$WEBP_ARGS ${f%.png}.webp"
done

img2webp -loop 0 -d 120 $WEBP_ARGS -o "$FINAL"

echo "Created: $FINAL ($(wc -c < "$FINAL") bytes)"

# Also create a static PNG version for platforms that don't support animated WebP
convert "$OUT_DIR/frame_025.png" "${FINAL%.webp}.png"
echo "Created static fallback: ${FINAL%.webp}.png"

# Cleanup
rm -rf "$OUT_DIR"
