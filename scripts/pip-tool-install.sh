#!/data/data/com.termux/files/usr/bin/bash
# pip-tool-install.sh — install a Python CLI tool into an isolated venv on Termux.
#
# Why this exists instead of `uv tool install` / `pipx`:
#   uv cannot install source-built C-extension packages on Termux. uv has
#   Rust-side Android OS detection that forces it to expect `android_*` wheel
#   tags, but Termux's python3.12 reports `linux_aarch64` (sys.platform=="linux"),
#   so every source build is tagged linux and uv rejects it as "not compatible
#   with the current Python 3.12 on Android aarch64". Neither `--python-platform
#   linux` (pulls wrong-arch / glibc manylinux wheels that don't dlopen on
#   bionic) nor `_PYTHON_HOST_PLATFORM=android_*` (breaks uv's interpreter probe)
#   is a workable override. pip has no post-build tag recheck, so it installs the
#   freshly built wheel as-is — built against bionic, runs natively.
#
# Also pins the interpreter to python3.12, whose `sys.platform == "linux"` makes
# sdists that hard-reject android (e.g. psutil 7.x: "platform android is not
# supported") build cleanly. python3.13 reports "android" and those sdists abort.
#
# Usage:
#   pip-tool-install.sh <pip-spec> [--bin name1,name2] [--with extra1,extra2]
# Examples:
#   pip-tool-install.sh maigret --with setuptools
#   pip-tool-install.sh 'some-tool==1.2' --bin some-tool --with setuptools,wheel
set -euo pipefail

PY="${PIP_TOOL_PYTHON:-python3.12}"
VENVROOT="${PIP_TOOL_VENVROOT:-$HOME/.local/share/pip-tools}"
BINDIR="${PIP_TOOL_BINDIR:-$HOME/.local/bin}"

spec="${1:?usage: pip-tool-install.sh <pip-spec> [--bin n1,n2] [--with e1,e2]}"
shift || true
bins=""; extras=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bin)  bins="$2"; shift 2 ;;
    --with) extras="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Derive a venv name from the package portion of the spec (strip version/extras).
name="$(printf '%s' "$spec" | sed -E 's/[<>=!~ ].*$//; s/\[.*$//')"
venv="$VENVROOT/$name"

command -v "$PY" >/dev/null || { echo "interpreter '$PY' not found" >&2; exit 1; }
mkdir -p "$VENVROOT" "$BINDIR"
rm -rf "$venv"
"$PY" -m venv "$venv"
"$venv/bin/pip" install --quiet --upgrade pip setuptools wheel
if [ -n "$extras" ]; then
  "$venv/bin/pip" install --quiet ${extras//,/ }
fi
"$venv/bin/pip" install "$spec"

# Symlink entrypoints. Default: the derived package name; override with --bin.
if [ -z "$bins" ]; then bins="$name"; fi
for b in ${bins//,/ }; do
  if [ -x "$venv/bin/$b" ]; then
    ln -sf "$venv/bin/$b" "$BINDIR/$b"
    echo "linked $BINDIR/$b -> $venv/bin/$b"
  else
    echo "WARN: no entrypoint '$b' in $venv/bin" >&2
  fi
done
echo "done: $name installed at $venv"
