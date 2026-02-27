#!/data/data/com.termux/files/usr/bin/python3
"""
stub-method.py - Stub a specific method in a smali file.

Replaces the method body with a safe return default while preserving
annotations, parameter declarations, and the method signature.

Usage: python3 stub-method.py <smali-file> <method-name>

Return type mapping:
  V           → return-void
  Z/B/C/S/I   → const/4 v0, 0x0; return v0
  J           → const-wide/16 v0, 0x0; return-wide v0
  F           → const/4 v0, 0x0; return v0
  D           → const-wide/16 v0, 0x0; return-wide v0
  L.../[...   → const/4 v0, 0x0; return-object v0
"""

import sys
import re


def stub_method(filepath: str, target_method: str) -> int:
    """Stub all overloads of target_method in the smali file.

    Returns the number of methods stubbed.
    """
    with open(filepath, "r") as f:
        content = f.read()

    lines = content.split("\n")
    output: list[str] = []
    patched_count = 0

    i = 0
    while i < len(lines):
        line = lines[i]

        if line.strip().startswith(".method ") and target_method in line:
            method_sig = line.strip()

            # Don't touch abstract or native methods (no body to replace)
            if "abstract" in method_sig or "native" in method_sig:
                output.append(line)
                i += 1
                continue

            # Parse return type from method signature: )ReturnType
            return_match = re.search(
                r"\)([\[]*[VZBCSIJFD]|[\[]*L[^;]+;)", method_sig
            )
            if not return_match:
                output.append(line)
                i += 1
                continue

            return_type = return_match.group(1)
            output.append(line)  # keep .method header

            # Skip original body, but preserve annotations and param declarations
            i += 1
            in_annotation = False
            while i < len(lines) and not lines[i].strip().startswith(".end method"):
                stripped = lines[i].strip()
                if stripped.startswith(".annotation"):
                    in_annotation = True
                    output.append(lines[i])
                elif stripped.startswith(".end annotation"):
                    in_annotation = False
                    output.append(lines[i])
                elif in_annotation:
                    # Preserve full annotation content (value arrays, etc.)
                    output.append(lines[i])
                elif stripped.startswith(".param") or stripped.startswith(".end param"):
                    output.append(lines[i])
                i += 1

            # Generate minimal stub body based on return type
            if return_type == "V":
                min_regs = 0
                ret_code = "    return-void"
            elif return_type in ("Z", "B", "C", "S", "I"):
                min_regs = 1
                ret_code = "    const/4 v0, 0x0\n    return v0"
            elif return_type == "J":
                min_regs = 2
                ret_code = "    const-wide/16 v0, 0x0\n    return-wide v0"
            elif return_type == "F":
                min_regs = 1
                ret_code = "    const/4 v0, 0x0\n    return v0"
            elif return_type == "D":
                min_regs = 2
                ret_code = "    const-wide/16 v0, 0x0\n    return-wide v0"
            else:
                # Object type (L...;) or array type ([...)
                min_regs = 1
                ret_code = "    const/4 v0, 0x0\n    return-object v0"

            output.append(f"    .locals {min_regs}")
            output.append("")
            output.append(ret_code)
            output.append("")

            # Write .end method
            if i < len(lines):
                output.append(lines[i])
            patched_count += 1
            i += 1
            continue

        output.append(line)
        i += 1

    with open(filepath, "w") as f:
        f.write("\n".join(output))

    return patched_count


def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <smali-file> <method-name>")
        sys.exit(1)

    filepath = sys.argv[1]
    target_method = sys.argv[2]

    count = stub_method(filepath, target_method)
    filename = filepath.split("/")[-1]
    print(f"    [x] Stubbed {count} '{target_method}' method(s) in {filename}")


if __name__ == "__main__":
    main()
