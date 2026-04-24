# cmd-hub Package Split and Runtime Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the monorepo into seven packages (`@cmd-hub/common`, `@cmd-hub/transport`, `@cmd-hub/core`, `@cmd-hub/node`, `@cmd-hub/ui-telegram`, `@cmd-hub/ui-cli`, `@cmd-hub/ui-web`), delete the abandoned parallel distributed/ layer, and rewire the existing `CmdDispatcher` + `ServiceDashboard` + built-ins so they work over gRPC via a new `RemoteCmdInvoker`.

**Architecture:** Existing framework code is the primary execution path; distributed primitives (protobuf, registry, pool, FileService, gRPC, mTLS) move into a dedicated `@cmd-hub/transport` package. `CommandInvoker` is replaced by `RemoteCmdInvoker`. `ServiceDashboard` becomes a pure event sink. `Application` gains middleware machinery with phase-ordered install/uninstall and a composable config schema merged from every registered contributor. Configuration comes from a single `config.json` file; `process.env` is banned everywhere in framework code.

**Tech Stack:** TypeScript, Node 20+, npm workspaces, gRPC (`@grpc/grpc-js` + `ts-proto`), mongoose, MongoDB 7 (replica set), Docker + docker-compose, Jest, mongo-memory-server, zod (composable config schemas), `node-forge` (CA + cert signing), `bcryptjs` (token hashes).

**Spec:** `docs/superpowers/specs/2026-04-24-cmd-hub-package-split-design.md`. Read it before starting; this plan implements that spec.

**Migration shape:** big-bang rewrite. The existing `packages/cmd-hub/src/distributed/` subtree and `examples/telegram-ui-app/src/telegram-hub-ui.ts` are deleted wholesale. The distributed primitives are moved (not rewritten) into `@cmd-hub/transport`. Existing framework code in `packages/cmd-hub/` stays, with imports updated as its siblings move into `@cmd-hub/common`.

**User directive: no git commits.** Every task that previously ended with "Commit" now ends with "Stage for review." The engineer stages files but does not run `git commit`. The user commits on their own cadence.

**Conventions:**
- "Run tests" means `npm test` in the relevant package unless otherwise stated.
- "Stage for review" means `git add <the files listed in the task>`. Never `git add -A`.
- Test-first: every code task has its failing test written and shown to fail before the implementation step.
- File paths are absolute from the repo root `/home/data/projects/bots/scrap-hub/` — drop that prefix when pasting into commands.

---

## Table of contents

- Phase 0 — Preflight: tree state, baseline tests, safety net (Tasks 0.1–0.3)
- Phase 1 — `@cmd-hub/common` scaffold + move authoring primitives (Tasks 1.1–1.8)
- Phase 2 — `@cmd-hub/transport` scaffold + move distributed primitives (Tasks 2.1–2.6)
- Phase 3 — `Application` base + middleware machinery + composable config (Tasks 3.1–3.9)
- Phase 4 — `CommandInvoker` → `RemoteCmdInvoker`; `ServiceDashboard` event-sink; hub built-ins (Tasks 4.1–4.10)
- Phase 5 — `@cmd-hub/node` runtime + move UI implementations + rewrite examples (Tasks 5.1–5.12)

---

## Phase 0 — Preflight

Establish a clean starting point and freeze the golden-scraper assertion set.

### Task 0.1: Baseline tree state + test snapshot

**Files:**
- None modified; inspection only.

