# Flat build UI: hide `args` / `intercom` slices from the user

**Date:** 2026-04-29
**Status:** approved (ready for implementation plan)

## Problem

Two UX defects in the command builder, both rooted in the same cause: the
`args` / `intercom` slice scaffolding leaks into the user-facing tree.

### Defect 1 — `--config` ceremony

A user invoked the scraper with:

```
/scraper "Адвокат" --city "Санкт-Петербург" --limit 1000 --sources ai-agent \
                   --format csv --requestDelayMs 1000 \
                   --config --aiAgent --model qwen3.5:9b ...
```

`--config` is not a tree node. The parser silently ignores it (a no-op
fallthrough — see `parser.ts:225-248`). The user typed it because the
mental model was "drop into a config bucket" — a verb the framework no
longer has. The actual descent into `args/aiAgent/...` happens via
`findInRootSlices` (`parser.ts:255-264`), which auto-descends through
`args/` when the user names one of its direct children. So
`--aiAgent --baseUrl X` already works *without* `--config`, but:

- the user has no signal that `--config` is meaningless,
- typing `--baseUrl` directly at root *does not* work, because
  `findInRootSlices` only looks one level deep — `baseUrl` is at
  `args/aiAgent/baseUrl`.

### Defect 2 — `intercom` button visible during build

`desc-compiler.ts:65-74` wraps the service tree as
`argBranch({ args, intercom })`. While building an inactive service, the
markuper renders both `args →` and `intercom →` buttons at root. The
user has to know to click `args →` first. `intercom` is for *runtime*
control of an *active* service (pause/resume/stop/export); exposing it
during build is wrong.

### Why these are one problem

Both defects come from the user being asked to navigate the slice
structure that the framework uses internally to separate build-time
arguments from runtime control. Slice scaffolding is a transport /
routing concern (the wire prefixes `args/` and `intercom/` survive
version skew between hub and node — see `cmd-node-app.ts:341`); it has
no business showing up in the build UI.

## Design

Hide the slice wrapper from the user. Build-time UI shows only the args
tree as root; runtime UI shows only the intercom tree as root. Slice
prefixes survive on the wire unchanged.

Three changes, in order:

### 1. Compile slice as root, not as a child (desc-compiler.ts)

`buildServiceOptions` currently:

```typescript
const isActive = dispatcher.isServiceActive(userId, service.name)
const args = isActive ? argBranch({}) : service.argsTree()
const intercom = service.intercomTree()
return argBranch({ args, intercom })
```

Becomes:

```typescript
const isActive = dispatcher.isServiceActive(userId, service.name)
return isActive ? service.intercomTree() : service.argsTree()
```

The descriptor must carry the active slice name (`'args'` or
`'intercom'`) so downstream layers know which prefix to attach at the
wire boundary. Add a `slice` field to whatever the descriptor compiler
returns (today: `{ tree: ArgTree }`); becomes `{ tree, slice }` for
service descriptors. One-shot descriptors keep `slice: undefined` —
their leaves are bare on the wire as today.

### 2. Slice-prefix at the parser → wire boundary (parser.ts: `effectiveValues`)

The parser stores values keyed by the path *within the tree it was
given*. With the wrapper gone, those paths are now bare — `query`,
`aiAgent/baseUrl`, `pause`. The wire (`unflattenArgs` on the node side,
`sliceArgsByPrefix` in `cmd-node-app.ts:341`) still expects
`args/query`, `args/aiAgent/baseUrl`, `intercom/pause`.

`effectiveValues()` (`parser.ts:424-438`) already does a small
transformation pass: filters `args/now`, applies saved-source
fallbacks. Extend it to prepend `${slice}/` to every key when the
descriptor carries a `slice`. The slice is read from the parser's
configured descriptor (passed in via `CBParserConfig`).

The result: parser internals are slice-unaware; the boundary that
emits to the wire (`EvaluationResult` / dispatcher) sees keys in the
old `args/...` / `intercom/...` shape; transport, storage, and node-side
code are untouched.

The `args/now` filter (which protects `now` from riding the wire) keeps
working — `now` is bare in the new internal model, so the filter
becomes a check for the bare key `'now'` instead of `'args/now'`.

