#!/data/data/com.termux/files/usr/bin/bash
# Build an isolated, opt-in Codex candidate. Never install or promote it here.
set -euo pipefail
readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly TERMUX_PREFIX=/data/data/com.termux/files/usr
readonly SOURCE_REVISION=01fc69f4026735edfdf6789820549727a4867b11
readonly SOURCE_VERSION=0.159.3
readonly BWRAP_SHA256=c547cbdc762a70ed216789ffaa4c6c0e7d2beabe32245a498f8e365a9fc8dab4
readonly PATCH_PATH="$REPO_ROOT/patches/codex-termux-socket-root.patch"
work_dir="${TMPDIR:-$TERMUX_PREFIX/tmp}/codex-native-$SOURCE_VERSION"
mode=build
original_arguments=("$@")
while (( $# )); do
  case "$1" in
    --work-dir) [[ $# -ge 2 ]] || { echo '--work-dir requires a path' >&2; exit 2; }; work_dir="$2"; shift 2 ;;
    --prepare-only | --test-only)
      [[ "$mode" == build ]] || { echo 'Choose only one mode flag' >&2; exit 2; }
      mode="${1#--}"; mode="${mode%-only}"; shift ;;
    --help) echo "usage: $0 [--work-dir PATH] [--prepare-only | --test-only]"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ "$work_dir" == *[[:space:]]* || "$work_dir" == *:* ]]; then
  echo 'Use a work directory without whitespace or colons (compiler flags and PATH)' >&2
  exit 2
fi
# Resource checks precede checkout writes, stale locks, downloads, and compilation.
# The supervised worker is accepted only as a direct child of its live supervisor.
if [[ "$mode" != prepare && "${CODEX_NATIVE_BUILD_SUPERVISOR:-}" != "$PPID" ]]; then
  exec python3 - "$REPO_ROOT/scripts/build-codex-termux.sh" "$work_dir" "${original_arguments[@]}" <<'RESOURCE_GUARD_PY'
"""Supervise only this build; refuse unsafe starts and preserve completed artifacts."""
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from types import FrameType
from typing import NoReturn

GIB = 1024 ** 3
MIN_AVAILABLE = 4 * GIB
MIN_DISK = 25 * GIB
STOP_AVAILABLE = 3 * GIB
MAX_JOB_RSS = 1536 * 1024 ** 2
MAX_SECONDS = 15 * 60
POLL_SECONDS = 2.0
STOP_GRACE = 3.0

@dataclass(frozen=True)
class Snapshot:
    available: int
    disk: int
    load: float

def snapshot(work_dir: Path) -> Snapshot:
    """Read actual available RAM, filesystem space, and Android's sysinfo load."""
    meminfo = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    available = int(meminfo['MemAvailable'].split()[0]) * 1024
    existing = work_dir.absolute()
    while not existing.exists():
        existing = existing.parent
    result = subprocess.run(['/system/bin/uptime'], capture_output=True, text=True, check=True, timeout=3)
    match = re.search(r'load averages?:\s*(\d+(?:\.\d+)?)', result.stdout)
    if match is None:
        raise RuntimeError('Cannot read the system load; refusing an unmeasured build')
    return Snapshot(available, shutil.disk_usage(existing).free, float(match[1]))

def pressure(state: Snapshot, max_load: float, *, starting: bool) -> list[str]:
    """Keep RAM and disk reserves; the entry threshold includes compiler headroom."""
    reasons: list[str] = []
    required = MIN_AVAILABLE if starting else STOP_AVAILABLE
    if state.available < required:
        reasons.append(f'available RAM {state.available/GIB:.1f} GiB < {required/GIB:.0f} GiB')
    if state.disk < MIN_DISK:
        reasons.append(f'free disk {state.disk/GIB:.1f} GiB < {MIN_DISK/GIB:.0f} GiB')
    if state.load > max_load:
        reasons.append(f'load {state.load:.2f} > {max_load:.2f}')
    return reasons

def identity(pid: int) -> str | None:
    """Use kernel start time to avoid signaling a reused PID."""
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()[19]
    except (FileNotFoundError, ProcessLookupError):
        return None