- [ ] **Step 1: Capture the current state of packages/**

Run: `ls -la packages/ && ls -la examples/`
Expected output: `packages/cmd-hub/`, `packages/cmd-node/`, `packages/create-cmd-node/`, and `examples/telegram-ui-app/`, `examples/scraper-node/` present.

- [ ] **Step 2: Capture current test pass count on both packages**

Run: `(cd packages/cmd-hub && npx jest -w 1 --no-coverage 2>&1 | tail -5)` and `(cd packages/cmd-node && npx jest -w 1 --no-coverage 2>&1 | tail -5)`.
Expected: cmd-hub reports `Tests: 127 passed, 127 total`; cmd-node reports `Tests: 23 passed, 23 total`. Record both numbers so you can compare at the end of each phase.

- [ ] **Step 3: Verify clean build across all four existing packages**

Run: `npx tsc --build packages/cmd-hub packages/cmd-node examples/telegram-ui-app examples/scraper-node --pretty 2>&1 | tail -5`
Expected: no output (clean exit).

### Task 0.2: Copy golden fixture to a stable location

The existing fixture lives at `packages/cmd-hub/src/distributed/__tests__/fixtures/`, which is about to be deleted. Copy it somewhere stable first.

**Files:**
- Copy: `packages/cmd-hub/src/distributed/__tests__/fixtures/expected-events.json` → `docs/superpowers/fixtures/golden-scraper/expected-events.json`
- Copy: `packages/cmd-hub/src/distributed/__tests__/fixtures/expected.csv` → `docs/superpowers/fixtures/golden-scraper/expected.csv`
- Copy: `packages/cmd-hub/src/distributed/__tests__/fixtures/golden-harness.ts` → `docs/superpowers/fixtures/golden-scraper/golden-harness.ts`

- [ ] **Step 1: Create the stable fixture directory**

Run: `mkdir -p docs/superpowers/fixtures/golden-scraper`

- [ ] **Step 2: Copy the three files**

Run:
```bash
cp packages/cmd-hub/src/distributed/__tests__/fixtures/expected-events.json docs/superpowers/fixtures/golden-scraper/
cp packages/cmd-hub/src/distributed/__tests__/fixtures/expected.csv docs/superpowers/fixtures/golden-scraper/
cp packages/cmd-hub/src/distributed/__tests__/fixtures/golden-harness.ts docs/superpowers/fixtures/golden-scraper/
```

- [ ] **Step 3: Verify**

Run: `ls -la docs/superpowers/fixtures/golden-scraper/`
Expected: three files present.

- [ ] **Step 4: Stage for review**

Run: `git add docs/superpowers/fixtures/golden-scraper/`

### Task 0.3: Root workspace sanity

**Files:**
- Inspect: `/home/data/projects/bots/scrap-hub/package.json`

- [ ] **Step 1: Confirm workspaces array**

Run: `cat package.json | head -15`
Expected: `"workspaces": ["packages/*", "examples/*"]`. If this has drifted, fix it before proceeding.

---

## Phase 1 — `@cmd-hub/common` scaffold and authoring primitives

Goal: produce a new `@cmd-hub/common` package. Move the files that both hub and node need (decorators, argument machinery, base classes, UI contracts) out of `packages/cmd-hub/` and into it. Leave the rest of `packages/cmd-hub/` intact and update its imports.

### Task 1.1: Scaffold `@cmd-hub/common`

**Files:**
- Create: `packages/cmd-hub-common/package.json`
- Create: `packages/cmd-hub-common/tsconfig.json`
- Create: `packages/cmd-hub-common/src/index.ts`
- Create: `packages/cmd-hub-common/jest.config.js`

- [ ] **Step 1: Create `package.json`**

Contents of `packages/cmd-hub-common/package.json`:

```json
{
    "name": "@cmd-hub/common",
    "version": "0.0.1",
    "main": "./build/src/index.js",
    "types": "./build/src/index.d.ts",
    "scripts": {
        "build": "tsc --build --pretty",
        "clean": "rm -rf build",
        "test": "jest --forceExit"
    },
    "license": "ISC",
    "description": "cmd-hub authoring primitives: decorators, BaseCommandService, BaseUI contracts, Application base class",
    "dependencies": {
        "mongoose": "^8.9.5",
        "reflect-metadata": "^0.2.2",
        "zod": "^3.23.0"
    },
    "devDependencies": {
        "@types/jest": "^30.0.0",
        "@types/node": "^20.0.0",
        "jest": "^30.3.0",
        "ts-jest": "^29.4.9",
        "typescript": "^5.7.3"
    }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Contents of `packages/cmd-hub-common/tsconfig.json`:

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "outDir": "./build",
        "baseUrl": "./",
        "declaration": true,
        "rootDir": "./"
    },
    "include": ["./src/**/*"],
    "exclude": ["node_modules", "build"]
}
```

- [ ] **Step 3: Create placeholder entry**

Contents of `packages/cmd-hub-common/src/index.ts`:

```ts
export const COMMON_VERSION = '0.0.1'
```

- [ ] **Step 4: Create jest config**

Contents of `packages/cmd-hub-common/jest.config.js`:

```js
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
}
```

- [ ] **Step 5: Install + verify**

Run: `npm install && ls -la node_modules/@cmd-hub/common`
Expected: symlink to `packages/cmd-hub-common`.

- [ ] **Step 6: Build**

Run: `(cd packages/cmd-hub-common && npm run build)`
Expected: clean exit; `packages/cmd-hub-common/build/src/index.js` exists.

- [ ] **Step 7: Stage for review**

Run: `git add packages/cmd-hub-common package.json package-lock.json`

### Task 1.2: Move `@CmdArgument` + `ArgumentHolder` + `ArgProxy`

**Files:**
- Move: `packages/cmd-hub/src/ui/command-processor/types/command-argument.ts` → `packages/cmd-hub-common/src/command/argument-decorator.ts`
- Move: `packages/cmd-hub/src/ui/command-processor/argument-holder.ts` → `packages/cmd-hub-common/src/command/argument-holder.ts`
- Move: `packages/cmd-hub/src/ui/command-processor/arg-proxy.ts` → `packages/cmd-hub-common/src/command/arg-proxy.ts`
- Modify: `packages/cmd-hub-common/src/index.ts`
- Modify: various files in `packages/cmd-hub/src/` that import these

- [ ] **Step 1: Find the actual file location of `@CmdArgument` decorator**

Run: `grep -rln 'export.*function CmdArgument\|export.*CmdArgument.*=' packages/cmd-hub/src/`
Note the result; the filename in the plan above is approximate. Use the actual filename you find.

- [ ] **Step 2: Copy the three files into the new package**

Run:
```bash
mkdir -p packages/cmd-hub-common/src/command
# Adjust the source paths based on what you found in Step 1.
cp packages/cmd-hub/src/ui/command-processor/types/command-argument.ts packages/cmd-hub-common/src/command/argument-decorator.ts
cp packages/cmd-hub/src/ui/command-processor/argument-holder.ts packages/cmd-hub-common/src/command/argument-holder.ts
cp packages/cmd-hub/src/ui/command-processor/arg-proxy.ts packages/cmd-hub-common/src/command/arg-proxy.ts
```

- [ ] **Step 3: Rewrite imports in the copied files**

Each copied file may have imports referencing `@core/*`, `@utils/*`, `@logger`, etc. Update them to be relative within `packages/cmd-hub-common/` OR import from a third-party package. Enumerate every import in each copied file and pick the right destination:
- `@core/types/...` → relative path within `packages/cmd-hub-common/src/`
- `reflect-metadata` → stays as is (third-party)
- anything pointing into `@cmd-hub/core` or `packages/cmd-hub/` → must be re-exported from `@cmd-hub/common` or moved here too

- [ ] **Step 4: Export from `packages/cmd-hub-common/src/index.ts`**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './command/argument-decorator'
export * from './command/argument-holder'
export * from './command/arg-proxy'
```

- [ ] **Step 5: Build `@cmd-hub/common`**

Run: `(cd packages/cmd-hub-common && npm run build)`
Expected: clean. Fix any import errors by adding the missing dependency to `@cmd-hub/common`'s `package.json` or moving the referenced file into this package.

- [ ] **Step 6: Replace originals in `packages/cmd-hub/src/` with re-exports**

Delete the source files at their old locations and replace with re-exports:

`packages/cmd-hub/src/ui/command-processor/types/command-argument.ts`:
```ts
export * from '@cmd-hub/common'
// Specifically re-exporting decorator + metadata types to avoid name bleed;
// the '@cmd-hub/common' barrel is the authoritative source.
```

Do the same for `argument-holder.ts` and `arg-proxy.ts`: each becomes a three-line re-export module pointing at `@cmd-hub/common`.

- [ ] **Step 7: Add `@cmd-hub/common` as a dependency of `packages/cmd-hub/`**

Modify `packages/cmd-hub/package.json`, adding to `dependencies`:

```json
"@cmd-hub/common": "*"
```

Run: `npm install`.

- [ ] **Step 8: Rebuild `@cmd-hub/core` and run its tests**

Run: `(cd packages/cmd-hub && npm run build && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: clean build; 127 tests still pass.

- [ ] **Step 9: Stage for review**

Run: `git add packages/cmd-hub-common packages/cmd-hub/src/ui/command-processor packages/cmd-hub/package.json package-lock.json`

### Task 1.3: Move `BaseCommandService` + data-class bases

**Files:**
- Move: `packages/cmd-hub/src/ui/types/command/service/service.ts` → `packages/cmd-hub-common/src/service/base-command-service.ts`
- Move: `packages/cmd-hub/src/ui/types/command/service/*` (other service files) → `packages/cmd-hub-common/src/service/`
- Modify: `packages/cmd-hub-common/src/index.ts` (add re-exports)
- Replace: the source files at their old location with re-export stubs

- [ ] **Step 1: Find all files in the service/ directory**

Run: `ls packages/cmd-hub/src/ui/types/command/service/`
List every file — there are likely: `service.ts`, `index.ts`, `service-data.ts` (or similar). All must be moved together.

- [ ] **Step 2: Copy the service subtree**

Run:
```bash
mkdir -p packages/cmd-hub-common/src/service
cp -r packages/cmd-hub/src/ui/types/command/service/*.ts packages/cmd-hub-common/src/service/
```

- [ ] **Step 3: Fix imports in each copied file**

For every file in `packages/cmd-hub-common/src/service/`, replace absolute imports (`@core/`, `@logger`, `@utils/`) with relative imports within the package, or with imports from npm dependencies (`mongoose`, `events`, etc.). Some imports may need to be moved alongside — track them as they surface.

- [ ] **Step 4: Export from index**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './service'
```

And create `packages/cmd-hub-common/src/service/index.ts`:

```ts
export * from './base-command-service'
export * from './service-data'   // or whatever exists
```

- [ ] **Step 5: Build `@cmd-hub/common`**

Run: `(cd packages/cmd-hub-common && npm run build)`
Expected: clean. Iterate on any failing imports — each one either gets rewritten (if the file doesn't truly need what it was importing) or triggers moving another primitive.

- [ ] **Step 6: Replace originals with re-exports**

Each original file becomes:

```ts
export * from '@cmd-hub/common'
```

- [ ] **Step 7: Rebuild cmd-hub + run tests**

Run: `(cd packages/cmd-hub && npm run build && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: clean build; 127 tests still pass.

- [ ] **Step 8: Stage for review**

Run: `git add packages/cmd-hub-common packages/cmd-hub/src/ui/types/command`

### Task 1.4: Move `BaseUI` + `IUI` + `IUIPlugin` + `BaseUIContext`

**Files:**
- Move: `packages/cmd-hub/src/ui/base-ui.ts` → `packages/cmd-hub-common/src/ui/base-ui.ts`
- Move: `packages/cmd-hub/src/ui/types/ui.ts` → `packages/cmd-hub-common/src/ui/types.ts`
- Move: `packages/cmd-hub/src/ui/types/plugin.ts` → `packages/cmd-hub-common/src/ui/plugin-types.ts`
- Move: `packages/cmd-hub/src/ui/types/context.ts` → `packages/cmd-hub-common/src/ui/context.ts`

- [ ] **Step 1: Copy the four files**

Run:
```bash
mkdir -p packages/cmd-hub-common/src/ui
cp packages/cmd-hub/src/ui/base-ui.ts packages/cmd-hub-common/src/ui/base-ui.ts
cp packages/cmd-hub/src/ui/types/ui.ts packages/cmd-hub-common/src/ui/types.ts
cp packages/cmd-hub/src/ui/types/plugin.ts packages/cmd-hub-common/src/ui/plugin-types.ts
cp packages/cmd-hub/src/ui/types/context.ts packages/cmd-hub-common/src/ui/context.ts
```

- [ ] **Step 2: Fix imports in each copied file**

Iterate: `(cd packages/cmd-hub-common && npm run build)`, fix one import at a time. Each error points at the file and line that needs a rewrite.

- [ ] **Step 3: Export from `packages/cmd-hub-common/src/index.ts`**

Append:

```ts
export * from './ui'
```

Create `packages/cmd-hub-common/src/ui/index.ts`:

```ts
export * from './base-ui'
export * from './types'
export * from './plugin-types'
export * from './context'
```

- [ ] **Step 4: Replace originals with re-exports**

Each original file becomes `export * from '@cmd-hub/common'`.

- [ ] **Step 5: Rebuild + run tests**

Run: `(cd packages/cmd-hub && npm run build && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: 127 tests pass.

- [ ] **Step 6: Stage for review**

Run: `git add packages/cmd-hub-common packages/cmd-hub/src/ui/base-ui.ts packages/cmd-hub/src/ui/types`

### Task 1.5: Move `UiUnicodeSymbols`, `TableDesigner`, `escapeHtml`

**Files:**
- Move: `packages/cmd-hub/src/ui/ui-unicode-symbols.ts` → `packages/cmd-hub-common/src/ui/unicode-symbols.ts`
- Move: `packages/cmd-hub/src/utils/table-designer/*` → `packages/cmd-hub-common/src/utils/table-designer/*`

- [ ] **Step 1: Copy the files**

Run:
```bash
cp packages/cmd-hub/src/ui/ui-unicode-symbols.ts packages/cmd-hub-common/src/ui/unicode-symbols.ts
mkdir -p packages/cmd-hub-common/src/utils/table-designer
cp -r packages/cmd-hub/src/utils/table-designer/* packages/cmd-hub-common/src/utils/table-designer/
```

- [ ] **Step 2: Fix imports + export from index**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './ui/unicode-symbols'
export * from './utils/table-designer'
```

Build. Iterate until clean.

- [ ] **Step 3: Replace originals with re-exports**

Same pattern as prior tasks.

- [ ] **Step 4: Run cmd-hub tests**

Run: `(cd packages/cmd-hub && npm run build && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: 127 pass.

- [ ] **Step 5: Stage for review**

Run: `git add packages/cmd-hub-common packages/cmd-hub/src/ui/ui-unicode-symbols.ts packages/cmd-hub/src/utils/table-designer`

### Task 1.6: Add `@CmdService` class decorator

**Files:**
- Create: `packages/cmd-hub-common/src/command/service-decorator.ts`
- Create: `packages/cmd-hub-common/src/command/__tests__/service-decorator.test.ts`
- Modify: `packages/cmd-hub-common/src/index.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/command/__tests__/service-decorator.test.ts`:

```ts
import 'reflect-metadata'
import { CmdService, getCmdServiceMeta } from '../service-decorator'

class FakeConfigData {}
class FakeParamsData {}
class FakeMessagesData {}

describe('CmdService', () => {
    it('stores the decorator metadata on the class', () => {
        @CmdService({
            name: 'scraper',
            description: 'scrape things',
            compatibilityId: 'com.example.scraper',
            version: '1.0.0',
            config: FakeConfigData,
            params: FakeParamsData,
            messages: FakeMessagesData,
        })
        class FakeService {}

        const meta = getCmdServiceMeta(FakeService)
        expect(meta).toEqual({
            name: 'scraper',
            description: 'scrape things',
            compatibilityId: 'com.example.scraper',
            version: '1.0.0',
            config: FakeConfigData,
            params: FakeParamsData,
            messages: FakeMessagesData,
        })
    })

    it('getCmdServiceMeta returns null for undecorated classes', () => {
        class UndecoratedClass {}
        expect(getCmdServiceMeta(UndecoratedClass)).toBeNull()
    })

    it('throws at registration time if required fields are missing', () => {
        expect(() =>
            CmdService({
                name: '',
                description: 'x',
                compatibilityId: 'x',
                version: '1.0.0',
                config: FakeConfigData,
                params: FakeParamsData,
                messages: FakeMessagesData,
            } as any)(class {}),
        ).toThrow(/name/)
    })
})
```

- [ ] **Step 2: Run the test — expect failure (module not present)**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/command/__tests__/service-decorator --no-coverage)`
Expected: `Cannot find module '../service-decorator'`.

- [ ] **Step 3: Implement the decorator**

Contents of `packages/cmd-hub-common/src/command/service-decorator.ts`:

```ts
import 'reflect-metadata'

const META_KEY = Symbol.for('cmd-hub.CmdService')

export interface CmdServiceMeta {
    name: string
    description: string
    compatibilityId: string
    version: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: new (...args: any[]) => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: new (...args: any[]) => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: new (...args: any[]) => any
}

function assertMeta(meta: CmdServiceMeta): void {
    if (!meta.name) throw new Error('@CmdService: name is required')
    if (!meta.description) throw new Error('@CmdService: description is required')
    if (!meta.compatibilityId) throw new Error('@CmdService: compatibilityId is required')
    if (!meta.version) throw new Error('@CmdService: version is required')
    if (!meta.config) throw new Error('@CmdService: config class is required')
    if (!meta.params) throw new Error('@CmdService: params class is required')
    if (!meta.messages) throw new Error('@CmdService: messages class is required')
    if (!/^\d+\.\d+\.\d+/.test(meta.version)) {
        throw new Error(`@CmdService: version must be semver, got "${meta.version}"`)
    }
}

export function CmdService(meta: CmdServiceMeta): ClassDecorator {
    return (target) => {
        assertMeta(meta)
        Reflect.defineMetadata(META_KEY, meta, target)
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCmdServiceMeta(cls: any): CmdServiceMeta | null {
    return Reflect.getMetadata(META_KEY, cls) ?? null
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/command/__tests__/service-decorator --no-coverage)`
Expected: `Tests: 3 passed`.

- [ ] **Step 5: Export from the package index**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './command/service-decorator'
```

- [ ] **Step 6: Rebuild cmd-hub regression check**

Run: `(cd packages/cmd-hub && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: 127 tests still pass.

- [ ] **Step 7: Stage for review**

Run: `git add packages/cmd-hub-common/src/command/service-decorator.ts packages/cmd-hub-common/src/command/__tests__ packages/cmd-hub-common/src/index.ts`

### Task 1.7: Add `CommandArgumentHolder.fromMap`

**Files:**
- Modify: `packages/cmd-hub-common/src/command/argument-holder.ts`
- Create: `packages/cmd-hub-common/src/command/__tests__/argument-holder-from-map.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/command/__tests__/argument-holder-from-map.test.ts`:

```ts
import 'reflect-metadata'
import { CmdArgument } from '../argument-decorator'
import { CommandArgumentHolder } from '../argument-holder'

class DataCls {
    @CmdArgument({ required: true, position: 1, description: 'Query' })
    query!: string

    @CmdArgument({ required: false, description: 'City' })
    city?: string

    @CmdArgument({ required: false, description: 'Limit', defaultValue: '100' })
    limit?: string
}

describe('CommandArgumentHolder.fromMap', () => {
    it('populates fields from a flat string map', () => {
        const instance = CommandArgumentHolder.fromMap(DataCls, { query: 'coffee', city: 'Berlin' })
        expect(instance.query).toBe('coffee')
        expect(instance.city).toBe('Berlin')
    })

    it('applies defaults for missing non-required fields', () => {
        const instance = CommandArgumentHolder.fromMap(DataCls, { query: 'coffee' })
        expect(instance.query).toBe('coffee')
        expect(instance.limit).toBe('100')
    })

    it('throws when a required field is missing', () => {
        expect(() => CommandArgumentHolder.fromMap(DataCls, { city: 'Berlin' })).toThrow(/query/)
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/command/__tests__/argument-holder-from-map --no-coverage)`
Expected: either `fromMap is not a function` or an import error. Either way, fails.

- [ ] **Step 3: Implement `fromMap` on `CommandArgumentHolder`**

Open `packages/cmd-hub-common/src/command/argument-holder.ts`. Add (after the existing class body; find a natural spot inside the class):

```ts
    /**
     * Build a populated data-class instance from a flat string map.
     * Reads @CmdArgument metadata off the class; required fields must be
     * present in the map; missing non-required fields take defaultValue.
     */
    static fromMap<T extends object>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Cls: new (...args: any[]) => T,
        args: Record<string, string>,
    ): T {
        const instance = new Cls()
        const fields = CommandArgumentHolder.describe(Cls)  // existing reflection helper
        for (const field of fields) {
            const raw = args[field.name]
            if (raw !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(instance as any)[field.name] = raw
            } else if (field.required) {
                throw new Error(`${Cls.name}.${field.name} is required`)
            } else if (field.defaultValue !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(instance as any)[field.name] = field.defaultValue
            }
        }
        return instance
    }
```

If `describe` doesn't exist on `CommandArgumentHolder`, find the equivalent method that enumerates decorated fields. Use whatever method already returns `[{ name, required, defaultValue, ... }]`. If no such method exists, write one first — it should be a plain reflection over `Reflect.getMetadata`.

- [ ] **Step 4: Run — expect pass**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/command/__tests__/argument-holder-from-map --no-coverage)`
Expected: `Tests: 3 passed`.

- [ ] **Step 5: Regression: run entire cmd-hub suite**

Run: `(cd packages/cmd-hub && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: 127 pass.

- [ ] **Step 6: Stage for review**

Run: `git add packages/cmd-hub-common/src/command/argument-holder.ts packages/cmd-hub-common/src/command/__tests__`

### Task 1.8: Add `buildCommandFromDecorator` helper

**Files:**
- Create: `packages/cmd-hub-common/src/command/build-command.ts`
- Create: `packages/cmd-hub-common/src/command/__tests__/build-command.test.ts`
- Modify: `packages/cmd-hub-common/src/index.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/command/__tests__/build-command.test.ts`:

```ts
import 'reflect-metadata'
import { CmdArgument } from '../argument-decorator'
import { CmdService } from '../service-decorator'
import { buildCommandFromDecorator } from '../build-command'

class CfgCls {
    @CmdArgument({ required: true, position: 1, description: 'Query' })
    query!: string
    @CmdArgument({ required: false, description: 'City', defaultValue: '' })
    city?: string
}
class ParCls {}
class MsgCls {
    @CmdArgument({ required: false, standalone: true, description: 'Pause' })
    pause?: void
}

@CmdService({
    name: 'scraper',
    description: 'scrape',
    compatibilityId: 'com.example.scraper',
    version: '1.0.0',
    config: CfgCls, params: ParCls, messages: MsgCls,
})
class FakeService {}

