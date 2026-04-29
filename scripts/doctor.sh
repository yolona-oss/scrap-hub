#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/doctor.sh [-h|--help]

Check the development environment: required tools, versions, optional
tools, repo invariants. Exits non-zero only if a required check fails.
EOF
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

header "doctor"

FAIL=0
MIN_NODE_MAJOR=20

check_required() {
    local cmd="$1" label="$2"
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$label: $($cmd --version 2>&1 | head -n1)"
    else
        err "$label: not found"
        FAIL=1
    fi
}

check_optional() {
    local cmd="$1" label="$2"
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$label: $($cmd --version 2>&1 | head -n1)"
    else
        warn "$label: not found (optional)"
    fi
}

# Required tools
if command -v node >/dev/null 2>&1; then
    NODE_VER="$(node --version)"
    NODE_MAJOR="${NODE_VER#v}"
    NODE_MAJOR="${NODE_MAJOR%%.*}"
    if (( NODE_MAJOR >= MIN_NODE_MAJOR )); then
        ok "node: $NODE_VER"
    else
        err "node: $NODE_VER (need >= $MIN_NODE_MAJOR)"
        FAIL=1
    fi
else
    err "node: not found"
    FAIL=1
fi

check_required npm "npm"
check_required bash "bash"
check_required git "git"

# Optional tools
check_optional docker "docker"
check_optional mongosh "mongosh"
check_optional protoc "protoc"

# Repo invariants
if [[ -f "tsconfig.base.json" ]]; then
    ok "tsconfig.base.json exists"
else
    err "tsconfig.base.json missing"
    FAIL=1
fi

WS_BAD=0
while IFS= read -r ws; do
    [[ -z "$ws" ]] && continue
    if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$ws/package.json" 2>/dev/null; then
        err "invalid package.json: ${ws#"$(pwd)/"}"
        WS_BAD=$(( WS_BAD + 1 ))
        FAIL=1
    fi
done < <(workspaces)
if [[ "$WS_BAD" -eq 0 ]]; then
    ok "all workspace package.json files parse"
fi

if [[ "$FAIL" -ne 0 ]]; then
    exit 2
fi
