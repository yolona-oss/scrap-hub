# Service argument hydration & `-now` opt-out

**Date:** 2026-04-28
**Status:** approved (brainstorm), pending plan

## Problem

When a user runs `/scraper` (or any other remote service) with no
arguments and has saved data in their account-module or a recent
session, the framework silently hydrates the merged effective config
inside `BaseCommandService.initSession` and starts the run. The builder
never opens. The user has no chance to inspect or override the
hydrated values, and no way to tell whether the run is using
session-, module-, or freshly-typed input.

The mis-routing happens in `CmdDispatcher.isAllArgsPassed`
(`packages/core/src/ui/command-processor/dispatcher.ts:408-427`):

- For locally-registered services, the method returns `false` (always
  open the builder).
- For remote services, it falls through the same code path as
  one-shots — `passedArgs.length >= countRequiredLeaves(...)`. With no
  required leaves on the wire-side tree, `0 >= 0` is true and the
  builder is skipped.

Once the builder is skipped, `HandleInvokation` ships an empty `args`
map to the node, and `BaseCommandService.initSession`
(`packages/common/src/service/base-command-service.ts:319-380`) merges
account+session config into the effective config without telling the
hub.

## Goal

For every remote *service*, `/<svc>` (with or without typed args)
opens the builder, hydrated from saved data with the source of each
saved value visible. The user can opt out — and skip the builder
entirely — by adding the standalone flag `-now`. One-shot commands
keep their existing count-based completion check.

## Behavior matrix

| Input | Saved data | Result |
|---|---|---|
| `/scraper` | full required from session/module | builder opens, all leaves shown as saved (source-tagged), user can edit or submit |
| `/scraper` | partial | builder opens, set leaves shown saved, unset leaves require user input |
| `/scraper` | none | builder opens, every leaf empty |
| `/scraper --session 123 -dry-run` | any | builder opens, `--session 123` and `-dry-run` shown as user-committed (no source tag), other leaves hydrated from saved |
| `/scraper -now` | full required | no builder; saved data merged in compile, dispatch directly |
| `/scraper -now` | missing required | builder opens with a "missing required: X" info line; `-now` is dropped |
| `/scraper -now --session 123` | session 123 covers required | no builder; user value wins on `--session`, saved values fill the rest |
| `/<one-shot>` | n/a | unchanged: builder opens only when required-arg count not met |

## Architecture

Three coordinated changes, all hub-side except a new `now` standalone
flag in the global params class.

### 1. `isAllArgsPassed` becomes service-aware

`CmdDispatcher.isAllArgsPassed` returns `false` for *any* service
(local or remote), and keeps the count-based check for one-shots.
Remote service detection uses the existing `isService(...)` predicate
extended to consult the manifest aggregator (services declared on
node manifests as `services[].command.name`).

### 2. `-now` standalone flag in `GlobalServiceParam`

Add a single `@CmdArgument({standalone: true})` named `now` to
`GlobalServiceParam` (`packages/common/src/service/service-data.ts`).
Every service inherits it. The flag rides the wire under
`params/now`.

`HandleCmdBuilder.startNewBuild` looks for the `-now` token in the
inbound `args` array. When present:

- Validate that every required leaf has either a typed value or a
  saved-source value.
- If validation fails: drop `-now` and open the builder with an info
  line listing the missing required leaves. (No silent run on
  incomplete state.)
- Otherwise: build the final `args` map (typed ⊕ saved), dispatch via
  `RemoteCmdInvoker.invoke` directly, skip the builder.

### 3. Hydration source tagging

`CBParser.SavedData` becomes a typed `SavedSources` map keyed by full
slash-delimited leaf path:

```ts
type SavedSource = 'session' | 'module'
type SavedSources = Map<string, { value: string; source: SavedSource }>
```

The hub fetches both layers in `HandleCmdBuilder`:

- **module** — `account.getModuleByNameOrCreate(command).module.record.data.config`
- **session** — most recent session via `module.getSessions()`, then
  the session's `config` overlay and `runtimeState` (config keys only;
  runtime-state stays node-side)

Session values **override** module values on key collision (matches
`BaseCommandService.initSession` precedence: account < session <
input). Each entry carries its winning source.

The markuper renders an unset leaf with `(saved: <source>)` next to
its name; user-committed leaves (`parser._values`) are unmarked. The
existing `_renderSavedDefaults` already skips keys present in
`Values` — that invariant is preserved.

### 4. Compile-time fold

When the parser compiles (`EvaluationResult.Result`), the final `args`
map shipped over the wire is `parser._values ⊕ SavedSources.values`
for every required leaf the user didn't commit. Optional saved values
also fold in — saved data is the user's prior intent, so suppressing
it would surprise the user.

The fold lives in the parser's compile path, not in the markuper.
Markup-time and compile-time use the same `SavedSources` map.

## Components & data flow