def members(root: int, known: dict[int, str]) -> int:
    """Track descendants, including test runners that create their own groups."""
    result = subprocess.run(['ps', '-eo', 'pid,ppid,rss'], capture_output=True, text=True, check=True, timeout=3)
    rows = [tuple(map(int, line.split())) for line in result.stdout.splitlines()[1:] if line.strip()]
    # A completed/reaped root PID may already belong to an unrelated process.
    owned = {root} if root in known and identity(root) == known[root] else set()
    while True:
        added = {pid for pid, parent, _ in rows if parent in owned} - owned
        if not added:
            break
        owned.update(added)
    for pid in owned:
        stamp = identity(pid)
        if stamp is not None:
            known[pid] = stamp
    # Retain identified children if a parent exits between samples.
    return sum(rss * 1024 for pid, _, rss in rows if pid in known and identity(pid) == known[pid])

def stop_job(job: subprocess.Popen[bytes], known: dict[int, str]) -> None:
    """Stop only identified build descendants, allowing cleanup before SIGKILL."""
    try:
        members(job.pid, known)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError):
        # Measurement failure must not prevent canceling the owned session.
        pass
    for sig in (signal.SIGTERM, signal.SIGKILL):
        # Popen owns this unreaped session leader even if /proc measurement failed.
        if job.poll() is None:
            try:
                os.killpg(job.pid, sig)
            except ProcessLookupError:
                pass
        for pid, stamp in list(known.items()):
            if identity(pid) == stamp:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + STOP_GRACE
        while time.monotonic() < deadline:
            job.poll()
            if all(identity(pid) != stamp for pid, stamp in known.items()):
                break
            time.sleep(0.05)
    job.wait(timeout=STOP_GRACE)

def limit_child() -> None:
    """Scope CPU affinity, priority, signals, and core-dump limits to this job."""
    signal.pthread_sigmask(signal.SIG_UNBLOCK, signal.valid_signals() - {signal.SIGKILL, signal.SIGSTOP})
    os.setpriority(os.PRIO_PROCESS, 0, 19)
    os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (600, 630))

def supervise(command: list[str], work_dir: Path) -> int:
    """Never queue unattended retries or touch unrelated processes/configuration."""
    max_load = max(1.0, len(os.sched_getaffinity(0)) * 0.75)
    state = snapshot(work_dir)
    reasons = pressure(state, max_load, starting=True)
    if reasons:
        print('Build not started: ' + '; '.join(reasons), flush=True)
        return 75
    print('Guard: one CPU, nice 19, one Cargo job; abort on pressure or after 15 minutes.', flush=True)
    env = dict(os.environ, CODEX_NATIVE_BUILD_SUPERVISOR=str(os.getpid()))
    known: dict[int, str] = {}
    job = subprocess.Popen(command, env=env, start_new_session=True, preexec_fn=limit_child)
    started = time.monotonic()
    try:
        stamp = identity(job.pid)
        if stamp is not None:
            known[job.pid] = stamp
        while job.poll() is None:
            rss = members(job.pid, known)
            reasons = pressure(snapshot(work_dir), max_load, starting=False)
            if rss > MAX_JOB_RSS:
                reasons.append(f'build RSS {rss/GIB:.2f} GiB exceeds 1.5 GiB')
            if time.monotonic() - started > MAX_SECONDS:
                reasons.append('15-minute build budget exhausted; completed artifacts retained')
            if reasons:
                print('Stopping this build: ' + '; '.join(reasons), flush=True)
                stop_job(job, known)
                return 75
            time.sleep(POLL_SECONDS)
        # Do not strand a detached child after its build parent exits.
        stop_job(job, known)
        return job.returncode or 0
    except BaseException:
        stop_job(job, known)
        raise

def interrupted(signum: int, frame: FrameType | None) -> NoReturn:
    """Turn termination into an exception so the supervised job is cleaned up."""
    raise InterruptedError(f'build supervisor received signal {signum}')

def main(arguments: list[str]) -> int:
    # Agent-launched shells can inherit blocked signals. Unblock only this
    # supervisor; SIGTERM and Ctrl-C must cancel its children rather than strand them.
    signal.signal(signal.SIGTERM, interrupted)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, signal.valid_signals() - {signal.SIGKILL, signal.SIGSTOP})
    try:
        return supervise([arguments[0], *arguments[2:]], Path(arguments[1]))
    except KeyboardInterrupt:
        print('Build canceled; completed artifacts retained.', file=sys.stderr)
        return 130
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Build guard refused/aborted the job: {error}', file=sys.stderr)
        return 75

