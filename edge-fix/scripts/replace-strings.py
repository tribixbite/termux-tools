#!/data/data/com.termux/files/usr/bin/python3
"""
replace-strings.py - Replace string values in smali files.

Scans a smali file for string literals containing old_value and replaces
them with a new value. Handles two smali string contexts:
  1. const-string instructions: `const-string vN, "old_value"`
  2. Annotation values: `value = "old_value"` (e.g. Retrofit @Url annotations)

Used to black-hole telemetry endpoint URLs by pointing them to localhost.

Usage: python3 replace-strings.py <smali-file> <old-string> <new-string>
"""

import sys
import re


def replace_strings(filepath: str, old_str: str, new_str: str) -> int:
    """Replace string literals containing old_str with new_str.

    Handles both const-string instructions and annotation value strings.
    Returns the number of replacements made.
    """
    with open(filepath, "r") as f:
        content = f.read()

    escaped = re.escape(old_str)
    total_count = 0

    # Pattern 1: const-string and const-string/jumbo instructions
    pattern1 = rf'(const-string(?:/jumbo)?\s+[vp]\d+,\s*"){escaped}(")'
    replacement1 = rf"\g<1>{new_str}\g<2>"
    content, count1 = re.subn(pattern1, replacement1, content)
    total_count += count1

    # Pattern 2: annotation value strings (e.g. Retrofit @Url, @BaseUrl)
    # Matches: value = "https://example.com/path"
    pattern2 = rf'(value\s*=\s*"){escaped}(")'
    replacement2 = rf"\g<1>{new_str}\g<2>"
    content, count2 = re.subn(pattern2, replacement2, content)
    total_count += count2

    if total_count > 0:
        with open(filepath, "w") as f:
            f.write(content)

    return total_count


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