```
/scraper [tokens]
    │
    ▼
CmdDispatcher.handleCommand
    │
    ▼
HandleCmdBuilder.startNewBuild
    │
    ├─ loadSavedSources(userId, command)
    │       │
    │       ├─ module.record.data.config  → tag 'module'
    │       └─ latest session.data.config → tag 'session' (overrides)
    │
    ├─ if args contains '-now':
    │       │
    │       ├─ args ⊕ savedSources covers required? → dispatch directly
    │       └─ otherwise → drop -now, open builder w/ missing-required info
    │
    └─ otherwise:
            │
            ▼
        builder.startBuild(userId, command, desc, mode, savedSources)
            │
            ▼
        CBParser.SavedSources = savedSources
            │
            ▼
        BuilderMarkuper renders saved-source tags on unset leaves

(user steps through the build...)
            │
            ▼
        EvaluationResult.Result {
            command,
            args = parser._values ⊕ savedSources.values  (user wins)
        }
            │
            ▼
        RemoteCmdInvoker.invokeLegacy → cmd-node
```

The cmd-node-side flow is unchanged: it receives a flat `args` map
across `config/`, `params/`, `messages/` slices, runs leaf
validators, and constructs the service. `BaseCommandService.initSession`
keeps overlaying account/session on top of input — but now the input
already reflects what the user saw in the builder, so there is no
silent surprise.

## File-level change list

| File | Change |
|---|---|
| `packages/core/src/ui/command-processor/dispatcher.ts:408-427` | `isAllArgsPassed`: detect remote service via aggregator and return `false`; keep one-shot count check |
| `packages/core/src/ui/command-processor/handlers/build.ts:14-55` | extract `loadSavedSources` helper; detect `-now`; branch into direct-dispatch vs builder-open w/ saved sources |
| `packages/core/src/ui/command-processor/builder/builder.ts:46-66, 74-94` | accept `SavedSources` instead of plain `Record`; thread through `startBuild` and `restartAtLeaf` |
| `packages/core/src/ui/command-processor/builder/interpreter/parser.ts:85, 362-367` | replace `_savedData` with `_savedSources` (typed map); add compile-time `effectiveValues()` that folds user values ⊕ saved values |
| `packages/core/src/ui/command-processor/builder/builder-markuper.ts:158-171, 173-193` | render `(saved: session)` / `(saved: module)` per leaf; same skip rule for user-committed keys |
| `packages/core/src/ui/command-processor/builder/interpreter/interpreter.ts` (compile path) | use `parser.effectiveValues()` when emitting `ICommandCompiled.raw` |
| `packages/common/src/service/service-data.ts:6-26` | add `@CmdArgument({standalone: true})` `now` to `GlobalServiceParam` with description |
| (tests) `packages/core/src/ui/command-processor/__tests__/` | new tests for: services always open builder; `-now` direct dispatch; `-now` w/ missing required falls through to builder; saved-source rendering & precedence |

## Edge cases

- **No saved data, no typed args** — builder opens with every leaf
  empty. Existing behavior, unchanged.
- **`-now` on a one-shot** — `now` is on `GlobalServiceParam`, which
  one-shots don't have. The flag is unknown to one-shots and the
  parser falls through to its existing positional-bind logic (which
  may or may not error depending on the one-shot's tree). Out of
  scope for this design — one-shots aren't the bug.
- **`-now` with `noCache`** — `noCache` already exists in
  `GlobalServiceParam` and tells the node to skip overlay reads. The
  two are independent: `-now` controls hub-side builder skipping,
  `noCache` controls node-side overlay merging. Both can ride
  together.
- **Multiple sessions** — the hub picks the most recent session
  (highest `expiresAt`-or-equivalent ordering). Sessions named
  explicitly via `--session <id>` are not consulted by the hydration
  step *until compile* — when `--session 123` is present the user
  has signaled an explicit session pick, and the node will resolve
  it via the existing `params.s` / `params.sessionId` flow.
- **Saved value fails validation on the node** — the existing
  `validation_failed` envelope flow re-prompts the failed leaf via
  `restartAtLeaf`. The seeded values include the saved value, the
  parser focuses on the failed leaf, the user types a corrected
  value. No change required here.

## Testing

- `dispatcher.isAllArgsPassed` returns `false` for both local and
  remote services regardless of arg count.
- `HandleCmdBuilder` opens the builder for `/<svc>` with empty args
  when saved data exists; `parser.SavedSources` is populated.
- `HandleCmdBuilder` skips the builder for `/<svc> -now` when saved
  data covers required leaves; `RemoteCmdInvoker.invoke` is called
  directly with the merged args map.
- `HandleCmdBuilder` opens the builder for `/<svc> -now` when saved
  data is incomplete; missing-required info line is rendered.
- Markuper renders `(saved: session)` / `(saved: module)` only for
  unset leaves; user-committed leaves render with `✓` and no source
  tag.
- Saved-source precedence: a leaf saved in both module and session
  resolves to `'session'`.
- Compile fold: `parser._values ⊕ savedSources` is shipped; user
  values win on collision.
- One-shots: arg-count check unchanged, `-now` is not declared on
  their tree.

## Out of scope

- Decoupling node-side `BaseCommandService.initSession` overlay
  reads from saved-data hydration. The node-side overlay still runs
  — it now reads (mostly) the same values the hub already injected.
  A future cleanup could collapse the two paths, but it would
  require the hub to know the full `GlobalServiceConfig` defaults,
  which currently live node-side. Tracked as v2 follow-up.
- Changing how sessions are selected for hydration. The "most
  recent session" rule mirrors what `/sinfo` already shows; a
  user-facing session picker is a separate UX problem.
- Multi-node fan-out for `-now`. Routing is unchanged.
