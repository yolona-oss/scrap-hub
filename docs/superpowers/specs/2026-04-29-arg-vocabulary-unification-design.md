# Arg vocabulary unification — design

**Status:** approved (brainstorming)
**Date:** 2026-04-29
**Scope:** framework (`packages/`) + plugins (`plugins/`) + examples (`examples/`)
**Migration posture:** hard cut, single PR, no deprecation aliases

## Problem

The framework's vocabulary for "values passed to a command" has accumulated drift across three orthogonal axes:

1. **Service data slices** — `CmdServiceData` has `config`, `params`, `messages`, `runtimeState`. Two of those (`config` and `params`) actually hold the same kind of thing — arguments to the command — distinguished only by *whether the framework persists them* across invocations. A reader looking at `this.data.config` can plausibly think it refers to `config.json` (app config), `ConfigContributor` (zod-merged middleware config), or the persisted account/session document — none of which it is.
2. **Declaration vocabulary** — `@CmdArgument` decorator, `CmdArgumentDef`, `LeafOptions`, `BranchOptions`, `OptionsTree`, `LeafSpec.options` mix three different roots (`Argument`, `Options`, `Spec`) for one mechanism.
3. **Term overload** — "options" means at least three different things in the public API: the tree primitive (`OptionsTree`), the decorator's input shape (`LeafOptions`), and the per-leaf static enum list (`LeafSpec.options`).

`messages` is a fourth concept, distinct from the above: it declares the **intercom message vocabulary** (the `receiveMsg(msg, args)` reverse channel for pause/resume/stop/custom actions), not invocation arguments.

## Goal

A single, consistent vocabulary across the framework that:

- collapses the false `config`/`params` distinction into one argument tree with per-leaf persistence;
- uses `Arg` as the single root for the declaration mechanism;
- removes the "options" overload entirely;
- gives the intercom slice a name that matches its role;
- removes ambiguity between `data.config` and the app's `config.json` / `ConfigContributor` system.

## Non-goals

- Multi-layer persistence beyond what exists today (account + session). The `persistent` flag is a boolean. A future `layer` enum is out of scope.
- Backwards-compatible name aliases. Hard cut, single PR.
- Restructuring the `state` (formerly `runtimeState`) slice. Renamed only.
- Changing the `@CmdService` / `@CmdOneShot` decorator surfaces beyond the field-name renames listed below.

## Design

### Vocabulary

Old → new, exhaustively:

```
─── Decorator + tree types ────────────────────────────────────
@CmdArgument               →  @CmdArg
CmdArgumentDef             →  ArgDef
OptionsTree                →  ArgTree                (= ArgLeaf | ArgBranch)
LeafSpec                   →  ArgLeaf
BranchSpec                 →  ArgBranch
LeafOptions                →  ArgLeafDef
BranchOptions              →  ArgBranchDef
LeafType                   →  ArgValueType           (string | number | bool — unchanged)
LeafValidator              →  ArgValidator
LeafSpec.options           →  ArgLeaf.choices

─── Functions / constants ─────────────────────────────────────
buildTreeFromClass         →  buildArgTreeFromClass
walkLeaves                 →  walkArgLeaves
flattenValue               →  flattenArgs
unflattenValue             →  unflattenArgs
nodeAtPath                 →  argNodeAtPath
COMMAND_ARG_DESC_KEY       →  CMD_ARG_META_KEY
PAIR_PATH_DELIMITER        →  ARG_PATH_DELIMITER

─── Service data slices ───────────────────────────────────────
data.config + data.params  →  data.args              (merged; persistence per-leaf)
data.messages              →  data.intercom
data.runtimeState          →  data.state

─── Service decorator @CmdService payload ─────────────────────
{ config, params, messages }  →  { args, intercom }

─── Global default classes ────────────────────────────────────
GlobalServiceConfig        →  (deleted — was empty)
GlobalServiceParam         →  GlobalServiceArgs
GlobalServiceMessages      →  GlobalServiceIntercom

─── Wire prefixes ─────────────────────────────────────────────
config/, params/           →  args/
messages/                  →  intercom/

─── Slash command ─────────────────────────────────────────────
/sconfig                   →  /sargs
```

The discriminator string values on tree nodes (`node: 'leaf' | 'branch'`) are unchanged. Only the type names change.

### The `persistent` flag

`@CmdArg`'s input gains one new field:

```ts
export interface ArgLeafDef {
  type?: ArgValueType
  required?: boolean
  position?: number
  standalone?: boolean
  default?: string
  description?: string
  choices?: readonly string[]
  validator?: ArgValidator
  displayHint?: DisplayHint
  /** When true, this leaf's value is read from / written to the layered
   *  account-session store. When false (default), the leaf is per-invocation. */
  persistent?: boolean
}
```

