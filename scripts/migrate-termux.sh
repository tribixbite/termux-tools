#!/data/data/com.termux/files/usr/bin/bash
# migrate-termux.sh — clone a Termux install to another device.
#
# backup    : termux-backup of $PREFIX + selective tar of $HOME + git-repo manifest.
# restore   : reverse, then re-clone git repos and refresh pacman.
# --dry     : backup → print sizes only; restore → list actions only.
#
# Excludes (HOME tar): ~/git, ~/.cache, ~/storage, install caches
# (bun/cargo/go/npm), rustup downloads/tmp, and any node_modules / target
# / dist / build directory under any project.

set -euo pipefail

# ---------- constants ----------------------------------------------------------

readonly TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
readonly PREFIX_DIR="/data/data/com.termux/files/usr"
readonly HOME_DIR="/data/data/com.termux/files/home"
readonly TERMUX_ROOT="/data/data/com.termux/files"  # parent of ./home and ./usr
readonly DEFAULT_OUTPUT_PRIMARY="$HOME/storage/shared/Download"
readonly DEFAULT_OUTPUT_FALLBACK="$HOME"
readonly DEFAULT_REPO_COUNT=20

# Excludes are relative to TERMUX_ROOT so the same array works for both
# `tar -C $TERMUX_ROOT ./home` (backup) and `du -C $TERMUX_ROOT ./home` (--dry).
readonly HOME_EXCLUDES=(
  --exclude='./home/git'
  --exclude='./home/.cache'
  --exclude='./home/.bun/install/cache'
  --exclude='./home/.cargo/registry/cache'
  --exclude='./home/.cargo/registry/src'
  --exclude='./home/.cargo/git'
  --exclude='./home/.rustup/downloads'
  --exclude='./home/.rustup/tmp'
  --exclude='./home/go/pkg/mod/cache/download'
  --exclude='./home/.npm/_cacache'
  --exclude='./home/storage'
  --exclude='*/node_modules'
  --exclude='*/target'
  --exclude='*/dist'
  --exclude='*/build'
)

# ANSI colors — 8-color set, safe in any terminal, looks fine in dark mode.
readonly C_RED=$'\033[31m'
readonly C_GRN=$'\033[32m'
readonly C_YEL=$'\033[33m'
readonly C_CYN=$'\033[36m'
readonly C_DIM=$'\033[2m'
readonly C_RST=$'\033[0m'

# ---------- logging helpers ---------------------------------------------------

msg()  { printf '%s\n' "$*" >&2; }
info() { msg "${C_CYN}>${C_RST} $*"; }
ok()   { msg "${C_GRN}+${C_RST} $*"; }
warn() { msg "${C_YEL}!${C_RST} $*"; }
err()  { msg "${C_RED}-${C_RST} $*"; }

# ---------- usage -------------------------------------------------------------

usage() {
  cat >&2 <<EOF
${C_CYN}migrate-termux.sh${C_RST} — clone Termux to another device

${C_YEL}USAGE${C_RST}
  $0 backup  [--dry] [-o DIR]
  $0 restore [--dry] [-i DIR] [--repos FILE]
  $0 -h | --help

${C_YEL}COMMANDS${C_RST}
  backup    Tar \$PREFIX (via termux-backup) + \$HOME (with excludes)
            + manifest of top $DEFAULT_REPO_COUNT recently-modified ~/git repos.
  restore   Reverse of backup. WIPES & restores \$PREFIX, extracts \$HOME,
            refreshes pacman, re-clones git repos from manifest.

${C_YEL}OPTIONS${C_RST}
  --dry         backup:  estimate sizes, no archives written
                restore: list actions, no extraction or clones
  -o, --output  output dir (default: ${DEFAULT_OUTPUT_PRIMARY} if it exists, else \$HOME)
  -i, --input   input dir (default: same as -o default)
  --repos FILE  custom repo manifest (format: name|branch|remote_url)

${C_YEL}HOME EXCLUDES${C_RST}
  ~/git, ~/.cache, ~/storage, install caches (bun/cargo/go/npm),
  rustup downloads/tmp, and all node_modules / target / dist / build dirs.

${C_YEL}NOTES${C_RST}
  - aarch64 Termux only; same-source APK required on both devices.
  - termux-restore WIPES \$PREFIX before extracting (5s grace period).
  - Companion APKs (Termux:API, :Boot, :Widget), ADB pairing, Doze whitelist,
    and accessibility perms are per-device and must be re-granted manually.
EOF
}

