#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/focus.sh <workspace-name> [-h|--help]

Build a single workspace. TS project references pull in upstream
dependencies automatically.

Workspace name can be the directory basename (e.g. scraper-node)
or the npm name (e.g. @cmd-hub/core).
EOF
}

if [[ $# -eq 0 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    [[ $# -eq 0 ]] && exit 1 || exit 0
fi

TARGET="$1"

# Match by basename or npm name.
MATCH=""
while IFS= read -r ws; do
    [[ -z "$ws" ]] && continue
    base="$(basename "$ws")"
    name="$(pkg_name "$ws")"
    if [[ "$base" == "$TARGET" || "$name" == "$TARGET" ]]; then
        MATCH="$name"
        break
    fi
done < <(workspaces)

if [[ -z "$MATCH" ]]; then
    err "no workspace matches: $TARGET"
    log ""
    log "available workspaces:"
    while IFS= read -r ws; do
        [[ -z "$ws" ]] && continue
        printf '  %s  (%s)\n' "$(pkg_name "$ws")" "$(basename "$ws")"
    done < <(workspaces)
    exit 1
fi

header "focus $MATCH"
npm run build --workspace="$MATCH" || die "build failed for $MATCH"
ok "built $MATCH"
