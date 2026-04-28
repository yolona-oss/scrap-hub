# Service Argument Hydration & `-now` Opt-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the silent-hydration bug — when a user runs `/<service>` (with or without args), always open the builder hydrated with source-tagged saved data, and add a standalone `-now` flag that skips the builder when saved data covers required leaves.

**Architecture:** Hub-side fix. `CmdDispatcher.isAllArgsPassed` becomes service-aware (services always open the builder). `HandleCmdBuilder` loads module + most-recent session config, tags each entry with its source, and passes the typed `SavedSources` map through to the parser. The markuper renders `(saved: session)` / `(saved: module)` next to unset leaves. The compile path folds `_values ⊕ savedSources.values` so saved values fill gaps without showing as user input. A new `now` standalone arg in `GlobalServiceParam` lets users skip the builder; missing required leaves on `-now` falls through to the builder with an info line.

**Tech Stack:** TypeScript 5, Jest, monorepo with npm workspaces. Files live in `packages/core` (hub) and `packages/common` (shared primitives). Tests run from each package via `npx jest`.

---

## File Structure

**Modify:**
- `packages/common/src/service/service-data.ts` — add `now` standalone leaf to `GlobalServiceParam`
- `packages/core/src/ui/command-processor/dispatcher.ts` — make `isAllArgsPassed` service-aware
- `packages/core/src/ui/command-processor/builder/interpreter/parser.ts` — replace `SavedData` plumbing with typed `SavedSources`; add `effectiveValues()` for compile-time fold
- `packages/core/src/ui/command-processor/builder/interpreter/modes/base.ts` — use `parser.effectiveValues()` in compile
- `packages/core/src/ui/command-processor/builder/builder.ts` — thread `SavedSources` through `startBuild` / `restartAtLeaf`
- `packages/core/src/ui/command-processor/builder/builder-markuper.ts` — render source tags on unset saved leaves
- `packages/core/src/ui/command-processor/handlers/build.ts` — add saved-source loader, `-now` short-circuit, and the missing-required fall-through

**Create:**
- `packages/core/src/ui/command-processor/saved-sources.ts` — type definitions + `loadSavedSources` helper
- `packages/core/src/ui/command-processor/__tests__/saved-sources.test.ts`
- `packages/core/src/ui/command-processor/__tests__/handle-build.test.ts`
- `packages/core/src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts`

**Existing tests to update:**
- `packages/core/src/__tests__/interpreter.test.ts` — add cases for `effectiveValues()` fold
- `packages/core/src/__tests__/markuper-pair-tree.test.ts` — add cases for source-tag rendering

Each file owns one responsibility: the saved-sources module owns DB shape concerns, the parser owns state, the markuper owns rendering, the build handler owns the dispatch decision tree.

---

## Task 1: Add `now` standalone arg to `GlobalServiceParam`

**Files:**
- Modify: `packages/common/src/service/service-data.ts:6-26`
- Test: existing `packages/common/src/service/__tests__/` if present, else verify via downstream tests

- [ ] **Step 1: Add the `now` field to `GlobalServiceParam`**

Edit `packages/common/src/service/service-data.ts` — add this `@CmdArgument` after `noCache`:

```typescript
    @CmdArgument({
        required: false,
        standalone: true,
        description: "Skip the builder. Run immediately using saved session/module data merged with any typed args. Falls back to the builder when required args are missing.",
    })
    now?: string
```

The class becomes:

```typescript
export class GlobalServiceParam {
    @CmdArgument({
        required: false,
        description: "Session id to restore state from."
    })
    sessionId?: string

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Disable auto-dashboard for this service"
    })
    noDashboard?: string

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Skip per-account/session config overlays for this run; use built-in defaults + explicit args only. Saved values are NOT modified.",
    })
    noCache?: string

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Skip the builder. Run immediately using saved session/module data merged with any typed args. Falls back to the builder when required args are missing.",
    })
    now?: string
}
```

- [ ] **Step 2: Build common to make sure the new field compiles**

Run: `cd /home/data/projects/bots/scrap-hub/packages/common && npx tsc --build`
Expected: clean build, no errors.

- [ ] **Step 3: Run common's existing tests as a regression sanity check**

Run: `cd /home/data/projects/bots/scrap-hub/packages/common && npx jest`
Expected: all tests pass (the count may differ from the README; what matters is no regressions).

- [ ] **Step 4: Commit**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/common/src/service/service-data.ts
git commit -m "feat(common): add -now standalone flag to GlobalServiceParam"
```

---

## Task 2: Define `SavedSources` types + `loadSavedSources` helper

**Files:**
- Create: `packages/core/src/ui/command-processor/saved-sources.ts`
- Create: `packages/core/src/ui/command-processor/__tests__/saved-sources.test.ts`

**Context:** `SavedSources` is a `Map<string, { value, source }>` where keys are slash-delimited dot-paths matching the wire convention (e.g. `config/aiAgent/model`). The keys must be prefixed with the slice (`config/`) for services because that's the wire shape the parser stores.

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/ui/command-processor/__tests__/saved-sources.test.ts`:

```typescript
import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))

import { loadSavedSources, type SavedSources } from '../saved-sources'

describe('loadSavedSources', () => {
    function makeRepos(opts: {
        moduleConfig?: Record<string, unknown>
        sessions?: Array<{ name: string; createTime: number; config: Record<string, unknown> }>
        ownerExists?: boolean
        accountExists?: boolean
    }) {
        const sessions = (opts.sessions ?? []).map(s => ({
            record: { name: s.name, createTime: s.createTime, data: { config: s.config } },
        }))
        const moduleHandle = {
            record: { data: { config: opts.moduleConfig ?? {} } },
            getSessions: jest.fn().mockResolvedValue(sessions),
        }
        const account = {
            getModuleByNameOrCreate: jest.fn().mockResolvedValue({ module: moduleHandle, isNew: false }),
        }
        return {
            manager: { findByUserId: jest.fn().mockResolvedValue(opts.ownerExists === false ? null : { id: 'o1', accountId: 'a1', userId: 'u1' }) },
            account: { handleById: jest.fn().mockResolvedValue(opts.accountExists === false ? null : account) },
        }
    }

    test('returns empty map when no owner', async () => {
        const repos = makeRepos({ ownerExists: false }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.size).toBe(0)
    })

    test('returns empty map when no account', async () => {
        const repos = makeRepos({ accountExists: false }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.size).toBe(0)
    })

    test('reads module config under config/ prefix tagged module', async () => {
        const repos = makeRepos({
            moduleConfig: { city: 'Moscow', depth: 3 },
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/city')).toEqual({ value: 'Moscow', source: 'module' })
        expect(result.get('config/depth')).toEqual({ value: '3', source: 'module' })
    })

    test('most recent session config overrides module on collision; entry tagged session', async () => {
        const repos = makeRepos({
            moduleConfig: { city: 'Moscow', depth: 3 },
            sessions: [
                { name: 'older', createTime: 1000, config: { city: 'Saint-Petersburg' } },
                { name: 'newer', createTime: 2000, config: { city: 'Kazan' } },
            ],
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/city')).toEqual({ value: 'Kazan', source: 'session' })
        expect(result.get('config/depth')).toEqual({ value: '3', source: 'module' })
    })

    test('module-only key keeps module tag when session lacks it', async () => {
        const repos = makeRepos({
            moduleConfig: { depth: 3 },
            sessions: [{ name: 's', createTime: 1, config: { city: 'X' } }],
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/depth')).toEqual({ value: '3', source: 'module' })
        expect(result.get('config/city')).toEqual({ value: 'X', source: 'session' })
    })

    test('skips null/undefined/empty-string values', async () => {
        const repos = makeRepos({
            moduleConfig: { keep: 'x', dropNull: null, dropEmpty: '', dropUndef: undefined },
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.has('config/keep')).toBe(true)
        expect(result.has('config/dropNull')).toBe(false)
        expect(result.has('config/dropEmpty')).toBe(false)
        expect(result.has('config/dropUndef')).toBe(false)
    })

    test('flattens nested objects into slash-delimited paths', async () => {
        const repos = makeRepos({
            moduleConfig: { aiAgent: { model: 'gpt-4', temperature: 0.7 } },
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/aiAgent/model')).toEqual({ value: 'gpt-4', source: 'module' })
        expect(result.get('config/aiAgent/temperature')).toEqual({ value: '0.7', source: 'module' })
    })

    test('swallows DB errors and returns empty map', async () => {
        const repos = {
            manager: { findByUserId: jest.fn().mockRejectedValue(new Error('db down')) },
            account: { handleById: jest.fn() },
        } as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.size).toBe(0)
    })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/ui/command-processor/__tests__/saved-sources.test.ts`
