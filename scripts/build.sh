#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/build.sh [--workspace <name>] [-h|--help]

Build all workspaces (default) or a single workspace.

Options:
  --workspace <name>   Build only the named workspace (e.g. scraper-node).
                       TS project references pull in upstream deps.
  -h, --help           Show this help.
EOF
}

WORKSPACE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --workspace) WORKSPACE="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

if [[ -n "$WORKSPACE" ]]; then
    header "build $WORKSPACE"
    npm run build --workspace="$WORKSPACE" || die "build failed for $WORKSPACE"
else
    header "build (all workspaces)"
    npm run build --workspaces --if-present || die "build failed"
fi
