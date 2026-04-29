#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$(repo_root)"

usage() {
    cat <<'EOF'
Usage: scripts/reset.sh [-h|--help]

Full reset: clean --all, npm install, build. Bails on first failure.
EOF
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }

header "reset: clean --all"
bash scripts/clean.sh --all

header "reset: npm install"
npm install

header "reset: build"
bash scripts/build.sh

ok "reset complete"
