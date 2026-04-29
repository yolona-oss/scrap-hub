#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
cd "$(dirname "${BASH_SOURCE[0]}")/.."
printf '==> clean ui-app\n'
rm -rf -- build tsconfig.tsbuildinfo .jest-cache coverage
echo "  removed build artifacts"