Expected: FAIL — module `'../saved-sources'` not found.

- [ ] **Step 3: Create the implementation**

Create `packages/core/src/ui/command-processor/saved-sources.ts`:

```typescript
import log from '../../application/logger'
import type { DispatcherRepos } from './dispatcher'

export type SavedSource = 'session' | 'module'

export interface SavedEntry {
    readonly value: string
    readonly source: SavedSource
}

export type SavedSources = Map<string, SavedEntry>

/** Walk a nested record into flat slash-delimited entries. Skips
 *  null / undefined / empty-string values — those carry no signal
 *  for the builder's saved-defaults overlay. */
function flatten(prefix: string, obj: Record<string, unknown>, out: Map<string, string>): void {
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined || v === '') continue
        const key = prefix.length > 0 ? `${prefix}/${k}` : k
        if (typeof v === 'object' && !Array.isArray(v)) {
            flatten(key, v as Record<string, unknown>, out)
            continue
        }
        out.set(key, String(v))
    }
}

/** Read account-module + most-recent session config and return a
 *  flat slash-delimited map of `pathKey → { value, source }`. Session
 *  values override module values on key collision (matches
 *  BaseCommandService.initSession's account < session precedence).
 *
 *  Keys are emitted under the `config/` slice prefix so they line up
 *  with the wire convention used by the parser's value map.
 *
 *  Returns an empty map on any DB error so the caller falls through
 *  to a fresh builder rather than failing the dispatch. */
export async function loadSavedSources(
    repos: DispatcherRepos,
    userId: string,
    command: string,
): Promise<SavedSources> {
    const result: SavedSources = new Map()
    try {
        const owner = await repos.manager.findByUserId(userId)
        if (!owner?.accountId) return result
        const account = await repos.account.handleById(owner.accountId)
        if (!account) return result
        const { module } = await account.getModuleByNameOrCreate(command)

        const moduleConfig = (module.record.data?.config ?? {}) as Record<string, unknown>
        const moduleFlat = new Map<string, string>()
        flatten('config', moduleConfig, moduleFlat)
        for (const [k, v] of moduleFlat) result.set(k, { value: v, source: 'module' })

        const sessions = await module.getSessions()
        if (sessions.length > 0) {
            // Most recent first by createTime; sessions without createTime sort to the end.
            const sorted = [...sessions].sort((a, b) =>
                (b.record.createTime ?? 0) - (a.record.createTime ?? 0),
            )
            const latest = sorted[0]
            const sessionConfig = (latest.record.data?.config ?? {}) as Record<string, unknown>
            const sessionFlat = new Map<string, string>()
            flatten('config', sessionConfig, sessionFlat)
            for (const [k, v] of sessionFlat) result.set(k, { value: v, source: 'session' })
        }
    } catch (e) {
        log.debug(`loadSavedSources: ${(e as Error).message}`)
        return new Map()
    }
    return result
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/ui/command-processor/__tests__/saved-sources.test.ts`
Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/saved-sources.ts \
        packages/core/src/ui/command-processor/__tests__/saved-sources.test.ts
git commit -m "feat(core): add SavedSources type + loadSavedSources helper"
```

---

## Task 3: Make `isAllArgsPassed` and `isService` service-aware for remotes

**Files:**
- Modify: `packages/core/src/ui/command-processor/dispatcher.ts:398-406, 408-427`
- Create: `packages/core/src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts`

**Context:** Two predicates need updating:
1. `isService(name)` (line 398) currently returns `false` for any name not in the local registry — including remote services. Task 8 needs this to also recognize remote services declared in `services[]` of any node manifest.
2. `isAllArgsPassed(command, args)` (line 408) currently treats remote services like one-shots and returns `true` when arg count meets the required-leaf count. Fix: services always return `false` (always open the builder).

The manifest aggregator publishes `services[]` per node — a remote command appears in `services[]` exactly when it's a service.

- [ ] **Step 1: Inspect the existing remote branch**

Read `packages/core/src/ui/command-processor/dispatcher.ts:408-427`. Current code:

```typescript
isAllArgsPassed(command: string, passedArgs: string[]): boolean {
    const cmd = this.cmd_registry.get(command)
    if (cmd) {
        if (isOneShot(cmd.invokable)) {
            return passedArgs.length >= (this._localRequiredCount.get(command) ?? 0)
        }
        return false
    }

    const remote = this.tryGetRemoteCommand(command)
    if (remote) {
        return passedArgs.length >= countRequiredLeaves(protoToTree(remote.options))
    }

    log.error(`While processing command "${command}" with passed arguments "${passedArgs.join(", ")}", command not found`)
    return true
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts`:

```typescript
import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { CmdDispatcher } from '../dispatcher'

function makeAggregatorWithRemoteService(name: string, isService: boolean) {
    const command = {
        name,
        description: '',
        compatibilityId: 'cmd-hub.test',
        version: '1.0.0',
        options: { tree: { case: 'branch', value: { children: [], description: '' } } } as any,
        aliases: [],
    }
    const services = isService
        ? [{ command, intercomActions: [], caps: { supportsPause: false, supportsStop: true } }]
        : []
    return {
        listManifests: () => [{
            nodeId: 'n1', nodeName: 'n', version: '1.0.0',
            commands: [command],
            services,
            configs: [], hardware: {}, metrics: {},
        }],
        findCommand: (n: string) => (n === name ? command : undefined),
        configModuleOwners: (_: string) => [],
    }
}

describe('CmdDispatcher.isService — remote awareness', () => {
    test('remote service is recognized as a service', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('scraper', true) as any)
        expect(dispatcher.isService('scraper')).toBe(true)
    })

    test('remote one-shot is NOT a service', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('echo', false) as any)
        expect(dispatcher.isService('echo')).toBe(false)
    })

    test('unknown command is not a service', () => {
        const dispatcher = new CmdDispatcher()
        expect(dispatcher.isService('mystery')).toBe(false)
    })
})