describe('buildCommandFromDecorator', () => {
    it('builds a Command with merged ArgSpecs from config + params + messages', () => {
        const cmd = buildCommandFromDecorator(FakeService)
        expect(cmd.name).toBe('scraper')
        expect(cmd.description).toBe('scrape')
        expect(cmd.compatibilityId).toBe('com.example.scraper')
        expect(cmd.version).toBe('1.0.0')
        const argNames = cmd.args.map((a) => a.name)
        expect(argNames).toEqual(expect.arrayContaining(['query', 'city', 'pause']))
        const query = cmd.args.find((a) => a.name === 'query')!
        expect(query.required).toBe(true)
        expect(query.position).toBe(1)
    })

    it('throws on an undecorated service class', () => {
        class Unadorned {}
        expect(() => buildCommandFromDecorator(Unadorned)).toThrow(/@CmdService/)
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/command/__tests__/build-command --no-coverage)`
Expected: module-not-found.

- [ ] **Step 3: Implement the helper**

Contents of `packages/cmd-hub-common/src/command/build-command.ts`:

```ts
import { getCmdServiceMeta } from './service-decorator'
import { CommandArgumentHolder } from './argument-holder'

export interface ProtoArgSpec {
    name: string
    position: number
    required: boolean
    type: string
    description: string
    enumValues: string[]
    defaultValue: string
    standalone: boolean
}

export interface ProtoCommand {
    name: string
    compatibilityId: string
    version: string
    description: string
    args: ProtoArgSpec[]
    aliases: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCommandFromDecorator(ServiceClass: any): ProtoCommand {
    const meta = getCmdServiceMeta(ServiceClass)
    if (!meta) {
        throw new Error(`buildCommandFromDecorator: ${ServiceClass.name ?? '(anon)'} is not decorated with @CmdService`)
    }

    const args: ProtoArgSpec[] = []
    for (const DataCls of [meta.config, meta.params, meta.messages]) {
        const fields = CommandArgumentHolder.describe(DataCls) // existing reflection helper
        for (const f of fields) {
            args.push({
                name: f.name,
                position: f.position ?? 0,
                required: f.required ?? false,
                type: f.type ?? 'string',
                description: f.description ?? '',
                enumValues: f.pairOptions ?? [],
                defaultValue: f.defaultValue ?? '',
                standalone: f.standalone ?? false,
            })
        }
    }

    return {
        name: meta.name,
        compatibilityId: meta.compatibilityId,
        version: meta.version,
        description: meta.description,
        args,
        aliases: [],
    }
}
```

If `CommandArgumentHolder.describe(DataCls)` returns a different shape than the per-field `{ name, required, position, defaultValue, pairOptions, standalone, description, type }` object above, adapt this code accordingly. The goal: produce the flat `ProtoArgSpec[]` from the union of all three decorated classes' fields.

- [ ] **Step 4: Run — expect pass**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/command/__tests__/build-command --no-coverage)`
Expected: `Tests: 2 passed`.

- [ ] **Step 5: Export + regression**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './command/build-command'
```

Run: `(cd packages/cmd-hub && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: 127 pass.

- [ ] **Step 6: Stage for review**

Run: `git add packages/cmd-hub-common/src/command/build-command.ts packages/cmd-hub-common/src/command/__tests__ packages/cmd-hub-common/src/index.ts`

---

## Phase 2 — `@cmd-hub/transport` scaffold and distributed primitives

Goal: produce `@cmd-hub/transport`. Move the contents of `packages/cmd-hub/src/distributed/` into it. Delete the old `packages/cmd-hub/src/distributed/` subtree. `cmd-hub`'s tests that depended on distributed will temporarily break; they are rewritten in Phase 4.

### Task 2.1: Scaffold `@cmd-hub/transport`

**Files:**
- Create: `packages/cmd-hub-transport/package.json`
- Create: `packages/cmd-hub-transport/tsconfig.json`
- Create: `packages/cmd-hub-transport/src/index.ts`
- Create: `packages/cmd-hub-transport/jest.config.js`

- [ ] **Step 1: Create `package.json`**

Contents of `packages/cmd-hub-transport/package.json`:

```json
{
    "name": "@cmd-hub/transport",
    "version": "0.0.1",
    "main": "./build/src/index.js",
    "types": "./build/src/index.d.ts",
    "scripts": {
        "build": "tsc --build --pretty",
        "clean": "rm -rf build",
        "test": "jest --forceExit",
        "gen-proto": "bash scripts/gen-proto.sh"
    },
    "license": "ISC",
    "description": "cmd-hub distributed primitives: protobuf, registry, pool, FileService, gRPC, mTLS",
    "dependencies": {
        "@cmd-hub/common": "*",
        "@grpc/grpc-js": "^1.10.0",
        "bcryptjs": "^3.0.3",
        "express": "^5.0.1",
        "mongoose": "^8.9.5",
        "node-forge": "^1.4.0"
    },
    "devDependencies": {
        "@types/bcryptjs": "^2.4.6",
        "@types/express": "^5.0.0",
        "@types/jest": "^30.0.0",
        "@types/node": "^20.0.0",
        "@types/node-forge": "^1.3.14",
        "@types/supertest": "^7.2.0",
        "grpc-tools": "^1.13.1",
        "jest": "^30.3.0",
        "mongodb-memory-server": "^10.4.3",
        "supertest": "^7.2.2",
        "ts-jest": "^29.4.9",
        "ts-proto": "^2.11.6",
        "typescript": "^5.7.3"
    }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Contents of `packages/cmd-hub-transport/tsconfig.json`:

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "outDir": "./build",
        "baseUrl": "./",
        "declaration": true,
        "rootDir": "./"
    },
    "include": ["./src/**/*"],
    "exclude": ["node_modules", "build"]
}
```

- [ ] **Step 3: Create `src/index.ts`**

```ts
export const TRANSPORT_VERSION = '0.0.1'
```

- [ ] **Step 4: Create jest config**

Contents of `packages/cmd-hub-transport/jest.config.js`:

```js
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
}
```

- [ ] **Step 5: Install + verify**

Run: `npm install && ls node_modules/@cmd-hub/transport`
Expected: symlink present.

- [ ] **Step 6: Build**

Run: `(cd packages/cmd-hub-transport && npm run build)`
Expected: clean.

- [ ] **Step 7: Stage for review**

Run: `git add packages/cmd-hub-transport package.json package-lock.json`

### Task 2.2: Move protobuf + codegen + types

**Files:**
- Move: `packages/cmd-hub/src/grpc/protos/*.proto` → `packages/cmd-hub-transport/src/grpc/protos/`
- Move: `packages/cmd-hub/src/grpc/generated/*.ts` → `packages/cmd-hub-transport/src/grpc/generated/`
- Move: `packages/cmd-hub/scripts/gen-proto.sh` → `packages/cmd-hub-transport/scripts/gen-proto.sh`
- Move: `packages/cmd-hub/src/distributed/types.ts` → `packages/cmd-hub-transport/src/types.ts`

- [ ] **Step 1: Copy files**

Run:
```bash
mkdir -p packages/cmd-hub-transport/src/grpc/{protos,generated}
mkdir -p packages/cmd-hub-transport/scripts
cp -r packages/cmd-hub/src/grpc/protos/*.proto packages/cmd-hub-transport/src/grpc/protos/
cp -r packages/cmd-hub/src/grpc/generated/*.ts packages/cmd-hub-transport/src/grpc/generated/
cp packages/cmd-hub/scripts/gen-proto.sh packages/cmd-hub-transport/scripts/gen-proto.sh
cp packages/cmd-hub/src/distributed/types.ts packages/cmd-hub-transport/src/types.ts
chmod +x packages/cmd-hub-transport/scripts/gen-proto.sh
```

- [ ] **Step 2: Fix `gen-proto.sh` paths**

Open `packages/cmd-hub-transport/scripts/gen-proto.sh`. The script referenced paths relative to cmd-hub's root. Now it's in `packages/cmd-hub-transport/`. Adjust `OUT_DIR`, `PROTO_DIR`, and the `npm bin` resolution (hoisted to repo root: `../../node_modules/.bin/...`).

- [ ] **Step 3: Regenerate to verify correctness**

Run: `bash packages/cmd-hub-transport/scripts/gen-proto.sh`
Expected: regenerates `cmd_node.ts` and `file_service.ts` into `packages/cmd-hub-transport/src/grpc/generated/`. Diff the output against the old copy; should be byte-identical (we didn't change the .proto).

- [ ] **Step 4: Fix imports in types.ts**

Any import from `@core/*` or elsewhere in the cmd-hub tree: rewrite to a relative path within `packages/cmd-hub-transport/` or an npm package.

- [ ] **Step 5: Export from `src/index.ts`**

Append to `packages/cmd-hub-transport/src/index.ts`:

```ts
export * as CmdHubProto from './grpc/generated/cmd_node'
export * from './grpc/generated/cmd_node'   // named re-exports
export * from './types'
```

- [ ] **Step 6: Build**

Run: `(cd packages/cmd-hub-transport && npm run build)`
Expected: clean.

- [ ] **Step 7: Stage for review**

Run: `git add packages/cmd-hub-transport/src/grpc packages/cmd-hub-transport/scripts packages/cmd-hub-transport/src/types.ts packages/cmd-hub-transport/src/index.ts`

### Task 2.3: Move the rest of `distributed/` wholesale

**Files:**
- Move every subdirectory of `packages/cmd-hub/src/distributed/` (except `types.ts` — already moved) into `packages/cmd-hub-transport/src/`:
  - `distributed/registry/` → `src/registry/`
  - `distributed/pool/` → `src/pool/`
  - `distributed/files/` → `src/files/`
  - `distributed/auth/` → `src/auth/`
  - `distributed/metrics/` → `src/metrics/`
  - `distributed/grpc-server/` → `src/grpc-server/`
  - `distributed/client/` → `src/client/`
  - `distributed/db/` → `src/db/`
  - `distributed/builtins/` — **DO NOT MOVE.** These are hub-only built-ins; they were my parallel reimplementation; they stay in `packages/cmd-hub/` but as deletion candidates in Phase 4.
  - `distributed/dispatcher/` — **DO NOT MOVE.** Same reason.
  - `distributed/app/` — **DO NOT MOVE.** `CmdHubApp` is hub-only; its fate is Phase 4.
  - `distributed/session/` — **DO NOT MOVE.** Hub-only.

- [ ] **Step 1: Move the listed subdirectories**

Run (each cp line):
```bash
cp -r packages/cmd-hub/src/distributed/registry  packages/cmd-hub-transport/src/registry
cp -r packages/cmd-hub/src/distributed/pool      packages/cmd-hub-transport/src/pool
cp -r packages/cmd-hub/src/distributed/files     packages/cmd-hub-transport/src/files
cp -r packages/cmd-hub/src/distributed/auth      packages/cmd-hub-transport/src/auth
cp -r packages/cmd-hub/src/distributed/metrics   packages/cmd-hub-transport/src/metrics
cp -r packages/cmd-hub/src/distributed/grpc-server packages/cmd-hub-transport/src/grpc-server
cp -r packages/cmd-hub/src/distributed/client    packages/cmd-hub-transport/src/client
cp -r packages/cmd-hub/src/distributed/db        packages/cmd-hub-transport/src/db
```

- [ ] **Step 2: Move the CA helper**

Run: `cp packages/cmd-hub/src/cli/ca.ts packages/cmd-hub-transport/src/ca.ts`

- [ ] **Step 3: Fix imports in every moved file**

Any import from `@core/*`, `@logger`, `@utils/*`, `../../` that points outside the transport package now resolves to `@cmd-hub/common` (for `BaseCommandService`, decorators, unicode symbols) or to internal relative paths (for sibling transport modules). Iterate:

Run: `(cd packages/cmd-hub-transport && npm run build)`
Fix one import at a time until the build is clean.

- [ ] **Step 4: Export everything from `src/index.ts`**

Append to `packages/cmd-hub-transport/src/index.ts`:

```ts
export * from './registry/cmd-node-registry'
export * from './pool/command-pool'
export * from './pool/manifest-aggregator'
export * from './files/types'
export * from './files/file-service'
export * from './files/gridfs-backend'
export * from './files/upload-endpoint'
export * from './auth/types'
export * from './auth/internal-cert-verifier'
export * from './auth/internal-token-verifier'
export * from './metrics/metric-store'
export * from './grpc-server/cmd-hub-service-impl'
export * from './grpc-server/server'
export * from './grpc-server/tls'
export * from './client/cmd-node-client'
export * from './client/grpc-cmd-node-client'
export * from './db/node-record.model'
export * from './db/file-metadata.model'
export * from './ca'
```

Some of these may not exist as barrel files today (e.g. `registry/` might not have an `index.ts`). If so, export directly from the underlying file.

- [ ] **Step 5: Build + run transport tests**

Run: `(cd packages/cmd-hub-transport && npm run build && npx jest -w 1 --no-coverage 2>&1 | tail -8)`
Expected: build clean; tests that moved over run. Count them.

- [ ] **Step 6: Stage for review**

Run: `git add packages/cmd-hub-transport/src`

### Task 2.4: Delete `packages/cmd-hub/src/distributed/` (transport-moved parts only)

**Files:**
- Delete: `packages/cmd-hub/src/distributed/{registry,pool,files,auth,metrics,grpc-server,client,db}/`
- Delete: `packages/cmd-hub/src/distributed/types.ts`
- Delete: `packages/cmd-hub/src/grpc/` (now in transport)
- Delete: `packages/cmd-hub/scripts/gen-proto.sh`
- Delete: `packages/cmd-hub/src/cli/ca.ts`

- [ ] **Step 1: Remove the moved subdirectories**

Run:
```bash
rm -rf packages/cmd-hub/src/distributed/registry
rm -rf packages/cmd-hub/src/distributed/pool
rm -rf packages/cmd-hub/src/distributed/files
rm -rf packages/cmd-hub/src/distributed/auth
rm -rf packages/cmd-hub/src/distributed/metrics
rm -rf packages/cmd-hub/src/distributed/grpc-server
rm -rf packages/cmd-hub/src/distributed/client
rm -rf packages/cmd-hub/src/distributed/db
rm packages/cmd-hub/src/distributed/types.ts
rm -rf packages/cmd-hub/src/grpc
rm packages/cmd-hub/scripts/gen-proto.sh
rm packages/cmd-hub/src/cli/ca.ts
```

- [ ] **Step 2: Add `@cmd-hub/transport` as dependency of `packages/cmd-hub/`**

Modify `packages/cmd-hub/package.json`, add to `dependencies`:

```json
"@cmd-hub/transport": "*"
```

Run: `npm install`.

- [ ] **Step 3: Update `packages/cmd-hub/src/index.ts` barrel to pull transport exports where appropriate**

Any top-level re-export that previously pointed at `./distributed/*` or `./grpc/*` should now point at `@cmd-hub/transport`. The export list in `packages/cmd-hub/src/index.ts` will have many stale entries — update them one by one. Many will become pass-through re-exports from `@cmd-hub/transport`.

- [ ] **Step 4: Build cmd-hub**

Run: `(cd packages/cmd-hub && npm run build 2>&1 | tail -20)`
Expected: MANY errors (distributed/builtins/ and distributed/dispatcher/ and distributed/app/ still import from the moved subtree). That's expected; Phase 4 deletes those. For now, **just delete the failing imports' downstream files**:

- `packages/cmd-hub/src/distributed/builtins/` — delete the whole directory
- `packages/cmd-hub/src/distributed/dispatcher/` — delete
- `packages/cmd-hub/src/distributed/app/` — delete
- `packages/cmd-hub/src/distributed/session/` — delete
- `packages/cmd-hub/src/distributed/` — remove the now-empty directory

Also delete the test fixtures moved in Phase 0 (we already copied them to docs/): `packages/cmd-hub/src/distributed/__tests__/` — remove.

Finally delete my parallel CLI: `packages/cmd-hub/src/cli/cmd-hub-cli.ts` and its test — gone.

- [ ] **Step 5: Rebuild cmd-hub**

Run: `(cd packages/cmd-hub && npm run build 2>&1 | tail -10)`
Expected: clean OR a small number of imports in `src/index.ts` that referenced the deleted directories. Remove those export lines from `src/index.ts`.

- [ ] **Step 6: Run cmd-hub tests**

Run: `(cd packages/cmd-hub && npx jest -w 1 --no-coverage 2>&1 | tail -8)`
Expected: the 127-test count has dropped significantly (the deleted suites took their tests with them). The count is whatever remains from non-distributed tests. Record the new number.

- [ ] **Step 7: Run transport tests**

Run: `(cd packages/cmd-hub-transport && npx jest -w 1 --no-coverage 2>&1 | tail -8)`
Expected: the tests that moved with `distributed/` now run here. Record count.

- [ ] **Step 8: Stage for review**

Run: `git add packages/cmd-hub packages/cmd-hub-transport package-lock.json`

### Task 2.5: Delete `packages/cmd-node/` (abandoned)

The abandoned node package from the 2026-04-23 attempt lives at `packages/cmd-node/`. `@cmd-hub/node` at `packages/cmd-hub-node/` will supersede it in Phase 5. Delete now so the tree is clean.

**Files:**
- Delete: `packages/cmd-node/` entirely

- [ ] **Step 1: Remove the directory**

Run: `rm -rf packages/cmd-node`

- [ ] **Step 2: Verify npm workspaces picks this up**

Run: `npm install && ls node_modules/cmd-node 2>&1`
Expected: `ls: cannot access`. The symlink is gone.

- [ ] **Step 3: Stage for review**

Run: `git add -u && git add package-lock.json`

### Task 2.6: Remove distributed references from `examples/`

The `examples/telegram-ui-app/src/telegram-hub-ui.ts` adapter and the `examples/scraper-node/src/invoke-bridge.ts` and `examples/scraper-node/src/node-config.ts` all reference the abandoned distributed layer. Delete them; we'll rewrite these examples in Phase 5 on top of the new architecture.

**Files:**
- Delete: `examples/telegram-ui-app/src/telegram-hub-ui.ts`
- Delete: `examples/telegram-ui-app/src/config.ts` (our env-based version)
- Delete: `examples/scraper-node/src/invoke-bridge.ts`
- Delete: `examples/scraper-node/src/node-config.ts`
- Reset: `examples/telegram-ui-app/src/index.ts` and `examples/scraper-node/src/index.ts` to empty stubs — they get rewritten in Phase 5

- [ ] **Step 1: Delete the adapter + config files**

Run:
```bash
rm -f examples/telegram-ui-app/src/telegram-hub-ui.ts
rm -f examples/telegram-ui-app/src/config.ts
rm -f examples/scraper-node/src/invoke-bridge.ts
rm -f examples/scraper-node/src/node-config.ts
```

- [ ] **Step 2: Reset example index.ts files to placeholder stubs**

Contents of `examples/telegram-ui-app/src/index.ts`:

```ts
/* eslint-disable no-console */
// Rewritten in Phase 5 of the package-split plan.
console.log('telegram-ui-app placeholder; rewrite pending')
process.exit(1)
```

Contents of `examples/scraper-node/src/index.ts`:

```ts
/* eslint-disable no-console */
// Rewritten in Phase 5 of the package-split plan.
console.log('scraper-node placeholder; rewrite pending')
process.exit(1)
```

- [ ] **Step 3: Strip the now-broken dependencies from the example package.jsons**

Open `examples/telegram-ui-app/package.json`. Remove from `dependencies`: `zod`, `socks-proxy-agent`, `https-proxy-agent`, `@grpc/grpc-js` if listed. Keep `@cmd-hub/core` only (plus mongoose and telegraf which we'll need in Phase 5).

Open `examples/scraper-node/package.json`. Remove `cmd-node`, `@grpc/grpc-js`. Keep `@cmd-hub/core` only (will be updated in Phase 5 to depend on `@cmd-hub/node`).

- [ ] **Step 4: Build examples to confirm stubs compile**

Run: `(cd examples/telegram-ui-app && npx tsc --build --pretty)` and `(cd examples/scraper-node && npx tsc --build --pretty)`
Expected: clean.

- [ ] **Step 5: Stage for review**

Run: `git add examples package-lock.json`

---

## Phase 3 — `Application` base + middleware + composable config

Goal: move `Application` + `LockManager` into `@cmd-hub/common`. Strip Mongo/ConfigRegistry-migration from `Application.Initialize()` — those become middlewares. Add `.use()`, `Phase`, `IAppMiddleware`, `ConfigContributor`, composable-schema loading. Ship `MongoMiddleware`, `ProxyMiddleware`, `AppLockMiddleware` in `@cmd-hub/common`.

### Task 3.1: Move `Application` + `LockManager`

**Files:**
- Move: `packages/cmd-hub/src/application/app.ts` → `packages/cmd-hub-common/src/application/application.ts`
- Move: `packages/cmd-hub/src/application/logger.ts` → `packages/cmd-hub-common/src/application/logger.ts`
- Move: `packages/cmd-hub/src/utils/lock-manager.ts` → `packages/cmd-hub-common/src/application/lock-manager.ts`
- Replace originals with re-exports

- [ ] **Step 1: Copy files**

Run:
```bash
mkdir -p packages/cmd-hub-common/src/application
cp packages/cmd-hub/src/application/app.ts packages/cmd-hub-common/src/application/application.ts
cp packages/cmd-hub/src/application/logger.ts packages/cmd-hub-common/src/application/logger.ts
cp packages/cmd-hub/src/utils/lock-manager.ts packages/cmd-hub-common/src/application/lock-manager.ts
```

- [ ] **Step 2: Fix imports in the copied files**

Iterate builds until clean. Imports like `@core/config`, `@logger` that resolve to cmd-hub internals need rewriting. Some will need relative paths within common; others will point at moved dependencies.

- [ ] **Step 3: Export from package index**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './application/application'
export * from './application/logger'
export * from './application/lock-manager'
```

- [ ] **Step 4: Replace originals with re-exports**

Each original file becomes a three-line `export * from '@cmd-hub/common'`.

- [ ] **Step 5: Build + run cmd-hub regression**

Run: `(cd packages/cmd-hub && npm run build && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: still passing (whatever count from Task 2.4).

- [ ] **Step 6: Stage for review**

Run: `git add packages/cmd-hub-common/src/application packages/cmd-hub/src/application packages/cmd-hub/src/utils/lock-manager.ts`

### Task 3.2: Strip Mongo/ConfigRegistry logic from `Application.Initialize()`

**Files:**
- Modify: `packages/cmd-hub-common/src/application/application.ts`

- [ ] **Step 1: Read the current Initialize() implementation**

Open `packages/cmd-hub-common/src/application/application.ts`. Locate `async Initialize()`. It likely does: load config, acquire lock, connect Mongo, migrate ConfigRegistry.

- [ ] **Step 2: Remove Mongo connect + ConfigRegistry migration**

Delete the `MongoConnect(...)` call and the `ConfigRegistry.migrateToMongoDB(...)` call. They will be reintroduced as middleware in Task 3.7. Keep: lock-manager acquisition, signal handler registration, error interceptor, banner.

- [ ] **Step 3: Build + cmd-hub regression**

Run: `(cd packages/cmd-hub-common && npm run build && cd ../.. && cd packages/cmd-hub && npx jest -w 1 --no-coverage 2>&1 | tail -5)`
Expected: may fail because the existing tests assumed Mongo was auto-connected. Note which tests fail. They will pass again after Task 3.7 + Phase 4 rewires the bootstrap.

- [ ] **Step 4: Stage for review**

Run: `git add packages/cmd-hub-common/src/application/application.ts`

### Task 3.3: Add `Phase` enum + middleware types

**Files:**
- Create: `packages/cmd-hub-common/src/application/phase.ts`
- Create: `packages/cmd-hub-common/src/application/middleware-types.ts`
- Create: `packages/cmd-hub-common/src/application/__tests__/phase.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/application/__tests__/phase.test.ts`:

```ts
import { Phase } from '../phase'

describe('Phase', () => {
    it('defines the five expected phases in ascending order', () => {
        expect(Phase.Infrastructure).toBe(10)
        expect(Phase.Storage).toBe(20)
        expect(Phase.Transport).toBe(30)
        expect(Phase.Services).toBe(40)
        expect(Phase.UI).toBe(50)
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/phase --no-coverage)`
Expected: module-not-found.

- [ ] **Step 3: Implement Phase**

Contents of `packages/cmd-hub-common/src/application/phase.ts`:

```ts
export enum Phase {
    Infrastructure = 10,
    Storage = 20,
    Transport = 30,
    Services = 40,
    UI = 50,
}
```

- [ ] **Step 4: Implement middleware types**

Contents of `packages/cmd-hub-common/src/application/middleware-types.ts`:

```ts
import type { z } from 'zod'
import type { Phase } from './phase'

// Avoid a circular import on Application itself; middlewares only know they
// receive "some app-like object" during install.
export interface AppLike {
    readonly config: unknown
}

export interface IAppMiddleware {
    readonly name?: string
    readonly phase: Phase
    install(app: AppLike): Promise<void> | void
    uninstall?(app: AppLike): Promise<void> | void
}

export type AppMiddleware =
    | IAppMiddleware
    | ((app: AppLike) => Promise<void | (() => Promise<void> | void)> | void | (() => Promise<void> | void))

export interface ConfigContributor {
    readonly namespace: string
    readonly schema: z.ZodType<unknown>
}

export function isConfigContributor(x: unknown): x is ConfigContributor {
    return typeof x === 'object' && x !== null &&
        typeof (x as ConfigContributor).namespace === 'string' &&
        typeof (x as ConfigContributor).schema === 'object'
}
```

- [ ] **Step 5: Run the Phase test**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/phase --no-coverage)`
Expected: `Tests: 1 passed`.

- [ ] **Step 6: Export from package index**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './application/phase'
export * from './application/middleware-types'
```

- [ ] **Step 7: Stage for review**

Run: `git add packages/cmd-hub-common/src/application/phase.ts packages/cmd-hub-common/src/application/middleware-types.ts packages/cmd-hub-common/src/application/__tests__ packages/cmd-hub-common/src/index.ts`

### Task 3.4: Add `.use()` + phase-sorted install/uninstall to `Application`

**Files:**
- Modify: `packages/cmd-hub-common/src/application/application.ts`
- Create: `packages/cmd-hub-common/src/application/__tests__/use.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/application/__tests__/use.test.ts`:

```ts
import { Application } from '../application'
import { IAppMiddleware, AppLike } from '../middleware-types'
import { Phase } from '../phase'

// Minimal concrete subclass for testing. Skips real config loading by using
// the inlineConfig escape hatch (added in Task 3.5).
class TestApp extends Application<{ k: string }> {
    async run(): Promise<void> { /* no-op */ }
}

function recordingMiddleware(label: string, phase: Phase, log: string[]): IAppMiddleware {
    return {
        name: label,
        phase,
        install: () => { log.push(`install:${label}`) },
        uninstall: () => { log.push(`uninstall:${label}`) },
    }
}

describe('Application.use()', () => {
    it('installs middlewares sorted by phase; uninstalls in reverse order', async () => {
        const log: string[] = []
        const app = new TestApp({
            configPath: '', baseSchema: require('zod').z.object({ k: require('zod').z.string().default('v') }),
            inlineConfig: { k: 'v' },
        })
        app.use(recordingMiddleware('transport', Phase.Transport, log))
        app.use(recordingMiddleware('storage', Phase.Storage, log))
        app.use(recordingMiddleware('infrastructure', Phase.Infrastructure, log))

        await app.Initialize()
        expect(log).toEqual(['install:infrastructure', 'install:storage', 'install:transport'])

        await app.terminate()
        expect(log).toEqual([
            'install:infrastructure', 'install:storage', 'install:transport',
            'uninstall:transport', 'uninstall:storage', 'uninstall:infrastructure',
        ])
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/use --no-coverage)`
Expected: most likely `app.use is not a function`. Before Task 3.5 is done, this test also fails on the `inlineConfig` parameter — that's fine; Task 3.5 adds it.

- [ ] **Step 3: Implement `.use()`**

In `packages/cmd-hub-common/src/application/application.ts`, add:

```ts
import { Phase } from './phase'
import { IAppMiddleware, AppMiddleware, AppLike } from './middleware-types'

// Inside the Application class body:
private readonly _middlewares: IAppMiddleware[] = []

use(mw: AppMiddleware): this {
    if (typeof mw === 'function') {
        // Function-form: wrap into IAppMiddleware with a default phase.
        const fnMw: IAppMiddleware = {
            phase: Phase.Infrastructure,
            install: async (app: AppLike) => {
                const maybeTeardown = await mw(app)
                if (typeof maybeTeardown === 'function') {
                    // Attach teardown onto the middleware itself via closure.
                    ;(fnMw as IAppMiddleware & { _teardown?: () => unknown })._teardown = maybeTeardown
                }
            },
            uninstall: async () => {
                const t = (fnMw as IAppMiddleware & { _teardown?: () => Promise<void> | void })._teardown
                if (typeof t === 'function') await t()
            },
        }
        this._middlewares.push(fnMw)
    } else {
        this._middlewares.push(mw)
    }
    return this
}

// Modify Initialize() to run middleware install, sorted by phase
// (insert this block AFTER the existing lock acquire + signal handlers,
// but BEFORE the banner/ready log).
protected async _installMiddlewares(): Promise<void> {
    const sorted = [...this._middlewares].sort((a, b) => a.phase - b.phase)
    for (const mw of sorted) {
        await mw.install(this as unknown as AppLike)
    }
}

protected async _uninstallMiddlewares(): Promise<void> {
    const sorted = [...this._middlewares].sort((a, b) => b.phase - a.phase)
    for (const mw of sorted) {
        if (mw.uninstall) {
            try { await mw.uninstall(this as unknown as AppLike) }
            catch (e) { /* log and continue — one middleware's teardown should not block others */ }
        }
    }
}
```

Then call `await this._installMiddlewares()` near the end of `Initialize()`, and `await this._uninstallMiddlewares()` at the start of `terminate()`.

- [ ] **Step 4: Run the use test**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/use --no-coverage)`
Expected: should pass once Task 3.5 adds `inlineConfig` support. Until then, this test is blocked.

Revisit this test after Task 3.5 to confirm pass.

- [ ] **Step 5: Stage for review**

Run: `git add packages/cmd-hub-common/src/application/application.ts packages/cmd-hub-common/src/application/__tests__`

### Task 3.5: Add `configPath` + `baseSchema` + `inlineConfig` to Application constructor

**Files:**
- Modify: `packages/cmd-hub-common/src/application/application.ts`
- Create: `packages/cmd-hub-common/src/application/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/application/__tests__/config.test.ts`:

```ts
import { Application } from '../application'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

class TestApp extends Application<{ foo: string }> {
    async run(): Promise<void> {}
}

const SCHEMA = z.object({ foo: z.string() })

describe('Application config loading', () => {
    it('loads config from the provided JSON file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
        const cfgPath = path.join(dir, 'config.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ foo: 'hello' }))

        const app = new TestApp({ configPath: cfgPath, baseSchema: SCHEMA })
        await app.Initialize()
        expect(app.config.foo).toBe('hello')
        await app.terminate()
    })

    it('inlineConfig bypasses file loading', async () => {
        const app = new TestApp({
            configPath: '/does/not/exist',
            baseSchema: SCHEMA,
            inlineConfig: { foo: 'inline' },
        })
        await app.Initialize()
        expect(app.config.foo).toBe('inline')
        await app.terminate()
    })

    it('throws clearly when config file is missing', async () => {
        const app = new TestApp({ configPath: '/nope/config.json', baseSchema: SCHEMA })
        await expect(app.Initialize()).rejects.toThrow(/config/)
    })

    it('throws on invalid JSON', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
        const cfgPath = path.join(dir, 'config.json')
        fs.writeFileSync(cfgPath, 'not-json{{')
        const app = new TestApp({ configPath: cfgPath, baseSchema: SCHEMA })
        await expect(app.Initialize()).rejects.toThrow()
    })

    it('throws on schema validation failure with named path', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
        const cfgPath = path.join(dir, 'config.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ foo: 42 }))
        const app = new TestApp({ configPath: cfgPath, baseSchema: SCHEMA })
        await expect(app.Initialize()).rejects.toThrow(/foo/)
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/config --no-coverage)`
Expected: either compile error (constructor doesn't accept these options) or runtime failure.

- [ ] **Step 3: Modify Application constructor + Initialize**

In `packages/cmd-hub-common/src/application/application.ts`:

```ts
import { z } from 'zod'
import * as fs from 'fs/promises'

// Change the generic to carry Cfg.
export abstract class Application<Cfg = unknown> {
    readonly config!: Cfg   // definitely-assigned after Initialize()

    constructor(readonly opts: {
        configPath: string
        baseSchema: z.ZodType<unknown>
        inlineConfig?: Cfg
    }) {
        // existing fields...
    }

    // In Initialize(), as the VERY FIRST thing:
    async Initialize(): Promise<void> {
        if (this._isInited) throw new Error('Application already initialized')

        // 1. Build the merged schema from baseSchema + all contributors.
        const mergedSchema = this._buildMergedSchema()

        // 2. Load config.
        let raw: unknown
        if (this.opts.inlineConfig !== undefined) {
            raw = this.opts.inlineConfig
        } else {
            let text: string
            try {
                text = await fs.readFile(this.opts.configPath, 'utf8')
            } catch (e) {
                throw new Error(`cannot read config at ${this.opts.configPath}: ${(e as Error).message}`)
            }
            try {
                raw = JSON.parse(text)
            } catch (e) {
                throw new Error(`invalid JSON in ${this.opts.configPath}: ${(e as Error).message}`)
            }
        }

        // 3. Validate.
        ;(this as unknown as { config: Cfg }).config = mergedSchema.parse(raw) as Cfg

        // ... existing Initialize() body (lock, signals, error interceptor, middleware install)
    }

    private _buildMergedSchema(): z.ZodType<unknown> {
        // Placeholder until Task 3.6 adds contributor discovery.
        return this.opts.baseSchema
    }
}
```

- [ ] **Step 4: Run the config test + the use test**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__ --no-coverage)`
Expected: both suites pass.

- [ ] **Step 5: Stage for review**

Run: `git add packages/cmd-hub-common/src/application/application.ts packages/cmd-hub-common/src/application/__tests__/config.test.ts`

### Task 3.6: Implement `ConfigContributor` discovery + schema merging

**Files:**
- Modify: `packages/cmd-hub-common/src/application/application.ts`
- Create: `packages/cmd-hub-common/src/application/__tests__/contributors.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/application/__tests__/contributors.test.ts`:

```ts
import { Application } from '../application'
import { Phase } from '../phase'
import { ConfigContributor, IAppMiddleware } from '../middleware-types'
import { z } from 'zod'

class TestApp extends Application<{ base: number; added?: { n: string } }> {
    async run(): Promise<void> {}
}

const mwContributor: IAppMiddleware & ConfigContributor = {
    phase: Phase.Storage,
    namespace: 'added',
    schema: z.object({ n: z.string() }),
    install: () => undefined,
}

describe('Config contributor discovery', () => {
    it('merges middleware contributor schemas with baseSchema', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({ base: z.number() }),
            inlineConfig: { base: 1, added: { n: 'hello' } },
        }).use(mwContributor)

        await app.Initialize()
        expect(app.config.added?.n).toBe('hello')
        await app.terminate()
    })

    it('throws on namespace collision with overlapping keys', async () => {
        const a: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'shared', install: () => undefined,
            schema: z.object({ x: z.string() }),
        }
        const b: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'shared', install: () => undefined,
            schema: z.object({ x: z.string() }),  // same key
        }
        const app = new TestApp({
            configPath: '', baseSchema: z.object({ base: z.number() }),
            inlineConfig: { base: 1, shared: { x: '1' } },
        }).use(a).use(b)
        await expect(app.Initialize()).rejects.toThrow(/shared/)
    })

    it('merges disjoint slices in the same namespace', async () => {
        const a: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'tls', install: () => undefined,
            schema: z.object({ caCertPath: z.string() }),
        }
        const b: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'tls', install: () => undefined,
            schema: z.object({ serverCertPath: z.string() }),
        }
        const app = new (Application as any)({
            configPath: '',
            baseSchema: z.object({ base: z.number() }),
            inlineConfig: {
                base: 1,
                tls: { caCertPath: '/ca.crt', serverCertPath: '/hub.crt' },
            },
        })
        app.use(a); app.use(b)
        await app.Initialize()
        expect(app.config.tls.caCertPath).toBe('/ca.crt')
        expect(app.config.tls.serverCertPath).toBe('/hub.crt')
        await app.terminate()
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/contributors --no-coverage)`
Expected: tests fail (contributor-aware merge not implemented).

- [ ] **Step 3: Implement contributor discovery in `_buildMergedSchema`**

Modify `packages/cmd-hub-common/src/application/application.ts`:

```ts
import { isConfigContributor, ConfigContributor } from './middleware-types'

private _buildMergedSchema(): z.ZodType<unknown> {
    const base = this.opts.baseSchema
    if (!(base instanceof z.ZodObject)) {
        // If user passed a non-object schema, we can't merge into it.
        return base
    }

    // Collect contributors from middlewares (Task 3.6),
    // UIs (added in Phase 4's CmdHubApp), services (added in Phase 5).
    const contributors: ConfigContributor[] = []
    for (const mw of this._middlewares) {
        if (isConfigContributor(mw)) contributors.push(mw)
    }
    // Hook for subclasses to add their own contributors.
    contributors.push(...this._collectSubclassContributors())

    // Accumulate slices by namespace, detecting collisions.
    const namespaceSchemas = new Map<string, z.ZodObject<z.ZodRawShape>>()
    for (const c of contributors) {
        if (!(c.schema instanceof z.ZodObject)) {
            throw new Error(`contributor "${c.namespace}" schema must be a ZodObject`)
        }
        const existing = namespaceSchemas.get(c.namespace)
        if (!existing) {
            namespaceSchemas.set(c.namespace, c.schema)
            continue
        }
        // Disjoint-keys merge: if any key overlaps, it's a collision.
        const existingShape = existing.shape
        const newShape = c.schema.shape
        for (const key of Object.keys(newShape)) {
            if (key in existingShape) {
                throw new Error(
                    `config namespace collision: "${c.namespace}.${key}" is declared by ` +
                    `multiple contributors`,
                )
            }
        }
        namespaceSchemas.set(c.namespace, existing.merge(c.schema as z.ZodObject<z.ZodRawShape>))
    }

    // Extend the base schema with each namespace.
    let merged: z.ZodObject<z.ZodRawShape> = base as z.ZodObject<z.ZodRawShape>
    for (const [ns, schema] of namespaceSchemas) {
        merged = merged.extend({ [ns]: schema })
    }
    return merged
}

// Subclass hook — CmdHubApp/CmdNodeApp can contribute their own.
protected _collectSubclassContributors(): ConfigContributor[] {
    return []
}
```

- [ ] **Step 4: Run the contributors test**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/application/__tests__/contributors --no-coverage)`
Expected: `Tests: 3 passed`.

- [ ] **Step 5: Stage for review**

Run: `git add packages/cmd-hub-common/src/application/application.ts packages/cmd-hub-common/src/application/__tests__`

### Task 3.7: Implement `MongoMiddleware`

**Files:**
- Create: `packages/cmd-hub-common/src/middleware/mongo-middleware.ts`
- Create: `packages/cmd-hub-common/src/middleware/__tests__/mongo-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/middleware/__tests__/mongo-middleware.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { MongoMiddleware } from '../mongo-middleware'
import { Application } from '../../application/application'
import { z } from 'zod'

class TestApp extends Application<{ mongo: { url: string; migrateConfigRegistry: boolean } }> {
    async run(): Promise<void> {}
}

describe('MongoMiddleware', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    }, 120_000)
    afterAll(async () => { await rs.stop() })

    it('connects mongoose on install and disconnects on uninstall', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: { mongo: { url: rs.getUri('mw-test'), migrateConfigRegistry: false } },
        }).use(new MongoMiddleware())
        await app.Initialize()
        expect(mongoose.connection.readyState).toBe(1)  // connected
        await app.terminate()
        expect(mongoose.connection.readyState).toBe(0)  // disconnected
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/middleware/__tests__/mongo-middleware --no-coverage)`
Expected: module-not-found.

- [ ] **Step 3: Implement**

Contents of `packages/cmd-hub-common/src/middleware/mongo-middleware.ts`:

```ts
import mongoose from 'mongoose'
import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, AppLike } from '../application/middleware-types'
import { Phase } from '../application/phase'

export class MongoMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'MongoMiddleware'
    readonly phase = Phase.Storage
    readonly namespace = 'mongo'
    readonly schema = z.object({
        url: z.string().min(1),
        migrateConfigRegistry: z.boolean().default(false),
    })

    async install(app: AppLike): Promise<void> {
        const cfg = (app.config as { mongo: { url: string; migrateConfigRegistry: boolean } }).mongo
        await mongoose.connect(cfg.url)
        if (cfg.migrateConfigRegistry) {
            // Lazy-require so this file doesn't depend on cmd-hub's ConfigRegistry.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { ConfigRegistry } = require('@cmd-hub/core') as any
            if (ConfigRegistry?.migrateToMongoDB) {
                await ConfigRegistry.migrateToMongoDB()
            }
        }
    }

    async uninstall(_app: AppLike): Promise<void> {
        await mongoose.disconnect()
    }
}
```

Note: this uses a lazy-require to avoid taking a hard dependency on `@cmd-hub/core` (circular). If `ConfigRegistry` doesn't live in `@cmd-hub/core` yet, this code is safe — the require-then-check pattern silently falls through.

- [ ] **Step 4: Run — expect pass**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/middleware/__tests__/mongo-middleware --no-coverage)`
Expected: `Tests: 1 passed`.

- [ ] **Step 5: Export**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './middleware/mongo-middleware'
```

- [ ] **Step 6: Stage for review**

Run: `git add packages/cmd-hub-common/src/middleware packages/cmd-hub-common/src/index.ts`

### Task 3.8: Implement `ProxyMiddleware`

**Files:**
- Create: `packages/cmd-hub-common/src/middleware/proxy-middleware.ts`
- Create: `packages/cmd-hub-common/src/middleware/__tests__/proxy-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub-common/src/middleware/__tests__/proxy-middleware.test.ts`:

```ts
import { ProxyMiddleware } from '../proxy-middleware'
import { Application } from '../../application/application'
import { z } from 'zod'

class TestApp extends Application<{ proxy: { socks: string | null; https: string | null } }> {
    async run(): Promise<void> {}
    get context() { return (this as unknown as { _context: Record<string, unknown> })._context ??= {} }
}

describe('ProxyMiddleware', () => {
    it('creates a SOCKS agent when config.proxy.socks is set', async () => {
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { proxy: { socks: 'socks5://127.0.0.1:1080', https: null } },
        }).use(new ProxyMiddleware())
        await app.Initialize()
        expect((app.context as { httpAgent?: unknown }).httpAgent).toBeDefined()
        await app.terminate()
    })

    it('does nothing when no proxy urls are set', async () => {
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { proxy: { socks: null, https: null } },
        }).use(new ProxyMiddleware())
        await app.Initialize()
        expect((app.context as { httpAgent?: unknown }).httpAgent).toBeUndefined()
        await app.terminate()
    })
})
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement**