# ---------- helpers -----------------------------------------------------------

# Pick the default IO dir: prefer shared Download (survives Termux reinstall).
default_io_dir() {
  if [ -d "$DEFAULT_OUTPUT_PRIMARY" ]; then
    printf '%s\n' "$DEFAULT_OUTPUT_PRIMARY"
  else
    printf '%s\n' "$DEFAULT_OUTPUT_FALLBACK"
  fi
}

# Emit `name|branch|remote_url` for the N most recently modified ~/git/* repos.
# Repos without an origin remote are skipped (manifest is for cloning).
list_repos() {
  local n="${1:-$DEFAULT_REPO_COUNT}"
  [ -d "$HOME/git" ] || return 0
  (
    cd "$HOME/git"
    for d in */; do
      d="${d%/}"
      [ -d "$d/.git" ] || continue
      local mtime remote branch
      mtime=$(stat -c %Y "$d" 2>/dev/null || echo 0)
      remote=$(git -C "$d" config --get remote.origin.url 2>/dev/null || true)
      branch=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
      [ -n "$remote" ] && printf '%s|%s|%s|%s\n' "$mtime" "$d" "$branch" "$remote"
    done | sort -rn | head -"$n" | awk -F'|' 'BEGIN{OFS="|"} {print $2,$3,$4}'
  )
}

# Human-readable size of a directory tree from TERMUX_ROOT, applying the same
# excludes used by tar. du and tar both accept --exclude with fnmatch globs,
# so HOME_EXCLUDES drops in directly.
estimate_home() {
  ( cd "$TERMUX_ROOT" \
      && du -shx --apparent-size "${HOME_EXCLUDES[@]}" ./home 2>/dev/null \
      | awk '{print $1}' )
}

estimate_prefix() {
  du -shx --apparent-size "$PREFIX_DIR" 2>/dev/null | awk '{print $1}'
}

# Largest contributors to the HOME archive, post-exclusion. Useful in --dry to
# spot anything you forgot to exclude (e.g. a 5GB downloaded model).
top_home_dirs() {
  ( cd "$TERMUX_ROOT" \
      && du -hx --apparent-size --max-depth=2 "${HOME_EXCLUDES[@]}" ./home 2>/dev/null \
      | sort -rh | head -10 )
}

# Quiesce operad's daemon so its state files (state.json, trace.log,
# registry.json) don't churn during the backup. Best-effort, never fatal.
#
# Notes:
#  - Plain `tmx shutdown` detaches cleanly and leaves user tmux sessions alive
#    (per CLAUDE.md). `--kill` would also tear down user sessions, which is
#    too aggressive for a backup.
#  - The operad watchdog will respawn the daemon within seconds, so this just
#    buys a brief quiet window. That's enough for tar to skip stale opens.
#  - We do NOT kill sshd — if the backup is invoked over ssh, that would sever
#    the running session, and sshd doesn't hold $HOME files we care about.
stop_daemons() {
  if command -v tmx >/dev/null 2>&1; then
    info "quiescing operad daemon (tmx shutdown)"
    tmx shutdown 2>/dev/null || true
  fi
}

# ---------- backup ------------------------------------------------------------

