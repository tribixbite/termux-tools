#!/data/data/com.termux/files/usr/bin/python3
"""
patch-commandline.py — Patch Chromium command-line behavior.

Chromium only reads /data/local/tmp/<pkg>-command-line when the app has
android:debuggable=true (checked via BuildInfo.isDebugAndroid()). The manifest
patch provides that version-robust gate. This helper also patches the Java gate
where available and suppresses Chromium's repeated bad-flags prompt.

Patches org/chromium/base/CommandLine.smali in one decompiled DEX tree. The
build passes one exact tree at a time so this script can never modify a DEX
other than the one which will immediately be assembled.

Usage: python3 patch-commandline.py <smali-dir>
       smali-dir is one baksmali output tree (for example smali_classes4)
"""

import sys
import os
import re
import glob


def find_smali_class(smali_root: str, filename: str) -> str | None:
    """Find a Chromium base class in one tree or a legacy parent root."""
    relative = os.path.join("org", "chromium", "base", filename)
    direct = os.path.join(smali_root, relative)
    if os.path.isfile(direct):
        return direct

    # Retain compatibility for direct/manual use with a parent containing
    # smali* directories. build.sh intentionally passes an exact tree.
    matches = glob.glob(os.path.join(smali_root, "smali*", relative))
    return matches[0] if len(matches) == 1 else None


def find_commandline_smali(smali_root: str) -> str | None:
    """Find CommandLine.smali in the requested DEX tree."""
    return find_smali_class(smali_root, "CommandLine.smali")


def find_buildinfo_smali(smali_root: str) -> str | None:
    """Find BuildInfo.smali — may contain isDebugAndroid()."""
    return find_smali_class(smali_root, "BuildInfo.smali")


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


def patch_flags_loaded_warning(filepath: str) -> bool:
    """Patch CommandLine.wasFlagsLoadedFromFile() to return false.

    The command-line file is still read normally. This only prevents Chromium's
    native ShowBadFlagsPrompt() code from displaying the per-tab snackbar.
    """
    with open(filepath, "r") as f:
        content = f.read()

    lines = content.split("\n")
    output: list[str] = []
    patched = False
    i = 0

    while i < len(lines):
        line = lines[i]

        if (
            line.strip().startswith(".method ")
            and "wasFlagsLoadedFromFile" in line
            and line.strip().endswith(")Z")
        ):
            output.append(line)
            i += 1
            in_annotation = False

            # Preserve method annotations such as @CalledByNative, but discard
            # the original executable body.
            while i < len(lines) and not lines[i].strip().startswith(".end method"):
                stripped = lines[i].strip()

                if stripped.startswith(".annotation"):
                    in_annotation = True
                    output.append(lines[i])
                elif stripped.startswith(".end annotation"):
                    output.append(lines[i])
                    in_annotation = False
                elif in_annotation:
                    output.append(lines[i])
                elif stripped.startswith(".param") or stripped.startswith(".end param"):
                    output.append(lines[i])

                i += 1

            output.extend(
                [
                    "    .locals 1",
                    "",
                    "    # Patched by edge-fix: suppress command-line-file warning",
                    "    const/4 v0, 0x0",
                    "    return v0",
                    "",
                ]
            )

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
        print(f"Usage: {sys.argv[0]} <smali-dir>")
        sys.exit(1)

    smali_root = sys.argv[1]

    cmdline = find_commandline_smali(smali_root)
    if not cmdline:
        print("  [!] CommandLine.smali not found in this DEX tree")
        sys.exit(1)

    print(f"  Found CommandLine: {os.path.relpath(cmdline, smali_root)}")

    # The manifest sets android:debuggable=true as the version-robust flag-file
    # gate. Patch the Java gate too when this Chromium version exposes it, but
    # do not require BuildInfo: Edge 154 moved/removed that method.
    buildinfo = find_buildinfo_smali(smali_root)
    if buildinfo:
        print(f"  Found BuildInfo: {os.path.relpath(buildinfo, smali_root)}")
        if patch_is_debug_android(buildinfo):
            print("  [x] Patched isDebugAndroid() → always returns true")
        else:
            print("  [i] BuildInfo.isDebugAndroid() absent; manifest gate remains active")
    else:
        if patch_commandline_init(cmdline):
            print("  [x] Patched CommandLine.initFromFile() debug check")
        else:
            print("  [i] No Java debug gate found; manifest gate remains active")

    # This patch is required: Chromium's native bad-flags prompt calls this
    # method for every tab and otherwise displays a repeated snackbar.
    if not patch_flags_loaded_warning(cmdline):
        print("  [!] CommandLine.wasFlagsLoadedFromFile() not found")
        sys.exit(1)

    print("  [x] Patched wasFlagsLoadedFromFile() → always returns false")
    print("  Command-line flags remain active; repeated warning is suppressed")


if __name__ == "__main__":
    main()