describe('CmdDispatcher.isAllArgsPassed — service awareness', () => {
    test('remote SERVICE always returns false regardless of arg count', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('scraper', true) as any)

        expect(dispatcher.isAllArgsPassed('scraper', [])).toBe(false)
        expect(dispatcher.isAllArgsPassed('scraper', ['--city', 'Moscow'])).toBe(false)
    })

    test('remote ONE-SHOT keeps count-based check', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('echo', false) as any)

        // No required leaves on the empty tree → 0 args satisfies 0 required.
        expect(dispatcher.isAllArgsPassed('echo', [])).toBe(true)
    })

    test('unknown command returns true (caller surfaces a not-found error downstream)', () => {
        const dispatcher = new CmdDispatcher()
        // No aggregator attached.
        expect(dispatcher.isAllArgsPassed('mystery', [])).toBe(true)
    })
})
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts`
Expected: FAIL on the "remote SERVICE" case — currently returns `true` for empty args.

- [ ] **Step 4: Patch `isService` and `isAllArgsPassed`**

In `packages/core/src/ui/command-processor/dispatcher.ts`:

4a. Replace the existing `isService` method (lines 398-406):

```typescript
    public isService(name: string): boolean {
        const cb = this.tryGetInvokable(name)
        if (!cb) {
            // Remote commands aren't in the local registry; treat as not-a-service.
            log.debug(`isService("${name}"): not in local registry`)
            return false
        }
        return isService(cb.invokable)
    }
```

with:

```typescript
    public isService(name: string): boolean {
        const cb = this.tryGetInvokable(name)
        if (cb) return isService(cb.invokable)
        // Remote: present in some node's services[] iff it's a service.
        return this._isRemoteService(name)
    }
```

4b. Replace lines 408-427:

```typescript
    isAllArgsPassed(command: string, passedArgs: string[]): boolean {
        const cmd = this.cmd_registry.get(command)
        if (cmd) {
            if (isOneShot(cmd.invokable)) {
                return passedArgs.length >= (this._localRequiredCount.get(command) ?? 0)
            }
            // Services always open the builder, even with all args typed.
            return false
        }

        const remote = this.tryGetRemoteCommand(command)
        if (remote) {
            // Services declared in any node's `services[]` always open the
            // builder so the user can review hydrated saved data and
            // toggle `-now` to skip it explicitly.
            if (this._isRemoteService(command)) return false
            // Remote command trees aren't cached on the hub — the manifest
            // can change as cmd-nodes attach/detach. Recompute per call.
            return passedArgs.length >= countRequiredLeaves(protoToTree(remote.options))
        }

        log.error(`While processing command "${command}" with passed arguments "${passedArgs.join(", ")}", command not found`)
        return true
    }

    /** A remote command is a service iff at least one node lists it under
     *  `services[]` in its manifest. The aggregator publishes the same
     *  command shape under both `commands` and `services[].command`, so
     *  the name-match here is unambiguous. */
    private _isRemoteService(command: string): boolean {
        const agg = this._manifestAggregator
        if (!agg) return false
        for (const m of agg.listManifests()) {
            // services[] is typed `unknown[]` on AggregatedManifest — it's
            // emitted from the proto NodeManifest where each entry has
            // `command.name`. Defensive cast: anything missing the shape
            // is ignored.
            for (const s of (m.services as Array<{ command?: { name?: string } }>) ?? []) {
                if (s?.command?.name === command) return true
            }
        }
        return false
    }
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 6: Run full core suite to catch regressions**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest`
Expected: all tests pass. The change is additive on the remote branch — local-service / local-one-shot / unknown paths are untouched.

- [ ] **Step 7: Commit**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/dispatcher.ts \
        packages/core/src/ui/command-processor/__tests__/dispatcher-service-aware.test.ts
git commit -m "fix(core): isAllArgsPassed treats remote services like local ones"
```

---

## Task 4: Replace parser `_savedData` with typed `SavedSources`

**Files:**
- Modify: `packages/core/src/ui/command-processor/builder/interpreter/parser.ts:85, 362-367`
- Modify: `packages/core/src/__tests__/interpreter.test.ts` — update any references to `SavedData` if present

**Context:** The parser today exposes `SavedData: Record<string, unknown> | undefined`. We replace with a typed map and add `effectiveValues()` for the compile-time fold (Task 6 uses it).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/__tests__/interpreter.test.ts` (in a new `describe` block at the bottom of the file, before the final closing of the file):

```typescript
import type { SavedSources } from '../ui/command-processor/saved-sources'

describe('Parser — SavedSources & effectiveValues', () => {
    test('SavedSources getter returns whatever was assigned', () => {
        const tree = branch({ city: leaf({ description: 'd' }) })
        const parser = createParser(tree)

        expect(parser.SavedSources).toBeUndefined()

        const map: SavedSources = new Map([
            ['config/city', { value: 'Moscow', source: 'module' as const }],
        ])
        parser.SavedSources = map
        expect(parser.SavedSources).toBe(map)
    })

    test('effectiveValues folds saved values for unset leaves only', () => {
        const tree = branch({ city: leaf({ description: 'd' }), depth: leaf({ description: 'd' }) })
        const parser = createParser(tree)

        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '3', source: 'session' }],
        ])
        parser.SavedSources = saved

        // User commits city → user value wins; depth stays from saved.
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const eff = parser.effectiveValues()
        expect(eff.get('city')).toBe('Kazan')
        expect(eff.get('depth')).toBe('3')
    })

    test('effectiveValues with no SavedSources returns just user values', () => {
        const tree = branch({ city: leaf({ description: 'd' }) })
        const parser = createParser(tree)

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const eff = parser.effectiveValues()
        expect(eff.size).toBe(1)
        expect(eff.get('city')).toBe('Kazan')
    })

    test('effectiveValues with SavedSources but no user input returns saved values', () => {
        const tree = branch({ city: leaf({ description: 'd' }) })
        const parser = createParser(tree)
        parser.SavedSources = new Map([['city', { value: 'Moscow', source: 'module' }]])

        const eff = parser.effectiveValues()
        expect(eff.get('city')).toBe('Moscow')
    })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/interpreter.test.ts -t "SavedSources"`
Expected: FAIL — `SavedSources` and `effectiveValues` don't exist yet.

- [ ] **Step 3: Patch the parser**

In `packages/core/src/ui/command-processor/builder/interpreter/parser.ts`:

3a. Replace the import block at the top (after the existing imports) — add a type-only import for `SavedSources`. After line 13 (`import log from '../../../../application/logger'`), add:

```typescript
import type { SavedSources } from '../../saved-sources'
```

3b. Replace line 85:

```typescript
    private _savedData?: Record<string, unknown>
