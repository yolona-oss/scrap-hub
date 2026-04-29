# Build/Clean/Test Scripts — Design

**Date:** 2026-04-29
**Scope:** Add Bash scripts at the repo root for `build`, `clean`, `test`, plus utility scripts (`status`, `doctor`, `focus`, `reset`). Mirror a smaller set in each `examples/*` workspace. Wire them into `package.json` scripts.

## Goals

- A single, consistent way to build, clean, and test the monorepo from the root.
- Per-example scripts so each example can be operated on in isolation.
- Useful day-to-day utilities (`status`, `doctor`, `focus`, `reset`) that pay off in a 10-workspace tree.
- Per-command files (Approach 2): each script is small, single-purpose, and independently invokable.

## Non-goals

- Replacing `tsc --build` ordering. TS project references already enforce build order; scripts call `npm run build` and let TS sort it out.
- Cross-platform support beyond Linux/macOS Bash. (No Windows / PowerShell variants.)
- A new test runner. `jest` stays where it is per package.

## Layout

```
scripts/
  lib/
    common.sh         # colors, log/warn/err, require_cmd, workspace helpers
  build.sh
  clean.sh
  test.sh
  status.sh
  doctor.sh
  focus.sh
  reset.sh
  mongo-init-rs.sh    # pre-existing; untouched

examples/ui-app/scripts/
  build.sh
  clean.sh
  test.sh

examples/scraper-node/scripts/
  build.sh
  clean.sh
  test.sh
```

Every script starts with `set -euo pipefail` and `IFS=$'\n\t'`. Root scripts source `scripts/lib/common.sh`. Example scripts are self-contained (no shared lib — they only need 3 commands and a few lines each).

## Conventions

- **Cwd-independent.** Each script resolves the repo root via `git rev-parse --show-toplevel`, then `cd`s there. Works from any subdir and from npm scripts.
- **Exit codes.** `0` success; `1` user/usage error (bad flag, unknown workspace); `2` environment error (missing tool); `3` command failure (build/test failed).
- **Color.** `lib/common.sh` writes color only when stdout is a TTY and `NO_COLOR` is unset.
- **Headers.** Every script prints a single `==> <name>` line at start.
- **Help.** Every script accepts `-h` / `--help` and prints a short usage block.
- **No emoji.**

## Root scripts

### `scripts/lib/common.sh`

Sourced helpers:

- `log "$@"`, `warn "$@"`, `err "$@"` — colored output, color-aware.
- `die "$@"` — `err` then `exit 3`.
- `require_cmd <name>` — verifies a command is on `PATH`; exits `2` with a message if not.
- `repo_root` — echoes `git rev-parse --show-toplevel`.
- `workspaces` — echoes the absolute path of every workspace dir, derived from the root `package.json` `workspaces` glob list.
- `has_script <dir> <name>` — true if `dir/package.json` declares a `scripts.<name>`.

### `scripts/build.sh`

- Default: `npm run build --workspaces --if-present`.
- `--workspace <name>`: forwards to `npm run build --workspace=<name>`.
- Fails with exit code `3` on any build failure.

### `scripts/clean.sh`

