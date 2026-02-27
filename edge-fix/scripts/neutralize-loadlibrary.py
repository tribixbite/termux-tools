#!/data/data/com.termux/files/usr/bin/python3
"""
neutralize-loadlibrary.py - Replace System.loadLibrary calls with nop.

Finds all `invoke-static {vN}, Ljava/lang/System;->loadLibrary(...)V`
instructions in a smali file and replaces them with `nop`. This prevents
native telemetry libraries from being loaded while preserving bytecode
structure (register counts, branch targets, etc.).

Usage: python3 neutralize-loadlibrary.py <smali-file>
"""

import sys
import re


def neutralize(filepath: str) -> int:
    """Replace all System.loadLibrary calls with nop.

    Returns the number of calls neutralized.
    """
    with open(filepath, "r") as f:
        lines = f.readlines()

    count = 0
    output: list[str] = []

    for line in lines:
        # Match both invoke-static and invoke-static/range forms
        if re.search(
            r"invoke-static(/range)?\s+\{[^}]*\},\s*"
            r"Ljava/lang/System;->loadLibrary\(Ljava/lang/String;\)V",
            line,
        ):
            # Preserve indentation, replace with nop
            indent = line[: len(line) - len(line.lstrip())]
            output.append(f"{indent}nop\n")
            count += 1
        else:
            output.append(line)

    with open(filepath, "w") as f:
        f.writelines(output)

    return count


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <smali-file>")
        sys.exit(1)

    filepath = sys.argv[1]
    count = neutralize(filepath)
    filename = filepath.split("/")[-1]
    print(f"    [x] Neutralized {count} loadLibrary call(s) in {filename}")


if __name__ == "__main__":
    main()
