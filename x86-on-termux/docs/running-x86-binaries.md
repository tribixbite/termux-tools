---
name: running-x86-binaries-on-termux
description: Use when a linux_x86_64 binary needs to run on aarch64 Termux and no aarch64 build exists, and proot-distro is unwanted (too heavy, permission issues, or launch-speed). Covers qemu-user + minimal Debian sysroot extracted from .deb packages.
---

# Running x86_64 Linux Binaries on aarch64 Termux (no proot)

## When to use
- Binary is `ELF 64-bit LSB ... x86-64` (check `file <binary>`)
- No `linux_aarch64` / `linux_arm64` / static variant ships upstream
- proot-distro is undesirable (install size ~500MB–1GB, setuid-like behavior, per-call overhead)
- The binary is not setuid and doesn't require kernel modules

## Core pattern

```
aarch64 kernel
    ↑ syscalls (forwarded by qemu-user)
qemu-x86_64 (CPU emulation)
    ↑ loads ELF, translates open(/lib*) via -L prefix
x86_64 ld-linux + glibc   (extracted from Debian .deb, in $PREFIX/opt/<name>-sysroot)
    ↑
x86_64 binary
```

No chroot, no binfmt, no proot. Just `qemu-x86_64 -L <sysroot> <binary>`.

## Prerequisites

```bash
pkg install qemu-user-x86-64 binutils tar xz dpkg    # ar, dpkg-deb, tar, xz
# qemu-user-x86_64 bin ends up as $PREFIX/bin/qemu-x86_64
```

## Step 1 — Inspect the binary

```bash
file ./mybinary
# ELF 64-bit LSB pie executable, x86-64, ... interpreter /lib64/ld-linux-x86-64.so.2

readelf -d ./mybinary | grep NEEDED
# lists shared libraries the binary links against
```

Typical minimal Rust/Go/C binary only needs: `libc.so.6`, `libpthread.so.0`, `libdl.so.2`, `librt.so.1`, `libm.so.6`, `ld-linux-x86-64.so.2`. All come from `libc6:amd64`. Additional libs (libssl, libz, libstdc++) need their own `.deb`s.

## Step 2 — Build the sysroot

```bash
SYSROOT=$PREFIX/opt/x86_64-sysroot
mkdir -p $SYSROOT $PREFIX/tmp/amd64-debs && cd $PREFIX/tmp/amd64-debs

# Fetch Debian bookworm package index to discover filenames
curl -fsSL -o Packages.gz http://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz

# Look up deb filenames from the index (Version + Filename fields)
for pkg in libc6 libgcc-s1; do
  zcat Packages.gz | awk "/^Package: $pkg\$/,/^\$/" | grep -E "^(Version|Filename):"
done

# Download the debs (pool paths from the index output above)
curl -fsSL -O http://deb.debian.org/debian/pool/main/g/glibc/libc6_2.36-9+deb12u13_amd64.deb
curl -fsSL -O http://deb.debian.org/debian/pool/main/g/gcc-12/libgcc-s1_12.2.0-14+deb12u1_amd64.deb

# Extract into sysroot
cd $SYSROOT
dpkg-deb -x $PREFIX/tmp/amd64-debs/libc6.deb .
dpkg-deb -x $PREFIX/tmp/amd64-debs/libgcc-s1.deb .
```

For additional libs: search `Packages.gz` for `Package: <libname>` (e.g. `libssl3`, `zlib1g`, `libstdc++6`), grab `Filename:`, download, `dpkg-deb -x` into the same sysroot.

## Step 3 — CRITICAL: Fix absolute symlinks

Debian `.deb`s ship absolute symlinks (e.g. `lib64/ld-linux-x86-64.so.2 → /lib/x86_64-linux-gnu/ld-linux-x86-64.so.2`). These resolve against the **host root**, not the sysroot — so they're dangling and qemu silently exits 1 with no output.

```bash
cd $SYSROOT
find . -type l -lname '/*' -print | while read lnk; do
  target=$(readlink "$lnk")
  real="$PWD${target}"
  if [[ -e "$real" ]]; then
    rm "$lnk" && cp "$real" "$lnk"
  else
    echo "BROKEN (dependency missing): $lnk -> $target"
  fi
done
```

Verify: `find $SYSROOT -type l -lname '/*'` should print nothing.

## Step 4 — Populate `/etc` for DNS / nsswitch