cmd_backup() {
  local out="${OUTPUT_DIR:-$(default_io_dir)}"
  mkdir -p "$out"

  local prefix_tar="$out/termux-prefix-$TIMESTAMP.tar.gz"
  local home_tar="$out/termux-home-$TIMESTAMP.tar.gz"
  local repos_txt="$out/termux-repos-$TIMESTAMP.txt"

  if [ "$DRY" -eq 1 ]; then
    info "DRY RUN — calculating sizes only (no archives written)"
    info "output dir would be: $out"

    info "PREFIX uncompressed: $(estimate_prefix)"
    info "HOME   uncompressed (after excludes): $(estimate_home)"

    msg ""
    info "top contributors to HOME archive:"
    top_home_dirs | awk '{print "  " $0}'

    msg ""
    info "git-repo manifest preview ($DEFAULT_REPO_COUNT most-recent):"
    list_repos | awk -F'|' '{printf "  %-30s [%s]  %s\n", $1, $2, $3}'

    msg ""
    info "${C_DIM}note: gzip typically gives ~50-70% reduction on these trees.${C_RST}"
    return 0
  fi

  stop_daemons

  info "writing repo manifest -> $repos_txt"
  list_repos > "$repos_txt"
  ok "captured $(wc -l < "$repos_txt") repo(s)"

  info "backing up \$PREFIX -> $prefix_tar"
  termux-backup -f "$prefix_tar"
  ok "PREFIX archive: $(du -h "$prefix_tar" | awk '{print $1}')"

  info "backing up \$HOME -> $home_tar"
  tar --warning=no-file-changed --warning=no-file-ignored \
      "${HOME_EXCLUDES[@]}" \
      -czf "$home_tar" \
      -C "$TERMUX_ROOT" ./home
  ok "HOME archive: $(du -h "$home_tar" | awk '{print $1}')"

  msg ""
  info "artifacts:"
  ls -lh "$prefix_tar" "$home_tar" "$repos_txt" 2>/dev/null \
    | awk '{printf "  %s  %s\n", $5, $NF}'
  msg ""
  ok "backup complete. transfer all three files to the new device."
}

# ---------- restore -----------------------------------------------------------

# Pick the most recent matching artifact in the input dir.
latest() {
  local pattern="$1"
  ls -1t $pattern 2>/dev/null | head -1 || true
}