Authors who used to put a property in a `config` class now put it in their args class with `persistent: true`. Authors who used to put a property in a `params` class put it in the same args class without the flag.

Example — current scraper:

```ts
// Before
class ScraperConfigData {
  @CmdArgument({ description: "Search query" })
  query?: string
}
class ScraperParamsData { /* ... */ }

// After
class ScraperArgs {
  @CmdArg({ persistent: true, description: "Search query" })
  query?: string
  // ...
}
```

`GlobalServiceArgs` (replacing `GlobalServiceParam`) declares the four runtime flags, none of which are persistent:

```ts
export class GlobalServiceArgs {
  @CmdArg({ required: false, description: "Session id to restore state from." })
  sessionId?: string

  @CmdArg({ required: false, standalone: true,
            description: "Disable auto-dashboard for this service" })
  noDashboard?: string

  @CmdArg({ required: false, standalone: true,
            description: "Skip per-account/session arg overlays for this run; use built-in defaults + explicit args only. Saved values are NOT modified." })
  noCache?: string

  @CmdArg({ required: false, standalone: true,
            description: "Skip the builder. Run immediately using saved session/state data merged with any typed args. Falls back to the builder when required args are missing." })
  now?: string
}
```

`GlobalServiceConfig` is empty in the current code and has no persistent leaves to carry over, so it is deleted outright.

### `BaseCommandService.initSession()` — bootstrapping order

The new flow when an invocation lands at a service:

1. **Build the merged args tree.** As today (`mergeTrees(GlobalServiceArgs, this.data.args)`), then partition leaves into **persistent** vs. **ephemeral** by reading the `persistent` flag off each `ArgLeaf`.
2. **Read ephemeral leaves directly from input.** The four standalone flags (`sessionId`, `noDashboard`, `noCache`, `now`) plus any user-defined ephemeral leaves come straight from `inputData.args` — no store read.
3. **Read the `noCache` flag** to decide whether to consult the store.
4. **Layered merge for persistent leaves.** If `!noCache`: `defaults ← accountLayer.data.args ← sessionLayer.data.args ← inputData.args` (filtered to persistent leaves). If `noCache`: `defaults ← inputData.args` (filtered).
5. **Combine.** `data.args` is the union of merged persistent values + ephemeral values.
6. **Persist.** When `!noCache`, write the persistent slice of `data.args` back to the session layer under the key `args` (replacing the old `config` key).

The bootstrap reads `inputData.args` ephemeral leaves *before* it can do the persistent merge, because `noCache` controls whether the merge happens. This is a small bootstrapping order, not a fundamental complication — `noCache` is a known-ephemeral leaf in `GlobalServiceArgs`, so its location is fixed.

### Persistence (Mongo)

The account/session document field is renamed: `data.config` → `data.args`. The shape is unchanged — a flat object of dot-path keys to coerced values. The store now only contains persistent leaves; ephemeral leaves were never stored.

`/sargs` (formerly `/sconfig`) reads `data.args` from the layered store, filters its render to **leaves where the schema's `persistent` flag is `true`**, and writes back to the session layer.

### Migration for existing Mongo documents

One-time migration runs at app startup the first time the new code is deployed:

- For every account/session document that has a `data.config` field, copy `data.config` to `data.args` and unset `data.config`.
- Idempotent: skip docs already migrated (have `data.args`, no `data.config`).
- Documents that had old `data.params` are not migrated — `params` was never persisted; nothing to copy.

The migration ships as a `MongoStorageMiddleware` startup hook so it runs once per node on first boot of the new code, not as a separate operator step.

### Wire (gRPC)

The proto messages that today carry `config`, `params`, `messages` are restructured:

- The `config` and `params` map fields collapse into a single `args` map field (flat dot-path → string).
- The `messages` map field is renamed to `intercom`.
- `treeToProto` / `protoToTree` keep their shape but their internals walk one args branch instead of two.

Because the wire is mTLS between hub and nodes that we ship together (no third-party consumers), there is no compatibility shim — the proto change lands in the same PR as the renames.

### Hub-side dispatcher and builder

- `desc-compiler.ts`, `dispatcher.ts`, `service-ctrl-cmd.ts`: the slice-prefix routing changes from three branches (`config/`, `params/`, `messages/`) to two (`args/`, `intercom/`).
- The builder UI groups args by `persistent` for display in `/sargs`-style flows ("settings remembered for next time" vs. "for this run only"). Grouping is presentation-only and does not affect the wire shape or the `ArgTree` type.

### `/sinfo`

The dashboard panel that renders runtime data swaps three section labels for three new ones: `args`, `intercom`, `state` (formerly `config`, `params` + `messages`, `runtimeState`).