### 3. Hybrid deep search at root (parser.ts: replace `findInRootSlices`)

`findInRootSlices` currently looks one level into the `args` / `intercom`
slices. Without those slices in the tree, the function loses its job.
Replace with `findInTree`, used at root only:

- Exact child of the current branch wins (existing behavior at any
  branch level — unchanged).
- At root only, when no exact child matches, walk the entire tree for
  nodes named `<name>`. If exactly one match exists:
  - push every branch on the path between root and the match into
    `_path`, in order;
  - re-resolve the original token against the now-current branch (which
    is the parent of the match), so the leaf-vs-branch routing in
    `handleNavigationToken` runs once at the destination.
- Zero matches or 2+ matches → return `null`, falling through to the
  existing "unknown / positional auto-bind" path. The user gets the
  same "no matching child" treatment they'd get for any unknown token.

This makes `--baseUrl` at root resolve to `aiAgent/baseUrl`,
`--credentials` to `googleSheets/credentials`, etc. — *as long as the
name is unique in the tree*. Future name collisions fail closed: the
user has to drill (`--aiAgent --baseUrl ...`).

The match walk is bounded by tree size; for a tree the size of
ScraperArgs (single-digit branches, ~15 leaves total) the cost is
negligible per token. No memoization needed.

### What disappears

- `--config` is a token that doesn't name a tree node. With the
  slice wrapper gone, *no* token names a slice either. The parser's
  existing "unknown token at root" fallback (positional auto-bind, then
  `'none'`) handles it. There is no `--config` keyword to remove
  because the framework never had one — it was a no-op all along.
  Hard cutover: no special-case handling, no warning. If a user types
  `--config`, the parser tries it as a child (no match), then as a
  positional candidate (no positional left because `query` is already
  bound), then drops it as `'none'`. Same path as any typo.

- `--args` at root: same treatment. Without the wrapper there's no
  `args` child to descend into. Token is unrecognized, positional
  fallback fails (or auto-binds if there's an unfilled positional —
  unlikely but consistent), then `'none'`.

### What stays

- Wire format: `args/...` and `intercom/...` keys ride over gRPC
  exactly as today. `cmd-node-app.ts:341`'s `sliceArgsByPrefix` and
  `unflattenArgs` are unmodified.
- Storage: `MongoServiceStore`'s `data.args` / `data.state` schema is
  unaffected. The 2026-04-23 `data.config → data.args` migration
  (commit `23a877c`) keeps working.
- Per-leaf semantics: `persistent`, `position`, `standalone`,
  `validator` all continue to apply leaf-by-leaf.
- The `assertIntercomFlat` invariant (intercom roots have only leaf
  children) — still enforced at decoration time
  (`service-decorator.ts:31-43`).
- Built-in commands and one-shots: descriptor compiler returns
  `{ tree: argsTree, slice: undefined }`; their values stay bare on the
  wire as today.

## Components affected

| File | Change |
|---|---|
| `packages/core/src/ui/command-processor/builder/desc-compiler.ts` | `buildServiceOptions` returns the slice-tree as-is; descriptor return type carries `slice: 'args' \| 'intercom' \| undefined`. |
| `packages/core/src/ui/command-processor/builder/interpreter/parser.ts` | Replace `findInRootSlices` with `findInTree` (deep, at-root-only, ambiguity → null). Read `slice` from descriptor; in `effectiveValues`, prepend `${slice}/` when set; rename internal `'args/now'` filter to bare `'now'`. |
| Descriptor type (`IUICommandDescriptor` or local interface) | Add `slice?: 'args' \| 'intercom'`. |
| `packages/core/src/ui/command-processor/builder/builder-markuper.ts` | No code change required if descriptor changes are transparent — the markuper reads from `parser.Tree` and `parser.Path`. Confirm via test that no path text or button assumes `args/` / `intercom/` is the first segment. |
| `packages/core/src/__tests__/interpreter.test.ts` | Test at lines 336-348 builds a non-flat intercom (descends `intercom → aiAgent → model`). Migrate to the new root model: either rebuild the test with a top-level branch tree directly (no slice wrapping), or use args-slice descent only. Real intercom shapes are flat per `assertIntercomFlat`. |
| `packages/core/src/__tests__/markuper-pair-tree.test.ts` | Audit any test that builds `argBranch({ args, intercom })` for the wrapped shape; update to the new root model. |
| `packages/core/src/ui/command-processor/builder/__tests__/desc-compiler-remote.test.ts` | One-shot descriptors are unchanged; service descriptors get a new test asserting `slice` is set. |

