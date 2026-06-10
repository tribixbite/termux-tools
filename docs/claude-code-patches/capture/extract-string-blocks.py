#!/data/data/com.termux/files/usr/bin/python3
"""
extract-string-blocks.py — pull the full surrounding printable-text block around each
occurrence of one or more keywords in a binary (e.g. the Claude Code ELF).

Claude Code is a bun-compiled binary that embeds its JS (and a lot of unrelated data:
Wolfram symbol tables, compression dictionaries, etc.) as printable runs. To inspect
what a keyword like "biology" actually refers to, you want the whole readable run it
sits in, not a fixed-width window. This expands left/right over printable bytes (capped)
and de-duplicates identical blocks.

Example
-------
  ./extract-string-blocks.py ~/.claude/binaries/claude-2.1.170/claude-binary \
      -w chemistry -w biology --out chem-bio-blocks.txt
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

# printable ASCII + tab/newline/carriage-return
_PRINTABLE = set(range(0x20, 0x7F)) | {0x09, 0x0A, 0x0D}


def surrounding_block(text: str, index: int, cap: int) -> str:
    """Expand from `index` over printable chars, up to `cap` chars each side."""
    lo = index
    while lo > 0 and ord(text[lo - 1]) in _PRINTABLE and index - lo < cap:
        lo -= 1
    hi = index
    while hi < len(text) and ord(text[hi]) in _PRINTABLE and hi - index < cap:
        hi += 1
    return text[lo:hi].strip()


def main() -> None:
    ap = argparse.ArgumentParser(description="Extract full surrounding text blocks around keywords in a binary.")
    ap.add_argument("binary", help="path to the binary to scan")
    ap.add_argument("-w", "--word", action="append", required=True, dest="words",
                    help="keyword to search (case-insensitive); repeatable")
    ap.add_argument("--cap", type=int, default=1200, help="max chars to expand each side (default 1200)")
    ap.add_argument("--out", default="-", help="output file (default: stdout)")
    args = ap.parse_args()

    # latin-1 keeps a 1:1 byte<->char mapping so offsets stay meaningful.
    text = Path(args.binary).read_bytes().decode("latin-1")

    out: list[str] = [
        f"# Full surrounding text blocks from: {args.binary}",
        f"# keywords: {', '.join(args.words)}   cap: {args.cap} chars/side",
        "=" * 96,
    ]
    for word in args.words:
        seen: set[str] = set()
        hits = list(re.finditer(re.escape(word), text, re.IGNORECASE))
        blocks = []
        for m in hits:
            blk = surrounding_block(text, m.start(), args.cap)
            key = blk[:200]
            if key in seen:
                continue
            seen.add(key)
            blocks.append((m.start(), blk))
        out.append(f"\n\n========== WORD {word!r}: {len(hits)} raw hits, {len(blocks)} unique block(s) ==========")
        for off, blk in blocks:
            out.append(f"\n----- offset 0x{off:x} -----")
            out.append(blk)

    payload = "\n".join(out) + "\n"
    if args.out == "-":
        print(payload, end="")
    else:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"wrote {args.out} ({len(payload)} bytes)")


if __name__ == "__main__":
    main()