Contents of `packages/cmd-hub-common/src/middleware/proxy-middleware.ts`:

```ts
import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, AppLike } from '../application/middleware-types'
import { Phase } from '../application/phase'

// Lazy-require to avoid requiring these modules unless proxy is configured.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireLocal = require as (id: string) => unknown

export class ProxyMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'ProxyMiddleware'
    readonly phase = Phase.Infrastructure
    readonly namespace = 'proxy'
    readonly schema = z.object({
        socks: z.string().nullable().default(null),
        https: z.string().nullable().default(null),
    })

    install(app: AppLike): void {
        const cfg = (app.config as { proxy: { socks: string | null; https: string | null } }).proxy
        const context = (app as unknown as { context: Record<string, unknown> }).context ?? {}
        ;(app as unknown as { context: Record<string, unknown> }).context = context

        if (cfg.socks) {
            const { SocksProxyAgent } = requireLocal('socks-proxy-agent') as {
                SocksProxyAgent: new (url: string) => unknown
            }
            context.httpAgent = new SocksProxyAgent(cfg.socks)
        } else if (cfg.https) {
            const { HttpsProxyAgent } = requireLocal('https-proxy-agent') as {
                HttpsProxyAgent: new (url: string) => unknown
            }
            context.httpAgent = new HttpsProxyAgent(cfg.https)
        }
    }
}
```

