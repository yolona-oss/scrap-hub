#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/test.sh [--parallel] [-h|--help] [-- <jest args>]

Run the `test` script in every workspace that defines one.

Options:
  --parallel   Run workspace test scripts concurrently with prefixed output.
               Default is sequential.
  -h, --help   Show this help.

Anything after `--` is forwarded to jest in each workspace.
EOF
}

PARALLEL=0
JEST_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --parallel) PARALLEL=1; shift ;;
        -h|--help) usage; exit 0 ;;
        --) shift; JEST_ARGS=("$@"); break ;;
        *) err "unknown argument: $1"; usage >&2; exit 1 ;;
    esac
done

if [[ "$PARALLEL" -eq 0 ]]; then
    header "test (sequential)"
    if [[ ${#JEST_ARGS[@]} -gt 0 ]]; then
        npm run test --workspaces --if-present -- "${JEST_ARGS[@]}"
    else
        npm run test --workspaces --if-present
    fi
    exit 0
fi

header "test (parallel)"
declare -a PIDS NAMES
FAIL=0

while IFS= read -r ws; do
    [[ -z "$ws" ]] && continue
    has_script "$ws" test || continue
    name="$(pkg_name "$ws")"
    name="${name:-$(basename "$ws")}"
    (
        cd "$ws"
        if [[ ${#JEST_ARGS[@]} -gt 0 ]]; then
            npm test --silent -- "${JEST_ARGS[@]}" 2>&1
        else
            npm test --silent 2>&1
        fi
    ) | sed -u "s/^/[$name] /" &
    PIDS+=($!)
    NAMES+=("$name")
done < <(workspaces)

for i in "${!PIDS[@]}"; do
    if ! wait "${PIDS[$i]}"; then
        err "tests failed: ${NAMES[$i]}"
        FAIL=1
    fi
done

if [[ "$FAIL" -ne 0 ]]; then
    exit 3
fi
ok "all tests passed"