if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
RESOURCE_GUARD_PY
fi
for tool in git node bun cargo clang llvm-ar zig python3 rustfmt nice; do
  command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool (no packages installed automatically)" >&2; exit 1; }
done
readonly JUST_BIN="$(command -v just || true)"
just_bin="$JUST_BIN"
if [[ -z "$just_bin" && -x "$HOME/.cargo/bin/just" ]]; then just_bin="$HOME/.cargo/bin/just"; fi
[[ -x "$just_bin" ]] || { echo 'Missing prerequisite: just' >&2; exit 1; }
for path in "$TERMUX_PREFIX/glibc/lib/ld-linux-aarch64.so.1" "$TERMUX_PREFIX/glibc/bin/gcc" "$TERMUX_PREFIX/glibc/bin/ld"; do
  [[ -x "$path" ]] || { echo "Missing existing glibc tool: $path" >&2; exit 1; }
done
if [[ ! -e "$work_dir" ]]; then
  git clone --depth 1 --branch "rust-v$SOURCE_VERSION" https://github.com/openai/codex.git "$work_dir"
fi
work_dir="$(cd -- "$work_dir" && pwd)"
[[ "$(git -C "$work_dir" rev-parse HEAD)" == "$SOURCE_REVISION" ]] || { echo 'Refusing an unrelated checkout' >&2; exit 1; }
if ! mkdir "$work_dir/.termux-build.lock" 2>/dev/null; then
  echo "Build directory is locked: $work_dir/.termux-build.lock (check its owner before removing a stale lock)" >&2
  exit 1
fi
printf '%s\n' "$$" > "$work_dir/.termux-build.lock/owner.pid"
trap 'rm -f -- "$work_dir/.termux-build.lock/owner.pid"; rmdir -- "$work_dir/.termux-build.lock"' EXIT
if ! git -C "$work_dir" apply --reverse --check "$PATCH_PATH" 2>/dev/null; then
  git -C "$work_dir" apply --check "$PATCH_PATH"
  git -C "$work_dir" apply "$PATCH_PATH"
fi
readonly TOOLS="$work_dir/toolchain"
mkdir -p "$TOOLS/sysroot/lib/rustlib"
# Checksums are from the pinned official Rust manifest and nextest release.
# Cached archives are verified again; only this work directory receives downloads.
download() {
  node --input-type=module - "$1" "$2" "$3" <<'JS'
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
const [url, expected, destination] = process.argv.slice(2);
try {
  let data;
  if (existsSync(destination)) data = readFileSync(destination);
  else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`Checksum mismatch: ${destination}`);
  if (!existsSync(destination)) {
    const temporary = `${destination}.${process.pid}.tmp`;
    try { writeFileSync(temporary, data, { flag: 'wx' }); renameSync(temporary, destination); }
    finally { rmSync(temporary, { force: true }); }
  }
} catch (error) { console.error(error); process.exitCode = 1; }
JS
}
readonly RUST_DIST=https://static.rust-lang.org/dist/2026-04-16
# Extract only when absent, so a running compiler's mapped files are never rewritten.
component() {
  local name="$1" checksum="$2" archive="$TOOLS/$1.tar.xz"
  download "$RUST_DIST/$name.tar.xz" "$checksum" "$archive"
  if [[ ! -d "$TOOLS/$name" ]]; then tar -xJf "$archive" -C "$TOOLS"; fi
}
component rustc-1.95.0-aarch64-unknown-linux-gnu 0fe3689eeaed603e5ef24572d11597d3edadaefd2cb181674ad621260f2501d2
component rust-std-1.95.0-aarch64-unknown-linux-gnu 3a21b271b1ff973b94d69b25e7a39992f9fbcae1ab6d9475844a23e6ad3908ac
component rust-std-1.95.0-aarch64-unknown-linux-musl f6710416ed9a7d5cf2a15efa761eb79a1deeb43f9961bbe05cc97bec4ef9064a
for target in aarch64-unknown-linux-gnu aarch64-unknown-linux-musl; do
  if [[ ! -d "$TOOLS/sysroot/lib/rustlib/$target" ]]; then
    cp -a "$TOOLS/rust-std-1.95.0-$target/rust-std-$target/lib/rustlib/$target" "$TOOLS/sysroot/lib/rustlib/"
  fi
