#!/data/data/com.termux/files/usr/bin/bash
# Build a minimal x86_64 glibc sysroot at $PREFIX/opt/x86_64-sysroot.
# Idempotent: re-running only re-downloads packages whose .deb is missing.
#
# Required:
#   pkg install qemu-user-x86-64 binutils tar xz dpkg
# Optional env:
#   SYSROOT            override sysroot path (default: $PREFIX/opt/x86_64-sysroot)
#   EXTRA_PACKAGES     space-separated list of extra Debian amd64 packages to add
#                      (e.g. "libssl3 zlib1g libstdc++6")
#   DEBIAN_SUITE       Debian release (default: bookworm)
#   DEBIAN_MIRROR      mirror URL (default: http://deb.debian.org/debian)

set -euo pipefail

SYSROOT="${SYSROOT:-$PREFIX/opt/x86_64-sysroot}"
DEBIAN_SUITE="${DEBIAN_SUITE:-bookworm}"
DEBIAN_MIRROR="${DEBIAN_MIRROR:-http://deb.debian.org/debian}"
TMPDIR="$PREFIX/tmp/amd64-debs"
# libc6 pulls in the dynamic linker, libc, libpthread, libdl, librt, libm.
# libgcc-s1 is needed by most Rust/C++ binaries for stack unwinding.
BASE_PACKAGES="libc6 libgcc-s1"
EXTRA_PACKAGES="${EXTRA_PACKAGES:-}"

log() { printf '\033[1;34m[x86-on-termux]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# -- prereqs ----------------------------------------------------------------
for tool in curl dpkg-deb tar xz zcat qemu-x86_64 find readlink; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done

mkdir -p "$SYSROOT" "$TMPDIR"

# -- package index ----------------------------------------------------------
INDEX_GZ="$TMPDIR/Packages.gz"
INDEX="$TMPDIR/Packages"
if [[ ! -s "$INDEX_GZ" ]] || find "$INDEX_GZ" -mtime +7 2>/dev/null | grep -q .; then
  log "fetching Debian $DEBIAN_SUITE amd64 package index"
  curl -fsSL -o "$INDEX_GZ" \
    "$DEBIAN_MIRROR/dists/$DEBIAN_SUITE/main/binary-amd64/Packages.gz"
  zcat "$INDEX_GZ" > "$INDEX"
elif [[ ! -s "$INDEX" ]]; then
  zcat "$INDEX_GZ" > "$INDEX"
fi

# -- download + extract each package ---------------------------------------
packages_to_install=()
for p in $BASE_PACKAGES $EXTRA_PACKAGES; do packages_to_install+=("$p"); done

for pkg in "${packages_to_install[@]}"; do
  # Find the package entry in the index (stop at blank line after Package:)
  entry=$(awk -v p="$pkg" '
    $0 == "Package: " p { found=1 }
    found { print }
    found && $0 == "" { exit }
  ' "$INDEX")
  [[ -n "$entry" ]] || die "$pkg: not found in Debian $DEBIAN_SUITE amd64 index"

  filename=$(printf '%s\n' "$entry" | awk -F': ' '/^Filename:/ {print $2; exit}')
  version=$(printf '%s\n' "$entry" | awk -F': ' '/^Version:/ {print $2; exit}')
  [[ -n "$filename" ]] || die "$pkg: no Filename in index entry"

  deb="$TMPDIR/$(basename "$filename")"
  if [[ ! -s "$deb" ]]; then
    log "downloading $pkg ($version)"
    curl -fsSL -o "$deb" "$DEBIAN_MIRROR/$filename"
  else
    log "cached:      $pkg ($version)"
  fi

  log "extracting   $pkg -> $SYSROOT"
  dpkg-deb -x "$deb" "$SYSROOT"
done

# -- fix Debian's absolute symlinks -----------------------------------------
# Debian .debs ship absolute symlinks like
#   lib64/ld-linux-x86-64.so.2 -> /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2
# These resolve against the HOST root (which doesn't have x86_64 libs) and
# cause qemu to silently exit 1 with no output. Replace with the actual file.
log "fixing absolute symlinks inside sysroot"
cd "$SYSROOT"
found_broken=0
while IFS= read -r -d '' lnk; do
  target=$(readlink "$lnk")
  real="$PWD${target}"
  if [[ -e "$real" ]]; then
    rm "$lnk" && cp "$real" "$lnk"
  else
    echo "  BROKEN (dependency missing): $lnk -> $target" >&2
    found_broken=1
  fi
done < <(find . -type l -lname '/*' -print0)

[[ $found_broken -eq 0 ]] || die "sysroot has broken symlinks - add more packages to EXTRA_PACKAGES"

# -- populate /etc for DNS + nsswitch ---------------------------------------
mkdir -p "$SYSROOT/etc"
[[ -s "$SYSROOT/etc/resolv.conf" ]] || cat > "$SYSROOT/etc/resolv.conf" <<'EOF'
nameserver 8.8.8.8
nameserver 1.1.1.1
EOF

[[ -s "$SYSROOT/etc/nsswitch.conf" ]] || cat > "$SYSROOT/etc/nsswitch.conf" <<'EOF'
hosts: files dns
passwd: files
group: files
shadow: files
EOF

[[ -s "$SYSROOT/etc/hosts" ]] || cat > "$SYSROOT/etc/hosts" <<'EOF'
127.0.0.1 localhost
::1 localhost
EOF

# -- smoke test -------------------------------------------------------------
log "smoke-testing ld.so in sysroot"
if env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD -L "$SYSROOT" \
     "$SYSROOT/lib64/ld-linux-x86-64.so.2" --version >/dev/null 2>&1; then
  log "OK - ld.so runs under qemu-x86_64"
else
  die "ld.so smoke test failed - sysroot is not usable"
fi

size=$(du -sh "$SYSROOT" | awk '{print $1}')
log "done: sysroot = $SYSROOT ($size)"
log "write wrappers as: qemu-x86_64 -L \"$SYSROOT\" /path/to/x86_64/binary \"\$@\""
