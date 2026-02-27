#!/data/data/com.termux/files/usr/bin/python3
"""
patch-dex-strings.py - Binary-patch string values directly in a DEX file.

Replaces string literals in the DEX string table without decompiling/recompiling.
This avoids baksmali/smali round-trip bugs (IncompatibleClassChangeError on
interfaces with static methods) while still neutralizing telemetry URLs.

To maintain DEX string table sort order, the replacement string is padded to
the EXACT same byte length as the original. The ULEB128 length prefix and null
terminator position remain unchanged — only the string content bytes change.

Usage: python3 patch-dex-strings.py <dex-file> <old-string> <new-string>
"""

import sys
import struct
import hashlib
import zlib


def decode_uleb128(data: bytes, offset: int) -> tuple[int, int]:
    """Decode ULEB128 at offset. Returns (value, bytes_consumed)."""
    result = 0
    shift = 0
    size = 0
    while True:
        byte = data[offset + size]
        result |= (byte & 0x7F) << shift
        size += 1
        shift += 7
        if (byte & 0x80) == 0:
            break
    return result, size


def patch_dex_strings(dex_path: str, old_str: str, new_str: str) -> int:
    """Replace old_str with new_str in the DEX string table.

    The replacement is padded to match the original string length exactly,
    preserving the ULEB128 length prefix and string table sort order.

    Returns the number of replacements made.
    """
    with open(dex_path, "rb") as f:
        data = bytearray(f.read())

    old_bytes = old_str.encode("utf-8")
    new_bytes = new_str.encode("utf-8")

    if len(new_bytes) > len(old_bytes):
        print(f"    [!] Replacement string longer than original, skipping")
        return 0

    # Pad replacement to exact same length using path separator characters
    # This keeps the ULEB128 length prefix, null terminator position, and
    # string table sort order intact
    padded_new = new_bytes + b"/" * (len(old_bytes) - len(new_bytes))

    count = 0
    search_start = 0

    while True:
        pos = data.find(old_bytes, search_start)
        if pos == -1:
            break

        # Verify null terminator follows the string
        end_pos = pos + len(old_bytes)
        if end_pos >= len(data) or data[end_pos] != 0x00:
            search_start = pos + 1
            continue

        # Verify ULEB128 length prefix precedes the string
        found_prefix = False
        for prefix_start in range(max(0, pos - 5), pos):
            try:
                utf16_len, uleb_size = decode_uleb128(data, prefix_start)
                if prefix_start + uleb_size == pos and utf16_len == len(old_bytes):
                    found_prefix = True
                    break
            except (IndexError, ValueError):
                continue

        if not found_prefix:
            search_start = pos + 1
            continue

        # Replace string content in-place (same length, no structural changes)
        data[pos:pos + len(old_bytes)] = padded_new
        count += 1
        search_start = pos + len(old_bytes) + 1

    if count > 0:
        # Update DEX signature (SHA-1 of bytes 32..end)
        sha1 = hashlib.sha1(data[32:]).digest()
        data[12:32] = sha1

        # Update DEX checksum (Adler32 of bytes 12..end)
        checksum = zlib.adler32(bytes(data[12:])) & 0xFFFFFFFF
        data[8:12] = struct.pack("<I", checksum)

        with open(dex_path, "wb") as f:
            f.write(data)

    return count


def main() -> None:
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <dex-file> <old-string> <new-string>")
        sys.exit(1)

    dex_path = sys.argv[1]
    old_str = sys.argv[2]
    new_str = sys.argv[3]

    count = patch_dex_strings(dex_path, old_str, new_str)
    filename = dex_path.split("/")[-1]
    if count > 0:
        print(f"    [x] Binary-patched {count} string(s) in {filename}")


if __name__ == "__main__":
    main()