Note: the optional socks-proxy-agent and https-proxy-agent packages need to be listed as *optional peer dependencies* of `@cmd-hub/common`, or the test harness needs them installed at the repo root. Add them to `@cmd-hub/common`'s `devDependencies` to get them installed in the workspace, and document in the class docstring that production users need to install whichever agent they want.

- [ ] **Step 4: Install the peer deps at the workspace root**

Run:
```bash
cd packages/cmd-hub-common
npm install --save-dev socks-proxy-agent https-proxy-agent
```

- [ ] **Step 5: Run the test**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/middleware/__tests__/proxy-middleware --no-coverage)`
Expected: `Tests: 2 passed`.

- [ ] **Step 6: Export + stage**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './middleware/proxy-middleware'
```

Run: `git add packages/cmd-hub-common package-lock.json`

### Task 3.9: Implement `AppLockMiddleware`

**Files:**
- Create: `packages/cmd-hub-common/src/middleware/app-lock-middleware.ts`
- Create: `packages/cmd-hub-common/src/middleware/__tests__/app-lock-middleware.test.ts`

- [ ] **Step 1: Test + implementation pattern same as above**

Contents of `packages/cmd-hub-common/src/middleware/app-lock-middleware.ts`:

```ts
import { z } from 'zod'
import * as fs from 'fs'
import { IAppMiddleware, ConfigContributor, AppLike } from '../application/middleware-types'
import { Phase } from '../application/phase'

export class AppLockMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'AppLockMiddleware'
    readonly phase = Phase.Infrastructure
    readonly namespace = 'appLock'
    readonly schema = z.object({
        lockFile: z.string().min(1),
    })

    private acquiredPath: string | null = null

    install(app: AppLike): void {
        const cfg = (app.config as { appLock: { lockFile: string } }).appLock
        if (fs.existsSync(cfg.lockFile)) {
            const pid = fs.readFileSync(cfg.lockFile, 'utf8').trim()
            if (pid && isProcessAlive(Number(pid))) {
                throw new Error(`another instance is running (pid ${pid}); lock file: ${cfg.lockFile}`)
            }
            // Stale lock — overwrite below.
        }
        fs.writeFileSync(cfg.lockFile, String(process.pid), { mode: 0o600 })
        this.acquiredPath = cfg.lockFile
    }

    uninstall(_app: AppLike): void {
        if (this.acquiredPath && fs.existsSync(this.acquiredPath)) {
            fs.unlinkSync(this.acquiredPath)
        }
        this.acquiredPath = null
    }
}

function isProcessAlive(pid: number): boolean {
    if (!pid || Number.isNaN(pid)) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
}
```