```bash
mkdir -p $SYSROOT/etc
cat > $SYSROOT/etc/resolv.conf <<EOF
nameserver 8.8.8.8
nameserver 1.1.1.1
EOF
cat > $SYSROOT/etc/nsswitch.conf <<EOF
hosts: files dns
passwd: files
group: files
EOF
echo "127.0.0.1 localhost" > $SYSROOT/etc/hosts
```

Rust programs using `reqwest` (via glibc `getaddrinfo`) need this. Without it: `dns error` / `Temporary failure in name resolution`.

## Step 5 — Canonical wrapper

```bash
cat > $PREFIX/bin/<command-name> <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Run x86_64 binary on aarch64 Termux via qemu-user + sysroot
exec env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD \
  -L "$PREFIX/opt/x86_64-sysroot" \
  "/absolute/path/to/binary" "$@"
EOF
chmod +x $PREFIX/bin/<command-name>
```

The two `-U/-u LD_PRELOAD` clauses are mandatory (see gotchas).

## Gotchas (in order of discovery)

### 1. Silent `exit 1` with no output

Most likely a **dangling symlink** in the sysroot. qemu's silent failure is extremely unhelpful — always check symlinks first.

Secondary cause: the Termux shell exports `LD_PRELOAD=$PREFIX/lib/libtermux-exec.so` (aarch64 object). When inherited into the x86_64 process it prints a warning and continues, but sometimes the startup path fails before stderr is flushed. Always wrap with `env -u LD_PRELOAD` and pass `-U LD_PRELOAD` to qemu.

### 2. Libraries "not found" even though they're in the sysroot

qemu's `-L` prefix only translates paths when the kernel / syscall opens an absolute path. ld.so (once running) uses its own search logic. When that's insufficient, invoke ld.so explicitly:

```bash
qemu-x86_64 -U LD_PRELOAD -L $SYSROOT \
  $SYSROOT/lib64/ld-linux-x86-64.so.2 \
  --library-path $SYSROOT/lib/x86_64-linux-gnu \
  $BINARY "$@"
```

Side effect: `/proc/self/exe` now points at `ld-linux-x86-64.so.2` rather than the target binary, which breaks `posix_spawn` helpers. Prefer `-L $SYSROOT` alone unless direct invocation fails.

### 3. `syntax error: unexpected 'P���h���'` or `Exec format error`

qemu-user does **not** transparently re-invoke itself for cross-arch `execve()`. If the x86_64 binary forks another x86_64 binary, the aarch64 kernel rejects the ELF. The shell then tries to interpret the bytes as a script → garbage error.

Fix: replace the child binary with a shell-script shim that re-enters qemu. See the `shimming-self-updating-binaries` skill.

### 4. `Using embedded data zip` / launcher binaries

Many CLIs (Google, HashiCorp, GitHub) ship a small "launcher" that `GET`s the real tool on first run and writes it to `~/.<tool>/bin/<tool>`. That real binary is also x86_64 — so it also needs a shim. Handle with the self-updating shim pattern.

### 5. setuid / ptrace binaries

qemu-user cannot elevate privileges. Binaries that require `CAP_NET_RAW`, `CAP_SYS_ADMIN`, or real setuid bits will fail. No known workaround without proot/root.

### 6. Page size

qemu-x86_64 assumes 4K guest pages. Android kernels on Pixel 9+ default to 16K pages; Termux's builds are 4K-safe but verify with `getconf PAGE_SIZE` (via a Python one-liner) if things fall over at load. Kernels ≥ 6.6 are fine in our tested setup.

## Verify

```bash
<command-name> --version   # should print version, rc=0
<command-name> --help      # should print help, rc=0
```

If silent rc=1: re-check dangling symlinks, re-check LD_PRELOAD.

## Size budget

A minimal sysroot (`libc6` + `libgcc-s1`) is ~14 MB. Each additional Debian library runtime adds a few MB. Full `libssl3 + libstdc++6 + zlib1g` brings it to ~30 MB. Still far lighter than a proot-distro rootfs (500 MB+).

## Real-world verified case

`dl.google.com/android/cli/latest/linux_x86_64/android` (Google's Android CLI launcher, April 2026): 81 MB Rust binary. Runs correctly with 14 MB sysroot + 2-line wrapper. See `$PREFIX/bin/android` on this device for the production wrapper.

## Cleanup / uninstall

```bash
rm -rf $PREFIX/opt/x86_64-sysroot
rm -f $PREFIX/bin/<command-name>
rm -rf $PREFIX/tmp/amd64-debs
```
