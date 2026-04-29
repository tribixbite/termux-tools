#!/data/data/com.termux/files/usr/bin/env bash
# Install Ghostty 1.2.0 on Termux (Android, aarch64) via glibc-runner.
#
# Why this is hard:
#   - Zig 0.14 does not support native bionic libc → cannot link libc on
#     Termux directly. Ghostty's build does many `-lc` static-archive sub-builds
#     that fail with `LibCRuntimeNotFound`.
#   - The glibc-runner repo (gpkg) provides aarch64-linux-gnu glibc + many
#     libs at $PREFIX/glibc, but does NOT ship gtk4-glibc, libadwaita-glibc,
#     graphene-glibc, or gdk-pixbuf-glibc — so we build those from source
#     against the gpkg-installed glib/cairo/pango/etc.
#   - Ghostty's build.zig hardcodes `b.graph.host` for several native helper
#     tools; on Termux that resolves to aarch64-linux-musl, again hitting
#     LibCRuntimeNotFound. We patch each helper to musl-static and rewrite
#     blueprint.zig's `@cInclude("adwaita.h")` to a hardcoded version.
#   - libxev defaults to io_uring on Linux. Termux's seccomp filter SIGSYS-es
#     `io_uring_setup`. We patch libxev's backend candidates to epoll-only.
#   - GTK 4.18 requires pango ≥ 1.55.4; gpkg ships pango 1.54. We use GTK
#     4.16.6 (latest that takes pango 1.54) with libadwaita 1.5.4.
#   - libadwaita 1.5+ requires appstream (≥ 1.1.3); gpkg has appstream 1.0.5
#     bionic-only and the upstream subproject build needs a native build-host
#     appstream. We strip libadwaita's appstream usage with stub typedefs.
#   - Termux's bionic blueprint-compiler script is shebanged for python3 →
#     python3.13, but pygobject is python3.12-only as of 2026-04. We wrap it.
#   - Termux's pkgconf doesn't emit -L/-I for its compiled-in default
#     libdir/includedir; we wrap pkgconf to re-inject those. X11 headers at
#     `${includedir}/X11/...` would conflict with libcxx <stdint.h>, so we
#     symlink X11 into an isolated directory and rewrite the .pc files.
#
# Idempotent where reasonable. Re-run after a phone wipe.
# bun, node, python are not touched.

set -euo pipefail

# ─── Config ─────────────────────────────────────────────────────────────
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
GLIBC_PREFIX="${PREFIX}/glibc"
LOCAL_BIN="${HOME_DIR}/.local/bin"
LOCAL_SHARE="${HOME_DIR}/.local/share"
BUILD_DIR="${HOME_DIR}/build"
GHOSTTY_DIR="${HOME_DIR}/git/ghostty"
GHOSTTY_VERSION="1.2.0"
GTK_VERSION="4.16.6"
LIBADWAITA_VERSION="1.5.4"
GRAPHENE_VERSION="1.10.8"
GDK_PIXBUF_VERSION="2.42.12"
LIBXDAMAGE_VERSION="1.1.6"
LIBFYAML_VERSION="0.9.6"
ZIG_REQUIRED="0.14.0"
GLIBC_TARGET_VERSION="2.41"   # Zig 0.14 caps glibc support here

# ─── Helpers ────────────────────────────────────────────────────────────
log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m-->\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

ensure_dir() { [[ -d "$1" ]] || mkdir -p "$1"; }

# ─── 1. Pre-flight ──────────────────────────────────────────────────────
log "Pre-flight checks"
[[ "$(uname -m)" == "aarch64" ]] || die "This script targets aarch64 only"
command -v zig >/dev/null || die "Install zig first (pkg install zig); need ${ZIG_REQUIRED}"
zig_ver=$(zig version)
[[ "${zig_ver}" == "${ZIG_REQUIRED}"* ]] || warn "Zig ${zig_ver}; ${ZIG_REQUIRED} expected"
command -v grun >/dev/null || die "Install glibc-runner first (pacman -S glibc-runner)"
[[ -x "${GLIBC_PREFIX}/lib/ld-linux-aarch64.so.1" ]] || \
  die "glibc-runner sysroot missing; pacman -S glibc"