Contents of `packages/cmd-hub-common/src/middleware/__tests__/app-lock-middleware.test.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AppLockMiddleware } from '../app-lock-middleware'
import { Application } from '../../application/application'
import { z } from 'zod'

class TestApp extends Application<{ appLock: { lockFile: string } }> {
    async run(): Promise<void> {}
}

describe('AppLockMiddleware', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'))

    it('acquires the lock on install and releases on uninstall', async () => {
        const lockFile = path.join(tmpDir, 't1.lock')
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { appLock: { lockFile } },
        }).use(new AppLockMiddleware())
        await app.Initialize()
        expect(fs.existsSync(lockFile)).toBe(true)
        await app.terminate()
        expect(fs.existsSync(lockFile)).toBe(false)
    })

    it('refuses to start when lock is held by a running process', async () => {
        const lockFile = path.join(tmpDir, 't2.lock')
        fs.writeFileSync(lockFile, String(process.pid))  // current pid is alive
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { appLock: { lockFile } },
        }).use(new AppLockMiddleware())
        await expect(app.Initialize()).rejects.toThrow(/another instance/)
        fs.unlinkSync(lockFile)
    })

    it('overwrites stale lock (process not alive)', async () => {
        const lockFile = path.join(tmpDir, 't3.lock')
        fs.writeFileSync(lockFile, '999999')  // hopefully not a real pid
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { appLock: { lockFile } },
        }).use(new AppLockMiddleware())
        await app.Initialize()
        expect(fs.readFileSync(lockFile, 'utf8')).toBe(String(process.pid))
        await app.terminate()
    })
})
```

- [ ] **Step 2: Run tests**

Run: `(cd packages/cmd-hub-common && npx jest -w 1 src/middleware/__tests__/app-lock-middleware --no-coverage)`
Expected: `Tests: 3 passed`.

- [ ] **Step 3: Export + stage**

Append to `packages/cmd-hub-common/src/index.ts`:

```ts
export * from './middleware/app-lock-middleware'
```

Run: `git add packages/cmd-hub-common/src/middleware/app-lock-middleware.ts packages/cmd-hub-common/src/middleware/__tests__/app-lock-middleware.test.ts packages/cmd-hub-common/src/index.ts`

---

## Phase 4 — `RemoteCmdInvoker`, `ServiceDashboard` event-sink, hub built-ins

Goal: delete `CommandInvoker` (local service execution on the hub). Replace with `RemoteCmdInvoker` that opens a gRPC stream per invocation. Refactor `ServiceDashboard` to a pure event sink (`onEvent` + `sendIntercom`). Add `GrpcServerMiddleware`, `UploadEndpointMiddleware`, `CmdNodeClientMiddleware` to `@cmd-hub/core`. Rewrite `CmdHubApp` with `.useUI()` + `.use()` on top of the refactored Application.

### Task 4.1: Refactor `ServiceDashboard` to the `onEvent` interface

**Files:**
- Modify: `packages/cmd-hub/src/ui/command-processor/dashboard/service-dashboard.ts`
- Create: `packages/cmd-hub/src/ui/command-processor/dashboard/__tests__/service-dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub/src/ui/command-processor/dashboard/__tests__/service-dashboard.test.ts`:

```ts
import { ServiceDashboard, DashboardEvent } from '../service-dashboard'

describe('ServiceDashboard event-sink API', () => {
    it('accepts a message event and calls ui.editMessage', async () => {
        const ui = { editMessage: jest.fn(), sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }) } as any
        const db = new ServiceDashboard(ui, 'u', 'session-1')
        await db.attach()
        db.onEvent({ kind: 'message', text: 'hello' })
        // Debounced 500ms; flush:
        await new Promise((r) => setTimeout(r, 600))
        expect(ui.editMessage).toHaveBeenCalled()
    })

    it('accepts a done event and calls detach', async () => {
        const ui = { editMessage: jest.fn(), sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }) } as any
        const db = new ServiceDashboard(ui, 'u', 'session-2')
        await db.attach()
        db.onEvent({ kind: 'done', finalMessage: 'complete' })
        await new Promise((r) => setTimeout(r, 600))
        // After done, subsequent onEvent calls should be no-ops.
        expect(() => db.onEvent({ kind: 'message', text: 'late' })).not.toThrow()
    })

    it('sendIntercom invokes the configured callback', async () => {
        const cb = jest.fn().mockResolvedValue(undefined)
        const ui = { sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }), editMessage: jest.fn() } as any
        const db = new ServiceDashboard(ui, 'u', 'session-3', { sendIntercom: cb })
        await db.attach()
        await db.sendIntercom('pause', [])
        expect(cb).toHaveBeenCalledWith('pause', [])
    })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `(cd packages/cmd-hub && npx jest -w 1 src/ui/command-processor/dashboard --no-coverage)`
Expected: interface mismatch or compile error.

- [ ] **Step 3: Refactor `ServiceDashboard`**

Open `packages/cmd-hub/src/ui/command-processor/dashboard/service-dashboard.ts`. Major changes:

1. Delete `bindService(service)` and `unbindService()` methods.
2. Delete the constructor parameter that took a service instance.
3. Add a new `DashboardEvent` type:

```ts
export type DashboardEvent =
    | { kind: 'message'; text: string }
    | { kind: 'error'; text: string }
    | { kind: 'progress'; name: string; current: number; total: number }
    | { kind: 'progressStatus'; name: string; status: 'active' | 'done' | 'failed' | 'skipped' }
    | { kind: 'intercom'; actions: Array<{ id: string; label: string; icon: string }> }
    | { kind: 'file'; handle: unknown }
    | { kind: 'done'; finalMessage: string }
```

4. Add `onEvent(e: DashboardEvent)` that dispatches to the existing internal methods (`appendLine`, `setProgress`, `setProgressStatus`, `registerIntercom`, etc.). Map each event kind to the dashboard's existing internal state mutators.
5. Add a `sendIntercom(actionId: string, args: string[])` method configured via the options object:

```ts
interface DashboardOptions {
    sendIntercom?: (actionId: string, args: string[]) => Promise<void> | void
}
```

Constructor: `constructor(ui: IUI, userId: string, sessionId: string, options?: DashboardOptions)`.

- [ ] **Step 4: Update every call site**

Anywhere in `packages/cmd-hub/` that called `dashboard.bindService(svc)` — delete those calls (they're in the soon-to-be-deleted CommandInvoker, which Task 4.2 removes).

- [ ] **Step 5: Run the dashboard test**

Run: `(cd packages/cmd-hub && npx jest -w 1 src/ui/command-processor/dashboard --no-coverage)`
Expected: `Tests: 3 passed`.

- [ ] **Step 6: Stage**

Run: `git add packages/cmd-hub/src/ui/command-processor/dashboard`

### Task 4.2: Delete `CommandInvoker`, add `RemoteCmdInvoker`

**Files:**
- Delete: `packages/cmd-hub/src/ui/command-processor/invoker.ts`
- Create: `packages/cmd-hub/src/ui/command-processor/remote-invoker.ts`
- Create: `packages/cmd-hub/src/ui/command-processor/__tests__/remote-invoker.test.ts`

- [ ] **Step 1: Write the failing test**

Contents of `packages/cmd-hub/src/ui/command-processor/__tests__/remote-invoker.test.ts`:

```ts
import { RemoteCmdInvoker } from '../remote-invoker'
import { ManifestAggregator } from '@cmd-hub/transport'
import type { ICmdNodeClient } from '@cmd-hub/transport'

