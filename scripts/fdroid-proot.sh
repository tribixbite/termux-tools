#!/data/data/com.termux/files/usr/bin/bash
# fdroid — run fdroidserver from the Ubuntu proot container.
#
# fdroidserver's dependency set (Pillow, cryptography via paramiko, androguard)
# has no Termux wheels and would have to build from sdist here. The Ubuntu 24.04
# aarch64 container has manylinux wheels for all of them, so fdroidserver lives
# there instead: /opt/fdroidserver, a venv holding the PyPI release.
#
# proot-distro binds /data/data/com.termux by default, so the container sees
# Termux $HOME at the same absolute path. That means no copying and no --bind:
# `fdroid lint` in ~/git/fdroiddata-fork reads the very same files you edit here.
#
# ANDROID_HOME is deliberately NOT forwarded. This wrapper is for the metadata
# commands (lint, readmeta, rewritemeta, checkupdates), which need no SDK. Real
# `fdroid build` verification happens on amd64 CI — building on this aarch64
# device uses a different aapt2 than GitHub Actions and F-Droid's buildserver,
# so its APKs cannot byte-match the published binary. See fdroid/README.md in
# the Embeddy repo, and the `fdroid build` job in fdroiddata's .gitlab-ci.yml
# (tags: saas-linux-medium-amd64, image: fdroidserver:buildserver-bookworm).
set -euo pipefail

readonly DISTRO=ubuntu
readonly VENV=/opt/fdroidserver
readonly ROOTFS="${PREFIX:-/data/data/com.termux/files/usr}/var/lib/proot-distro/installed-rootfs/${DISTRO}"

if [ ! -d "$ROOTFS" ]; then
    printf 'fdroid: proot-distro container %q is not installed.\n' "$DISTRO" >&2
    printf '        Install it with: proot-distro install %s\n' "$DISTRO" >&2
    exit 1
fi

if [ ! -x "${ROOTFS}${VENV}/bin/fdroid" ]; then
    printf 'fdroid: fdroidserver is not installed at %s inside %q.\n' "$VENV" "$DISTRO" >&2
    printf '        Reinstall with:\n' >&2
    printf '          proot-distro login %s -- /bin/bash -lc \\\n' "$DISTRO" >&2
    printf '            "python3 -m venv %s && %s/bin/pip install fdroidserver"\n' "$VENV" "$VENV" >&2
    exit 1
fi

# --work-dir keeps the caller's directory, which resolves identically inside the
# container. Fall back to Termux $HOME if $PWD somehow is not visible there.
work_dir="$PWD"
[ -d "${ROOTFS}${work_dir}" ] || [ -d "$work_dir" ] || work_dir="$HOME"

# NOTE: do not default $serverwebroot here. Running against fdroiddata's
# config.yml logs two cosmetic errors when it is unset:
#   ERROR: Environment variable {env: serverwebroot} is not set!
#   ERROR: serverwebroot: has blank value!
# The command still completes and exits 0. Setting it to /tmp — as fdroiddata's
# own CI does in `.install_fdroid_server` — is WORSE here, because that config
# also sets `deploy_process_logs: true`, so checkupdates then really attempts an
# rsync of repo/status/*.json and fails with rc=11. Measured, not theorised.
# Leave it unset unless you are actually deploying.
exec proot-distro login "$DISTRO" \
    --no-arch-warning \
    --work-dir "$work_dir" \
    -- "${VENV}/bin/fdroid" "$@"