```

with:

```typescript
    private _savedSources?: SavedSources
```

3c. Replace lines 362-367 (the `SavedData` accessors):

```typescript
    get SavedData(): Record<string, unknown> | undefined {
        return this._savedData
    }
    set SavedData(data: Record<string, unknown> | undefined) {
        this._savedData = data
    }
```

with:

```typescript
    get SavedSources(): SavedSources | undefined {
        return this._savedSources
    }
    set SavedSources(data: SavedSources | undefined) {
        this._savedSources = data
    }

    /** Compile-time view: user-committed values overlaid with saved
     *  values for any leaf the user did not commit. Used by the
     *  interpreter's compile path so saved values fill gaps without
     *  appearing as user input in the markup. */
    effectiveValues(): Map<string, string> {
        const out = new Map<string, string>()
        if (this._savedSources) {
            for (const [k, entry] of this._savedSources) out.set(k, entry.value)
        }
        for (const [k, v] of this._values) out.set(k, v)
        return out
    }
```

- [ ] **Step 4: Run the parser test to confirm it passes**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/interpreter.test.ts -t "SavedSources"`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Run full core suite to surface call-site breakage**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest`
Expected: failures in places that still reference `parser.SavedData` (the markuper, the builder). Read the failure list — the next tasks fix those call sites.

- [ ] **Step 6: Commit (intermediate — call sites fixed in next tasks)**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/builder/interpreter/parser.ts \
        packages/core/src/__tests__/interpreter.test.ts
git commit -m "feat(core): replace parser SavedData with typed SavedSources + effectiveValues"
```

---

## Task 5: Update `CommandBuilder` to thread `SavedSources`

**Files:**
- Modify: `packages/core/src/ui/command-processor/builder/builder.ts:46-66, 74-94`

**Context:** `startBuild` and `restartAtLeaf` both accept the legacy `savedData?: Record<string, unknown>`. Replace with `SavedSources` and assign to `parser.SavedSources` instead of `parser.SavedData`. The markuper still receives the old-shape map for now — Task 7 fixes that.

- [ ] **Step 1: Write a behaviour test for the new signature**

Append to `packages/core/src/__tests__/interpreter.test.ts`:

```typescript
import { CommandBuilder } from '../ui/command-processor/builder/builder'

describe('CommandBuilder.startBuild — SavedSources', () => {
    test('passes SavedSources through to parser via interpreter', async () => {
        const builder = new CommandBuilder()
        const tree = branch({ city: leaf({ description: 'd' }) })
        const desc = descriptorFromTree(tree)
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
        ])
        await builder.startBuild('u1', 'svc', desc, undefined, saved)
        expect(builder.isUserOnBuild('u1')).toBe(true)
        // Indirect verification: a fresh execute on no input yields effective city=Moscow.
        // (Direct parser inspection isn't exposed; the markuper test covers rendering.)
    })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/interpreter.test.ts -t "CommandBuilder.startBuild — SavedSources"`
Expected: FAIL — TypeScript rejects passing `SavedSources` where `Record<string, unknown>` is expected, OR runtime fails because the parser's setter no longer matches.

- [ ] **Step 3: Patch `builder.ts`**

In `packages/core/src/ui/command-processor/builder/builder.ts`:

3a. After the existing imports (around line 11), add:

```typescript
import type { SavedSources } from '../saved-sources'
```

3b. Replace the `startBuild` signature + body (lines 46-66) with:

```typescript
    async startBuild(
        userId: string,
        command: string,
        desc: IUICommandDescriptor,
        mode?: InterpreterMode,
        savedSources?: SavedSources,
    ): Promise<IBaseMarkup> {
        if (this.usersBuild.has(userId)) {
            throw new Error('User already has active build.')
        }
        if (desc.options.node === 'branch' && desc.options.children.size === 0) {
            throw new Error('No arguments in descriptor. Nothing to build.')
        }

        const parser = new CBParser({ command, descriptor: desc })
        parser.SavedSources = savedSources
        const interpreter = new CBInterpreter(parser, mode)
        this.usersBuild.set(userId, interpreter)

        return BuilderMarkuper.intro(parser, savedSources)
    }
```

3c. Replace the `restartAtLeaf` signature + body (lines 74-94) with:

```typescript
    async restartAtLeaf(
        userId: string,
        command: string,
        desc: IUICommandDescriptor,
        seededValues: ReadonlyMap<string, string>,
        failedLeafPath: readonly string[],
        mode?: InterpreterMode,
        savedSources?: SavedSources,
    ): Promise<IBaseMarkup> {
        // Drop any leftover build for this user (defensive — the previous
        // execute() should have cleared it via `handle`'s `Done` branch,
        // but a torn-down stream could leave one behind).
        this.usersBuild.delete(userId)
        const parser = new CBParser({ command, descriptor: desc })
        parser.SavedSources = savedSources
        parser.seedValues(seededValues)
        parser.focusLeaf(failedLeafPath)
        const interpreter = new CBInterpreter(parser, mode)
        this.usersBuild.set(userId, interpreter)
        return BuilderMarkuper.markup(parser, { text: { info: '' } })
    }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/interpreter.test.ts -t "CommandBuilder.startBuild — SavedSources"`
Expected: PASS.

- [ ] **Step 5: Build core to surface markuper signature mismatch**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx tsc --build`
Expected: TypeScript errors at `BuilderMarkuper.intro(parser, savedSources)` and `_renderSavedDefaults` because their signatures still take `Record<string, unknown>`. Task 7 fixes that.

- [ ] **Step 6: Commit (intermediate)**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/builder/builder.ts \
        packages/core/src/__tests__/interpreter.test.ts
git commit -m "feat(core): CommandBuilder accepts SavedSources instead of plain record"
```

---

## Task 6: Use `parser.effectiveValues()` in the compile path

**Files:**
- Modify: `packages/core/src/ui/command-processor/builder/interpreter/modes/base.ts:144-151`

**Context:** Today the compile builds `proxy` and `raw` from `parser.Values` only. With saved-source folding the compile must use `effectiveValues()` so saved values land in `compiled.raw` (which becomes the wire `args` map) and in the proxy.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/__tests__/interpreter.test.ts`:

```typescript
describe('Interpreter compile — saved values fold into effective args', () => {
    test('compiled.raw includes saved values for unset leaves', () => {
        const tree = branch({
            city: leaf({ description: 'city' }),
            depth: leaf({ description: 'depth' }),
        })
        const parser = createParser(tree)
        parser.SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '5', source: 'session' }],
        ])
        const interpreter = new CBInterpreter(parser, 'incremental')

        // User overrides depth, leaves city to saved.
        interpreter.step('--depth 7')
        const ev = interpreter.step(BuilderActionSigns.execute)

        expect(ev.IsCompiled).toBe(true)
        const compiled = ev.Result
        expect(compiled.raw.get('city')).toBe('Moscow')
        expect(compiled.raw.get('depth')).toBe('7')
    })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/interpreter.test.ts -t "saved values fold"`
Expected: FAIL — `compiled.raw.get('city')` is `undefined` because compile uses `parser.Values` only.

- [ ] **Step 3: Patch `base.ts` compile**

In `packages/core/src/ui/command-processor/builder/interpreter/modes/base.ts`, replace lines 144-151:

```typescript
    protected compile(): ICommandCompiled {
        const values = this.parser.Values
        return {
            command: this.parser.Command,
            proxy: new CmdArgumentProxy(values, this.parser.Tree),
            raw: new Map(values),
        }
    }
