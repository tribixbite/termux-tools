# x86-on-termux

Run `linux_x86_64` binaries on aarch64 Termux **without proot-distro**, using
`qemu-user` plus a minimal glibc sysroot extracted from Debian `.deb` packages.

## Why

Some CLI tools only ship a `linux_x86_64` binary (Google's Android CLI at
`dl.google.com/android/cli/latest/linux_x86_64/android` was the motivating
case). On aarch64 Termux the options are usually:

1. **proot-distro** — correct but heavy (500 MB–1 GB rootfs) and slow per-call
2. **binfmt-misc + chroot** — requires root
3. **this approach** — `qemu-user` + a ~14 MB sysroot, no chroot, no root

For most single-binary tools, (3) is the right trade-off.

## How it works

```
aarch64 kernel
    ↑ syscalls (forwarded by qemu-user)
qemu-x86_64             # CPU emulation only
    ↑ -L <sysroot>       # translates /lib64 → <sysroot>/lib64
x86_64 glibc            # extracted from Debian libc6:amd64 (+ libgcc-s1)
    ↑
x86_64 target binary
```

No chroot. The guest process just runs inside your Termux environment with its
libc paths translated by qemu's `-L` prefix.

## Install the sysroot

```bash
bash install-sysroot.sh
```

This is idempotent — safe to re-run. Downloads and extracts to
`$PREFIX/opt/x86_64-sysroot` (~14 MB). Requires `curl`, `dpkg-deb`, `tar`, `xz`,
and the `qemu-user-x86-64` Termux package.

If your binary needs more libraries than libc/libgcc, add the package name to
the `EXTRA_PACKAGES` env var:

```bash
EXTRA_PACKAGES="libssl3 zlib1g libstdc++6" bash install-sysroot.sh
```

## Write a wrapper

Canonical shape:

```bash
#!/data/data/com.termux/files/usr/bin/bash
exec env -u LD_PRELOAD qemu-x86_64 -U LD_PRELOAD \
  -L "$PREFIX/opt/x86_64-sysroot" \
  "/absolute/path/to/x86_64-binary" "$@"
```

Drop it in `$PREFIX/bin/<cmd>` and `chmod +x`.

## Worked example — Google Android CLI

`examples/install-android-cli.sh` does the full flow end-to-end: downloads the
x86_64 launcher, triggers the first-run to fetch `android-cli`, installs a
self-repairing wrapper at `$PREFIX/bin/android` that survives `android update`.

```bash
bash examples/install-android-cli.sh
android --version     # 0.7.x
android --help        # full command list
```

The wrapper uses the "shimming self-updating binaries" pattern from
`docs/shimming-self-updating-binaries.md` — it detects when `android update`
has overwritten the shim with a fresh x86_64 ELF and reinstalls the shim.

## Documentation

- [`docs/running-x86-binaries.md`](docs/running-x86-binaries.md) — full
  technique, prerequisites, step-by-step, gotchas (why symlinks fail silently,
  LD_PRELOAD propagation, `execve` cross-arch, page-size notes).
- [`docs/shimming-self-updating-binaries.md`](docs/shimming-self-updating-binaries.md)
  — the detect-and-repair wrapper pattern (applies to any tool with a
  self-update subcommand: gcloud, rustup, nix, etc.).

## Gotchas at a glance

| Symptom | Cause | Fix |
|---------|-------|-----|
| `rc=1`, no output, even with `-strace` | Dangling absolute symlink in sysroot (Debian `.deb`s ship `/lib/...` symlinks that resolve against host /) | Replace absolute symlinks with resolved file copies (`install-sysroot.sh` does this) |
| `LD_PRELOAD` warning from `libtermux-exec.so` | Termux injects the shim into every process; it's aarch64 so x86_64 guest rejects it | Wrap call with `env -u LD_PRELOAD` and `qemu -U LD_PRELOAD` |
| `syntax error: unexpected 'P���h���'` | qemu-user doesn't re-enter itself on cross-arch `execve()`; child ELF is fed to the aarch64 kernel and falls through to shell script interpretation | Shim the child binary with a shell wrapper that re-enters qemu |
| `dns error` / `Temporary failure in name resolution` | `getaddrinfo` needs `/etc/resolv.conf` inside the sysroot | `install-sysroot.sh` writes a stock resolv.conf |
| `exec format error` for tools that use setuid / `ptrace` | qemu-user cannot elevate privileges or implement ptrace over emulated registers | No clean workaround without proot/root |

## Size budget

| Component | Size |
|-----------|------|
| Sysroot (`libc6` + `libgcc-s1`) | ~14 MB |
| Add `libssl3 + libstdc++6 + zlib1g` | ~30 MB |
| A proot-distro Debian rootfs (for comparison) | 500 MB+ |

## Licence

MIT (matches the parent `termux-tools` repo).
