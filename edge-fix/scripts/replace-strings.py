#!/data/data/com.termux/files/usr/bin/python3
"""
replace-strings.py - Replace const-string values in smali files.

Scans a smali file for `const-string vN, "old_value"` instructions and
replaces the string literal with a new value. Used to black-hole telemetry
endpoint URLs by pointing them to localhost.

Usage: python3 replace-strings.py <smali-file> <old-string> <new-string>
"""

import sys
import re


def replace_strings(filepath: str, old_str: str, new_str: str) -> int:
    """Replace const-string values matching old_str with new_str.

    Returns the number of replacements made.
    """
    with open(filepath, "r") as f:
        content = f.read()

    # Escape the old string for use in regex (handle special chars in URLs)
    escaped = re.escape(old_str)

    # Match const-string and const-string/jumbo instructions
    pattern = rf'(const-string(?:/jumbo)?\s+[vp]\d+,\s*"){escaped}(")'
    replacement = rf"\g<1>{new_str}\g<2>"

    new_content, count = re.subn(pattern, replacement, content)

    if count > 0:
        with open(filepath, "w") as f:
            f.write(new_content)

    return count


def main() -> None:
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <smali-file> <old-string> <new-string>")
        sys.exit(1)

    filepath = sys.argv[1]
    old_str = sys.argv[2]
    new_str = sys.argv[3]

    count = replace_strings(filepath, old_str, new_str)
    filename = filepath.split("/")[-1]
    if count > 0:
        print(f"    [x] Replaced {count} occurrence(s) of URL in {filename}")


if __name__ == "__main__":
    main()