### One-shot commands

Mostly unchanged. `CmdOneShotMeta.argsClass` keeps its name. `ctx.args` is unchanged. The decorator on each property of an args class becomes `@CmdArg` (was `@CmdArgument`). One-shot args have no notion of persistence — `persistent: true` on a one-shot arg is meaningless and the framework ignores it (no error, since one-shots run without a layered store).

## File-by-file impact

### `packages/common/src/command/`

- `tree.ts` — type renames (`OptionsTree` → `ArgTree`, `LeafSpec` → `ArgLeaf`, `BranchSpec` → `ArgBranch`, etc.); `LeafSpec.options` → `ArgLeaf.choices`; constant rename `PAIR_PATH_DELIMITER` → `ARG_PATH_DELIMITER`; function renames (`walkLeaves`, `flattenValue`, `unflattenValue`, `nodeAtPath`).
- `argument-decorator.ts` — file rename to `arg-decorator.ts`; export rename `CmdArgument` → `CmdArg`; type rename `CmdArgumentDef` → `ArgDef`; constant rename `COMMAND_ARG_DESC_KEY` → `CMD_ARG_META_KEY`; function rename `buildTreeFromClass` → `buildArgTreeFromClass`. **New field on `ArgLeafDef`:** `persistent?: boolean`.
- `arg-proxy.ts` — naming-only updates to keep call sites consistent.
- `cmd-one-shot.ts` — updates `@CmdArgument` references to `@CmdArg`; `bindArgsForSpec` keeps its name.
- `service-decorator.ts` — `@CmdService` payload field renames: `config` and `params` are removed; `messages` → `intercom`; new field `args`. Validation updated accordingly.
- `tree.ts` tests, `argument-decorator.ts` tests, `cmd-one-shot.ts` tests — updated for renames; new tests for the `persistent` flag on `ArgLeaf`.

### `packages/common/src/service/`