function fakeManifest(nodeId: string, cmd: string) {
    return {
        nodeId, nodeName: nodeId, version: '1.0.0',
        commands: [{ name: cmd, compatibilityId: `com.ex.${cmd}`, version: '1.0.0',
                     description: '', args: [], aliases: [] }],
        services: [], configs: [],
        hardware: {} as any, metrics: {} as any,
    }
}

describe('RemoteCmdInvoker', () => {
    it('fails fast when no pool member exists', async () => {
        const agg = new ManifestAggregator()
        const client: ICmdNodeClient = { invoke: async () => { throw new Error('should not be called') } }
        const invoker = new RemoteCmdInvoker({
            aggregator: agg, client,
            createDashboard: () => ({ attach: async () => {}, detach: async () => {},
                                       onEvent: jest.fn(), sendIntercom: async () => {} } as any),
        })
        const r = await invoker.invoke({ command: 'missing', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/no nodes available/)
    })

    it('streams events through the dashboard and resolves with done text', async () => {
        const agg = new ManifestAggregator()
        agg.attach(fakeManifest('A', 'echo'))

        const dashEvents: any[] = []
        const dashboard = {
            attach: async () => {}, detach: async () => {},
            onEvent: (e: any) => { dashEvents.push(e) },
            sendIntercom: async () => {},
        }

        const client: ICmdNodeClient = {
            invoke: async () => ({
                sessionId: 's1',
                send: async () => {},
                cancel: async () => {},
                async *events() {
                    yield { seq: 1, message: { text: 'hi' } } as any
                    yield { seq: 2, done: { finalMessage: 'bye' } } as any
                },
            }),
        }

        const invoker = new RemoteCmdInvoker({
            aggregator: agg, client,
            createDashboard: () => dashboard as any,
        })

        const r = await invoker.invoke({ command: 'echo', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(true)
        expect(r.markup.text).toBe('bye')
        expect(dashEvents.map((e) => e.kind)).toEqual(['message', 'done'])
    })
})
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement `RemoteCmdInvoker`**

Contents of `packages/cmd-hub/src/ui/command-processor/remote-invoker.ts`:

```ts
import { randomUUID } from 'crypto'
import type { ICmdNodeClient, ManifestAggregator, InvokeServer } from '@cmd-hub/transport'
import type { ServiceDashboard, DashboardEvent } from './dashboard/service-dashboard'

export interface HandleInput {
    command: string
    args: Record<string, string>
    userId: string
    uiHandle: unknown
    nodeOverride?: string
}

export interface HandleResult {
    success: boolean
    markup: { text: string }
    messageType?: 'system' | 'builder' | 'dashboard' | 'result'
}

export interface DashboardFactory {
    (session: { sessionId: string; userId: string; uiHandle: unknown }): ServiceDashboard
}

export class RemoteCmdInvoker {
    constructor(private readonly deps: {
        aggregator: ManifestAggregator
        client: ICmdNodeClient
        createDashboard: DashboardFactory
    }) {}

    async invoke(input: HandleInput): Promise<HandleResult> {
        const pool = this.deps.aggregator.getPool()
        const pick = pool.pick(
            input.command,
            input.nodeOverride ? { nodeId: input.nodeOverride } : undefined,
        )
        if (!pick) {
            const reason = input.nodeOverride
                ? `node "${input.nodeOverride}" is not a peer for /${input.command}`
                : `no nodes available for /${input.command}`
            return { success: false, markup: { text: reason }, messageType: 'system' }
        }

        const sessionId = randomUUID()
        const dashboard = this.deps.createDashboard({
            sessionId, userId: input.userId, uiHandle: input.uiHandle,
        })
        await dashboard.attach()

        const handle = await this.deps.client.invoke(pick.nodeId, {
            sessionId,
            userId: input.userId,
            commandName: input.command,
            args: input.args,
            serviceDataBlob: new Uint8Array(),
        })

        // Wire dashboard intercom clicks back to the node.
        ;(dashboard as unknown as { _sendIntercom?: typeof handle.send }).sendIntercom = async (actionId, args) => {
            await handle.send({ intercom: { actionId, args } } as never)
        }

        let finalText = ''
        let errored = false
        for await (const e of handle.events()) {
            const dashEvent = protoToDashboardEvent(e)
            if (dashEvent) dashboard.onEvent(dashEvent)
            if (e.error !== undefined) errored = true
            if (e.done !== undefined) finalText = e.done.finalMessage ?? ''
        }
        await dashboard.detach()

        if (errored) {
            return {
                success: false,
                markup: { text: finalText || 'command failed' },
                messageType: 'dashboard',
            }
        }
        return { success: true, markup: { text: finalText }, messageType: 'dashboard' }
    }
}

function protoToDashboardEvent(e: InvokeServer): DashboardEvent | null {
    if (e.message !== undefined) return { kind: 'message', text: e.message.text }
    if (e.error !== undefined) return { kind: 'error', text: e.error.text }
    if (e.progress !== undefined) {
        return {
            kind: 'progress',
            name: e.progress.name,
            current: Number(e.progress.current),
            total: Number(e.progress.total),
        }
    }
    if (e.progressStatus !== undefined) {
        return {
            kind: 'progressStatus',
            name: e.progressStatus.name,
            status: e.progressStatus.status as 'active' | 'done' | 'failed' | 'skipped',
        }
    }
    if (e.intercom !== undefined) {
        return {
            kind: 'intercom',
            actions: e.intercom.actions,
        }
    }
    if (e.file !== undefined && e.file.handle) {
        return { kind: 'file', handle: e.file.handle }
    }
    if (e.done !== undefined) {
        return { kind: 'done', finalMessage: e.done.finalMessage ?? '' }
    }
    return null
}
```

- [ ] **Step 4: Run the test**

Run: `(cd packages/cmd-hub && npx jest -w 1 src/ui/command-processor/__tests__/remote-invoker --no-coverage)`
Expected: `Tests: 2 passed`.

- [ ] **Step 5: Delete the old `CommandInvoker`**

Run: `rm packages/cmd-hub/src/ui/command-processor/invoker.ts`

- [ ] **Step 6: Update `CmdDispatcher` to use `RemoteCmdInvoker`**

Open `packages/cmd-hub/src/ui/command-processor/dispatcher.ts`. Find the place that used to call `CommandInvoker.invokeService(...)`. Replace with:

```ts
// At the top of the file
import { RemoteCmdInvoker } from './remote-invoker'

// In the class:
private _remoteInvoker: RemoteCmdInvoker | null = null

attachRemoteInvoker(invoker: RemoteCmdInvoker): void {
    this._remoteInvoker = invoker
}

// Where it used to invoke:
// Before: await CommandInvoker.invokeService(...)
// After:
if (isBuiltInFunction) {
    // existing function-invocation code path
} else {
    if (!this._remoteInvoker) {
        return { success: false, markup: { text: 'no remote invoker attached' } }
    }
    return this._remoteInvoker.invoke({ command: cmd, args, userId, uiHandle })
}
```

(The exact shape depends on how the current `dispatcher.ts` is structured; you'll need to read it and place the delegation at the natural seam.)

- [ ] **Step 7: Rebuild cmd-hub**

Run: `(cd packages/cmd-hub && npm run build 2>&1 | tail -10)`
Expected: may have errors from code that called the deleted `CommandInvoker`. Fix each — usually by deleting obsolete lines.

- [ ] **Step 8: Stage for review**

Run: `git add packages/cmd-hub/src/ui/command-processor`

### Task 4.3: Add `GrpcServerMiddleware` to `@cmd-hub/core`

**Files:**
- Create: `packages/cmd-hub/src/middleware/grpc-server-middleware.ts`
- Create: `packages/cmd-hub/src/middleware/__tests__/grpc-server-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

Test uses `mongodb-memory-server` to satisfy `CmdNodeRegistry`/`ManifestAggregator`'s Mongo needs, a trivial inline app config, and verifies the middleware starts a gRPC server on an ephemeral port.

Contents of `packages/cmd-hub/src/middleware/__tests__/grpc-server-middleware.test.ts`:

```ts
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { GrpcServerMiddleware } from '../grpc-server-middleware'
import { MongoMiddleware } from '@cmd-hub/common'
import { Application } from '@cmd-hub/common'
import { CmdHubServiceClient, NodeRecordModel } from '@cmd-hub/transport'

class TestApp extends Application<any> {
    async run(): Promise<void> {}
}

describe('GrpcServerMiddleware', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('grpc-mw-test'))
        await NodeRecordModel.init()
        await mongoose.disconnect()
    }, 120_000)
    afterAll(async () => { await rs.stop() })

    it('starts a listening gRPC server and accepts connections', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                mongo: { url: rs.getUri('grpc-mw-test'), migrateConfigRegistry: false },
                grpc: { bindAddress: '127.0.0.1:0', publicBaseUrl: 'http://127.0.0.1:0' },
                tls: { caCertPath: '', serverCertPath: '', serverKeyPath: '' },
            },
        })
            .use(new MongoMiddleware())
            .use(new GrpcServerMiddleware({ insecure: true }))  // test-only flag

        await app.Initialize()
        const boundAddress = (app as any)._grpcBoundAddress
        expect(boundAddress).toMatch(/:\d+$/)

        // Verify a client can at least connect.
        const client = new CmdHubServiceClient(boundAddress, grpc.credentials.createInsecure())
        client.close()

        await app.terminate()
    })
})
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement**

Contents of `packages/cmd-hub/src/middleware/grpc-server-middleware.ts`:

```ts
import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, Phase, AppLike } from '@cmd-hub/common'
import {
    startHubGrpcServer, CmdNodeRegistry, ManifestAggregator,
    FileService, GridFSBackend, MetricStore, InternalTokenVerifier,
    InMemoryChannelResolver, CmdNodeServiceClient,
    hubServerCredentialsFromPaths, mTlsFingerprintResolver,
} from '@cmd-hub/transport'
import mongoose from 'mongoose'

export interface GrpcServerMiddlewareOptions {
    insecure?: boolean   // test-only: use createInsecure() instead of mTLS
}

export class GrpcServerMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'GrpcServerMiddleware'
    readonly phase = Phase.Transport
    readonly namespace = 'grpc'
    readonly schema = z.object({
        bindAddress: z.string().min(1),
        publicBaseUrl: z.string().min(1),
    })

    private _handle: { shutdown(): Promise<void> } | null = null

    constructor(private readonly opts: GrpcServerMiddlewareOptions = {}) {}

    async install(app: AppLike): Promise<void> {
        const cfg = (app.config as any).grpc as { bindAddress: string; publicBaseUrl: string }
        const tls = (app.config as any).tls as {
            caCertPath?: string; serverCertPath?: string; serverKeyPath?: string
        } | undefined

        const registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier() })
        const aggregator = new ManifestAggregator()
        const metrics = new MetricStore()
        const fileService = new FileService(new GridFSBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: cfg.publicBaseUrl,
        }))
        const resolver = new InMemoryChannelResolver(
            (addr) => new CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
        )

        const credentials = this.opts.insecure
            ? grpc.ServerCredentials.createInsecure()
            : hubServerCredentialsFromPaths({
                caCertPath: tls!.caCertPath!,
                hubCertPath: tls!.serverCertPath!,
                hubKeyPath: tls!.serverKeyPath!,
            })
        const fpResolver = this.opts.insecure ? undefined : mTlsFingerprintResolver()

        this._handle = await startHubGrpcServer({
            bindAddress: cfg.bindAddress,
            credentials,
            registry,
            aggregator,
            fileService,
            metrics,
            resolveFingerprint: fpResolver,
            onNodeRegistered: (nodeId, addr) => resolver.attach(nodeId, addr),
            onNodeDisconnected: (nodeId) => resolver.detach(nodeId),
        })

        // Expose on the app so later middlewares (CmdNodeClientMiddleware) can find them.
        ;(app as any)._registry = registry
        ;(app as any)._aggregator = aggregator
        ;(app as any)._fileService = fileService
        ;(app as any)._metrics = metrics
        ;(app as any)._nodeChannelResolver = resolver
        ;(app as any)._grpcBoundAddress = this._handle.boundAddress
    }

    async uninstall(_app: AppLike): Promise<void> {
        if (this._handle) {
            await this._handle.shutdown()
            this._handle = null
        }
    }
}
```

- [ ] **Step 4: Run the test**

Run: `(cd packages/cmd-hub && npx jest -w 1 src/middleware/__tests__/grpc-server-middleware --no-coverage)`
Expected: `Tests: 1 passed`.

- [ ] **Step 5: Export + stage**

Add to `packages/cmd-hub/src/index.ts`:

```ts
export * from './middleware/grpc-server-middleware'
```

Run: `git add packages/cmd-hub/src/middleware packages/cmd-hub/src/index.ts`

### Tasks 4.4, 4.5: `UploadEndpointMiddleware`, `CmdNodeClientMiddleware`

Same shape as 4.3. Each is its own file under `packages/cmd-hub/src/middleware/`, each declares a `ConfigContributor` namespace (`upload` and none, respectively), each reads its config from `app.config`, each has a paired integration test.

For brevity, only the expected contents are listed; follow the Task 4.3 pattern.

**`UploadEndpointMiddleware`** namespace `upload`, schema `{ bindAddress: string }`. `install` mounts `makeUploadEndpoint(...)` on Express, starts `app.listen(bindAddress)`, stores the http server handle for uninstall. Test: uses `supertest` against the running server with a grant obtained from the hub's `CreateWriteGrant` RPC.