# ─── 2. Fix pacman gpkg mirror (US cloudfront DNS broken since 2026-04-25) ──
log "Patching pacman.conf [gpkg] to use serverlist mirror"
if grep -q '^Server = https://service\.termux-pacman\.dev/gpkg' "${PREFIX}/etc/pacman.conf"; then
  sed -i 's|^Server = https://service\.termux-pacman\.dev/gpkg/\$arch|Include = /data/data/com.termux/files/usr/etc/pacman.d/serverlist|' \
    "${PREFIX}/etc/pacman.conf"
  log "  patched"
else
  log "  already patched"
fi

# ─── 3. apt: blueprint-compiler + gettext + libxml2-utils (xmllint) ─────
log "Installing apt deps (blueprint-compiler, gettext, libxml2-utils)"
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  blueprint-compiler gettext libxml2-utils \
  >/dev/null
[[ -x "${PREFIX}/bin/python3.12" ]] || \
  warn "python3.12 missing; blueprint-compiler wrapper will fail. Restore it first."

# ─── 4. blueprint-compiler wrapper (pygobject is python3.12-only) ───────
log "Writing blueprint-compiler wrapper (forces python3.12)"
ensure_dir "${LOCAL_BIN}"
cat > "${LOCAL_BIN}/blueprint-compiler" <<EOF
#!${PREFIX}/bin/env bash
exec ${PREFIX}/bin/python3.12 ${PREFIX}/bin/blueprint-compiler "\$@"
EOF
chmod +x "${LOCAL_BIN}/blueprint-compiler"

# ─── 5. pacman: glibc-side build deps ───────────────────────────────────
log "Installing glibc-side build deps via pacman"
pacman -Sy --noconfirm >/dev/null
glibc_deps=(
  glibc-runner glibc gcc-glibc binutils-glibc
  glib-bin-glibc glib-glibc gobject-introspection-glibc
  harfbuzz-glibc libcairo-glibc pango-glibc fribidi-glibc
  libepoxy-glibc fontconfig-glibc freetype-glibc
  libpng-glibc libjpeg-turbo-glibc libtiff-glibc
  libxkbcommon-glibc libwayland-glibc libwayland-protocols-glibc
  libx11-glibc libxcb-glibc libxext-glibc libxi-glibc
  libxrandr-glibc libxcursor-glibc libxfixes-glibc libxinerama-glibc
  libxrender-glibc libxshmfence-glibc libxdmcp-glibc libxau-glibc
  xkeyboard-config-glibc xcb-proto-glibc xorgproto-glibc
  libdrm-glibc libxml2-glibc python-glibc gettext-glibc
  pkgconf-glibc xz-utils-glibc make-glibc patchelf-glibc
  mesa-glibc libglvnd-glibc libva-glibc libclc-glibc
)
pacman -S --needed --noconfirm --overwrite='*' "${glibc_deps[@]}" >/dev/null

# ─── 6. grun-* compiler wrappers + meson cross-file ─────────────────────
log "Writing grun-{gcc,g++,pkgconf} wrappers and meson cross-file"
cat > "${LOCAL_BIN}/grun-gcc" <<EOF
#!${PREFIX}/bin/env bash
exec ${PREFIX}/bin/grun ${GLIBC_PREFIX}/bin/gcc "\$@"
EOF
cat > "${LOCAL_BIN}/grun-g++" <<EOF
#!${PREFIX}/bin/env bash
exec ${PREFIX}/bin/grun ${GLIBC_PREFIX}/bin/g++ "\$@"
EOF