cmd_restore() {
  local in="${INPUT_DIR:-$(default_io_dir)}"

  local prefix_tar home_tar repos_txt
  prefix_tar=$(latest "$in/termux-prefix-*.tar.gz")
  home_tar=$(latest "$in/termux-home-*.tar.gz")
  repos_txt="${REPOS_FILE:-$(latest "$in/termux-repos-*.txt")}"

  [ -f "$prefix_tar" ] || { err "no termux-prefix-*.tar.gz in $in"; exit 1; }
  [ -f "$home_tar" ]   || { err "no termux-home-*.tar.gz in $in"; exit 1; }

  info "restore plan:"
  info "  PREFIX  $prefix_tar  ($(du -h "$prefix_tar" | awk '{print $1}'))"
  info "  HOME    $home_tar  ($(du -h "$home_tar" | awk '{print $1}'))"
  if [ -n "$repos_txt" ] && [ -f "$repos_txt" ]; then
    info "  REPOS   $repos_txt  ($(wc -l < "$repos_txt") entries)"
  else
    warn "  REPOS   none — git repos will not be re-cloned"
  fi

  if [ "$DRY" -eq 1 ]; then
    msg ""
    info "DRY RUN — no extraction, no clones"
    if [ -n "$repos_txt" ] && [ -f "$repos_txt" ]; then
      info "would clone:"
      awk -F'|' '{printf "  %-30s [%s]  %s\n", $1, $2, $3}' "$repos_txt"
    fi
    return 0
  fi

  # arch sanity — refuse to restore an aarch64 image onto a different ABI.
  local arch; arch=$(uname -m)
  if [ "$arch" != "aarch64" ]; then
    err "expected aarch64, got $arch — aborting"
    exit 1
  fi

  warn "termux-restore will WIPE \$PREFIX before extraction."
  warn "press Ctrl-C in 5 seconds to abort..."
  sleep 5

  info "restoring \$PREFIX (this can take a few minutes)..."
  termux-restore "$prefix_tar"
  ok "PREFIX restored"

  info "extracting \$HOME..."
  tar -xzf "$home_tar" -C "$TERMUX_ROOT"
  ok "HOME extracted"

  info "refreshing pacman repo metadata..."
  if command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm 2>/dev/null \
      || warn "pacman -Sy failed; run 'pkg update' manually"
  else
    pkg update -y 2>/dev/null || warn "pkg update failed; run manually"
  fi

  info "requesting storage permission (UI prompt may appear)..."
  termux-setup-storage 2>/dev/null \
    || warn "termux-setup-storage failed; run manually after the script exits"

  if [ -n "$repos_txt" ] && [ -f "$repos_txt" ]; then
    info "cloning git repos to ~/git..."
    mkdir -p "$HOME/git"
    local cloned=0 skipped=0 failed=0
    while IFS='|' read -r name branch remote; do
      [ -z "${name:-}" ] && continue
      [ -z "${remote:-}" ] && { warn "  skip $name (no remote)"; ((skipped++)) || true; continue; }
      if [ -d "$HOME/git/$name" ]; then
        info "  exists: $name"
        ((skipped++)) || true
      else
        info "  clone : $name [$branch]"
        if git -C "$HOME/git" clone --branch "$branch" "$remote" "$name" >/dev/null 2>&1; then
          ok "    cloned $name"
          ((cloned++)) || true
        else
          # retry without explicit branch in case the branch name drifted
          if git -C "$HOME/git" clone "$remote" "$name" >/dev/null 2>&1; then
            warn "    cloned $name (default branch — '$branch' not found)"
            ((cloned++)) || true
          else
            err "    failed: $name"
            ((failed++)) || true
          fi
        fi
      fi
    done < "$repos_txt"
    ok "repos: $cloned cloned, $skipped skipped, $failed failed"
  fi

  cat >&2 <<EOF

${C_GRN}=== Restore complete ===${C_RST}

Manual follow-ups (per-device, can't be carried over in archives):
  1. Companion APKs: Termux:API, Termux:Boot, Termux:Widget
  2. ADB pairing / wireless debugging — re-pair on this device
  3. Doze whitelist + phantom-killer protections
       (operad's tmx applies these on boot; or run by hand from CLAUDE.md notes)
  4. Accessibility / notification listener perms (per-app)
  5. Battery-optimization exclusion for Termux & Termux:API

Verify:
  pacman -Q | wc -l    # installed package count vs source device
  bun --version
  go version
  cargo --version
  ls ~/git             # cloned repos
EOF
}

# ---------- arg parsing -------------------------------------------------------

CMD=""
DRY=0
OUTPUT_DIR=""
INPUT_DIR=""
REPOS_FILE=""

parse_args() {
  CMD="${1:-}"
  if [ -z "$CMD" ]; then usage; exit 2; fi
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry|--dry-run) DRY=1 ;;
      -o|--output)
        [ $# -ge 2 ] || { err "$1 requires an argument"; exit 2; }
        OUTPUT_DIR="$2"; shift ;;
      -i|--input)
        [ $# -ge 2 ] || { err "$1 requires an argument"; exit 2; }
        INPUT_DIR="$2"; shift ;;
      --repos)
        [ $# -ge 2 ] || { err "$1 requires an argument"; exit 2; }
        REPOS_FILE="$2"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) err "unknown argument: $1"; usage; exit 2 ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"
  case "$CMD" in
    backup)        cmd_backup ;;
    restore)       cmd_restore ;;
    -h|--help|help) usage ;;
    *) err "unknown command: $CMD"; usage; exit 2 ;;
  esac
}

main "$@"
