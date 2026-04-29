#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/clean.sh [--all] [--lockfile] [-h|--help]

Remove build artifacts from every workspace.

Always removes (per workspace):  build/  tsconfig.tsbuildinfo  .jest-cache  coverage/

Options:
  --all        Also remove every workspace's node_modules/ and the root node_modules/.
  --lockfile   With --all, also remove the root package-lock.json (off by default).
  -h, --help   Show this help.
EOF
}

ALL=0
LOCKFILE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --all) ALL=1; shift ;;
        --lockfile) LOCKFILE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

remove() {
    local target="$1"
    if [[ -e "$target" || -L "$target" ]]; then
        rm -rf -- "$target"
        log "  removed ${target#"$(pwd)/"}"
    fi
}

header "clean"

while IFS= read -r ws; do
    [[ -z "$ws" ]] && continue
    remove "$ws/build"
    remove "$ws/tsconfig.tsbuildinfo"
    remove "$ws/.jest-cache"
    remove "$ws/coverage"
    if [[ "$ALL" -eq 1 ]]; then
        remove "$ws/node_modules"
    fi
done < <(workspaces)

if [[ "$ALL" -eq 1 ]]; then
    remove "$(pwd)/node_modules"
    if [[ "$LOCKFILE" -eq 1 ]]; then
        remove "$(pwd)/package-lock.json"
    fi
fi

ok "clean done"