done
download https://github.com/nextest-rs/nextest/releases/download/cargo-nextest-0.9.146/cargo-nextest-0.9.146-aarch64-unknown-linux-musl.tar.gz 62ae8b4ad034704f67417f8ed8b897566d82359ab44952729b925fb37eeb7622 "$TOOLS/nextest.tar.gz"
if [[ ! -x "$TOOLS/cargo-nextest" ]]; then tar -xzf "$TOOLS/nextest.tar.gz" -C "$TOOLS"; fi
cat > "$TOOLS/rustc" <<'WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd)"
unset LD_PRELOAD
exec /data/data/com.termux/files/usr/glibc/lib/ld-linux-aarch64.so.1 --library-path "$root/rustc-1.95.0-aarch64-unknown-linux-gnu/rustc/lib:/data/data/com.termux/files/usr/glibc/lib" "$root/rustc-1.95.0-aarch64-unknown-linux-gnu/rustc/bin/rustc" "$@"
WRAPPER
cat > "$TOOLS/cargo-rustc" <<'WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd)"
for arg in "$@"; do
  if [[ "$arg" == aarch64-unknown-linux-musl ]]; then exec "$root/rustc" "$@"; fi
done
exec "$root/rustc" --sysroot "$root/sysroot" -C linker="$root/host-linker" "$@"
WRAPPER
cat > "$TOOLS/host-linker" <<'WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
unset LD_PRELOAD
export PATH="/data/data/com.termux/files/usr/glibc/bin:$PATH"
exec /data/data/com.termux/files/usr/glibc/bin/gcc "$@" -Wl,--dynamic-linker=/data/data/com.termux/files/usr/glibc/lib/ld-linux-aarch64.so.1 -Wl,-rpath=/data/data/com.termux/files/usr/glibc/lib
WRAPPER
cat > "$TOOLS/musl-linker" <<'WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
exec /data/data/com.termux/files/usr/bin/clang --target=aarch64-linux-musl -fuse-ld=lld "$@"
WRAPPER
cat > "$TOOLS/musl-cc" <<'WRAPPER'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
# cc-rs identifies Zig as Clang and adds Rust's vendor-bearing target triple.
# Zig expects arch-os-abi, so normalize this one known target without dropping
# any compilation options or silently accepting a different platform.
args=()
for arg in "$@"; do
  case "$arg" in
    --target=aarch64-unknown-linux-musl) args+=(--target=aarch64-linux-musl) ;;
    *) args+=("$arg") ;;
  esac
done
exec /data/data/com.termux/files/usr/bin/zig cc -target aarch64-linux-musl "${args[@]}"
WRAPPER
chmod 700 "$TOOLS/rustc" "$TOOLS/cargo-rustc" "$TOOLS/host-linker" "$TOOLS/musl-linker" "$TOOLS/musl-cc"
[[ "$mode" != prepare ]] || { echo "Prepared isolated source and toolchain: $work_dir"; exit 0; }
# All environment changes are scoped to this script and its children.
unset LD_PRELOAD LD_LIBRARY_PATH RUSTFLAGS CARGO_ENCODED_RUSTFLAGS
export TMPDIR="$TERMUX_PREFIX/tmp" TMP="$TERMUX_PREFIX/tmp" TEMP="$TERMUX_PREFIX/tmp"
export PATH="$TOOLS:$(dirname -- "$just_bin"):$PATH"
export RUSTC="$TOOLS/cargo-rustc" CARGO_TARGET_DIR="$work_dir/target-musl"
export CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_INCREMENTAL=false
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER="$TOOLS/musl-linker"
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="--sysroot $TOOLS/sysroot --cfg codex_termux --check-cfg=cfg(codex_termux)"
export CC_aarch64_unknown_linux_musl="$TOOLS/musl-cc" AR_aarch64_unknown_linux_musl="$TERMUX_PREFIX/bin/llvm-ar"
export CODEX_BWRAP_SHA256="$BWRAP_SHA256"
export HOST_CC="$TERMUX_PREFIX/glibc/bin/gcc" MAKEFLAGS="SHELL=$TERMUX_PREFIX/bin/sh" CONFIG_SHELL="$TERMUX_PREFIX/bin/sh"
cd -- "$work_dir"
rustfmt --edition 2024 --check codex-rs/uds/src/daemon_directory.rs codex-rs/uds/src/lib_tests.rs
# The release tag stamps workspace versions but its lockfile may retain 0.0.0.
# Let Cargo refresh that metadata, then verify no external dependency drift.
nice -n 15 cargo check --manifest-path codex-rs/Cargo.toml --target aarch64-unknown-linux-musl -p codex-uds
python3 - <<'PY'
import subprocess, tomllib
from pathlib import Path
before = tomllib.loads(subprocess.check_output(['git', 'show', 'HEAD:codex-rs/Cargo.lock'], text=True))
after = tomllib.loads(Path('codex-rs/Cargo.lock').read_text())
def external(data):
    return sorted((p['name'], p['version'], p.get('source'), p.get('checksum')) for p in data['package'] if 'source' in p)
