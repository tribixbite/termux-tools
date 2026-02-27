#!/data/data/com.termux/files/usr/bin/python3
"""
patch-manifest.py - Robust XML-based manifest patcher for Edge Canary privacy fix.
Uses ElementTree for proper XML parsing instead of fragile regex.

Usage: python3 patch-manifest.py <manifest.xml> <config-dir>
"""

import sys
import os
import shutil
import xml.etree.ElementTree as ET

ANDROID_NS = "http://schemas.android.com/apk/res/android"
# Register the namespace so ET doesn't mangle it
ET.register_namespace("android", ANDROID_NS)


def android_attr(name):
    """Return fully qualified android: attribute name."""
    return f"{{{ANDROID_NS}}}{name}"


def read_config(filepath):
    """Read a config file, skip comments and blanks."""
    entries = []
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                entries.append(line)
    return entries


def strip_permissions(root, config_dir):
    """Remove tracking permissions from manifest root."""
    permissions = read_config(os.path.join(config_dir, "strip-permissions.list"))
    removed = 0

    for perm in permissions:
        # Find and remove <uses-permission> and <uses-permission-sdk-23>
        for tag in ["uses-permission", "uses-permission-sdk-23"]:
            for elem in root.findall(tag):
                if elem.get(android_attr("name")) == perm:
                    root.remove(elem)
                    print(f"  [x] Stripped permission: {perm}")
                    removed += 1
    return removed


def strip_components(root, config_dir):
    """Remove tracker components from <application> element."""
    components = read_config(os.path.join(config_dir, "strip-components.list"))
    app_elem = root.find("application")
    if app_elem is None:
        print("  ERROR: No <application> element found!")
        return 0

    removed = 0
    for entry in components:
        parts = entry.split("|", 1)
        if len(parts) != 2:
            print(f"  [!] Invalid format: {entry}")
            continue
        comp_type, comp_name = parts

        # Find matching elements by android:name attribute
        for elem in list(app_elem):
            if elem.tag == comp_type and elem.get(android_attr("name")) == comp_name:
                app_elem.remove(elem)
                print(f"  [x] Stripped {comp_type}: {comp_name}")
                removed += 1
    return removed


def strip_queries(root, config_dir):
    """Remove device ID package queries from <queries> element."""
    packages = read_config(os.path.join(config_dir, "strip-queries.list"))
    removed = 0

    for queries_elem in root.findall("queries"):
        for pkg in packages:
            for elem in list(queries_elem):
                if elem.tag == "package" and elem.get(android_attr("name")) == pkg:
                    queries_elem.remove(elem)
                    print(f"  [x] Stripped query: {pkg}")
                    removed += 1
    return removed


def strip_metadata(root, config_dir):
    """Remove tracker meta-data entries from <application> and root."""
    meta_names = read_config(os.path.join(config_dir, "strip-metadata.list"))
    removed = 0

    # Search in <application> and root
    for parent in [root, root.find("application")]:
        if parent is None:
            continue
        for meta_name in meta_names:
            for elem in list(parent):
                if elem.tag == "meta-data" and elem.get(android_attr("name")) == meta_name:
                    parent.remove(elem)
                    print(f"  [x] Stripped meta-data: {meta_name}")
                    removed += 1

    return removed


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <manifest.xml> <config-dir>")
        sys.exit(1)

    manifest_path = sys.argv[1]
    config_dir = sys.argv[2]

    if not os.path.isfile(manifest_path):
        print(f"ERROR: Manifest not found: {manifest_path}")
        sys.exit(1)

    # Backup original
    backup_path = manifest_path + ".orig"
    if not os.path.exists(backup_path):
        shutil.copy2(manifest_path, backup_path)

    # Parse XML
    tree = ET.parse(manifest_path)
    root = tree.getroot()

    print("=== Stripping tracking permissions ===")
    n_perms = strip_permissions(root, config_dir)

    print("\n=== Stripping tracker components ===")
    n_comps = strip_components(root, config_dir)

    print("\n=== Stripping device ID package queries ===")
    n_queries = strip_queries(root, config_dir)

    print("\n=== Stripping tracker meta-data ===")
    n_meta = strip_metadata(root, config_dir)

    # Fix @null meta-data values that crash PackageManager
    # (apktool compiles @null to @0x00000000 which Android rejects)
    print("\n=== Fixing @null meta-data values ===")
    for parent in [root, root.find("application")]:
        if parent is None:
            continue
        for elem in parent.iter("meta-data"):
            val = elem.get(android_attr("value"))
            if val == "@null":
                elem.set(android_attr("value"), "0")
                name = elem.get(android_attr("name"), "???")
                print(f"  [x] Fixed @null -> 0: {name}")

    # Write patched manifest
    tree.write(manifest_path, encoding="utf-8", xml_declaration=True)

    # Post-process: fix the android namespace prefix
    # ElementTree writes ns0: instead of android: by default for some versions
    with open(manifest_path, "r") as f:
        content = f.read()

    # Fix namespace declaration if needed
    content = content.replace("ns0:", "android:")
    content = content.replace("xmlns:ns0=", "xmlns:android=")
    content = content.replace("ns1:", "android:")
    content = content.replace("xmlns:ns1=", "xmlns:android=")

    with open(manifest_path, "w") as f:
        f.write(content)

    print(f"\n=== Manifest surgery complete ===")
    print(f"  Permissions stripped: {n_perms}")
    print(f"  Components stripped: {n_comps}")
    print(f"  Queries stripped: {n_queries}")
    print(f"  Meta-data stripped: {n_meta}")
    print(f"  Total removals: {n_perms + n_comps + n_queries + n_meta}")
    print(f"  Backup saved: {backup_path}")

    # Validate
    try:
        ET.parse(manifest_path)
        print("  XML validation: PASS")
    except ET.ParseError as e:
        print(f"  WARNING: XML validation issue: {e}")


if __name__ == "__main__":
    main()
