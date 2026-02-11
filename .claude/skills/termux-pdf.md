# Termux PDF Manipulation Skill

Use this skill for PDF layer extraction, manipulation, and processing on Termux ARM64. Covers sewing patterns, architectural drawings, CAD exports, and any layered PDF workflows.

## Prerequisites

```bash
# Core PDF tools
pkg install qpdf mupdf-tools poppler

# Python PDF libraries
pip install PyPDF2 pycryptodome

# Verify
which qpdf mutool pdfinfo gs python3
python3 -c "from PyPDF2 import PdfReader; print('PyPDF2 OK')"
```

## List PDF Layers (Optional Content Groups)

### With mutool (preferred)

```bash
# List all layers with visibility state
mutool draw -Y -o /dev/null input.pdf 1
# Output: layer 1 (on): Annotations
#         layer 2 (on): Size-XL
#         ...
```

### With Python

```python
from PyPDF2 import PdfReader

pdf = PdfReader('input.pdf')
if pdf.is_encrypted:
    pdf.decrypt('')

root = pdf.trailer['/Root'].get_object()
if '/OCProperties' in root:
    oc = root['/OCProperties'].get_object()
    for ref in oc['/OCGs']:
        obj = ref.get_object()
        print(f"Layer: {obj.get('/Name', 'unnamed')}")
else:
    print("No layers found")
```

## Extract Single Layer to New PDF

### mutool approach (renders content, strips hidden layers)

```bash
SRC="input.pdf"
DST="output_single_layer.pdf"

# First list layers to get their numbers
mutool draw -Y -o /dev/null "$SRC" 1

# Hide all unwanted layers by number, keep target layer visible
# Example: keep layer 10, hide layers 2-9,11-17
mutool draw -o "$DST" -F pdf \
  -z 2 -z 3 -z 4 -z 5 -z 6 -z 7 -z 8 -z 9 \
  -z 11 -z 12 -z 13 -z 14 -z 15 -z 16 -z 17 \
  "$SRC" 1-N
```

### Showing specific layers explicitly

```bash
# -z hides a layer, -Z shows a layer
# Hide everything first (via base state), then show specific ones
mutool draw -o output.pdf -F pdf -Z 1 -Z 10 input.pdf 1-19
```

## Handle Encrypted PDFs

```bash
# Decrypt with qpdf first (empty password for owner-only encryption)
qpdf --decrypt input.pdf decrypted.pdf

# Then process decrypted file
mutool draw -Y -o /dev/null decrypted.pdf 1

# Clean up
rm decrypted.pdf
```

## Render Pages as Images

```bash
# Single page to PNG at 150 DPI
mutool draw -o page_%d.png -r 150 input.pdf 2

# All pages
mutool draw -o page_%d.png -r 150 input.pdf

# Specific page range
mutool draw -o page_%d.png -r 150 input.pdf 5-10

# With layer filtering
mutool draw -o page_%d.png -r 150 -z 2 -z 3 input.pdf 1-5
```

## PDF Info and Metadata

```bash
# Full metadata
pdfinfo input.pdf

# Page count, size, encryption status
pdfinfo input.pdf | grep -E 'Pages|Page size|Encrypted'
```

## Merge PDFs

```bash
# Concatenate multiple PDFs
qpdf --empty --pages file1.pdf file2.pdf file3.pdf -- merged.pdf

# Specific page ranges
qpdf --empty --pages file1.pdf 1-5 file2.pdf 3,7,9 -- merged.pdf
```

## Split PDF

```bash
# Extract page range
qpdf input.pdf --pages . 1-5 -- first_5_pages.pdf

# Split into single pages
qpdf input.pdf --split-pages output_%d.pdf
```

## Compress / Optimize

```bash
# Linearize (optimize for web)
qpdf --linearize input.pdf optimized.pdf

# Compress with Ghostscript
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
   -dPDFSETTINGS=/printer \
   -dNOPAUSE -dBATCH -dQUIET \
   -sOutputFile=compressed.pdf input.pdf

# PDFSETTINGS options:
# /screen    — low quality, small size (72 dpi)
# /ebook     — medium quality (150 dpi)
# /printer   — high quality (300 dpi)
# /prepress  — highest quality, preserves color
```

## Sewing Pattern Workflow

Sewing patterns typically have all sizes overlaid with different colored lines on shared layers. Common structure:

```
Layer: Intro Page       — instructions, cutting guide
Layer: Annotations      — piece numbers, fold lines, grainlines, labels
Layer: 0/3, 3/6, etc.  — individual size lines
```

### Full extraction workflow

```bash
PDF="pattern.pdf"

# 1. Decrypt if needed
qpdf --decrypt "$PDF" decrypted.pdf && PDF="decrypted.pdf"

# 2. List layers
mutool draw -Y -o /dev/null "$PDF" 1

# 3. Note target layer number and layers to hide
# 4. Extract with only target size + annotations visible
TARGET_SIZE="2T"  # adjust as needed

mutool draw -o "pattern_${TARGET_SIZE}.pdf" -F pdf \
  -z 2 -z 3 -z 4 -z 5 -z 6 -z 7 -z 8 -z 9 \
  -z 11 -z 12 -z 13 -z 14 -z 15 -z 16 -z 17 \
  "$PDF" 1-19

# 5. Verify scale — check test squares on page 1
# Print at 100% (no scaling/fit-to-page)
```

## Python: Batch Layer Extraction

```python
from PyPDF2 import PdfReader
import subprocess

src = 'pattern_decrypted.pdf'
reader = PdfReader(src)
if reader.is_encrypted:
    reader.decrypt('')

# Get layer names and numbers
root = reader.trailer['/Root'].get_object()
oc = root['/OCProperties'].get_object()
layers = {}
for i, ref in enumerate(oc['/OCGs'], 1):
    obj = ref.get_object()
    name = str(obj.get('/Name', ''))
    layers[i] = name

# Extract each size layer separately
utility_layers = {'Annotations', 'Intro Page'}
size_layers = {k: v for k, v in layers.items() if v not in utility_layers}

pages = str(len(reader.pages))

for num, name in size_layers.items():
    hide = [str(n) for n in size_layers if n != num]
    cmd = ['mutool', 'draw', '-o', f'pattern_{name}.pdf', '-F', 'pdf']
    for h in hide:
        cmd.extend(['-z', h])
    cmd.extend([src, f'1-{pages}'])
    subprocess.run(cmd)
    print(f"Extracted: pattern_{name}.pdf")
```

## Troubleshooting

### AAPT2/build errors
Not applicable — this is a CLI-only workflow, no Android build involved.

### PyPDF2 AES encryption error
```bash
pip install pycryptodome
```

### mutool "invalid marked content" warnings
These are non-fatal warnings from complex Illustrator-exported PDFs. The output PDF is still correct.

### pikepdf won't install on Termux ARM64
Use PyPDF2 + mutool instead. pikepdf requires C++ compilation that fails on Termux.

### PDF renders with all layers visible in some viewers
Some PDF viewers ignore OCG visibility flags. Use `mutool draw -F pdf` with `-z` flags to physically strip hidden layer content from the output rather than relying on viewer hints.

## Tool Comparison

| Tool | Best For | Layer Support |
|------|----------|---------------|
| `mutool` | Layer extraction, rendering | Full (-Y, -z, -Z) |
| `qpdf` | Decrypt, merge, split, optimize | No layer control |
| `gs` | Compression, format conversion | No layer control |
| `pdfinfo` | Quick metadata inspection | Read-only |
| `PyPDF2` | Programmatic metadata/OCG inspection | Read OCG names |