if external(before) != external(after):
    raise SystemExit('Refusing external dependency drift from the pinned release')
PY
nice -n 15 "$just_bin" test --locked --target aarch64-unknown-linux-musl -p codex-uds
[[ "$mode" != test ]] || exit 0
nice -n 15 cargo build --locked --manifest-path codex-rs/Cargo.toml --target aarch64-unknown-linux-musl -p codex-cli --bin codex
binary="$CARGO_TARGET_DIR/aarch64-unknown-linux-musl/debug/codex"
[[ "$("$binary" --version)" == "codex-cli $SOURCE_VERSION" ]] || { echo 'Candidate version mismatch' >&2; exit 1; }
# Reuse the matching companion/resources without modifying the installed release.
# New immutable directories and an atomic pointer keep mapped executables intact.
stock="$HOME/.local/share/codex-channel/versions/$SOURCE_VERSION"
[[ -x "$stock/bin/codex-code-mode-host" && -x "$stock/bin/codex" ]] || {
  echo "CLI built at $binary; matching cdx $SOURCE_VERSION resources are required for packaging" >&2
  exit 1
}
[[ "$("$stock/bin/codex" --version)" == "codex-cli $SOURCE_VERSION" ]] || { echo 'Companion release mismatch' >&2; exit 1; }
node --input-type=module - "$stock/codex-resources/bwrap" "$BWRAP_SHA256" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
if (createHash('sha256').update(readFileSync(process.argv[2])).digest('hex') !== process.argv[3]) {
  throw new Error('Matching release bubblewrap checksum mismatch');
}
JS
candidate="$(mktemp -d "$work_dir/native-candidate.XXXXXX")"
cp -a -L -- "$stock/." "$candidate/"
cp -p -- "$binary" "$candidate/bin/codex"
"$REPO_ROOT/scripts/patch-codex-termux-dns.sh" "$candidate/bin/codex"
[[ "$("$candidate/bin/codex" --version)" == "codex-cli $SOURCE_VERSION" ]] || { echo 'Patched candidate version mismatch' >&2; exit 1; }
if [[ -e "$work_dir/native-current" && ! -L "$work_dir/native-current" ]]; then
  echo 'Refusing an unmanaged native-current path' >&2; exit 1
fi
ln -s -- "$(basename -- "$candidate")" "$work_dir/.native-current.$$"
mv -Tf -- "$work_dir/.native-current.$$" "$work_dir/native-current"
if [[ ! -e "$work_dir/codex-native" ]]; then
  temporary_launcher="$(mktemp "$work_dir/.codex-native.XXXXXX")"
  cat > "$temporary_launcher" <<'LAUNCHER'
#!/data/data/com.termux/files/usr/bin/bash
# codex-native managed experimental launcher
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd)"
export TMPDIR=/data/data/com.termux/files/usr/tmp TMP=/data/data/com.termux/files/usr/tmp TEMP=/data/data/com.termux/files/usr/tmp
export PATH="$root/native-current/codex-path:/data/data/com.termux/files/usr/bin:$PATH"
if [[ "${1:-}" == update ]]; then
  echo 'Rebuild this experimental candidate with scripts/build-codex-termux.sh' >&2; exit 2
fi
exec "$root/native-current/bin/codex" --disable daemon_auto_start "$@"
LAUNCHER
  chmod 700 "$temporary_launcher"
  mv -- "$temporary_launcher" "$work_dir/codex-native"
fi
echo "Built opt-in candidate (not promoted or runtime-validated): $work_dir/codex-native"
# TODO: Validate foreground remote control, mobile pairing, and sandbox behavior
# before integrating a locally built candidate with cdx. Never auto-promote it.