## Test plan

New tests:

1. `desc-compiler.test` — inactive service: descriptor's tree equals
   `service.argsTree()` exactly; `slice === 'args'`. Active service:
   tree equals `service.intercomTree()`; `slice === 'intercom'`.
   One-shot: `slice === undefined`.

2. `parser.test`:
   - **deep search, unique leaf**: tree
     `argBranch({ aiAgent: argBranch({ baseUrl: argLeaf() }) })`.
     `--baseUrl` at root commits to path `aiAgent/baseUrl`.
   - **deep search, ambiguous**: tree with `aiAgent.timeout` and
     `googleSheets.timeout`. `--timeout` returns `'none'`; user must
     drill.
   - **deep search only at root**: drill to `aiAgent`, then `--baseUrl`
     resolves to `aiAgent/baseUrl` via the existing immediate-child
     match (no whole-tree walk needed once mid-branch).
   - **no slice descent without slice wrapper**: tree has no `args` or
     `intercom` child; `--args` returns `'none'`. `--config` returns
     `'none'`.

3. `parser.test` — `effectiveValues` slice prefix:
   - Descriptor carries `slice: 'args'`; parser commits internal key
     `aiAgent/baseUrl`; `effectiveValues()` returns `args/aiAgent/baseUrl`.
   - Descriptor carries `slice: undefined`; same internal key emits
     bare on the wire (`aiAgent/baseUrl`). One-shot path.
   - Existing `args/now` filter preserved as `now` filter (no `args/`
     prefix internally any more).

4. End-to-end golden: build a service command with the new flat syntax
   (`/scraper Адвокат --baseUrl http://...`); assert the dispatched
   wire-args map contains `args/aiAgent/baseUrl` correctly. Use
   the existing E2E harness if practical; otherwise an integration test
   inside `packages/core`.

Existing tests to migrate:

5. `interpreter.test.ts:336-348` — re-shape the test fixture so the
   tree under test mirrors the new model (no `intercom`-rooted branch
   wrapping nested branches; intercom is flat in production).

Existing tests that should stay green untouched:

6. All node-side tests around `unflattenArgs`, `sliceArgsByPrefix`,
   `validate-args`. Wire format is unchanged.
7. `MongoServiceStore` tests; `data.args` / `data.state` schema
   unchanged.

## Out of scope

- Renaming internal slice tokens (e.g. `args` → `params`). The wire
  prefix names are stable.
- Changing the intercom flat-shape invariant. Still enforced.
- Per-user availability of sources (separate, already-fixed concern —
  see today's change to `AIAgentSource.availability`).
- Telegram-UI vs CLI vs web-UI specific tweaks. Markuper is one layer
  above; if a UI plugin renders the path text, the new model produces
  shorter paths but the rendering path is unaffected.

## Migration risk

Big-bang in spirit (per the project memory: "no incremental
preservation"), but the blast radius is small:

- **Wire** unchanged → no node, transport, or storage migration.
- **`/sargs`** filter and write paths key off per-leaf `persistent`;
  unchanged.
- **Builder UI**: any user with `--config` muscle memory hits a no-op
  and the build continues. They notice once when their old script
  produces "extra" tokens that bind to the next positional or get
  dropped — same surface as any typo.
- **Tests**: a small fixture-shape migration in two parser/markuper
  tests.

## Acceptance

- Existing scraper user types
  `/scraper Адвокат --city СПб --baseUrl http://... --model qwen3.5:9b`
  and the build compiles with `args/query`, `args/city`,
  `args/aiAgent/baseUrl`, `args/aiAgent/model` on the wire.
- The build picker shows no `args →` or `intercom →` buttons. Root
  buttons are the actual scraper args.
- Active-service builder shows intercom controls (`pause`, `stop`, etc.)
  as root buttons; no `args →` button (currently collapsed to empty
  branch, will simply not be rendered).
- Full test suite (`npm run build && npm test` per package) is green.