```

with:

```typescript
    protected compile(): ICommandCompiled {
        const effective = this.parser.effectiveValues()
        return {
            command: this.parser.Command,
            proxy: new CmdArgumentProxy(effective, this.parser.Tree),
            raw: effective,
        }
    }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/interpreter.test.ts -t "saved values fold"`
Expected: PASS.

- [ ] **Step 5: Commit (intermediate)**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/builder/interpreter/modes/base.ts \
        packages/core/src/__tests__/interpreter.test.ts
git commit -m "feat(core): compile path folds saved sources into effective args"
```

---

## Task 7: Update `BuilderMarkuper` to render source tags

**Files:**
- Modify: `packages/core/src/ui/command-processor/builder/builder-markuper.ts:44-50, 158-171, 173-193`
- Modify: `packages/core/src/__tests__/markuper-pair-tree.test.ts` — add cases for source tags

**Context:** The markuper renders `(saved)` next to unset leaves. We extend that to `(saved: session)` / `(saved: module)`. Existing skip rule for keys present in `parser.Values` is preserved (user-committed leaves stay unmarked).

- [ ] **Step 1: Inspect the existing markuper test fixture**

Read `packages/core/src/__tests__/markuper-pair-tree.test.ts` to learn its style. Use the same helpers when adding cases.

- [ ] **Step 2: Write the failing test**

Append to `packages/core/src/__tests__/markuper-pair-tree.test.ts` (after the last existing test, inside the file's outer scope — match the file's existing import style):

```typescript
import { BuilderMarkuper } from '../ui/command-processor/builder/builder-markuper'
import type { SavedSources } from '../ui/command-processor/saved-sources'

describe('BuilderMarkuper — saved-source tags', () => {
    function tree() {
        return branch({
            city: leaf({ description: 'city' }),
            depth: leaf({ description: 'depth' }),
        })
    }

    test('intro lists saved entries with source tag', async () => {
        const parser = new CBParser({ command: 'svc', descriptor: { options: tree() } })
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '5', source: 'session' }],
        ])
        const markup = await BuilderMarkuper.intro(parser, saved)
        expect(markup.text).toContain('city: Moscow')
        expect(markup.text).toContain('(module)')
        expect(markup.text).toContain('depth: 5')
        expect(markup.text).toContain('(session)')
    })

    test('user-committed leaf is unmarked; only unset leaves show source tag', async () => {
        const parser = new CBParser({ command: 'svc', descriptor: { options: tree() } })
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '5', source: 'session' }],
        ])
        parser.SavedSources = saved
        // Commit city by typing.
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        // depth is still saved → tag rendered for depth, not for city.
        expect(markup.text).toContain('depth: 5')
        expect(markup.text).toContain('(session)')
        // city was user-committed → no '(module)' next to it.
        // (Look for the saved-defaults block specifically: the user-set commit appears with ✓.)
        const savedSection = markup.text.split('Saved defaults')[1] ?? ''
        expect(savedSection).not.toContain('city')
    })

    test('no SavedSources renders no saved-defaults block', async () => {
        const parser = new CBParser({ command: 'svc', descriptor: { options: tree() } })
        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        expect(markup.text).not.toContain('Saved defaults')
    })
})
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/markuper-pair-tree.test.ts -t "saved-source tags"`
Expected: FAIL — TypeScript signature mismatch on `BuilderMarkuper.intro(parser, saved)` (intro still expects `Record<string, unknown>`).

- [ ] **Step 4: Patch `builder-markuper.ts`**

4a. After the existing imports (around line 6), add:

```typescript
import type { SavedSources } from '../saved-sources'
```

4b. Replace the `intro` signature (lines 44-50):

```typescript
    static async intro(
        parser: CBParser,
        savedData?: Record<string, unknown>,
    ): Promise<IBaseMarkup> {
        const overwrite = BuilderMarkuper._renderIntroText(parser, savedData)
        return BuilderMarkuper.markup(parser, { text: { overwrite, info: '' } })
    }
```

with:

```typescript
    static async intro(
        parser: CBParser,
        savedSources?: SavedSources,
    ): Promise<IBaseMarkup> {
        const overwrite = BuilderMarkuper._renderIntroText(parser, savedSources)
        return BuilderMarkuper.markup(parser, { text: { overwrite, info: '' } })
    }
```

4c. Replace `_renderSavedDefaults` (lines 158-171):

```typescript
    private static _renderSavedDefaults(parser: CBParser): string {
        const saved = parser.SavedData
        if (!saved) return ''
        const setKeys = new Set(parser.Values.keys())
        const lines: string[] = []
        for (const [key, val] of Object.entries(saved)) {
            if (val === undefined || val === null || val === '') continue
            if (setKeys.has(key)) continue
            const display = String(val).slice(0, 35)
            lines.push(` - ${UiUnicodeSymbols.info} ${key}: ${display} (saved)`)
        }
        if (lines.length === 0) return ''
        return `\n\n${UiUnicodeSymbols.lock} Saved defaults:\n${lines.join('\n')}`
    }
```

with:

```typescript
    private static _renderSavedDefaults(parser: CBParser): string {
        const saved = parser.SavedSources
        if (!saved || saved.size === 0) return ''
        const setKeys = new Set(parser.Values.keys())
        const lines: string[] = []
        for (const [key, entry] of saved) {
            if (setKeys.has(key)) continue
            const display = entry.value.slice(0, 35)
            lines.push(` - ${UiUnicodeSymbols.info} ${key}: ${display} (${entry.source})`)
        }
        if (lines.length === 0) return ''
        return `\n\n${UiUnicodeSymbols.lock} Saved defaults:\n${lines.join('\n')}`
    }
```

4d. Replace `_renderIntroText` (lines 173-193):

```typescript
    private static _renderIntroText(parser: CBParser, savedData?: Record<string, unknown>): string {
        const command = parser.Command
        let text = `${UiUnicodeSymbols.hammer} Run CmdBuilder\n` +
            `Building command: ${UiUnicodeSymbols.arrowRight} "${command}"\n`

        for (const { pathKey, leaf } of walkLeaves(parser.Tree)) {
            const brackets = leaf.required ? '<>' : '[]'
            const desc = leaf.description || 'No description'
            text += ` - ${brackets[0]}${pathKey}${brackets[1]} - ${desc}\n`
        }

        if (savedData && Object.keys(savedData).length > 0) {
            text += `\n${UiUnicodeSymbols.info} Saved config will be applied:\n`
            for (const [key, val] of Object.entries(savedData)) {
                if (val === undefined || val === null || val === '') continue
                const display = typeof val === 'object' ? JSON.stringify(val).slice(0, 40) : String(val).slice(0, 40)
                text += `  ${key}: ${display}\n`
            }
        }
        return text
    }
```