- `service-data.ts` — class renames: `GlobalServiceConfig` (deleted), `GlobalServiceParam` → `GlobalServiceArgs`, `GlobalServiceMessages` → `GlobalServiceIntercom`. `CmdServiceData` field renames: `config` + `params` → `args`; `messages` → `intercom`; `runtimeState` → `state`. Generic parameter renames mirror the field renames.
- `base-command-service.ts` — the merged args tree replaces the two-tree split; `initSession()` bootstrapping order updated per the design above; `setConfigValue` → `setArgValue` (writes to `data.args` / session layer's `args`); `setRuntimeStateValue` → `setStateValue`; `setRuntimeState` → `setState`; tree accessor methods `configTree()` + `paramsTree()` collapse to `argsTree()`; `messagesTree()` → `intercomTree()`. Constants `SESSION_CONFIG_KEY` → `SESSION_ARGS_KEY`; `SESSION_RUNTIME_STATE_KEY` → `SESSION_STATE_KEY`.
- `service-store.ts` — the `IServiceLayer.data.config` field becomes `data.args`; doc comments updated; types reflect the rename.
- `service-context.ts` — `config` → `args` field; updates trickle through `getServiceContext()`.

### `packages/core/src/ui/command-processor/`

- `built-in-cmd/sconfig-cmd.ts` — file rename to `sargs-cmd.ts`; command name `/sconfig` → `/sargs`; reads `module.record.data.args` (was `data.config`); filters render by `persistent: true` on the schema's `ArgLeaf`s.
- `built-in-cmd/service-ctrl-cmd.ts`, `dashboard-panel.ts`, `sinfo-cmd.ts`, `help-cmd.ts`, `account-ctrl-cmd.ts`, `config-cmd.ts`, `cmd-alias-ctlr.ts` — slice-name updates and any user-facing labels.
- `dispatcher.ts` — slice-prefix routing changes from `{config, params, messages}` to `{args, intercom}`.
- `builder/builder.ts`, `builder/desc-compiler.ts`, `builder/interpreter/state-span.ts`, `handlers/build.ts`, `handlers/invokation.ts`, `handlers/alias.ts` — internal references to the renamed types and slice names.
- All `__tests__` under `command-processor/` — updated for renames; the `dispatcher-service-aware.test.ts` and `handle-build.test.ts` suites get the bulk of the changes.

### `packages/core/src/ui/types/command/service/`

- `hub-service-data.ts`, `index.ts` — re-export renames.

### `packages/transport/`

- `grpc/protos/cmd_node.proto` — message field renames (`config`, `params` removed; `args` added; `messages` → `intercom`). Regenerated bindings via the existing build step.
- `grpc/server.ts`, `aggregator.ts`, `command-pool.ts`, `tree-codec.ts` (whichever holds `treeToProto` / `protoToTree`) — internals follow.

### `packages/node/`

- `app/cmd-node-app.ts` — line 105 (`messages: buildTreeFromClass(meta.messages)`) and lines 345/353 update for the slice rename and the new merged args tree.
- `runtime/validate-args.ts` — function and type renames.

### `plugins/storage/mongo/`

- `repos/account-handle.ts:157` — `'data.config'` → `'data.args'`.
- Schema definitions for the account/session documents update the field name. Migration hook added (see "Migration for existing Mongo documents").

### `plugins/ui/web/`, `plugins/ui/cli/`, `plugins/ui/telegram/`

- Any references to `data.config`, `module.record.data.config`, `params`, `messages` slice names update. `plugins/ui/web/src/web-ui.ts:533` is the only persistent-data reader; the others are decoration / formatting paths that need label changes only.

### `examples/scraper-node/`

- `scraper-service/service.ts` — `@CmdService` payload swaps `config`/`params`/`messages` for `args`/`intercom`; the body's `this.data.config.query` → `this.data.args.query`; `this.data.config.format` → `this.data.args.format`.
- `scraper-service/config-tree.ts` — file rename to `args-tree.ts`; classes `ScraperConfigData` + `ScraperParamsData` merge into one `ScraperArgs` class with `persistent: true` on the leaves that were in the old `ScraperConfigData`. `ScraperMessagesData` → `ScraperIntercom`.
- `scraper-service/system-config.ts` — comment at line 8 ("merged into `this.data.config`") updates to `this.data.args`. The `ScraperSystemConfig` interface is the *system-tier* zod schema (operator-set), unrelated to per-user args; it keeps its name.
- All tests under `examples/scraper-node/src/scraper-service/__tests__/` — slice-name updates. `manifest-smoke.test.ts:90` (`.options!.branch!.children.messages.branch!.children`) updates for the slice rename.

### `examples/ui-app/`

No code changes expected — this app hosts UIs and doesn't touch service args directly. Verify during implementation.

### Docs

- `docs/cli.md`, `docs/node-deployment.md`, `docs/superpowers/specs/2026-04-28-service-arg-hydration-design.md`, `docs/index.html` (line 11056), and `CLAUDE.md` — references to `config`/`params`/`messages` slice names and to `@CmdArgument`/`OptionsTree` updated to the new vocabulary. The "Command argument model" section of `CLAUDE.md` needs the largest rewrite.

## Migration plan (summary)

1. Single PR; old names deleted, new names landed atomically.
2. Mongo startup migration: `data.config` → `data.args`, idempotent. Ships as a `MongoStorageMiddleware` hook.
3. No deprecation aliases. `/sconfig` is removed; users typing the old command get the standard "unknown command" path.
4. The proto change is breaking; the same PR ships matched hub and node binaries.
5. The golden scraper end-to-end test is the regression boundary, per `project_distributed_migration.md`.

## Test gate

The existing 322 unit tests must pass with renames. Specific suites flagged for extra attention:

- `packages/common/src/service/__tests__/base-command-service.test.ts` — heavy `data.config` / `sessionLayer.data.config` use; needs both rename and tests covering the new `persistent` flag–driven merge.
- `packages/core/src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts` — slice routing.
- `examples/scraper-node/src/scraper-service/__tests__/manifest-smoke.test.ts` — asserts the slice tree structure.
- The end-to-end scraper test (the golden test).

New tests to add:

- `ArgLeaf.persistent: true` leaves take part in the layered merge.
- `ArgLeaf.persistent: false` (or absent) leaves bypass the store.
- The `noCache` flag still suppresses store reads and writes for persistent leaves.
- The Mongo migration is idempotent and copies `data.config` to `data.args` correctly.

## Risks and open questions

- **Risk: silent data loss on first deploy.** If the migration hook fails partway, some accounts may have `data.args` while others still have `data.config`. Mitigation: the hook's idempotent design lets re-runs heal the state. The hook logs progress and reports to `log.info`. We do *not* delete `data.config` until after `data.args` is written and verified per-doc.
- **Risk: a third-party plugin (none today) holds a string literal `'config'`.** No external consumers of the framework exist. Internal grep covers this.
- **Open: `/sargs` UX.** The new command merges what was `/sconfig` (persistent edits) into a tree-aware editor. The display split between persistent and ephemeral leaves is presentation-only. UI plugins may want to label them explicitly ("Saved settings" / "This-run flags"); that's a follow-on UX task, not part of this design.
- **Open: validator semantics for ephemeral leaves.** Validators currently run node-side after `unflattenValue`. Behavior is unchanged; flagged here only to confirm during implementation that the validator path is exercised for both persistent and ephemeral leaves.