# pkgconf wrapper: re-inject -L/-I paths that pkgconf strips for its compiled-in
# default libdir/includedir, since Zig doesn't know that default.
cat > "${LOCAL_BIN}/grun-pkgconf" <<EOF
#!${PREFIX}/bin/env bash
set -euo pipefail
PKG_CONFIG_PATH="${GLIBC_PREFIX}/lib/pkgconfig:${GLIBC_PREFIX}/share/pkgconfig\${PKG_CONFIG_PATH:+:\$PKG_CONFIG_PATH}" \\
PKG_CONFIG_LIBDIR="${GLIBC_PREFIX}/lib/pkgconfig:${GLIBC_PREFIX}/share/pkgconfig" \\
out=\$(${PREFIX}/bin/grun ${GLIBC_PREFIX}/bin/pkgconf "\$@")
if [[ "\$*" == *--libs* ]]; then
  out="-L${GLIBC_PREFIX}/lib \${out}"
fi
echo "\${out}"
EOF

# gdbus-codegen wrapper: glibc-side glib's tool is a Python script with a
# glibc-python shebang; needs invocation through grun and a wrapper.
cat > "${LOCAL_BIN}/gdbus-codegen" <<EOF
#!${PREFIX}/bin/env bash
exec ${PREFIX}/bin/grun \\
     ${GLIBC_PREFIX}/bin/python3 \\
     ${GLIBC_PREFIX}/bin/gdbus-codegen "\$@"
EOF
chmod +x "${LOCAL_BIN}"/grun-* "${LOCAL_BIN}/gdbus-codegen"

ensure_dir "${LOCAL_SHARE}"
cat > "${LOCAL_SHARE}/meson-glibc-cross.ini" <<EOF
[binaries]
c = '${LOCAL_BIN}/grun-gcc'
cpp = '${LOCAL_BIN}/grun-g++'
pkg-config = '${LOCAL_BIN}/grun-pkgconf'
gdbus-codegen = '${LOCAL_BIN}/gdbus-codegen'
exe_wrapper = ['${PREFIX}/bin/grun']

[host_machine]
system = 'linux'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'

[built-in options]
prefix = '${GLIBC_PREFIX}'
libdir = 'lib'
EOF

# ─── 7. Isolate X11 headers (libcxx <stdint.h> conflicts with /usr/glibc/include) ──
log "Setting up isolated X11 header dir"
ensure_dir "${LOCAL_SHARE}/x11-only-headers"
ln -snf "${GLIBC_PREFIX}/include/X11"      "${LOCAL_SHARE}/x11-only-headers/X11"
ln -snf "${GLIBC_PREFIX}/include/xkbcommon" "${LOCAL_SHARE}/x11-only-headers/xkbcommon"

# Rewrite affected .pc files to emit our isolated dir instead of bare ${includedir}.
for pc in x11 xext xfixes xi xrandr xrender xcursor xinerama xkbcommon-x11 xdamage; do
  pcf="${GLIBC_PREFIX}/lib/pkgconfig/${pc}.pc"
  [[ -f "${pcf}" ]] || continue
  if grep -q '^Cflags: -I${includedir}' "${pcf}" 2>/dev/null || \
     grep -q "^Cflags: -I${LOCAL_SHARE}/x11-only-headers" "${pcf}"; then
    sed -i "s|^Cflags: .*|Cflags: -I${LOCAL_SHARE}/x11-only-headers|" "${pcf}"
  fi
done
# xkbcommon.pc has its own dir
sed -i "s|^Cflags: .*|Cflags: -I${LOCAL_SHARE}/x11-only-headers|" \
  "${GLIBC_PREFIX}/lib/pkgconfig/xkbcommon.pc"

# ─── 8. dbus machine-id (cosmetic but quiets a Gtk warning) ─────────────
log "Seeding dbus machine-id"
ensure_dir "${GLIBC_PREFIX}/var/lib/dbus"
[[ -s "${GLIBC_PREFIX}/var/lib/dbus/machine-id" ]] || \
  head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' \
    > "${GLIBC_PREFIX}/var/lib/dbus/machine-id"

# ─── 9. Build vendored deps that gpkg lacks ─────────────────────────────
ensure_dir "${BUILD_DIR}"