with:

```typescript
    private static _renderIntroText(parser: CBParser, savedSources?: SavedSources): string {
        const command = parser.Command
        let text = `${UiUnicodeSymbols.hammer} Run CmdBuilder\n` +
            `Building command: ${UiUnicodeSymbols.arrowRight} "${command}"\n`

        for (const { pathKey, leaf } of walkLeaves(parser.Tree)) {
            const brackets = leaf.required ? '<>' : '[]'
            const desc = leaf.description || 'No description'
            text += ` - ${brackets[0]}${pathKey}${brackets[1]} - ${desc}\n`
        }

        if (savedSources && savedSources.size > 0) {
            text += `\n${UiUnicodeSymbols.info} Saved config will be applied:\n`
            for (const [key, entry] of savedSources) {
                const display = entry.value.slice(0, 40)
                text += `  ${key}: ${display} (${entry.source})\n`
            }
        }
        return text
    }
```

- [ ] **Step 5: Run markuper tests to confirm they pass**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/markuper-pair-tree.test.ts`
Expected: all tests pass, including the new 3 cases.

- [ ] **Step 6: Run full core suite**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest`
Expected: all tests pass. The build handler still references `parser.SavedData` indirectly via the `savedData` param — Task 8 finishes that migration.

- [ ] **Step 7: Commit**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/builder/builder-markuper.ts \
        packages/core/src/__tests__/markuper-pair-tree.test.ts
git commit -m "feat(core): markuper renders saved-source tags (session/module)"
```

---

## Task 8: `HandleCmdBuilder` loads saved sources and handles `-now`

**Files:**
- Modify: `packages/core/src/ui/command-processor/handlers/build.ts:14-55`
- Create: `packages/core/src/ui/command-processor/__tests__/handle-build.test.ts`

**Context:** This is the dispatcher decision tree:
1. Detect `-now` token in raw args.
2. Load saved sources (always — even without `-now`, we need them for the builder).
3. If `-now` was set:
    - Compute coverage: every required leaf in the command's tree must be present in either typed args (after parsing through a non-mandatory build) OR `savedSources`.
    - Covered → dispatch directly via `RemoteCmdInvoker.invoke` with the merged args map.
    - Not covered → fall through to opening the builder with an info line listing missing leaves; `-now` is dropped.
4. Otherwise: open the builder with `savedSources` threaded through.

For -now coverage check we walk required leaves of the command tree (already cached locally; remote tree decoded on demand). For typed args, we use a quick "is this path's pathKey covered by an exact-match leaf" check via `walkLeaves`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/ui/command-processor/__tests__/handle-build.test.ts`:

```typescript
import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { HandleCmdBuilder } from '../handlers/build'
import { CmdDispatcher } from '../dispatcher'
import { branch, leaf, type OptionsTree } from '@cmd-hub/common'

function makeDispatcher(opts: {
    commandTree: OptionsTree
    isService?: boolean
    savedSources?: Map<string, { value: string; source: 'module' | 'session' }>
    invokeMock?: jest.Mock
}) {
    const dispatcher = new CmdDispatcher() as any
    const command = 'svc'
    // Pretend the command is remote: install a minimal aggregator.
    dispatcher.attachManifestAggregator({
        listManifests: () => [{
            nodeId: 'n1', nodeName: 'n', version: '1.0.0',
            commands: [{ name: command, options: opts.commandTree, description: '' }],
            services: opts.isService === false ? [] : [{ command: { name: command }, intercomActions: [], caps: {} }],
            configs: [], hardware: {}, metrics: {},
        }],
        findCommand: (n: string) => n === command
            ? { name: command, options: opts.commandTree, description: '' }
            : undefined,
        configModuleOwners: () => [],
    })

    // Stub `getCommandTree` to return our raw OptionsTree (skip the proto round-trip).
    dispatcher.getCommandTree = () => opts.commandTree

    // Stub repos so loadSavedSources works without a real DB.
    const moduleHandle = {
        record: { data: { config: {} } },
        getSessions: jest.fn().mockResolvedValue([]),
    }
    const account = { getModuleByNameOrCreate: jest.fn().mockResolvedValue({ module: moduleHandle, isNew: false }) }
    dispatcher.attachRepos({
        manager: { findByUserId: jest.fn().mockResolvedValue({ id: 'o', accountId: 'a', userId: 'u' }) },
        account: { handleById: jest.fn().mockResolvedValue(account) },
        invitationLink: {} as any, cmdAlias: {} as any, pendingDelete: {} as any,
    })

    // Hook `loadSavedSources` by patching the module — simpler than threading repos shape.
    // Instead, we override the test helper by injecting saved sources at the parser layer
    // through a custom dispatch wrapper. For coverage tests below we drive the path via
    // a faked `loadSavedSources` import; see jest.mock at the test top.

    const invokeMock = opts.invokeMock ?? jest.fn().mockResolvedValue({
        success: true, markup: { text: 'ok' }, messageType: 'dashboard' as const,
    })
    dispatcher.attachRemoteInvoker({ invoke: invokeMock, invokeLegacy: jest.fn() } as any)

    return { dispatcher, invokeMock, moduleHandle }
}

// We mock loadSavedSources directly to control the saved map per test.
let mockSavedSources = new Map<string, { value: string; source: 'module' | 'session' }>()
jest.mock('../saved-sources', () => ({
    loadSavedSources: jest.fn(async () => mockSavedSources),
}))

describe('HandleCmdBuilder', () => {
    beforeEach(() => { mockSavedSources = new Map() })

    test('opens builder with saved sources for service when -now absent', async () => {
        const tree = branch({ city: leaf({ description: 'city', required: true }) })
        const { dispatcher } = makeDispatcher({ commandTree: tree })
        mockSavedSources = new Map([['city', { value: 'Moscow', source: 'module' }]])

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc',
            userId: 'u',
            ownerId: 'm',
            words: [],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(res.messageType).toBe('builder')
        expect(res.success).toBe(true)
    })

    test('-now with full saved coverage skips builder and calls invoke directly', async () => {
        const tree = branch({ city: leaf({ description: 'city', required: true }) })
        const invokeMock = jest.fn().mockResolvedValue({
            success: true, markup: { text: 'done' }, messageType: 'dashboard',
        })
        const { dispatcher } = makeDispatcher({ commandTree: tree, invokeMock })
        mockSavedSources = new Map([['city', { value: 'Moscow', source: 'module' }]])

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc -now',
            userId: 'u',
            ownerId: 'm',
            words: ['-now'],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(invokeMock).toHaveBeenCalledTimes(1)
        const callArg = invokeMock.mock.calls[0][0]
        expect(callArg.command).toBe('svc')
        expect(callArg.args).toMatchObject({ city: 'Moscow' })
        expect(res.messageType).toBe('dashboard')
    })

    test('-now without coverage falls through to builder with missing-required info', async () => {
        const tree = branch({ city: leaf({ description: 'city', required: true }) })
        const invokeMock = jest.fn()
        const { dispatcher } = makeDispatcher({ commandTree: tree, invokeMock })
        mockSavedSources = new Map() // empty saved data

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc -now',
            userId: 'u',
            ownerId: 'm',
            words: ['-now'],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(invokeMock).not.toHaveBeenCalled()
        expect(res.messageType).toBe('builder')
        expect(res.markup.text).toMatch(/missing required/i)
        expect(res.markup.text).toContain('city')
    })

    test('-now with typed args + saved partial covers required', async () => {
        const tree = branch({
            city: leaf({ description: 'city', required: true }),
            depth: leaf({ description: 'depth', required: true }),
        })
        const invokeMock = jest.fn().mockResolvedValue({
            success: true, markup: { text: 'ok' }, messageType: 'dashboard',
        })
        const { dispatcher } = makeDispatcher({ commandTree: tree, invokeMock })
        mockSavedSources = new Map([['city', { value: 'Moscow', source: 'session' }]])

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc -now --depth 5',
            userId: 'u',
            ownerId: 'm',
            words: ['-now', '--depth', '5'],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(invokeMock).toHaveBeenCalledTimes(1)
        const callArg = invokeMock.mock.calls[0][0]
        expect(callArg.args).toMatchObject({ city: 'Moscow', depth: '5' })
        expect(res.messageType).toBe('dashboard')
    })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/ui/command-processor/__tests__/handle-build.test.ts`