- For every workspace dir, removes: `build/`, `tsconfig.tsbuildinfo`, `.jest-cache`, `coverage/`.
- `--all`: also removes every workspace's `node_modules/` and the root `node_modules/`.
- `--lockfile`: also removes the root `package-lock.json` (only meaningful with `--all`; off by default — we don't churn the lockfile).
- Prints each path it removes.

### `scripts/test.sh`

- Default: sequential. Invokes `npm run test --workspaces --if-present`. Output is preserved as-is.
- `--parallel`: enumerates workspaces with a `test` script, runs them concurrently as background jobs with prefixed output (`[scraper-node] …`). `wait`s for all; exits non-zero if any failed.
- Trailing args after `--` forward to jest (e.g. `./scripts/test.sh -- --testNamePattern=foo`).

### `scripts/status.sh`

Prints a table, one row per workspace: name | has `build/`? | `tsconfig.tsbuildinfo` age (or `—`) | `node_modules/` present? | git dirty count for that subtree (`git status --porcelain -- <dir> | wc -l`). Followed by a one-line summary (`9 workspaces, 7 built, 2 dirty trees`). Always exits `0`.

### `scripts/doctor.sh`

Environment check. Each item prints OK / WARN / FAIL.

- `node --version` ≥ 20 (the version pinned by examples' `@types/node`).
- `npm --version` present.
- `bash --version` present.
- Optional: `docker`, `mongosh`, `protoc` (WARN if missing, not FAIL).
- `tsconfig.base.json` exists at repo root.
- Each workspace `package.json` parses (`node -e 'JSON.parse(...)'`).

Exits non-zero only on FAIL.

### `scripts/focus.sh`

`./scripts/focus.sh <workspace-name>`. Shells out to `npm run build --workspace=<name>`. TS project references pull in upstream deps automatically — we don't recompute the graph. On unknown name, lists valid workspace names and exits `1`.

### `scripts/reset.sh`

Pipeline: `scripts/clean.sh --all` → `npm install` → `scripts/build.sh`. Banner per phase. Bails on first failure.

## Example scripts

Each example gets the same trio. Self-contained Bash, no shared lib (3 short files per example).

### `examples/<name>/scripts/build.sh`

`tsc --build --pretty`. Identical to what is currently inline in each example's `package.json`.

### `examples/<name>/scripts/clean.sh`

`rm -rf build/ tsconfig.tsbuildinfo .jest-cache coverage`.

### `examples/<name>/scripts/test.sh`

If a `jest.config.*` exists or `package.json` has a `jest` field, run `npx jest "$@"`. Otherwise log `no tests configured` and exit `0`. This makes `ui-app` a no-op rather than a failure under `npm run test --workspaces --if-present`.

## `package.json` updates

### Root

```json
{
  "scripts": {
    "build": "bash scripts/build.sh",
    "build:sdk": "npm run build --workspace=@cmd-hub/core",
    "build:scraper": "npm run build --workspace=scraper-node --if-present",
    "build:app": "npm run build --workspace=ui-app",

    "clean": "bash scripts/clean.sh",
    "clean:all": "bash scripts/clean.sh --all",

    "test": "bash scripts/test.sh",
    "test:parallel": "bash scripts/test.sh --parallel",
    "test:e2e": "jest --config jest.config.e2e.js",

    "status": "bash scripts/status.sh",
    "doctor": "bash scripts/doctor.sh",
    "focus": "bash scripts/focus.sh",
    "reset": "bash scripts/reset.sh",

    "start": "npm run start:hub",
    "start:hub": "npm run start --workspace=ui-app -- ./config.json",
    "start:node": "npm run start --workspace=scraper-node -- ./config.json",
    "start:docker": "docker compose up --build",
    "stop:docker": "docker compose down"
  }
}
```

### Each example (`ui-app`, `scraper-node`)

```json
{
  "scripts": {
    "start:ts": "ts-node src/index.ts",
    "start": "node build/index.js",
    "build": "bash scripts/build.sh",
    "clean": "bash scripts/clean.sh",
    "rebuild": "npm run clean && npm run build",
    "test": "bash scripts/test.sh"
  }
}
```

## Risks and mitigations

- **`bash` not on `PATH` for some user.** Negligible on Linux/macOS. `doctor.sh` flags it.
- **`npm run focus -- foo` arg forwarding.** Documented in `--help`. Direct invocation `./scripts/focus.sh foo` is the simpler path.
- **Parallel test output interleaving.** Mitigated by per-line prefix and the fact that `--parallel` is opt-in.
- **`clean --all` accidentally nukes `node_modules`.** Explicit flag, prints what it removes; not the default.

## Validation

- `npm run build` builds the whole tree.
- `npm run clean && npm run build` succeeds.
- `npm run clean:all && npm install && npm run build` succeeds.
- `npm run test` matches today's behavior.
- `npm run test:parallel` succeeds and exits non-zero when one package fails.
- `npm run status` prints sensible output on a fresh clone and on a partially-built tree.
- `npm run doctor` passes on a working dev box.
- `npm run focus -- scraper-node` builds scraper-node and its deps only.
- `npm run reset` ends with a green build.
- Each example: `npm run -w ui-app build`, `clean`, `test`; same for `scraper-node`.