build_meson() {
  local name="$1" version="$2" url="$3" tarball="$4"
  shift 4
  local opts=("$@")

  log "Building ${name} ${version}"
  cd "${BUILD_DIR}"
  if [[ ! -d "${name}-${version}" ]]; then
    [[ -s "${tarball}" ]] || curl -fsSLO "${url}"
    tar -xf "${tarball}"
  fi

  cd "${name}-${version}"
  rm -rf build
  PATH="${LOCAL_BIN}:${PATH}" \
    meson setup build \
      --cross-file="${LOCAL_SHARE}/meson-glibc-cross.ini" \
      --buildtype=release \
      "${opts[@]}"
  ninja -C build -j2
  ninja -C build install
}

# graphene
${LOCAL_BIN}/grun-pkgconf --modversion graphene-1.0 >/dev/null 2>&1 || \
  build_meson graphene "${GRAPHENE_VERSION}" \
    "https://download.gnome.org/sources/graphene/1.10/graphene-${GRAPHENE_VERSION}.tar.xz" \
    "graphene-${GRAPHENE_VERSION}.tar.xz" \
    -Dintrospection=disabled -Dgtk_doc=false -Dtests=false -Dinstalled_tests=false

# gdk-pixbuf
${LOCAL_BIN}/grun-pkgconf --modversion gdk-pixbuf-2.0 >/dev/null 2>&1 || \
  build_meson gdk-pixbuf "${GDK_PIXBUF_VERSION}" \
    "https://download.gnome.org/sources/gdk-pixbuf/2.42/gdk-pixbuf-${GDK_PIXBUF_VERSION}.tar.xz" \
    "gdk-pixbuf-${GDK_PIXBUF_VERSION}.tar.xz" \
    -Dintrospection=disabled -Dman=false -Ddocs=false -Dtests=false \
    -Dinstalled_tests=false -Dgio_sniffing=false -Drelocatable=false \
    -Dpng=enabled -Djpeg=enabled -Dtiff=enabled -Dothers=enabled \
    -Dbuiltin_loaders=all -Dgtk_doc=false

# libXdamage (autotools, not meson)
${LOCAL_BIN}/grun-pkgconf --modversion xdamage >/dev/null 2>&1 || {
  log "Building libXdamage ${LIBXDAMAGE_VERSION}"
  cd "${BUILD_DIR}"
  if [[ ! -d "libXdamage-${LIBXDAMAGE_VERSION}" ]]; then
    curl -fsSLO "https://www.x.org/releases/individual/lib/libXdamage-${LIBXDAMAGE_VERSION}.tar.xz"
    tar -xf "libXdamage-${LIBXDAMAGE_VERSION}.tar.xz"
  fi
  cd "libXdamage-${LIBXDAMAGE_VERSION}"
  ./configure --prefix="${GLIBC_PREFIX}" \
    --host=aarch64-unknown-linux-gnu \
    --build=aarch64-unknown-linux-android \
    CC="${LOCAL_BIN}/grun-gcc" \
    PKG_CONFIG="${LOCAL_BIN}/grun-pkgconf" \
    PKG_CONFIG_PATH="${GLIBC_PREFIX}/lib/pkgconfig" \
    cross_compiling=yes
  make -j2
  make install
}

# libfyaml (autotools; needed by appstream → NOT directly by libadwaita
# after our patch, but appstream subproject may still resolve)
${LOCAL_BIN}/grun-pkgconf --modversion libfyaml >/dev/null 2>&1 || {
  log "Building libfyaml ${LIBFYAML_VERSION}"
  cd "${BUILD_DIR}"
  if [[ ! -d "libfyaml-${LIBFYAML_VERSION}" ]]; then
    curl -fsSLO "https://github.com/pantoniou/libfyaml/releases/download/v${LIBFYAML_VERSION}/libfyaml-${LIBFYAML_VERSION}.tar.gz"
    tar -xzf "libfyaml-${LIBFYAML_VERSION}.tar.gz"
  fi
  cd "libfyaml-${LIBFYAML_VERSION}"
  ./configure --prefix="${GLIBC_PREFIX}" \
    --host=aarch64-unknown-linux-gnu \
    --build=aarch64-unknown-linux-android \
    CC="${LOCAL_BIN}/grun-gcc" \
    PKG_CONFIG="${LOCAL_BIN}/grun-pkgconf" \
    PKG_CONFIG_PATH="${GLIBC_PREFIX}/lib/pkgconfig" \
    cross_compiling=yes
  make -j2
  make install
}

