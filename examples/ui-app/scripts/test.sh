#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
cd "$(dirname "${BASH_SOURCE[0]}")/.."
printf '==> test ui-app\n'

has_jest=0
for f in jest.config.js jest.config.ts jest.config.cjs jest.config.mjs jest.config.json; do
    [[ -f "$f" ]] && has_jest=1 && break
done
if [[ "$has_jest" -eq 0 ]]; then
    if node -e 'process.exit(require("./package.json").jest ? 0 : 1)' 2>/dev/null; then
        has_jest=1
    fi
fi

if [[ "$has_jest" -eq 0 ]]; then
    echo "  no tests configured"
    exit 0
fi
exec npx jest "$@"