Expected: FAIL — current `HandleCmdBuilder` doesn't know about `-now`, doesn't load saved sources via the new helper, and doesn't short-circuit dispatch.

- [ ] **Step 3: Rewrite `handlers/build.ts`**

Replace the file `packages/core/src/ui/command-processor/handlers/build.ts` entirely:

```typescript
import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui/types"
import { BaseUI } from "../../../ui/base-ui"
import { CommandBuilder, descCompiler } from "../builder"
import { CmdDispatcher } from "../dispatcher"
import log from '../../../application/logger'
import { IUICommandDescriptor, IUI } from "../../../ui/types"
import { isOneShot, formatEffectiveArgs } from "../../types/command"
import { walkLeaves, type OptionsTree } from "@cmd-hub/common"
import { loadSavedSources, type SavedSources } from "../saved-sources"
import { CBParser } from "../builder/interpreter/parser"
import { Lexer } from "../builder/interpreter/lexer"

const NOW_FLAG = '-now'

interface CoverageResult {
    covered: boolean
    missing: string[]
    /** Merged args that should ship over the wire if covered === true. */
    effectiveArgs: Record<string, string>
}

/** Strip the `-now` token from `args` and return both the rest and a
 *  flag indicating whether it was present. */
function extractNowFlag(args: string[]): { rest: string[]; nowSet: boolean } {
    let nowSet = false
    const rest: string[] = []
    for (const a of args) {
        if (a === NOW_FLAG) { nowSet = true; continue }
        rest.push(a)
    }
    return { rest, nowSet }
}

/** Compute coverage for `-now`: every required leaf in `tree` must
 *  appear in `typedArgs` (a flat dot-path map) OR in `saved`. Returns
 *  the merged args map and the list of any missing required keys. */
function computeNowCoverage(
    tree: OptionsTree,
    typedArgs: ReadonlyMap<string, string>,
    saved: SavedSources,
): CoverageResult {
    const merged: Record<string, string> = {}
    for (const [k, entry] of saved) merged[k] = entry.value
    for (const [k, v] of typedArgs) merged[k] = v

    const missing: string[] = []
    for (const { pathKey, leaf } of walkLeaves(tree)) {
        if (!leaf.required) continue
        if (merged[pathKey] === undefined || merged[pathKey] === '') {
            missing.push(pathKey)
        }
    }
    return { covered: missing.length === 0, missing, effectiveArgs: merged }
}

export class HandleCmdBuilder<UICtx extends BaseUIContext> extends AbstractCmdHandler<UICtx> {

    private async loadSaved(
        userId: string,
        command: string,
        ctx: UICtx,
        dispatcher: CmdDispatcher<UICtx>,
    ): Promise<SavedSources> {
        if (!dispatcher.isService(command)) return new Map()
        if (ctx.manager?.userId === undefined) return new Map()
        const repos = dispatcher.repos
        if (!repos) return new Map()
        return loadSavedSources(repos, String(ctx.manager.userId), command)
    }

    /** Parse `args` (without the -now flag) into a flat dot-path map.
     *  Uses the same tokenizer/parser the builder uses, but operates
     *  on the raw command tree rather than the descriptor — sidesteps
     *  the descCompiler so this works for remote services without a
     *  fully-decoded proto descriptor. */
    private parseTypedArgs(
        command: string,
        tree: OptionsTree,
        args: string[],
    ): Map<string, string> {
        if (args.length === 0) return new Map()
        try {
            const parser = new CBParser({ command, descriptor: { options: tree } })
            const lexer = new Lexer()
            lexer.setInput(args.join(' '))
            for (const tkn of lexer.tokenizeCurrent()) {
                parser.parseNextToken(tkn)
            }
            return new Map(parser.Values)
        } catch (e) {
            log.debug(`HandleCmdBuilder.parseTypedArgs: ${(e as Error).message}`)
        }
        return new Map()
    }

    private async startNewBuild(
        userId: string,
        command: string,
        args: string[],
        ctx: UICtx,
        builder: CommandBuilder,
        dispatcher: CmdDispatcher<UICtx>,
        uiImpl: IUI<UICtx>,
    ): Promise<ICmdHandlerResponce|void> {
        log.trace(`Checking for availability to start build: ${command}`)
        log.trace(`Command: ${command}\nArgs: ${args}`)
        const known = dispatcher.tryGetInvokable(command) || dispatcher.tryGetRemoteCommand(command)
        if (!known) return

        const { rest: argsNoFlag, nowSet } = extractNowFlag(args)

        const savedSources = await this.loadSaved(userId, command, ctx, dispatcher)

        if (nowSet && dispatcher.isService(command)) {
            const tree = dispatcher.getCommandTree(command)
            if (tree) {
                const typed = this.parseTypedArgs(command, tree, argsNoFlag)
                const coverage = computeNowCoverage(tree, typed, savedSources)
                if (coverage.covered) {
                    return await this.dispatchNow(command, userId, coverage.effectiveArgs, ctx, uiImpl, dispatcher)
                }
                // Missing required → fall through to the builder with an info line.
                log.info(`-now on /${command}: missing required leaves: ${coverage.missing.join(', ')}; opening builder`)
                const desc: IUICommandDescriptor = await descCompiler.compile(command, userId, dispatcher, ctx)
                const res = await builder.startBuild(userId, command, desc, undefined, savedSources)
                return {
                    success: true,
                    markup: {
                        text: `${res.text}\n\nmissing required: ${coverage.missing.join(', ')}`,
                        buttons: res.buttons,
                    },
                    messageType: 'builder' as const,
                }
            }
        }

        if (!dispatcher.isAllArgsPassed(command, argsNoFlag)) {
            const desc: IUICommandDescriptor = await descCompiler.compile(command, userId, dispatcher, ctx)
            const res = await builder.startBuild(userId, command, desc, undefined, savedSources)
            return {
                success: true,
                markup: res,
                messageType: 'builder' as const,
            }
        }
        return
    }

    private async dispatchNow(
        command: string,
        userId: string,
        effectiveArgs: Record<string, string>,
        ctx: UICtx,
        uiImpl: IUI<UICtx>,
        dispatcher: CmdDispatcher<UICtx>,
    ): Promise<ICmdHandlerResponce> {
        const invoker = dispatcher.RemoteInvoker
        if (!invoker) {
            return {
                success: false,
                markup: { text: 'No remote invoker attached to dispatcher' },
                messageType: 'system' as const,
            }
        }
        log.info(`exec (now): /${command} args=${JSON.stringify(effectiveArgs)}`)
        const res = await invoker.invoke({
            command,
            args: effectiveArgs,
            userId,
            uiHandle: { ctx, uiImpl },
            uiName: uiImpl.ContextType(),
        })
        return res
    }

    private async handleBuildProcess(userId: string, text: string, ctx: UICtx, builder: CommandBuilder, dispatcher: CmdDispatcher<UICtx>, uiImpl: IUI<UICtx>): Promise<ICmdHandlerResponce|void> {
        if (builder.isUserOnBuild(userId)) {
            const stepRes = builder.handle(userId, text)

            if (stepRes.IsCompiled) {
                log.info(`exec (built): ${formatEffectiveArgs(stepRes.Result)}`)
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }

                const localEntry = dispatcher.tryGetInvokable(stepRes.Result.command)
                if (localEntry && isOneShot(localEntry.invokable)) {
                    await localEntry.invokable.call(dispatcher, stepRes.Result.proxy, ctx, uiImpl)
                    return {
                        success: true,
                        markup: { text: '' },
                        messageType: 'system' as const,
                    }
                }

                const invoker = dispatcher.RemoteInvoker
                if (!invoker) {
                    return {
                        success: false,
                        markup: { text: 'No remote invoker attached to dispatcher' },
                        messageType: 'system' as const,
                    }
                }
                const compiled = stepRes.Result
                const invokeRes = await invoker.invokeLegacy(userId, compiled, ctx, uiImpl)
                if (invokeRes.validationFailed) {
                    const desc = await descCompiler.compile(compiled.command, userId, dispatcher, ctx)
                    const failedPath = invokeRes.validationFailed.argPath
                        .split('/')
                        .filter(s => s.length > 0)
                    const markup = await builder.restartAtLeaf(
                        userId, compiled.command, desc,
                        compiled.raw, failedPath,
                    )
                    return {
                        success: true,
                        markup,
                        messageType: 'builder' as const,
                    }
                }
                return invokeRes
            }

            if (stepRes.Done) {
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }
            }

            return {
                success: !Boolean(stepRes),
                markup: await stepRes.Markup,
                messageType: 'builder' as const
            }
        }
        return
    }

    public async handle(request: ICmdHandlerRequest<UICtx>): Promise<ICmdHandlerResponce> {
        const { command, text, userId, uiCtx, uiImpl, words: args, dispatcher } = request

        const builder = dispatcher.CommandBuilder
        const builderRes = await this.handleBuildProcess(userId, text, uiCtx, builder, dispatcher, uiImpl)
        if (builderRes) {
            return builderRes
        }

        try {
            const buildSetupRes = await this.startNewBuild(userId, command, args, uiCtx, builder, dispatcher, uiImpl)
            if (buildSetupRes) {
                return buildSetupRes
            }
        } catch(e: unknown) {
            log.error(`Cannot start build command: "${command}": ${(e as Error)?.message ?? e}`, e)
        }

        return await super.handle(request)
    }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/ui/command-processor/__tests__/handle-build.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Run full core suite**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest`
