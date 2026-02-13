# Screenshot Handling for Termux / Anthropic API

## Critical Rule
The Anthropic API **rejects images** where any dimension is >= 2000px or file size >= 4MB.
**ALWAYS** resize and compress before reading or sending screenshots.

## Quick Reference

### Check dimensions and size
```bash
identify screenshot.png                          # ImageMagick: WxH
file screenshot.png                              # Basic info
stat -c%s screenshot.png                         # Size in bytes (must be < 4194304)
```

### Auto-resize one-liner (safe for any image)
```bash
magick input.png -resize '1999x1999>' -quality 85 output.jpg
```
The `>` flag means "only shrink if larger" — safe to run on already-small images.

### Step-by-step
```bash
# 1. Resize if any dimension >= 2000px (keeps aspect ratio)
convert screenshot.png -resize '1999x1999>' screenshot.png

# 2. Compress if still > 4MB
convert screenshot.png -quality 85 screenshot.jpg

# 3. Verify
identify screenshot.jpg           # Check dimensions < 2000
stat -c%s screenshot.jpg          # Check size < 4194304
```

## ADB Screenshot Capture
```bash
# Capture from connected device
adb shell screencap -p /sdcard/screenshot.png
adb pull /sdcard/screenshot.png ./screenshot.png

# One-liner: capture + pull + resize
adb shell screencap -p /sdcard/ss.png && \
  adb pull /sdcard/ss.png ./ss.png && \
  magick ./ss.png -resize '1999x1999>' -quality 85 ./ss.jpg
```

## Screenshot Location
Local screenshots: `~/storage/shared/DCIM/Screenshots`

## Batch Processing
```bash
# Resize all PNGs in a directory
for f in *.png; do
  magick "$f" -resize '1999x1999>' -quality 85 "${f%.png}.jpg"
done
```

## Common Gotchas
- Phone screenshots are typically 1080x2400 — the **height exceeds 2000px**, must resize
- `adb shell screencap` captures at full device resolution
- PNG screenshots from high-DPI devices can be 5-10MB — always compress to JPEG
- Use `-quality 85` for JPEG — good balance of size and clarity
- If using `convert` instead of `magick`, they're equivalent (ImageMagick 7 prefers `magick`)
