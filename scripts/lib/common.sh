#!/usr/bin/env bash
# Shared helpers for scrap-hub root scripts.
# Source from a script: source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    _C_RESET=$'\033[0m'
    _C_DIM=$'\033[2m'
    _C_RED=$'\033[31m'
    _C_GREEN=$'\033[32m'
    _C_YELLOW=$'\033[33m'
    _C_BLUE=$'\033[34m'
    _C_BOLD=$'\033[1m'
else
    _C_RESET=""; _C_DIM=""; _C_RED=""; _C_GREEN=""; _C_YELLOW=""; _C_BLUE=""; _C_BOLD=""
fi

header() { printf '%s==> %s%s\n' "${_C_BOLD}${_C_BLUE}" "$*" "${_C_RESET}"; }
log()    { printf '%s\n' "$*"; }
ok()     { printf '%s  OK%s   %s\n' "${_C_GREEN}" "${_C_RESET}" "$*"; }
warn()   { printf '%s  WARN%s %s\n' "${_C_YELLOW}" "${_C_RESET}" "$*" >&2; }
err()    { printf '%s  FAIL%s %s\n' "${_C_RED}" "${_C_RESET}" "$*" >&2; }
die()    { err "$*"; exit 3; }

require_cmd() {
    local name="$1"
    if ! command -v "$name" >/dev/null 2>&1; then
        err "required command not found: $name"
        exit 2
    fi
}

repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || {
        err "not inside a git repository"
        exit 2
    }
}

# Echo every workspace dir (absolute path, one per line).
# Reads the root package.json `workspaces` array and expands globs.
workspaces() {
    local root
    root="$(repo_root)"
    local globs
    globs=$(node -e '
        const pkg = require(process.argv[1]);
        for (const g of (pkg.workspaces || [])) console.log(g);
    ' "$root/package.json")
    local g abs
    while IFS= read -r g; do
        [[ -z "$g" ]] && continue
        for abs in "$root"/$g; do
            [[ -d "$abs" && -f "$abs/package.json" ]] && printf '%s\n' "$abs"
        done
    done <<< "$globs"
}

# True if the package.json in <dir> declares a script named <name>.
has_script() {
    local dir="$1" name="$2"
    local pkg="$dir/package.json"
    [[ -f "$pkg" ]] || return 1
    node -e '
        const pkg = require(process.argv[1]);
        process.exit(pkg.scripts && pkg.scripts[process.argv[2]] ? 0 : 1);
    ' "$pkg" "$name" 2>/dev/null
}

# Echo the "name" field of <dir>/package.json.
pkg_name() {
    local dir="$1"
    node -e '
        const pkg = require(process.argv[1]);
        console.log(pkg.name || "");
    ' "$dir/package.json" 2>/dev/null
}