# GTK 4.16.6 (newer 4.16.x reference glib 2.84 functions; gpkg has 2.82)
${LOCAL_BIN}/grun-pkgconf --modversion gtk4 2>/dev/null | grep -q "^${GTK_VERSION}\$" || \
  build_meson gtk "${GTK_VERSION}" \
    "https://download.gnome.org/sources/gtk/4.16/gtk-${GTK_VERSION}.tar.xz" \
    "gtk-${GTK_VERSION}.tar.xz" \
    -Dx11-backend=true -Dwayland-backend=false -Dbroadway-backend=false \
    -Dvulkan=disabled -Dmedia-gstreamer=disabled \
    -Dprint-cups=disabled -Dprint-cpdb=disabled \
    -Dintrospection=disabled -Ddocumentation=false -Dman-pages=false \
    -Dbuild-tests=false -Dbuild-testsuite=false -Dbuild-examples=false \
    -Dbuild-demos=false -Dscreenshots=false \
    -Df16c=disabled -Dsysprof=disabled -Dtracker=disabled -Dcolord=disabled

# libadwaita 1.5.4 (with appstream stripped; gpkg has none)
if ! ${LOCAL_BIN}/grun-pkgconf --modversion libadwaita-1 2>/dev/null | grep -q "^${LIBADWAITA_VERSION}\$"; then
  log "Building libadwaita ${LIBADWAITA_VERSION} (appstream stripped)"
  cd "${BUILD_DIR}"
  rm -rf "libadwaita-${LIBADWAITA_VERSION}"
  [[ -s "libadwaita-${LIBADWAITA_VERSION}.tar.xz" ]] || \
    curl -fsSLO "https://download.gnome.org/sources/libadwaita/1.5/libadwaita-${LIBADWAITA_VERSION}.tar.xz"
  tar -xf "libadwaita-${LIBADWAITA_VERSION}.tar.xz"

  python3 - <<'PY'
