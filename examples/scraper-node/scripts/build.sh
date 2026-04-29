#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
cd "$(dirname "${BASH_SOURCE[0]}")/.."
printf '==> build scraper-node\n'
exec tsc --build --pretty