Expected: all tests pass.

- [ ] **Step 6: Build all packages to catch downstream breaks**

Run: `cd /home/data/projects/bots/scrap-hub && npm run build`
Expected: clean build across all workspaces. The `web-ui` plugin reads `module.record.data.config` (`plugins/ui/web/src/web-ui.ts:536`) but doesn't depend on the parser internals — it should be unaffected. Same for the built-in commands.

- [ ] **Step 7: Commit**

```bash
cd /home/data/projects/bots/scrap-hub
git add packages/core/src/ui/command-processor/handlers/build.ts \
        packages/core/src/ui/command-processor/__tests__/handle-build.test.ts
git commit -m "feat(core): HandleCmdBuilder loads saved sources and handles -now flag"
```

---

## Task 9: End-to-end smoke check

**Files:**
- No code changes; verifies the full flow.

**Context:** Run the full test matrix and the existing `golden-scraper-loopback.test.ts` to catch any integration regressions.

- [ ] **Step 1: Run every package's test suite**

Run from `/home/data/projects/bots/scrap-hub`:

```bash
cd packages/common && npx jest
cd ../core && npx jest
cd ../transport && npx jest
cd ../node && npx jest
cd ../../plugins/storage/mongo && npx jest
cd ../../ui/cli && npx jest 2>/dev/null || true
cd ../../scraper-node && npx jest 2>/dev/null || true
```

Expected: all pass (some plugins may not have jest configured; that's fine).

- [ ] **Step 2: Run the golden scraper loopback**

Run: `cd /home/data/projects/bots/scrap-hub/packages/core && npx jest src/__tests__/golden-scraper-loopback.test.ts`
Expected: PASS. This test exercises the full hub→node loop and is the regression boundary called out in the v2 migration memory.

- [ ] **Step 3: Build the whole monorepo one more time**

Run: `cd /home/data/projects/bots/scrap-hub && npm run build`
Expected: clean build.

- [ ] **Step 4: Final commit (only if you made any incidental fixes during the smoke check; otherwise skip)**

If everything passed without changes, no commit needed.

---

## Self-review notes

- **Spec coverage:** every behavior matrix row from the spec (§ Behavior matrix) is covered by Tasks 3, 6, 7, or 8. Source tagging covered by Task 7. `-now` direct dispatch covered by Task 8 case 2. `-now` missing-required fallthrough covered by Task 8 case 3. `-now` mixed (typed + saved) covered by Task 8 case 4.
- **Type consistency:** `SavedSources` defined once in Task 2; same shape used in Tasks 4, 5, 7, 8. `effectiveValues()` defined in Task 4, consumed in Task 6. `loadSavedSources` defined in Task 2, consumed in Task 8.
- **Out-of-scope items** from the spec (node-side overlay decoupling, session picker UX, multi-node fan-out for `-now`) intentionally omitted from this plan.
- **Backward compat:** the markuper's `intro()` and `_renderSavedDefaults`/`_renderIntroText` change shape from `Record<string, unknown>` to `SavedSources`. No external consumers (verified via grep — `parser.SavedData` and `BuilderMarkuper.intro` are not referenced outside `core`).
- **One edge case the plan handles silently:** if a user typed `-now` at a one-shot, `now` isn't in the one-shot's tree, so the parser's `commitLeaf` path doesn't fire. The flag string survives in `args` and gets passed through to `dispatcher.isAllArgsPassed`. For a one-shot the existing arg-count check still applies. This matches the spec's "Out of scope: one-shots aren't the bug" position.
