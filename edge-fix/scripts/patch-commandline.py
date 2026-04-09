#!/data/data/com.termux/files/usr/bin/python3
"""
patch-commandline.py — Patch Chromium's CommandLine class to read flags on release builds.

Chromium only reads /data/local/tmp/<pkg>-command-line when the app has
android:debuggable=true (checked via BuildInfo.isDebugAndroid()). Setting
debuggable exposes the app to JDWP attacks, so instead we patch the smali
to always return true from the debug check method.

Scans baksmali output for org/chromium/base/CommandLine.smali and patches
the method that gates file-based command line reading.

Usage: python3 patch-commandline.py <smali-root-dir>
       smali-root-dir contains smali_classes*/ from baksmali
"""

import sys
import os
import re
import glob


def find_commandline_smali(smali_root: str) -> str | None:
    """Find CommandLine.smali across all DEX class dirs."""
    pattern = os.path.join(smali_root, "smali*/org/chromium/base/CommandLine.smali")
    matches = glob.glob(pattern)
    return matches[0] if matches else None


def find_buildinfo_smali(smali_root: str) -> str | None:
    """Find BuildInfo.smali — contains isDebugAndroid() check."""
    pattern = os.path.join(smali_root, "smali*/org/chromium/base/BuildInfo.smali")
    matches = glob.glob(pattern)
    return matches[0] if matches else None


def patch_is_debug_android(filepath: str) -> bool:
    """Patch isDebugAndroid() in BuildInfo.smali to always return true.

    This is the method CommandLine.initFromFile() checks before reading
    the command-line flags file. By returning true, we enable flag reading
    without setting android:debuggable=true in the manifest.

    Original: checks ApplicationInfo.FLAG_DEBUGGABLE
    Patched:  const/4 v0, 0x1; return v0
    """
    with open(filepath, "r") as f:
        content = f.read()

    lines = content.split("\n")
    output: list[str] = []
    patched = False

    i = 0
    while i < len(lines):
        line = lines[i]

        # Look for .method ... isDebugAndroid(...)Z
        if (line.strip().startswith(".method ") and
                "isDebugAndroid" in line and line.strip().endswith(")Z")):

            output.append(line)  # keep .method header
            i += 1

            # Skip to .end method, preserving annotations
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
                    output.append(lines[i])
                elif stripped.startswith(".param") or stripped.startswith(".end param"):
                    output.append(lines[i])
                i += 1

            # Inject stub: return true
            output.append("    .locals 1")
            output.append("")
            output.append("    # Patched by edge-fix: enable command-line flags on release builds")
            output.append("    const/4 v0, 0x1")
            output.append("    return v0")
            output.append("")

            # Write .end method
            if i < len(lines):
                output.append(lines[i])
            patched = True
            i += 1
            continue

        output.append(line)
        i += 1

    if patched:
        with open(filepath, "w") as f:
            f.write("\n".join(output))

    return patched


def patch_commandline_init(filepath: str) -> bool:
    """Alternative: patch CommandLine.initFromFile to skip the debug check.

    Some Chromium versions inline the check into CommandLine itself rather
    than calling BuildInfo.isDebugAndroid(). This patches the conditional
    branch to always fall through.
    """
    with open(filepath, "r") as f:
        content = f.read()

    # Look for the pattern: invoke-static BuildInfo.isDebugAndroid
    # followed by if-eqz (skip if not debug)
    # Replace if-eqz with nop to always read the file
    pattern = r"(invoke-static \{[^}]*\}, Lorg/chromium/base/BuildInfo;->isDebugAndroid\(\)Z\s*\n\s*move-result [vp]\d+\s*\n\s*)(if-eqz [vp]\d+, :cond_\w+)"

    match = re.search(pattern, content)
    if not match:
        return False

    # Replace if-eqz with nop (effectively: always treat as debuggable)
    patched = content[:match.start(2)] + "# if-eqz patched out by edge-fix (enable cmd flags)" + content[match.end(2):]

    with open(filepath, "w") as f:
        f.write(patched)

    return True


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <smali-root-dir>")
        sys.exit(1)

    smali_root = sys.argv[1]

    # Strategy 1: Patch BuildInfo.isDebugAndroid() to return true
    buildinfo = find_buildinfo_smali(smali_root)
    if buildinfo:
        print(f"  Found BuildInfo: {os.path.relpath(buildinfo, smali_root)}")
        if patch_is_debug_android(buildinfo):
            print("  [x] Patched isDebugAndroid() → always returns true")
            print("  CommandLine flags file will be read on release builds")
            return
        else:
            print("  [!] isDebugAndroid() method not found in BuildInfo")

    # Strategy 2: Patch CommandLine.initFromFile() conditional
    cmdline = find_commandline_smali(smali_root)
    if cmdline:
        print(f"  Found CommandLine: {os.path.relpath(cmdline, smali_root)}")
        if patch_commandline_init(cmdline):
            print("  [x] Patched CommandLine.initFromFile() debug check")
            print("  CommandLine flags file will be read on release builds")
            return
        else:
            print("  [!] Could not find debug check pattern in CommandLine")

    # Neither found
    if not buildinfo and not cmdline:
        print("  [!] Neither BuildInfo.smali nor CommandLine.smali found")
        print("  Chromium base classes may be in an un-baksmali'd DEX (classes4+)")
        print("  Fallback: set android:debuggable=true in manifest")
        sys.exit(1)

    print("  [!] Could not patch command-line flag reading")
    print("  Fallback: set android:debuggable=true in manifest")
    sys.exit(1)


if __name__ == "__main__":
    main()