import re, pathlib
ROOT = pathlib.Path.home() / "build" / f"libadwaita-1.5.4"
mb = ROOT / "src/meson.build"
text = mb.read_text()
text = re.sub(r"appstream_dep\s*=\s*dependency\('appstream',[\s\S]*?\)\n", "", text, count=1)
text = re.sub(r"^\s*appstream_dep,\n", "", text, flags=re.MULTILINE)
mb.write_text(text)
STUB = r"""
/* === BEGIN appstream stub (libadwaita patched for glibc-runner build) === */
#include <gio/gio.h>
#define AS_CHECK_VERSION(major, minor, micro) 0
typedef struct _AsMetadata AsMetadata;
typedef struct _AsComponent AsComponent;
typedef struct _AsRelease AsRelease;
typedef struct _AsLaunchable AsLaunchable;
typedef struct _AsDeveloper AsDeveloper;
typedef enum { AS_FORMAT_KIND_UNKNOWN = 0 } AsFormatKind;
typedef enum { AS_LAUNCHABLE_KIND_UNKNOWN, AS_LAUNCHABLE_KIND_DESKTOP_ID, AS_LAUNCHABLE_KIND_SERVICE, AS_LAUNCHABLE_KIND_COCKPIT_MANIFEST, AS_LAUNCHABLE_KIND_URL } AsLaunchableKind;
typedef enum { AS_URL_KIND_UNKNOWN, AS_URL_KIND_HOMEPAGE, AS_URL_KIND_BUGTRACKER, AS_URL_KIND_FAQ, AS_URL_KIND_HELP, AS_URL_KIND_DONATION, AS_URL_KIND_TRANSLATE, AS_URL_KIND_CONTACT, AS_URL_KIND_VCS_BROWSER, AS_URL_KIND_CONTRIBUTE } AsUrlKind;
static inline AsMetadata *as_metadata_new (void) { return NULL; }
static inline gboolean as_metadata_parse_file (AsMetadata *m, GFile *f, AsFormatKind k, GError **e) { (void)m;(void)f;(void)k; if (e) *e = g_error_new (g_quark_from_static_string ("adw-about-stub"), 0, "appstream support not built"); return FALSE; }
static inline AsComponent *as_metadata_get_component (AsMetadata *m) { (void)m; return NULL; }
static inline const char *as_component_get_id (AsComponent *c) { (void)c; return NULL; }
static inline AsLaunchable *as_component_get_launchable (AsComponent *c, AsLaunchableKind k) { (void)c;(void)k; return NULL; }
static inline GPtrArray *as_release_list_get_entries (gpointer rel) { (void)rel; return NULL; }
static inline GPtrArray *as_component_get_releases_plain (AsComponent *c) { (void)c; return NULL; }
static inline GPtrArray *as_component_get_releases (AsComponent *c) { (void)c; return NULL; }
static inline const char *as_release_get_version (AsRelease *r) { (void)r; return NULL; }
static inline const char *as_release_get_description (AsRelease *r) { (void)r; return NULL; }
static inline const char *as_component_get_name (AsComponent *c) { (void)c; return NULL; }
static inline const char *as_component_get_project_license (AsComponent *c) { (void)c; return NULL; }
static inline const char *as_component_get_url (AsComponent *c, AsUrlKind k) { (void)c;(void)k; return NULL; }
static inline AsDeveloper *as_component_get_developer (AsComponent *c) { (void)c; return NULL; }
static inline const char *as_component_get_developer_name (AsComponent *c) { (void)c; return NULL; }
static inline const char *as_developer_get_name (AsDeveloper *d) { (void)d; return NULL; }
static inline GPtrArray *as_launchable_get_entries (AsLaunchable *l) { (void)l; return NULL; }
/* === END appstream stub === */
"""
for fname in ("src/adw-about-dialog.c", "src/adw-about-window.c"):
    p = ROOT / fname
    src = p.read_text()
    src = src.replace("#include <appstream.h>", STUB.strip())
    p.write_text(src)
for w in ("subprojects/appstream.wrap", "subprojects/libxmlb.wrap"):
    f = ROOT / w
    if f.exists(): f.unlink()
print("libadwaita patched")
PY

  cd "libadwaita-${LIBADWAITA_VERSION}"
  rm -rf build
  PATH="${LOCAL_BIN}:${PATH}" meson setup build \
    --cross-file="${LOCAL_SHARE}/meson-glibc-cross.ini" \
    --buildtype=release \
    -Dintrospection=disabled -Dvapi=false -Dgtk_doc=false \
    -Dtests=false -Dexamples=false
  ninja -C build -j2
  ninja -C build install
fi

# ─── 10. Clone Ghostty ──────────────────────────────────────────────────
log "Cloning Ghostty ${GHOSTTY_VERSION}"
ensure_dir "$(dirname "${GHOSTTY_DIR}")"
[[ -d "${GHOSTTY_DIR}" ]] || \
  git clone --depth 1 -b "v${GHOSTTY_VERSION}" \
    https://github.com/ghostty-org/ghostty.git "${GHOSTTY_DIR}"