**`CmdNodeClientMiddleware`** no config contribution. `install` retrieves the `InMemoryChannelResolver` from `app._nodeChannelResolver` (set by `GrpcServerMiddleware`) and attaches a `GrpcCmdNodeClient` at `app._cmdNodeClient` so `CmdHubApp` can hand it to `RemoteCmdInvoker`. Test: dispatch flow end-to-end with a mock node.

(Full task contents expanded during implementation; this plan entry is a one-liner to avoid 400 lines of repeating boilerplate. Each task follows TDD: write failing test, implement, run pass, stage.)

- [ ] **Complete Task 4.4** — see pattern above.
- [ ] **Complete Task 4.5** — see pattern above.

### Task 4.6: Rewrite `CmdHubApp` with `.useUI()` + `.use()`

**Files:**
- Create: `packages/cmd-hub/src/cmdhub/cmd-hub-app.ts`
- Modify: `packages/cmd-hub/src/cmdhub/index.ts` to export the new class alongside the legacy `AppCmdhub`
- Create: `packages/cmd-hub/src/cmdhub/__tests__/cmd-hub-app.test.ts`

- [ ] **Step 1: Design the class surface**

`CmdHubApp<Cfg>` extends `Application<Cfg>`. Methods:
- `useUI(ui: IUI<any>): this`
- Uses `_collectSubclassContributors()` to surface each registered UI's contributor schema.
- During `run()`: call `ui.run()` for every registered UI.
- During `Initialize()` (after middleware install phase runs, in `Phase.UI`): call `ui.onAppAttach?.(this)` for every UI, then call `ui.run()`.

- [ ] **Step 2: Write the failing test**

Test composes a full app with inline config, a `FakeUI`, verifies the UI's `onAppAttach` fired.

```ts
import { CmdHubApp } from '../cmd-hub-app'
import { MongoMiddleware, Phase } from '@cmd-hub/common'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { z } from 'zod'

class FakeUI implements IUI<any>, ConfigContributor {
    readonly namespace = 'fakeui'
    readonly schema = z.object({ enabled: z.boolean().default(true) })
    attached = false
    async onAppAttach(app: any) { this.attached = true }
    async run() {}
    async terminate() {}
    async sendMessage() { return { message_id: 1 } }
    async editMessage() {}
    async deleteMessage() {}
}

describe('CmdHubApp', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => { rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } }) }, 120_000)
    afterAll(async () => { await rs.stop() })

    it('calls onAppAttach on registered UIs during Initialize', async () => {
        const ui = new FakeUI()
        const app = new CmdHubApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                mongo: { url: rs.getUri('ui-test'), migrateConfigRegistry: false },
                fakeui: { enabled: true },
            },
        }).use(new MongoMiddleware()).useUI(ui)

        await app.Initialize()
        expect(ui.attached).toBe(true)
        await app.terminate()
    })
})
```

- [ ] **Step 3: Implement**

Contents of `packages/cmd-hub/src/cmdhub/cmd-hub-app.ts`:

```ts
import { Application, ConfigContributor, isConfigContributor, Phase } from '@cmd-hub/common'
import type { IUI } from '@cmd-hub/common'
import type { AppLike } from '@cmd-hub/common'

export class CmdHubApp<Cfg = unknown> extends Application<Cfg> {
    private readonly _uis: Array<IUI<any>> = []

    useUI(ui: IUI<any>): this {
        this._uis.push(ui)
        return this
    }

    protected _collectSubclassContributors(): ConfigContributor[] {
        return this._uis.filter(isConfigContributor) as unknown as ConfigContributor[]
    }

    async run(): Promise<void> {
        // Attach then run each UI.
        for (const ui of this._uis) {
            if (typeof (ui as any).onAppAttach === 'function') {
                await (ui as any).onAppAttach(this)
            }
            await ui.run()
        }
    }

    async terminate(): Promise<void> {
        for (const ui of [...this._uis].reverse()) {
            try { await ui.terminate?.() } catch { /* best effort */ }
        }
        await super.terminate()
    }
}
```

- [ ] **Step 4: Run the test**

Run: `(cd packages/cmd-hub && npx jest -w 1 src/cmdhub/__tests__/cmd-hub-app --no-coverage)`
Expected: pass.

- [ ] **Step 5: Export + stage**

### Tasks 4.7, 4.8, 4.9, 4.10

- **4.7** Modify `/help` built-in to read from `ManifestAggregator` (aggregated remote commands) in addition to local built-ins. Test: a pool of remote commands appears in `/help` output.
- **4.8** Modify `/config` built-in to fan out `ConfigReload` RPCs via the stored `ICmdNodeClient` resolver after a write. Test: on `/config scraper.apiKey new-value`, the middleware calls the node's `ConfigReload` RPC exactly once.
- **4.9** Delete my parallel CLI at `packages/cmd-hub/src/cli/cmd-hub-cli.ts` (already gone from Phase 2). Add a new one at `packages/cmd-hub/src/cli/hub-cli.ts` using `commander`, with subcommands `start` (bootstraps `CmdHubApp` from config.json), `ca-init`, `node-add`, `node-list`, `node-rotate-token`, `node-remove`. Tests for `node-add` at minimum.
- **4.10** Run the full cmd-hub suite. Expected: all previous tests still pass; new tests for the 4.x additions pass.

(These four tasks follow the established TDD pattern; full inline expansion adds ~500 lines without new design information.)

---

## Phase 5 — `@cmd-hub/node` + UI package moves + example rewrites

Goal: produce `@cmd-hub/node`. Move event-adapter, intercom-dispatch, metrics, hub-client from the (already deleted) `packages/cmd-node/` into `@cmd-hub/node`, wrap in middlewares. Move UI implementations to their own packages. Rewrite both example apps on top of the new architecture.

### Task 5.1: Scaffold `@cmd-hub/node`

Same pattern as Task 2.1. New package at `packages/cmd-hub-node/` with `package.json`, `tsconfig.json`, empty `index.ts`, `jest.config.js`. Dependencies: `@cmd-hub/common`, `@cmd-hub/transport`, `@grpc/grpc-js`, `mongoose`, `zod`.

- [ ] Complete.

### Tasks 5.2-5.5: Port node-side runtime

- **5.2** Port `event-adapter.ts` (from the fixture-preserved `docs/superpowers/fixtures/` if needed, or reconstruct from the spec). Tests identical to the version I wrote for the abandoned `packages/cmd-node/`.
- **5.3** Port `intercom-dispatch.ts`. Tests identical.
- **5.4** Implement `HardwareInfo` and `MetricsCollector`. Tests identical.
- **5.5** Implement `HubClientMiddleware` and `InvokeServerMiddleware`. Tests identical — both middlewares contribute config namespaces (`hub` and `node` for HubClient, `invokeServer` for InvokeServer) and use the mTLS helpers from `@cmd-hub/transport`.

### Task 5.6: `CmdNodeApp` class

**Files:**
- Create: `packages/cmd-hub-node/src/app/cmd-node-app.ts`

Extends `Application<Cfg>`. Adds `useCommand(ServiceClass)`, `useCommands(arr)`, `useService(ServiceClass)` (alias). Internally builds a `Map<name, ServiceClass>`; `_collectSubclassContributors()` returns each registered ServiceClass's `configSchema` + `configNamespace` static fields. `run()` resolves once `HubClientMiddleware` reports Register success (it sets a flag on the app).

Tests: register a service, verify manifest built correctly, verify `configSchema` surfaces into the merged config schema.

### Tasks 5.7-5.9: Move UI implementations to their own packages

- **5.7** Scaffold `packages/cmd-hub-ui-telegram/`, move `packages/cmd-hub/src/ui/impls/telegram/*` into it. `TelegramUI` becomes `ConfigContributor` (namespace `telegram`, schema `{ botToken, adminUserIds }`). Constructor parameterless; reads `botToken` in `onAppAttach`. Replace `packages/cmd-hub/src/ui/impls/telegram/` with re-exports.
- **5.8** Same for `@cmd-hub/ui-cli`.
- **5.9** Same for `@cmd-hub/ui-web`.

### Task 5.10: Rewrite `examples/telegram-ui-app/src/index.ts`

**Files:**
- Rewrite: `examples/telegram-ui-app/src/index.ts`

```ts
import 'reflect-metadata'
import { CmdHubApp } from '@cmd-hub/core'
import { MongoMiddleware, ProxyMiddleware, AppLockMiddleware } from '@cmd-hub/common'
import { GrpcServerMiddleware, UploadEndpointMiddleware, CmdNodeClientMiddleware } from '@cmd-hub/core'
import { TelegramUI } from '@cmd-hub/ui-telegram'
import { z } from 'zod'

const AppSchema = z.object({
    deployment: z.object({ name: z.string().default('default') }).default({}),
})

const app = new CmdHubApp({
    configPath: process.argv[2] ?? './config.json',
    baseSchema: AppSchema,
})
    .use(new AppLockMiddleware())
    .use(new ProxyMiddleware())
    .use(new MongoMiddleware())
    .use(new GrpcServerMiddleware())
    .use(new UploadEndpointMiddleware())
    .use(new CmdNodeClientMiddleware())
    .useUI(new TelegramUI())

await app.Initialize()
await app.run()
```

- [ ] Commit `examples/telegram-ui-app/src/index.ts` + a matching `config.json.example`.

### Task 5.11: Rewrite `examples/scraper-node/src/index.ts`

Same pattern. Boot `CmdNodeApp`, `.use(MongoMiddleware).use(HubClientMiddleware).use(InvokeServerMiddleware).useCommand(OrgScraperService)`. Annotate `OrgScraperService` with `@CmdService({ name, description, compatibilityId, version, config: ScraperConfigData, params: ScraperParamsData, messages: ScraperMessagesData })` + static `configNamespace = 'scraper'` + `configSchema = z.object({ serpApiKey, yandexXmlUser, ... })`.

### Task 5.12: Re-run golden scraper test on the new stack

Copy back `docs/superpowers/fixtures/golden-scraper/expected-events.json` + `expected.csv` into `packages/cmd-hub/src/__tests__/integration/` (or wherever the integration tests live after the restructuring). Write a new loopback integration test that boots a `CmdHubApp` + a `CmdNodeApp` in-process (two `Application` instances in the same test file), registers a `FakeScraperService` on the node, dispatches `/scraper` through the hub, verifies byte-identical event sequence + CSV against the fixture.

- [ ] Run: pass.

---

## Self-review notes (plan-side)

**Spec coverage check** — walking through each section of the 2026-04-24 spec:
- Package Layout (7 packages) → Phase 1 (commons), Phase 2 (transport), Phases 3-4 (core), Phase 5 (node + UI packages). ✓
- Dependency graph → enforced by `package.json` deps in each scaffold task. ✓
- Application + middleware machinery → Phase 3 Tasks 3.1–3.9. ✓
- Phases enum → Task 3.3. ✓
- Middleware hybrid interface → Task 3.3 + 3.4. ✓
- Canonical middlewares (Mongo, Proxy, AppLock, Grpc, Upload, CmdNodeClient, HubClient, InvokeServer) → Tasks 3.7, 3.8, 3.9, 4.3, 4.4, 4.5, 5.5. ✓
- Configuration / composable schema / contributor discovery → Tasks 3.5, 3.6. ✓
- `@CmdService` decorator → Task 1.6. ✓
- `buildCommandFromDecorator` → Task 1.8. ✓
- `CommandArgumentHolder.fromMap` → Task 1.7. ✓
- `useCommand`/`useCommands`/`useService` → Task 5.6 (CmdNodeApp). ✓
- `RemoteCmdInvoker` replacing `CommandInvoker` → Task 4.2. ✓
- Dispatcher change + aggregated manifest → Task 4.2 step 6. ✓
- `ServiceDashboard` event-sink refactor → Task 4.1. ✓
- UI implementation moves → Tasks 5.7, 5.8, 5.9. ✓
- `CmdHubApp` with `.useUI()` → Task 4.6. ✓
- `CmdNodeApp` → Task 5.6. ✓
- InvokeStart handler shape (fromMap → construct → emit) → implicit in the `InvokeServerMiddleware` implementation (Task 5.5). ✓
- Hotplug semantics (carried forward unchanged) → no explicit task; inherited from existing code in `@cmd-hub/transport`. ✓
- Testing strategy → per-task test files; golden test end-to-end in Task 5.12. ✓
- Verification checklist → documented in spec; corresponds to Phase 5 exit criteria.

**Placeholder scan** — Tasks 4.4, 4.5, 5.2-5.5, 5.7-5.9 are written as one-liners pointing at patterns from earlier tasks. This is within the "summarize after a fully expanded example" density tradeoff but it's also the plan's biggest risk. If the engineer executing a subagent-driven workflow hits 4.4 (UploadEndpointMiddleware) first without context, they'd ask for clarification. Acceptable only if the executor has read 4.3 carefully. Marking this explicitly: **Tasks 4.4, 4.5, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9 are expand-during-execution** — the engineer should fully expand each using Task 4.3 (for 4.x middlewares) or Task 5.7 (for UI package moves) as the template.

**Type consistency** — `IAppMiddleware.install(app: AppLike)` signature is consistent across Tasks 3.3–3.9, 4.3–4.5, 5.5. `ConfigContributor { namespace, schema }` shape consistent throughout. `Phase` enum values consistent. `DashboardEvent` kinds match between Task 4.1 definition and Task 4.2 `protoToDashboardEvent` mapping. `RemoteCmdInvoker.invoke({ command, args, userId, uiHandle, nodeOverride? })` is the consistent signature.

**Known gap:** Tasks 4.4, 4.5, 5.2–5.5, 5.7–5.9 are not fully expanded. When executing, treat them as "one-per-session" expansions where the engineer follows the Task 4.3 (or 5.7) pattern verbatim with the appropriate substitutions.
