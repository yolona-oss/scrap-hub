#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/status.sh [-h|--help]

Print a per-workspace snapshot: build/ present, tsbuildinfo age,
node_modules/ present, dirty git files in that subtree.
EOF
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

header "status"

ROOT="$(pwd)"
TOTAL=0
BUILT=0
DIRTY_TREES=0

printf '%-40s  %-6s  %-12s  %-7s  %s\n' "WORKSPACE" "BUILT" "TSBUILDINFO" "NODE_MOD" "DIRTY"
printf '%-40s  %-6s  %-12s  %-7s  %s\n' "----------------------------------------" "------" "------------" "-------" "-----"

human_age() {
    local f="$1"
    [[ -f "$f" ]] || { printf -- '—'; return; }
    local mtime now diff
    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")
    now=$(date +%s)
    diff=$(( now - mtime ))
    if   (( diff < 60 ));    then printf '%ds' "$diff"
    elif (( diff < 3600 ));  then printf '%dm' "$(( diff / 60 ))"
    elif (( diff < 86400 )); then printf '%dh' "$(( diff / 3600 ))"
    else                          printf '%dd' "$(( diff / 86400 ))"
    fi
}

while IFS= read -r ws; do
    [[ -z "$ws" ]] && continue
    TOTAL=$(( TOTAL + 1 ))
    rel="${ws#"$ROOT/"}"
    name="$(pkg_name "$ws")"
    name="${name:-$rel}"

    built="no"
    if [[ -d "$ws/build" ]]; then built="yes"; BUILT=$(( BUILT + 1 )); fi

    tsage=$(human_age "$ws/tsconfig.tsbuildinfo")

    nm="no"
    [[ -d "$ws/node_modules" ]] && nm="yes"

    dirty=$(git status --porcelain -- "$ws" 2>/dev/null | wc -l | awk '{print $1}')
    if [[ "$dirty" -gt 0 ]]; then DIRTY_TREES=$(( DIRTY_TREES + 1 )); fi

    printf '%-40s  %-6s  %-12s  %-7s  %s\n' "$name" "$built" "$tsage" "$nm" "$dirty"
done < <(workspaces)

printf '\n%s%d workspaces, %d built, %d dirty trees%s\n' \
    "${_C_DIM}" "$TOTAL" "$BUILT" "$DIRTY_TREES" "${_C_RESET}"