# ─── 11. Pre-fetch all transitive deps (Termux Zig has no /etc/resolv.conf) ──
# Recursively curl every URL declared in any build.zig.zon under the source
# tree AND the populated zig pkg cache, then `zig fetch <local-tarball>`.
log "Pre-fetching Ghostty deps via curl + zig fetch"
cd "${GHOSTTY_DIR}"
cat > prefetch-deps.sh <<'PFEOF'
#!/data/data/com.termux/files/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
CACHE="${ROOT}/.deps-cache"
ZIG_PKG="${HOME}/.cache/zig/p"
mkdir -p "${CACHE}"
declare -A DONE
scan() {
  grep -hE '\.url = "(https|git\+https)' \
    $(find "${ROOT}" -name build.zig.zon 2>/dev/null) \
    $(find "${ZIG_PKG}" -maxdepth 2 -name build.zig.zon 2>/dev/null) 2>/dev/null \
    | sed -E 's/.*"([^"]+)".*/\1/' | sort -u
}
fetch_one() {
  local url="$1"; [[ -n "${DONE[${url}]:-}" ]] && return 0
  local fname
  if [[ "${url}" == git+https://* ]]; then
    local raw="${url#git+https://}" repo="${raw%%#*}" commit="${raw##*#}"
    local slug="$(echo "${repo}" | tr '/' '_')-${commit:0:12}.tar"
    fname="${CACHE}/${slug}"
    if [[ ! -s "${fname}" ]]; then
      local work="${CACHE}/.git-${commit:0:12}"
      rm -rf "${work}"
      git clone --quiet "https://${repo}" "${work}"
      git -C "${work}" archive --format=tar --prefix='' "${commit}" > "${fname}"
      rm -rf "${work}"
    fi
  else
    fname="${CACHE}/$(basename "${url}")"
    [[ -s "${fname}" ]] || curl -fsSL --retry 3 -o "${fname}.part" "${url}" && mv "${fname}.part" "${fname}" 2>/dev/null
  fi
  if hash="$(zig fetch "${fname}" 2>&1)"; then
    DONE["${url}"]="${hash}"
  else
    return 1
  fi
}
pass=0
while :; do
  pass=$((pass+1))
  mapfile -t urls < <(scan)
  new=0
  for url in "${urls[@]}"; do
    [[ -n "${DONE[${url}]:-}" ]] && continue
    fetch_one "${url}" && new=$((new+1))
  done
  [[ ${new} -eq 0 ]] && break
  [[ ${pass} -ge 8 ]] && exit 2
done
PFEOF
chmod +x prefetch-deps.sh
./prefetch-deps.sh

# ─── 12. Patch Ghostty + zg + libxev ────────────────────────────────────
log "Patching ghostty/zg/libxev"
python3 - <<'PY'
import re, pathlib, glob
ROOT = pathlib.Path.home() / "git" / "ghostty"
ZIG_CACHE = pathlib.Path.home() / ".cache" / "zig" / "p"

# blueprint.zig: replace @cInclude("adwaita.h") version probe with hardcoded
bp = ROOT / "src/apprt/gtk/build/blueprint.zig"
if bp.exists():
    text = bp.read_text()
    text = re.sub(r"pub const c = @cImport\(\{[\s\S]*?\}\);\n", "", text, count=1)
    text = re.sub(
        r"const adwaita_version = std\.SemanticVersion\{\s*\.major = c\.ADW_MAJOR_VERSION,\s*\.minor = c\.ADW_MINOR_VERSION,\s*\.patch = c\.ADW_MICRO_VERSION,\s*\};",
        "const adwaita_version = std.SemanticVersion{ .major = 1, .minor = 5, .patch = 4 };",
        text,
    )
    bp.write_text(text)
    print("patched: blueprint.zig")

# SharedDeps.zig: drop libC + gtk4 + libadwaita-1 linkage from blueprint_exe
sd = ROOT / "src/build/SharedDeps.zig"
text = sd.read_text()
text = re.sub(
    r"\n        blueprint_exe\.linkLibC\(\);\n"
    r"        blueprint_exe\.linkSystemLibrary2\(\"gtk4\", dynamic_link_opts\);\n"
    r"        blueprint_exe\.linkSystemLibrary2\(\"libadwaita-1\", dynamic_link_opts\);\n",
    "\n",
    text,
    count=1,
)
sd.write_text(text)
print("patched: SharedDeps.zig (drop blueprint_exe gtk linkage)")

# Repoint b.graph.host to musl-static for native helpers in ghostty's build dir
musl = "b.resolveTargetQuery(.{ .cpu_arch = .aarch64, .os_tag = .linux, .abi = .musl })"
for rel in [
    "src/build/GhosttyDocs.zig",
    "src/build/GhosttyFrameData.zig",
    "src/build/GhosttyWebdata.zig",
    "src/build/HelpStrings.zig",
    "src/build/SharedDeps.zig",
    "src/build/UnicodeTables.zig",
]:
    p = ROOT / rel
    s = p.read_text()
    new = s.replace(".target = b.graph.host,", f".target = {musl},")
    if new != s:
        p.write_text(new)
        print(f"patched: {rel}")

# zg dep: replace b.graph.host with musl-static (zg has gbp/dwp helpers)
for zg in ZIG_CACHE.glob("zg-*"):
    bz = zg / "build.zig"
    if not bz.exists(): continue
    s = bz.read_text()
    new = s.replace(".target = b.graph.host,", f".target = {musl},")
    if new != s:
        bz.write_text(new)
        print(f"patched: {zg.name}/build.zig")

# libxev: Termux blocks io_uring_setup via seccomp → SIGSYS. Force epoll only.
for lx in ZIG_CACHE.glob("libxev-*"):
    bk = lx / "src" / "backend.zig"
    if not bk.exists(): continue
    s = bk.read_text()
    new = s.replace(".linux => .io_uring,", ".linux => .epoll,")
    new = new.replace(".linux => &.{ .io_uring, .epoll },", ".linux => &.{.epoll},")
    if new != s:
        bk.write_text(new)
        print(f"patched: {lx.name}/src/backend.zig")
PY

# ─── 13. Build Ghostty ──────────────────────────────────────────────────
log "Building Ghostty (this takes ~10-20 min on aarch64)"
cd "${GHOSTTY_DIR}"
rm -rf .zig-cache  # ensure libxev patch + zg patch get picked up
PKG_CONFIG="${LOCAL_BIN}/grun-pkgconf" \
PKG_CONFIG_PATH="${GLIBC_PREFIX}/lib/pkgconfig:${GLIBC_PREFIX}/share/pkgconfig" \
PATH="${LOCAL_BIN}:${PATH}" \
zig build install -p "${HOME_DIR}/.local" \
  -Dtarget=aarch64-linux-gnu."${GLIBC_TARGET_VERSION}" \
  -Doptimize=ReleaseFast \
  -Dgtk-wayland=false -Dgtk-x11=true \
  -fno-sys=gtk4-layer-shell \
  -Demit-docs=false -Demit-terminfo=false -Demit-termcap=false \
  -j2 --maxrss 1500000000 || warn "zig build returned nonzero (terminfo step is expected to fail; ghostty exe should still be present)"

[[ -x "${HOME_DIR}/.local/bin/ghostty" ]] || die "ghostty binary not produced"

# ─── 14. Install termux-x11 launcher ────────────────────────────────────
log "Installing ghostty-x11 launcher"
cat > "${LOCAL_BIN}/ghostty-x11" <<EOF
#!${PREFIX}/bin/env bash
# Launch ghostty under termux-x11 + glibc-runner.
# llvmpipe forced because termux-x11 has no DRI3 (zink crashes on swapchain).
exec env \\
  DISPLAY="\${DISPLAY:-:1}" \\
  GALLIUM_DRIVER=llvmpipe \\
  LIBGL_ALWAYS_SOFTWARE=1 \\
  MESA_LOADER_DRIVER_OVERRIDE=llvmpipe \\
  EGL_PLATFORM=surfaceless \\
  ${PREFIX}/bin/grun \\
  ${HOME_DIR}/.local/bin/ghostty "\$@"
EOF
chmod +x "${LOCAL_BIN}/ghostty-x11"

# ─── 15. Smoke test ─────────────────────────────────────────────────────
log "Smoke test: ghostty +version"
"${LOCAL_BIN}/ghostty-x11" +version || die "smoke test failed"

cat <<EOF

─────────────────────────────────────────────────────────────────
  Ghostty ${GHOSTTY_VERSION} installed.

  Launch (X11 GUI):    ghostty-x11
  Launch (CLI tool):   grun ~/.local/bin/ghostty +<action>

  Requires termux-x11 server running on :1.
─────────────────────────────────────────────────────────────────
EOF
