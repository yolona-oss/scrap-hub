# AI-Agent PR4b — Work Queue + Parent-Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory work queue keyed by org id with state transitions, plus six parent-agent tools (`harvest_serp`, `discover_org_candidates`, `list_orgs`, `pick_next_partial`, `deepen_org`, `freeze_org`) that read and write the queue. Tools are constructed by `buildTools` but **not yet exposed in any LLM phase** — PR4c wires them into a new `harvest`/`deepen+review` phase. Lands cold.

**Architecture:** Three layers. (1) `OrgRecord` type + `WorkQueue` class (in-memory, run-scoped, keyed by id) with priority pick and state transitions `partial → saturated → verified|rejected`. (2) Six new tools using a shared `WorkQueueContext = {workQueue, classifyPage, extractContacts}` injection seam. `harvest_serp` and `deepen_org` compose `classifyPage` (PR1) + `extract_contacts` (PR1+PR2 strategies + PR2 extractor escalation) + `WorkQueue` writes. `discover_org_candidates` is a read-only classification preview. `list_orgs`, `pick_next_partial`, `freeze_org` are read/state-transition operations on the queue. (3) Wiring: `buildTools` accepts a `WorkQueueContext` option; if absent (PR4b default), the queue tools are simply not added to the toolset. PR4c flips the default to "always present in the new phases."

**Tech Stack:** TypeScript, Node 20, cheerio (for shared parsing), Jest 30, the `extractor`/`classify-page` modules from PR1+PR2+PR3.

**Spec reference:** `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` §3.6 (work queue, OrgRecord), §3.7 (deepening loop), §3.10 (parent-agent tools `list_orgs`, `pick_next_partial`, `deepen_org`, `harvest_serp`, `discover_org_candidates`, `freeze_org` — `fill_gap` and `review_org` are PR4d). Decisions locked in conversation: PR4b lands cold (queue tools constructed but not phase-exposed); phase wiring is PR4c.

---

## Scope Boundaries

**IN scope (PR4b):**
- `OrgRecord` type (queue's internal record shape).
- `WorkQueue` class — store, state transitions, priority pick.
- Six tools: `harvest_serp`, `discover_org_candidates`, `list_orgs`, `pick_next_partial`, `deepen_org`, `freeze_org`.
- `WorkQueueContext` injection seam for tool construction.
- `buildTools` accepts an optional `workQueueContext` parameter; when present, queue tools are added; when absent, they are not.
- Tests for queue operations and tool handlers (with mocked classify/extract).

**NOT in scope (deferred):**
- Phase machine changes — `loop.ts` not touched. Queue tools exist but are unreachable from the LLM in PR4b.
- Prompt changes (PR4c).
- `fill_gap` (PR4d).
- `review_org` (PR4d).
- `OrgRecord → OrgData` conversion at run end. The queue is internal; `OrgData` records flow through `AsyncQueue<OrgData>` exactly as PR4a established. PR4c will route `report_extraction`-emitted records through the queue and emit `OrgData` only on `verified`/`freeze_org`.
- Branch enumeration (deferred to PR4d alongside structured `OrgAddress`).

**Why this scope:** The queue + tools form a coherent reviewable PR. Landing them inert lets PR4c focus on phase-machine wiring without blending two concerns. Existing LLM behavior is unchanged because the new tools are not reachable from any phase.

---

## File Structure

| File | Change |
|---|---|
| `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts` (new) | `OrgRecord`, `OrgFrontierEntry`, `OrgRecordStatus`, `OrgGap`, `WorkQueueContext`. |
| `examples/scraper-node/src/sources/ai-agent/work-queue/work-queue.ts` (new) | `WorkQueue` class. |
| `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/work-queue.test.ts` (new) | Queue unit tests. |
| `examples/scraper-node/src/sources/ai-agent/work-queue/index.ts` (new) | Re-exports. |
| `examples/scraper-node/src/sources/ai-agent/tools/list-orgs.ts` (new) | Tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/pick-next-partial.ts` (new) | Tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/freeze-org.ts` (new) | Tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/discover-org-candidates.ts` (new) | Tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/harvest-serp.ts` (new) | Tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/deepen-org.ts` (new) | Tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/...` (new) | One test file per tool. |
| `examples/scraper-node/src/sources/ai-agent/tools/index.ts` (modify) | Accept optional `workQueueContext` in `BuildToolsOptions`; conditionally add queue tools. |

---

## Decisions Locked Before Implementation

- **Queue is in-memory, run-scoped.** Created in `index.ts` (search source) alongside the AsyncQueue, scoped to one scraper run. No persistence. Spec §3.6 explicitly out-of-scope: "The queue is in-memory, run-scoped" (Open Question §9).
- **`OrgRecord.id`** is generated server-side (`crypto.randomUUID()` short form: first 8 hex chars suffices for human-readable in tool results, but full UUID for uniqueness). Decision: **full UUID** for uniqueness, no shortening.
- **Status transitions** enforced by the queue: `partial → saturated → verified|rejected`; `partial → rejected` allowed (validation gate). `saturated → partial` is **not allowed** — the queue rejects backsliding (use a new record if you need one). `verified` and `rejected` are terminal.
- **Priority pick** is `1 - (gaps.length / 3)` per spec §3.6. Records with fewer gaps win. Ties broken by insertion order (older first).
- **`harvest_serp` is server-side**: classifies the URL, extracts all org cards (deterministic), creates one `partial` record per card, returns ids + per-record summary. **Does NOT call the extractor sub-agent in PR4b** — that escalation already lives inside `extract_contacts`, which `deepen_org` invokes. `harvest_serp` is the broad sweep.
- **`deepen_org` is server-side state machine**: pops highest-scored frontier entry, classifies, extract_contacts'es, merges into the record. Loops until `record.status` becomes `saturated`, frontier empties, or `perOrgToolCallsUsed >= 5`. Returns the diff.
- **Per-org budget = 5** (`perOrgToolCallsUsed` cap). Spec §3.7. Configurable via existing `aiAgent.maxToolCallsPerOrg` arg — but **that arg doesn't exist yet**. Adding it is part of Task 2.
- **`discover_org_candidates` is read-only.** Classifies a URL and returns what would be added without committing. Useful for the LLM to look before leaping.
- **`list_orgs` and `pick_next_partial`** return queue entries — limited to a result-size cap (e.g. 20 records) to keep the LLM response payload bounded.
- **`freeze_org`** force-finalizes a `partial`/`saturated` record as `partial` with status retained, marking it terminal. Used at run end.
- **`OrgRecord` has both fields-from-OrgData (`phones`, `emails`, etc.) AND queue-only fields (`id`, `frontier`, `gaps`, `perOrgToolCallsUsed`).** The conversion to `OrgData` for emit happens in PR4c (it's the verified/frozen records that get emitted).
- **`WorkQueueContext` is constructed by `index.ts`** and passed through `runAgentLoop` → `buildTools`. Exact wiring is touched in PR4b (the option exists), but the runtime is unchanged because `index.ts` doesn't construct one yet (left for PR4c). Tests pass `WorkQueueContext` directly when needed.
- **Worktree:** `.worktrees/ai-agent-pr4b`, branch `feature/ai-agent-pr4b`. Already created and `npm install`ed; baseline 287/287 scraper-node + 213/213 ai-agent tests green.

---

## Task 1: Define OrgRecord types

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/types.test.ts`:

```typescript
import type {
    OrgRecord, OrgRecordStatus, OrgGap, OrgFrontierEntry, WorkQueueContext,
} from '../types'
import type { ClassifiedPage } from '../../page-types'

describe('work-queue types', () => {
    it('OrgRecordStatus has the four expected variants', () => {
        const exhaustive: Record<OrgRecordStatus, true> = {
            partial: true, saturated: true, verified: true, rejected: true,
        }
        expect(Object.keys(exhaustive).length).toBe(4)
    })

    it('OrgGap has the three expected fields', () => {
        const gaps: OrgGap[] = ['phone', 'email', 'address']
        expect(gaps.length).toBe(3)
    })

    it('OrgFrontierEntry shape', () => {
        const entry: OrgFrontierEntry = { url: 'https://x', reason: 'hint', score: 0.8 }
        expect(entry.score).toBe(0.8)
    })

    it('OrgRecord required fields', () => {
        const r: OrgRecord = {
            id: 'uuid-1',
            status: 'partial',
            name: 'Acme',
            phones: [],
            emails: [],
            addresses: [],
            sources: [],
            gaps: ['phone'],
            frontier: [],
            confidence: 0.5,
            extractionMethod: 'deterministic',
            notes: [],
            perOrgToolCallsUsed: 0,
        }
        expect(r.id).toBe('uuid-1')
        expect(r.status).toBe('partial')
    })

    it('WorkQueueContext provides classifyPage and extractContacts callbacks', () => {
        const fakeClassify = async (_url: string): Promise<ClassifiedPage> => ({
            url: _url, pageType: 'org-site', confidence: 0.5, signals: [],
            cleanedText: '', candidateBlocks: [], jsonLdBlobs: [],
            contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        })
        const fakeExtract = async (_html: string) => ({
            phones: [], emails: [], addresses: [], candidateName: '',
        })
        const ctx: WorkQueueContext = {
            classifyPage: fakeClassify,
            extractContacts: fakeExtract,
        }
        expect(typeof ctx.classifyPage).toBe('function')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4b/examples/scraper-node
npx jest src/sources/ai-agent/work-queue/__tests__/types.test.ts
```
Expected: FAIL — types not defined.

- [ ] **Step 3: Implement types**

Create `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts`:

```typescript
import type { ClassifiedPage } from '../page-types'
import type { OrgSourceRef } from '../../../types'

export type OrgRecordStatus = 'partial' | 'saturated' | 'verified' | 'rejected'

export type OrgGap = 'phone' | 'email' | 'address'

export interface OrgFrontierEntry {
    url: string
    reason: string
    score: number
}

export interface OrgRecord {
    id: string
    status: OrgRecordStatus
    name: string
    phones: string[]
    emails: string[]
    addresses: string[]
    sources: OrgSourceRef[]
    gaps: OrgGap[]
    frontier: OrgFrontierEntry[]
    confidence: number
    extractionMethod: 'deterministic' | 'extractor-llm' | 'mixed'
    notes: string[]
    perOrgToolCallsUsed: number
}

/** Extraction result the queue tools consume — shaped like extract_contacts return. */
export interface ExtractContactsResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
}

export interface WorkQueueContext {
    classifyPage: (url: string, opts?: { signal?: AbortSignal }) => Promise<ClassifiedPage>
    /** Deterministic + extractor-escalation extraction over an HTML string. */
    extractContacts: (html: string, opts?: { signal?: AbortSignal, pageUrl?: string }) => Promise<ExtractContactsResult>
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/sources/ai-agent/work-queue/__tests__/types.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/work-queue/types.ts \
        examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/types.test.ts
git commit -m "feat(ai-agent): add work-queue OrgRecord types"
```

---

## Task 2: Add maxToolCallsPerOrg arg

**Files:**
- Modify: `examples/scraper-node/src/scraper-service/args-tree.ts` (within `AIAgentSettings`)
- Modify: `examples/scraper-node/src/sources/ai-agent/config.ts`

`maxToolCallsPerOrg` was specified in §4 of the spec but not yet wired. PR4b adds it because `deepen_org` reads it.

- [ ] **Step 1: Add the field to AIAgentSettings**

Find the `AIAgentSettings` class in `examples/scraper-node/src/scraper-service/args-tree.ts` and insert this `@CmdArg` block AFTER `apiKey?: string` and BEFORE `extractor?: ExtractorSettings`:

```typescript
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Per-org deepening budget — max classify+extract operations the queue spends on a single record before freezing it.',
        type: 'number',
        choices: ['3', '5', '8', '12'],
        default: '5',
        validator: positiveInt,
    })
    maxToolCallsPerOrg?: number
```

- [ ] **Step 2: Thread into ResolvedAIAgentConfig**

In `examples/scraper-node/src/sources/ai-agent/config.ts`, add `maxToolCallsPerOrg: number` to the `ResolvedAIAgentConfig` interface (just before the `extractor` field).

In `resolveAIAgentConfig`, add the resolution line in the `resolved` object literal (between `totalTimeoutMs` and the trailing `extractor: null,`):

```typescript
        maxToolCallsPerOrg: ai.maxToolCallsPerOrg ?? 5,
```

Update the trailing log line to include `maxToolCallsPerOrg=${resolved.maxToolCallsPerOrg}`.

- [ ] **Step 3: Update existing test fixtures that construct ResolvedAIAgentConfig**

Find every `ResolvedAIAgentConfig` literal in test files:

```bash
grep -rln "ResolvedAIAgentConfig" examples/scraper-node/src --include='*.test.ts'
```

For each file, add `maxToolCallsPerOrg: 5,` to the config literal (after `totalTimeoutMs`).

- [ ] **Step 4: Verify build clean and tests pass**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npx jest src/sources/ai-agent --silent 2>&1 | tail -5
```
Expected: tsc clean, tests still passing (213/213).

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/scraper-service/args-tree.ts \
        examples/scraper-node/src/sources/ai-agent/config.ts \
        examples/scraper-node/src/sources/ai-agent/__tests__/  # if any test files updated
git commit -m "feat(ai-agent): add maxToolCallsPerOrg arg + thread into resolved config"
```

---

## Task 3: WorkQueue class — store + state transitions + priority pick

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/work-queue/work-queue.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/work-queue/index.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/work-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/work-queue.test.ts`:

```typescript
import { WorkQueue } from '../work-queue'
import type { OrgRecord } from '../types'

function newRec(overrides: Partial<OrgRecord> = {}): Omit<OrgRecord, 'id' | 'perOrgToolCallsUsed'> {
    return {
        status: 'partial',
        name: 'X',
        phones: [],
        emails: [],
        addresses: [],
        sources: [],
        gaps: ['phone', 'email', 'address'],
        frontier: [],
        confidence: 0.5,
        extractionMethod: 'deterministic',
        notes: [],
        ...overrides,
    }
}

describe('WorkQueue', () => {
    it('insert assigns a UUID and starts perOrgToolCallsUsed at 0', () => {
        const q = new WorkQueue()
        const rec = q.insert(newRec())
        expect(rec.id).toBeTruthy()
        expect(rec.id).not.toBe('')
        expect(rec.perOrgToolCallsUsed).toBe(0)
    })

    it('get returns the record by id', () => {
        const q = new WorkQueue()
        const rec = q.insert(newRec({ name: 'Acme' }))
        const got = q.get(rec.id)
        expect(got?.name).toBe('Acme')
    })

    it('get returns undefined for unknown id', () => {
        const q = new WorkQueue()
        expect(q.get('nope')).toBeUndefined()
    })

    it('list returns all records when no filter', () => {
        const q = new WorkQueue()
        q.insert(newRec({ name: 'A' }))
        q.insert(newRec({ name: 'B' }))
        expect(q.list().length).toBe(2)
    })

    it('list filters by status', () => {
        const q = new WorkQueue()
        const a = q.insert(newRec({ name: 'A' }))
        q.insert(newRec({ name: 'B' }))
        q.transition(a.id, 'verified')
        expect(q.list({ status: 'partial' }).length).toBe(1)
        expect(q.list({ status: 'verified' }).length).toBe(1)
    })

    it('transition partial → saturated allowed', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        expect(q.get(r.id)?.status).toBe('saturated')
    })

    it('transition saturated → verified allowed', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        q.transition(r.id, 'verified')
        expect(q.get(r.id)?.status).toBe('verified')
    })

    it('transition partial → rejected allowed', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'rejected')
        expect(q.get(r.id)?.status).toBe('rejected')
    })

    it('transition saturated → partial NOT allowed (throws)', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        expect(() => q.transition(r.id, 'partial')).toThrow(/transition/i)
    })

    it('transition verified → anything NOT allowed (terminal)', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'verified')
        expect(() => q.transition(r.id, 'partial')).toThrow(/terminal/i)
        expect(() => q.transition(r.id, 'rejected')).toThrow(/terminal/i)
    })

    it('pickNextPartial returns highest-priority partial (fewest gaps wins)', () => {
        const q = new WorkQueue()
        const a = q.insert(newRec({ name: 'A', gaps: ['phone', 'email', 'address'] }))
        const b = q.insert(newRec({ name: 'B', gaps: ['phone'] }))
        const c = q.insert(newRec({ name: 'C', gaps: ['phone', 'email'] }))
        const picked = q.pickNextPartial()
        expect(picked?.id).toBe(b.id)
    })

    it('pickNextPartial returns undefined when no partials remain', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'verified')
        expect(q.pickNextPartial()).toBeUndefined()
    })

    it('pickNextPartial breaks ties by insertion order (older first)', () => {
        const q = new WorkQueue()
        const a = q.insert(newRec({ name: 'A', gaps: ['phone'] }))
        const b = q.insert(newRec({ name: 'B', gaps: ['phone'] }))
        expect(q.pickNextPartial()?.id).toBe(a.id)
    })

    it('mutate returns a mutable handle for in-place updates', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.mutate(r.id, draft => {
            draft.phones.push('+78121001010')
            draft.gaps = draft.gaps.filter(g => g !== 'phone')
        })
        const after = q.get(r.id)
        expect(after?.phones).toEqual(['+78121001010'])
        expect(after?.gaps).toEqual(['email', 'address'])
    })

    it('mutate throws for unknown id', () => {
        const q = new WorkQueue()
        expect(() => q.mutate('nope', () => {})).toThrow(/not found/i)
    })

    it('mutate refuses to change id', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        // Even if a draft mutation tries to set id, the post-mutation invariant
        // restores it. The test just verifies the invariant.
        q.mutate(r.id, draft => { (draft as any).id = 'CHANGED' })
        expect(q.get(r.id)).toBeDefined()
        expect(q.get('CHANGED')).toBeUndefined()
    })

    it('list result is a defensive copy (mutations do not bleed back)', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec({ name: 'A' }))
        const list = q.list()
        list[0].name = 'MUTATED'
        expect(q.get(r.id)?.name).toBe('A')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/work-queue/__tests__/work-queue.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement WorkQueue**

Create `examples/scraper-node/src/sources/ai-agent/work-queue/work-queue.ts`:

```typescript
import { randomUUID } from 'crypto'
import { log } from '@cmd-hub/common'
import type { OrgRecord, OrgRecordStatus } from './types'

const ALLOWED_TRANSITIONS: Record<OrgRecordStatus, OrgRecordStatus[]> = {
    partial: ['saturated', 'rejected'],
    saturated: ['verified', 'rejected'],
    verified: [],
    rejected: [],
}

const TERMINAL: OrgRecordStatus[] = ['verified', 'rejected']

export interface WorkQueueListFilter {
    status?: OrgRecordStatus
    limit?: number
}

export class WorkQueue {
    private records = new Map<string, OrgRecord>()
    private insertionOrder: string[] = []

    insert(seed: Omit<OrgRecord, 'id' | 'perOrgToolCallsUsed'>): OrgRecord {
        const id = randomUUID()
        const record: OrgRecord = { ...seed, id, perOrgToolCallsUsed: 0 }
        this.records.set(id, record)
        this.insertionOrder.push(id)
        log.trace(`work-queue.insert: id=${id} name="${record.name.slice(0, 40)}"`)
        return this.cloneRecord(record)
    }

    get(id: string): OrgRecord | undefined {
        const r = this.records.get(id)
        return r ? this.cloneRecord(r) : undefined
    }

    list(filter: WorkQueueListFilter = {}): OrgRecord[] {
        let results: OrgRecord[] = []
        for (const id of this.insertionOrder) {
            const r = this.records.get(id)
            if (!r) continue
            if (filter.status && r.status !== filter.status) continue
            results.push(this.cloneRecord(r))
            if (filter.limit && results.length >= filter.limit) break
        }
        return results
    }

    pickNextPartial(): OrgRecord | undefined {
        let best: { id: string, priority: number, idx: number } | null = null
        let idx = 0
        for (const id of this.insertionOrder) {
            const r = this.records.get(id)
            if (!r || r.status !== 'partial') { idx++; continue }
            const priority = 1 - (r.gaps.length / 3)
            if (!best || priority > best.priority) {
                best = { id, priority, idx }
            }
            idx++
        }
        return best ? this.cloneRecord(this.records.get(best.id)!) : undefined
    }

    transition(id: string, target: OrgRecordStatus): void {
        const r = this.records.get(id)
        if (!r) throw new Error(`work-queue.transition: id ${id} not found`)
        if (TERMINAL.includes(r.status)) {
            throw new Error(`work-queue.transition: ${r.status} is terminal — cannot transition to ${target}`)
        }
        const allowed = ALLOWED_TRANSITIONS[r.status]
        if (!allowed.includes(target)) {
            throw new Error(`work-queue.transition: ${r.status} → ${target} is not an allowed transition`)
        }
        r.status = target
        log.debug(`work-queue.transition: id=${id} → ${target}`)
    }

    mutate(id: string, mutator: (draft: OrgRecord) => void): void {
        const r = this.records.get(id)
        if (!r) throw new Error(`work-queue.mutate: id ${id} not found`)
        const originalId = r.id
        mutator(r)
        // Defend the id invariant — mutators can't change it.
        r.id = originalId
    }

    private cloneRecord(r: OrgRecord): OrgRecord {
        return {
            ...r,
            phones: [...r.phones],
            emails: [...r.emails],
            addresses: [...r.addresses],
            sources: r.sources.map(s => ({ ...s })),
            gaps: [...r.gaps],
            frontier: r.frontier.map(f => ({ ...f })),
            notes: [...r.notes],
        }
    }

    /** For tests + telemetry: total record count. */
    size(): number {
        return this.records.size
    }
}
```

- [ ] **Step 4: Create work-queue/index.ts**

Create `examples/scraper-node/src/sources/ai-agent/work-queue/index.ts`:

```typescript
export { WorkQueue, type WorkQueueListFilter } from './work-queue'
export type {
    OrgRecord, OrgRecordStatus, OrgGap, OrgFrontierEntry,
    WorkQueueContext, ExtractContactsResult,
} from './types'
```

- [ ] **Step 5: Run tests + tsc**

```bash
npx jest src/sources/ai-agent/work-queue
npx tsc --noEmit -p tsconfig.json
```
Expected: 17 tests passing, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/work-queue/
git commit -m "feat(ai-agent): add WorkQueue with state transitions + priority pick"
```

---

## Task 4: list_orgs tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/list-orgs.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/list-orgs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/list-orgs.test.ts`:

```typescript
import { makeListOrgsTool } from '../list-orgs'
import { WorkQueue } from '../../work-queue'

const seed = (name: string) => ({
    status: 'partial' as const,
    name,
    phones: [], emails: [], addresses: [], sources: [],
    gaps: ['phone', 'email', 'address'] as const,
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
})

describe('list_orgs tool', () => {
    it('returns all records with no filter', async () => {
        const wq = new WorkQueue()
        wq.insert({ ...seed('A'), gaps: [...seed('A').gaps] })
        wq.insert({ ...seed('B'), gaps: [...seed('B').gaps] })
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({})
        expect(r.orgs).toHaveLength(2)
        expect(r.orgs.map((o: any) => o.name).sort()).toEqual(['A', 'B'])
    })

    it('filters by status', async () => {
        const wq = new WorkQueue()
        const a = wq.insert({ ...seed('A'), gaps: [...seed('A').gaps] })
        wq.insert({ ...seed('B'), gaps: [...seed('B').gaps] })
        wq.transition(a.id, 'rejected')
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({ status: 'partial' })
        expect(r.orgs).toHaveLength(1)
        expect(r.orgs[0].name).toBe('B')
    })

    it('respects limit (default 20)', async () => {
        const wq = new WorkQueue()
        for (let i = 0; i < 25; i++) {
            wq.insert({ ...seed(`org${i}`), gaps: [...seed(`org${i}`).gaps] })
        }
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({})
        expect(r.orgs).toHaveLength(20)
    })

    it('ignores unknown status filter values gracefully', async () => {
        const wq = new WorkQueue()
        wq.insert({ ...seed('A'), gaps: [...seed('A').gaps] })
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({ status: 'bogus' })
        // Implementation choice: invalid status returns all records (treats as unfiltered).
        expect(r.orgs.length).toBeGreaterThan(0)
    })

    it('returns a summary projection per org (id, status, name, gaps, sourceCount)', async () => {
        const wq = new WorkQueue()
        wq.insert({ ...seed('A'), gaps: ['phone'] })
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({})
        expect(r.orgs[0]).toMatchObject({
            id: expect.any(String),
            status: 'partial',
            name: 'A',
            gaps: ['phone'],
            sourceCount: 0,
        })
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/list-orgs.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement list_orgs**

Create `examples/scraper-node/src/sources/ai-agent/tools/list-orgs.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue } from '../work-queue'
import type { OrgRecordStatus } from '../work-queue'
import { log } from '@cmd-hub/common'

const VALID_STATUSES: OrgRecordStatus[] = ['partial', 'saturated', 'verified', 'rejected']
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

interface OrgSummary {
    id: string
    status: OrgRecordStatus
    name: string
    gaps: string[]
    sourceCount: number
    confidence: number
}

export function makeListOrgsTool(workQueue: WorkQueue): Tool {
    return {
        name: 'list_orgs',
        description: 'List orgs in the work queue. Filter by status (partial/saturated/verified/rejected) and limit (default 20, max 100). Returns id, status, name, gaps, sourceCount per record.',
        parameters: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['partial', 'saturated', 'verified', 'rejected'],
                    description: 'Filter by status. Omit for all.',
                },
                limit: {
                    type: 'number',
                    description: `Max records to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
                },
            },
        },
        async handler(args) {
            const requestedStatus = typeof args?.status === 'string' ? args.status : undefined
            const status = requestedStatus && VALID_STATUSES.includes(requestedStatus as OrgRecordStatus)
                ? (requestedStatus as OrgRecordStatus)
                : undefined
            const limit = Math.min(
                typeof args?.limit === 'number' && args.limit > 0 ? args.limit : DEFAULT_LIMIT,
                MAX_LIMIT,
            )

            const records = workQueue.list({ status, limit })
            const orgs: OrgSummary[] = records.map(r => ({
                id: r.id,
                status: r.status,
                name: r.name,
                gaps: r.gaps,
                sourceCount: r.sources.length,
                confidence: r.confidence,
            }))
            log.trace(`ai-agent.list_orgs: status=${status ?? 'any'} limit=${limit} returned=${orgs.length}`)
            return { orgs, total: workQueue.size() }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/list-orgs.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/list-orgs.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/list-orgs.test.ts
git commit -m "feat(ai-agent): add list_orgs tool"
```

---

## Task 5: pick_next_partial tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/pick-next-partial.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/pick-next-partial.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/pick-next-partial.test.ts`:

```typescript
import { makePickNextPartialTool } from '../pick-next-partial'
import { WorkQueue } from '../../work-queue'
import type { OrgGap } from '../../work-queue'

const seed = (name: string, gaps: OrgGap[] = ['phone', 'email', 'address']) => ({
    status: 'partial' as const,
    name,
    phones: [], emails: [], addresses: [], sources: [],
    gaps,
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
})

describe('pick_next_partial tool', () => {
    it('returns highest-priority partial', async () => {
        const wq = new WorkQueue()
        wq.insert(seed('A', ['phone', 'email', 'address']))
        const b = wq.insert(seed('B', ['phone']))
        wq.insert(seed('C', ['phone', 'email']))
        const tool = makePickNextPartialTool(wq)
        const r: any = await tool.handler({})
        expect(r.org?.id).toBe(b.id)
        expect(r.org?.name).toBe('B')
    })

    it('returns null when no partials remain', async () => {
        const wq = new WorkQueue()
        const a = wq.insert(seed('A'))
        wq.transition(a.id, 'rejected')
        const tool = makePickNextPartialTool(wq)
        const r: any = await tool.handler({})
        expect(r.org).toBeNull()
    })

    it('returns full record fields (not just summary)', async () => {
        const wq = new WorkQueue()
        wq.insert(seed('A', ['phone']))
        const tool = makePickNextPartialTool(wq)
        const r: any = await tool.handler({})
        expect(r.org).toMatchObject({
            id: expect.any(String),
            name: 'A',
            status: 'partial',
            gaps: ['phone'],
            phones: [],
            sources: [],
            frontier: [],
        })
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/pick-next-partial.test.ts
```

- [ ] **Step 3: Implement pick_next_partial**

Create `examples/scraper-node/src/sources/ai-agent/tools/pick-next-partial.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue } from '../work-queue'
import { log } from '@cmd-hub/common'

export function makePickNextPartialTool(workQueue: WorkQueue): Tool {
    return {
        name: 'pick_next_partial',
        description: 'Return the highest-priority partial org from the work queue (fewest gaps wins, ties by insertion order). Returns null if no partials remain. Full record returned, not just a summary.',
        parameters: {
            type: 'object',
            properties: {},
        },
        async handler(_args) {
            const org = workQueue.pickNextPartial()
            log.trace(`ai-agent.pick_next_partial: ${org ? `id=${org.id} name="${org.name.slice(0, 40)}" gaps=${org.gaps.length}` : 'none available'}`)
            return { org: org ?? null }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/pick-next-partial.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/pick-next-partial.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/pick-next-partial.test.ts
git commit -m "feat(ai-agent): add pick_next_partial tool"
```

---

## Task 6: freeze_org tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/freeze-org.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/freeze-org.test.ts`

`freeze_org` force-finalizes a `partial` or `saturated` record by transitioning it to `rejected` if the gaps make it useless, or leaving it `partial` if it has at least one contact. Spec §3.6 says "freeze_org — force-finalize a record as partial if budget runs out." So the tool keeps the status if it's useful (`partial` with at least one contact), or rejects it.

Actually, re-reading the spec: "freeze_org — force-finalize a record as partial if budget runs out" means freeze it AS partial. The point is to mark it terminal-ish — but `partial` isn't terminal in our state machine. Decision: `freeze_org` calls `transition` with target `rejected` if `phones+emails+addresses === 0`, else with target `verified` (since freezing a partial that has contacts means we accept what we have). Sound? Yes — this matches the spec's intent (finalize) without adding a fifth state.

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/freeze-org.test.ts`:

```typescript
import { makeFreezeOrgTool } from '../freeze-org'
import { WorkQueue } from '../../work-queue'
import type { OrgGap } from '../../work-queue'

const seed = (name: string, contacts: { phones?: string[], gaps?: OrgGap[] } = {}) => ({
    status: 'partial' as const,
    name,
    phones: contacts.phones ?? [],
    emails: [],
    addresses: [],
    sources: [],
    gaps: contacts.gaps ?? ['phone', 'email', 'address'] as OrgGap[],
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
})

describe('freeze_org tool', () => {
    it('freezes partial with contacts as verified', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A', { phones: ['+78121001010'], gaps: ['email', 'address'] }))
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(out.finalStatus).toBe('verified')
    })

    it('freezes contactless partial as rejected', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A'))
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('rejected')
        expect(out.finalStatus).toBe('rejected')
    })

    it('freezes saturated → verified', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A', { phones: ['+78121001010'], gaps: [] }))
        wq.transition(r.id, 'saturated')
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(out.finalStatus).toBe('verified')
    })

    it('returns error for unknown id', async () => {
        const wq = new WorkQueue()
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns error if record is already terminal', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A', { phones: ['+7'] }))
        wq.transition(r.id, 'rejected')
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/terminal|already/i)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/freeze-org.test.ts
```

- [ ] **Step 3: Implement freeze_org**

Create `examples/scraper-node/src/sources/ai-agent/tools/freeze-org.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue } from '../work-queue'
import { log } from '@cmd-hub/common'

export function makeFreezeOrgTool(workQueue: WorkQueue): Tool {
    return {
        name: 'freeze_org',
        description: 'Force-finalize an org record. If it has at least one contact (phone/email/address), transition to verified; otherwise to rejected. Used at run end when budget runs out.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
            },
            required: ['orgId'],
        },
        async handler(args) {
            const orgId = String(args?.orgId ?? '')
            const record = workQueue.get(orgId)
            if (!record) return { error: `org id ${orgId} not found` }
            if (record.status === 'verified' || record.status === 'rejected') {
                return { error: `org ${orgId} is already terminal (${record.status})` }
            }
            const hasContact = record.phones.length || record.emails.length || record.addresses.length
            const finalStatus = hasContact ? 'verified' : 'rejected'

            // saturated → verified is allowed; partial → rejected is allowed.
            // partial → verified is NOT a direct transition: route via saturated first.
            if (record.status === 'partial' && finalStatus === 'verified') {
                workQueue.transition(orgId, 'saturated')
            }
            workQueue.transition(orgId, finalStatus)

            log.debug(`ai-agent.freeze_org: id=${orgId} → ${finalStatus} (hadContact=${Boolean(hasContact)})`)
            return { orgId, finalStatus }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/freeze-org.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/freeze-org.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/freeze-org.test.ts
git commit -m "feat(ai-agent): add freeze_org tool"
```

---

## Task 7: discover_org_candidates tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/discover-org-candidates.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/discover-org-candidates.test.ts`

Read-only classification preview. The LLM uses this to inspect a URL before calling `harvest_serp`. No queue mutation.

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/discover-org-candidates.test.ts`:

```typescript
import { makeDiscoverOrgCandidatesTool } from '../discover-org-candidates'
import type { ClassifiedPage } from '../../page-types'

function fakeClassify(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://x', pageType: 'org-site', confidence: 0.8, signals: ['tel-link'],
        cleanedText: 'About us...', candidateBlocks: [],
        jsonLdBlobs: [],
        contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        ...partial,
    }
}

describe('discover_org_candidates tool', () => {
    it('classifies a URL and returns the summary', async () => {
        const ctx = {
            classifyPage: async () => fakeClassify({ pageType: 'aggregator-serp', signals: ['cards:8', 'pagination'] }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        expect(r.url).toBe('https://x')  // from the fake; real impl would echo input
        expect(r.pageType).toBe('aggregator-serp')
        expect(r.signals).toContain('cards:8')
    })

    it('rejects empty url', async () => {
        const ctx = {
            classifyPage: async () => fakeClassify(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: '' })
        expect(r.error).toBeDefined()
    })

    it('handles classifyPage throwing as a tool error (not throw)', async () => {
        const ctx = {
            classifyPage: async () => { throw new Error('network down') },
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.error).toMatch(/network down|fetch/i)
    })

    it('returns aggregator-related counts in the summary', async () => {
        const ctx = {
            classifyPage: async () => fakeClassify({
                pageType: 'aggregator-serp',
                jsonLdBlobs: [{}, {}, {}],
                candidateBlocks: [
                    { selector: 'header', text: 'h', tels: [], mails: [] },
                    { selector: 'footer', text: 'f', tels: ['+7'], mails: [] },
                ],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.jsonLdCount).toBe(3)
        expect(r.candidateBlockCount).toBe(2)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/discover-org-candidates.test.ts
```

- [ ] **Step 3: Implement discover_org_candidates**

Create `examples/scraper-node/src/sources/ai-agent/tools/discover-org-candidates.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueueContext } from '../work-queue'
import { log } from '@cmd-hub/common'

export function makeDiscoverOrgCandidatesTool(ctx: WorkQueueContext): Tool {
    return {
        name: 'discover_org_candidates',
        description: 'Classify a URL without committing to harvest. Returns page type, signals, and counts so you can decide whether to call harvest_serp on this URL.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to classify.' },
            },
            required: ['url'],
        },
        async handler(args, signal) {
            const url = String(args?.url ?? '').trim()
            if (!url) return { error: 'empty url' }

            log.trace(`ai-agent.discover_org_candidates: ${url}`)
            try {
                const page = await ctx.classifyPage(url, { signal })
                return {
                    url: page.url,
                    pageType: page.pageType,
                    confidence: page.confidence,
                    signals: page.signals,
                    jsonLdCount: page.jsonLdBlobs.length,
                    candidateBlockCount: page.candidateBlocks.length,
                    contactCandidateCount: page.contactCandidates.length,
                    aggregatorCandidateCount: page.aggregatorCandidates.length,
                }
            } catch (e: any) {
                log.warn(`ai-agent.discover_org_candidates: ${url}: ${e?.message ?? e}`)
                return { error: `fetch failed: ${e?.message ?? e}` }
            }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/discover-org-candidates.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/discover-org-candidates.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/discover-org-candidates.test.ts
git commit -m "feat(ai-agent): add discover_org_candidates tool"
```

---

## Task 8: harvest_serp tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/harvest-serp.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/harvest-serp.test.ts`

Server-side harvest: classifies the URL (must be `aggregator-serp`), iterates the JSON-LD `LocalBusiness` blobs, creates one `partial` record per card, returns ids.

In PR4b the LocalBusiness extraction happens via `parseJsonLdBlobs` on the classified page (already in `ClassifiedPage.jsonLdBlobs`). Each blob with `@type: LocalBusiness | Organization | ...` becomes a record seed. Spec §3.10 says "harvest_serp(url) is a parent-facing tool that runs server-side: classifies, extracts all org cards from an aggregator-serp, creates one partial record per card, returns ids and a summary." The LLM never sees raw HTML through this path.

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/harvest-serp.test.ts`:

```typescript
import { makeHarvestSerpTool } from '../harvest-serp'
import { WorkQueue } from '../../work-queue'
import type { ClassifiedPage } from '../../page-types'

function fakeClassify(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://zoon.ru/spb/medical/', pageType: 'aggregator-serp',
        confidence: 0.85, signals: [], cleanedText: '', candidateBlocks: [],
        jsonLdBlobs: [],
        contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        ...partial,
    }
}

describe('harvest_serp tool', () => {
    it('creates one partial record per LocalBusiness JSON-LD entry', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [
                    { '@type': 'LocalBusiness', name: 'Clinic A', telephone: '+78121001010' },
                    { '@type': 'LocalBusiness', name: 'Clinic B', telephone: '+78122002020' },
                    { '@type': 'WebPage', name: 'Page' }, // not a LocalBusiness — skipped
                ],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx)
        const r: any = await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        expect(r.created).toBe(2)
        expect(wq.size()).toBe(2)
        const orgs = wq.list()
        expect(orgs.map(o => o.name).sort()).toEqual(['Clinic A', 'Clinic B'])
        expect(orgs[0].phones).toContain('+78121001010')
    })

    it('refuses to harvest non-aggregator-serp pages', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({ pageType: 'org-site' }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.error).toMatch(/not.*aggregator-serp|wrong page type/i)
        expect(wq.size()).toBe(0)
    })

    it('records the source ref with kind="aggregator-serp" on each created record', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                url: 'https://zoon.ru/spb/medical/',
                jsonLdBlobs: [{ '@type': 'LocalBusiness', name: 'A', telephone: '+7' }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx)
        await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        const orgs = wq.list()
        expect(orgs[0].sources).toHaveLength(1)
        expect(orgs[0].sources[0].kind).toBe('aggregator-serp')
        expect(orgs[0].sources[0].url).toBe('https://zoon.ru/spb/medical/')
    })

    it('records gaps based on what was extracted', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [{
                    '@type': 'LocalBusiness',
                    name: 'A',
                    telephone: '+78121001010',
                    // No email, no address.
                }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx)
        await tool.handler({ url: 'https://x' })
        const orgs = wq.list()
        expect(orgs[0].gaps.sort()).toEqual(['address', 'email'])
    })

    it('returns 0 created when no LocalBusiness entries found', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [{ '@type': 'WebPage' }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.created).toBe(0)
        expect(wq.size()).toBe(0)
    })

    it('rejects empty url', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx)
        const r: any = await tool.handler({ url: '' })
        expect(r.error).toMatch(/empty url/i)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/harvest-serp.test.ts
```

- [ ] **Step 3: Implement harvest_serp**

Create `examples/scraper-node/src/sources/ai-agent/tools/harvest-serp.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue, OrgGap } from '../work-queue'
import type { WorkQueueContext } from '../work-queue'
import type { OrgSourceRef } from '../../../types'
import { log } from '@cmd-hub/common'

const LOCAL_BUSINESS_TYPE_RE = /LocalBusiness|Organization|MedicalBusiness|Dentist/i

function isLocalBusiness(blob: unknown): boolean {
    if (!blob || typeof blob !== 'object') return false
    const t = (blob as any)['@type']
    if (typeof t === 'string') return LOCAL_BUSINESS_TYPE_RE.test(t)
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && LOCAL_BUSINESS_TYPE_RE.test(x))
    return false
}

function flattenAddress(a: unknown): string | null {
    if (!a) return null
    if (typeof a === 'string') return a
    if (typeof a === 'object') {
        const obj = a as Record<string, unknown>
        const parts = [obj.streetAddress, obj.addressLocality, obj.postalCode]
            .filter(p => typeof p === 'string') as string[]
        if (parts.length) return parts.join(', ')
    }
    return null
}

function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1)
    if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
    if (digits.length === 10) return '+7' + digits
    return raw.trim()
}

function computeGaps(phones: string[], emails: string[], addresses: string[]): OrgGap[] {
    const gaps: OrgGap[] = []
    if (phones.length === 0) gaps.push('phone')
    if (emails.length === 0) gaps.push('email')
    if (addresses.length === 0) gaps.push('address')
    return gaps
}

export function makeHarvestSerpTool(workQueue: WorkQueue, ctx: WorkQueueContext): Tool {
    return {
        name: 'harvest_serp',
        description: 'Classify the URL and extract all LocalBusiness JSON-LD entries from an aggregator search-results page. Creates one partial org record per card. Returns the count of records created. Does NOT create records for non-aggregator-serp pages.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL of the aggregator SERP page.' },
            },
            required: ['url'],
        },
        async handler(args, signal) {
            const url = String(args?.url ?? '').trim()
            if (!url) return { error: 'empty url' }

            log.trace(`ai-agent.harvest_serp: ${url}`)
            let page
            try {
                page = await ctx.classifyPage(url, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.harvest_serp: classifyPage failed: ${e?.message ?? e}`)
                return { error: `fetch failed: ${e?.message ?? e}` }
            }

            if (page.pageType !== 'aggregator-serp') {
                return { error: `page is ${page.pageType}, not aggregator-serp — wrong page type for harvest` }
            }

            const created: string[] = []
            for (const blob of page.jsonLdBlobs) {
                if (!isLocalBusiness(blob)) continue
                const b = blob as Record<string, unknown>
                const name = typeof b.name === 'string' ? b.name : ''
                if (!name) continue

                const phones: string[] = typeof b.telephone === 'string' ? [normalizePhone(b.telephone)] : []
                const emails: string[] = typeof b.email === 'string' ? [b.email.toLowerCase()] : []
                const addr = flattenAddress(b.address)
                const addresses: string[] = addr ? [addr] : []

                const sourceRef: OrgSourceRef = {
                    url: page.url,
                    kind: 'aggregator-serp',
                    extractedAt: new Date().toISOString(),
                    extractionMethod: 'deterministic',
                }

                const rec = workQueue.insert({
                    status: 'partial',
                    name,
                    phones,
                    emails,
                    addresses,
                    sources: [sourceRef],
                    gaps: computeGaps(phones, emails, addresses),
                    frontier: [],
                    confidence: 0.85,
                    extractionMethod: 'deterministic',
                    notes: [],
                })
                created.push(rec.id)
            }

            log.debug(`ai-agent.harvest_serp: ${url} → created ${created.length} records`)
            return {
                url: page.url,
                pageType: page.pageType,
                created: created.length,
                createdIds: created,
            }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/harvest-serp.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/harvest-serp.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/harvest-serp.test.ts
git commit -m "feat(ai-agent): add harvest_serp tool"
```

---

## Task 9: deepen_org tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/deepen-org.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/deepen-org.test.ts`

Server-side state machine. The complex one. Pseudocode:

```
loop:
  if record.status !== 'partial': break
  if record.frontier empty: break
  if perOrgToolCallsUsed >= maxToolCallsPerOrg: break
  url = pop highest-scored frontier entry
  page = classifyPage(url)
  perOrgToolCallsUsed++
  if page.pageType === 'other': continue
  extracted = extractContacts(page.html ?? '', { pageUrl: url })
  perOrgToolCallsUsed++
  merge extracted into record (arrays + sources + gaps recomputed)
  if record has no remaining gaps: status = 'saturated'; break
  if page.pageType === 'org-site': add page.contactCandidates (top 3) to frontier
  if page.pageType === 'aggregator-detail': add aggregator-side candidates if any
return diff
```

`maxToolCallsPerOrg` is 5 by default (Task 2). Each loop iteration uses 2 calls (classify + extract), so up to 2-3 frontier hops per record.

Critical: the seed record may already have a frontier (from `harvest_serp` adding `aggregator-detail` URLs from the SERP page) OR it may be empty. If empty AND the record already has saturating contacts, deepen_org returns "no work" without burning budget.

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/deepen-org.test.ts`:

```typescript
import { makeDeepenOrgTool } from '../deepen-org'
import { WorkQueue } from '../../work-queue'
import type { ClassifiedPage } from '../../page-types'
import type { OrgGap } from '../../work-queue'

function fakePage(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://x', pageType: 'org-site', confidence: 0.85, signals: [],
        cleanedText: '', candidateBlocks: [], jsonLdBlobs: [],
        contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        html: '<html></html>',
        ...partial,
    }
}

const seed = (overrides: any = {}) => ({
    status: 'partial' as const,
    name: 'Acme',
    phones: [], emails: [], addresses: [],
    sources: [],
    gaps: ['phone', 'email', 'address'] as OrgGap[],
    frontier: [{ url: 'https://acme.ru/contacts', reason: 'contact-page', score: 0.9 }],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
    ...overrides,
})

const MAX_BUDGET = 5

describe('deepen_org tool', () => {
    it('classifies + extracts a frontier URL and merges into the record', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({
                phones: ['+78121001010'], emails: [], addresses: [], candidateName: '',
            }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, MAX_BUDGET)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        const after = wq.get(r.id)!
        expect(after.phones).toContain('+78121001010')
        expect(after.gaps).not.toContain('phone')
        expect(after.perOrgToolCallsUsed).toBeGreaterThan(0)
    })

    it('transitions to saturated when all gaps fill', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({
                phones: ['+78121001010'], emails: ['info@acme.ru'], addresses: ['ул. Ленина, 1'],
                candidateName: '',
            }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, MAX_BUDGET)
        await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('saturated')
    })

    it('stops when budget exhausted', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            frontier: [
                { url: 'https://acme.ru/a', reason: 'x', score: 0.9 },
                { url: 'https://acme.ru/b', reason: 'x', score: 0.8 },
                { url: 'https://acme.ru/c', reason: 'x', score: 0.7 },
                { url: 'https://acme.ru/d', reason: 'x', score: 0.6 },
            ],
        }))
        let calls = 0
        const ctx = {
            classifyPage: async () => { calls++; return fakePage() },
            extractContacts: async () => { calls++; return { phones: [], emails: [], addresses: [], candidateName: '' } },
        }
        const tool = makeDeepenOrgTool(wq, ctx, 4)  // budget = 4 → 2 hops max
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.budgetExhausted).toBe(true)
        const after = wq.get(r.id)!
        expect(after.perOrgToolCallsUsed).toBe(4)
    })

    it('processes frontier in score order (highest first)', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            frontier: [
                { url: 'https://acme.ru/low', reason: 'x', score: 0.3 },
                { url: 'https://acme.ru/high', reason: 'x', score: 0.9 },
            ],
        }))
        const visited: string[] = []
        const ctx = {
            classifyPage: async (url: string) => { visited.push(url); return fakePage({ url }) },
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 4)
        await tool.handler({ orgId: r.id })
        expect(visited[0]).toContain('/high')
    })

    it('skips other-pageType pages without burning extract budget', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            frontier: [{ url: 'https://acme.ru/blog', reason: 'x', score: 0.5 }],
        }))
        let extractCalls = 0
        const ctx = {
            classifyPage: async () => fakePage({ pageType: 'other' }),
            extractContacts: async () => { extractCalls++; return { phones: [], emails: [], addresses: [], candidateName: '' } },
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        await tool.handler({ orgId: r.id })
        expect(extractCalls).toBe(0)
    })

    it('returns error for unknown id', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns no-op result when frontier is empty and record already has gaps', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ frontier: [] }))
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.frontierEmpty).toBe(true)
        expect(out.budgetExhausted).toBe(false)
    })

    it('appends contactCandidates to frontier when classifying an org-site', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            classifyPage: async () => fakePage({
                pageType: 'org-site',
                contactCandidates: [
                    { url: 'https://acme.ru/about', score: 0.7, reason: 'path', kind: 'contact-page' },
                    { url: 'https://acme.ru/locations', score: 0.6, reason: 'path', kind: 'contact-page' },
                ],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        const urls = after.frontier.map(f => f.url)
        expect(urls).toContain('https://acme.ru/about')
    })

    it('refuses to deepen non-partial records', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'rejected')
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/not partial|already terminal/i)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/deepen-org.test.ts
```

- [ ] **Step 3: Implement deepen_org**

Create `examples/scraper-node/src/sources/ai-agent/tools/deepen-org.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue, WorkQueueContext, OrgFrontierEntry, OrgGap } from '../work-queue'
import type { OrgSourceRef } from '../../../types'
import { log } from '@cmd-hub/common'

const FRONTIER_MAX_ADD = 3

function recomputeGaps(phones: string[], emails: string[], addresses: string[]): OrgGap[] {
    const gaps: OrgGap[] = []
    if (phones.length === 0) gaps.push('phone')
    if (emails.length === 0) gaps.push('email')
    if (addresses.length === 0) gaps.push('address')
    return gaps
}

export function makeDeepenOrgTool(
    workQueue: WorkQueue,
    ctx: WorkQueueContext,
    maxToolCallsPerOrg: number,
): Tool {
    return {
        name: 'deepen_org',
        description: 'Walk the frontier of a partial org record, classifying + extracting each URL until gaps fill, frontier empties, or per-org budget runs out. Server-side state machine; the LLM just calls this and inspects the diff.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
            },
            required: ['orgId'],
        },
        async handler(args, signal) {
            const orgId = String(args?.orgId ?? '')
            const initial = workQueue.get(orgId)
            if (!initial) return { error: `org id ${orgId} not found` }
            if (initial.status !== 'partial') {
                return { error: `org ${orgId} is not partial (status=${initial.status}); cannot deepen` }
            }

            const visitedUrls = new Set<string>()
            let frontierEmpty = false
            let budgetExhausted = false

            log.trace(`ai-agent.deepen_org: id=${orgId} initial frontier=${initial.frontier.length} budget=${maxToolCallsPerOrg}`)

            while (true) {
                const cur = workQueue.get(orgId)!
                if (cur.status !== 'partial') break
                if (cur.frontier.length === 0) {
                    frontierEmpty = true
                    break
                }
                if (cur.perOrgToolCallsUsed >= maxToolCallsPerOrg) {
                    budgetExhausted = true
                    break
                }

                // Pop highest-scored frontier entry.
                let bestIdx = 0
                for (let i = 1; i < cur.frontier.length; i++) {
                    if (cur.frontier[i].score > cur.frontier[bestIdx].score) bestIdx = i
                }
                const next = cur.frontier[bestIdx]
                workQueue.mutate(orgId, draft => {
                    draft.frontier.splice(bestIdx, 1)
                })
                if (visitedUrls.has(next.url)) continue
                visitedUrls.add(next.url)

                // Classify (1 budget call).
                let page
                try {
                    page = await ctx.classifyPage(next.url, { signal })
                } catch (e: any) {
                    log.warn(`deepen_org: classify ${next.url} failed: ${e?.message ?? e}`)
                    workQueue.mutate(orgId, d => { d.perOrgToolCallsUsed += 1 })
                    continue
                }
                workQueue.mutate(orgId, d => { d.perOrgToolCallsUsed += 1 })

                if (page.pageType === 'other') continue

                // Re-check budget after classify.
                if (workQueue.get(orgId)!.perOrgToolCallsUsed >= maxToolCallsPerOrg) {
                    budgetExhausted = true
                    break
                }

                // Extract (1 budget call).
                let extracted
                try {
                    extracted = await ctx.extractContacts(page.html ?? '', { signal, pageUrl: next.url })
                } catch (e: any) {
                    log.warn(`deepen_org: extract ${next.url} failed: ${e?.message ?? e}`)
                    workQueue.mutate(orgId, d => { d.perOrgToolCallsUsed += 1 })
                    continue
                }

                workQueue.mutate(orgId, draft => {
                    draft.perOrgToolCallsUsed += 1
                    for (const x of extracted.phones) {
                        if (!draft.phones.includes(x)) draft.phones.push(x)
                    }
                    for (const x of extracted.emails) {
                        if (!draft.emails.includes(x)) draft.emails.push(x)
                    }
                    for (const x of extracted.addresses) {
                        if (!draft.addresses.includes(x)) draft.addresses.push(x)
                    }
                    if (!draft.name && extracted.candidateName) draft.name = extracted.candidateName

                    const sourceKind = page.pageType === 'aggregator-detail' ? 'aggregator-detail'
                        : page.pageType === 'aggregator-serp' ? 'aggregator-serp'
                        : page.pageType === 'aggregator-landing' ? 'aggregator-landing'
                        : 'org-site'
                    const sourceRef: OrgSourceRef = {
                        url: next.url,
                        kind: sourceKind,
                        extractedAt: new Date().toISOString(),
                        extractionMethod: 'deterministic',
                    }
                    if (!draft.sources.some(s => s.url === sourceRef.url && s.kind === sourceRef.kind)) {
                        draft.sources.push(sourceRef)
                    }

                    draft.gaps = recomputeGaps(draft.phones, draft.emails, draft.addresses)

                    // Append contactCandidates to frontier (top FRONTIER_MAX_ADD).
                    const newFrontier: OrgFrontierEntry[] = page.contactCandidates
                        .slice(0, FRONTIER_MAX_ADD)
                        .map(c => ({ url: c.url, reason: c.reason, score: c.score }))
                        .filter(f => !visitedUrls.has(f.url) && !draft.frontier.some(e => e.url === f.url))
                    draft.frontier.push(...newFrontier)
                })

                // If gaps cleared, transition saturated.
                const after = workQueue.get(orgId)!
                if (after.gaps.length === 0) {
                    workQueue.transition(orgId, 'saturated')
                    break
                }
            }

            const final = workQueue.get(orgId)!
            return {
                orgId,
                status: final.status,
                gapsRemaining: final.gaps,
                phones: final.phones,
                emails: final.emails,
                addresses: final.addresses,
                sourcesAdded: final.sources.length - initial.sources.length,
                budgetUsed: final.perOrgToolCallsUsed - initial.perOrgToolCallsUsed,
                budgetExhausted,
                frontierEmpty,
            }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/deepen-org.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/deepen-org.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/deepen-org.test.ts
git commit -m "feat(ai-agent): add deepen_org tool (server-side state machine)"
```

---

## Task 10: Wire optional WorkQueueContext into buildTools

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/index.ts`

The new tools exist but aren't constructed by `buildTools`. PR4b adds the option; PR4c flips the default in the loop. For now: when `workQueueContext` and `workQueue` are both provided, the queue tools are added. When absent, behavior is unchanged.

- [ ] **Step 1: Read current buildTools**

```bash
cat examples/scraper-node/src/sources/ai-agent/tools/index.ts
```

- [ ] **Step 2: Update buildTools to accept new options**

Replace the file with:

```typescript
import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeParseHtmlTool } from "./parse-html"
import { makeDelegateSourceTool } from "./delegate-source"
import { makeReportResultsTool } from "./report-results"
import { makeExtractContactsTool, type ExtractorRunner } from "./extract-contacts"
import { makeEndReconTool } from "./end-recon"
import { makeRevisePlanTool } from "./revise-plan"
import { makeListOrgsTool } from "./list-orgs"
import { makePickNextPartialTool } from "./pick-next-partial"
import { makeFreezeOrgTool } from "./freeze-org"
import { makeDiscoverOrgCandidatesTool } from "./discover-org-candidates"
import { makeHarvestSerpTool } from "./harvest-serp"
import { makeDeepenOrgTool } from "./deepen-org"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import type { ReportState } from "./emit"
import type { WorkQueue, WorkQueueContext } from "../work-queue"
import { log } from "@cmd-hub/common"

export type { ReportState } from "./emit"
export type { ExtractorRunner } from "./extract-contacts"
export type AgentPhase = 'recon' | 'plan' | 'execute'

export interface BuildToolsOptions {
    extractorRunner?: ExtractorRunner
    /** When provided, queue tools (list_orgs, pick_next_partial, freeze_org,
     *  discover_org_candidates, harvest_serp, deepen_org) are added to the toolset.
     *  PR4b adds the option; PR4c wires the loop to provide it during harvest+deepen+review phases. */
    workQueue?: WorkQueue
    workQueueContext?: WorkQueueContext
    /** Per-org deepening budget for deepen_org. Required when workQueue is set. */
    maxToolCallsPerOrg?: number
}

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    phase: AgentPhase,
    opts: BuildToolsOptions = {},
): Promise<Tool[]> {
    log.trace(`ai-agent.tools.buildTools: phase=${phase} extractor=${opts.extractorRunner ? 'on' : 'off'} workQueue=${opts.workQueue ? 'on' : 'off'}`)
    if (phase === 'plan') {
        log.debug('ai-agent.tools.buildTools: plan phase → no tools exposed')
        return []
    }
    if (phase === 'recon') {
        const tools = [makeWebSearchTool(query), makeEndReconTool()]
        log.debug(`ai-agent.tools.buildTools: recon phase → ${tools.map(t => t.name).join(', ')}`)
        return tools
    }
    const tools: Tool[] = [
        makeWebSearchTool(query),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        makeExtractContactsTool({ extractorRunner: opts.extractorRunner }),
        await makeDelegateSourceTool(query, queue, state),
        makeReportResultsTool(queue, query, state),
        makeRevisePlanTool(),
    ]

    if (opts.workQueue && opts.workQueueContext) {
        const wq = opts.workQueue
        const ctx = opts.workQueueContext
        const budget = opts.maxToolCallsPerOrg ?? 5
        tools.push(
            makeListOrgsTool(wq),
            makePickNextPartialTool(wq),
            makeFreezeOrgTool(wq),
            makeDiscoverOrgCandidatesTool(ctx),
            makeHarvestSerpTool(wq, ctx),
            makeDeepenOrgTool(wq, ctx, budget),
        )
    }

    log.debug(`ai-agent.tools.buildTools: execute phase → ${tools.map(t => t.name).join(', ')}`)
    return tools
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
```

- [ ] **Step 3: Verify existing tests still pass**

The existing loop tests (`loop-phases.test.ts`, `loop-invariants.test.ts`, etc.) call `buildTools` without `workQueue`/`workQueueContext`. Backward-compatible — the queue tools simply aren't added.

```bash
npx jest src/sources/ai-agent
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/index.ts
git commit -m "feat(ai-agent): thread optional WorkQueueContext through buildTools"
```

---

## Task 11: Full repo verification

**Files:**
- (none modified)

- [ ] **Step 1: Build whole repo**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4b
npm run build 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 2: Run scraper-node tests**

```bash
cd examples/scraper-node && bash scripts/test.sh 2>&1 | tail -8
```
Expected: ~330 tests passing (PR4a baseline 287 + ~45 new from PR4b).

- [ ] **Step 3: Run repo-wide tests**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4b
npm test --workspaces --if-present 2>&1 | grep -E "^(Tests:|Test Suites:|FAIL)"
```
Expected: every workspace green. Possible flake on packages/common per prior PRs; rerun if so.

---

## Task 12: Wire-up sanity check

**Files:**
- (read-only)

- [ ] **Step 1: Verify queue tools NOT yet exposed in any LLM phase**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4b
grep -n "workQueue\b\|workQueueContext" examples/scraper-node/src/sources/ai-agent/loop.ts
```
Expected: no matches (loop.ts unchanged in PR4b).

- [ ] **Step 2: Verify the source bootstrap doesn't construct a queue yet**

```bash
grep -n "WorkQueue\b\|new WorkQueue" examples/scraper-node/src/sources/ai-agent/index.ts
```
Expected: no matches (index.ts unchanged in PR4b).

- [ ] **Step 3: Verify each new tool's tests pass**

```bash
npx jest src/sources/ai-agent/tools/__tests__/list-orgs.test.ts
npx jest src/sources/ai-agent/tools/__tests__/pick-next-partial.test.ts
npx jest src/sources/ai-agent/tools/__tests__/freeze-org.test.ts
npx jest src/sources/ai-agent/tools/__tests__/discover-org-candidates.test.ts
npx jest src/sources/ai-agent/tools/__tests__/harvest-serp.test.ts
npx jest src/sources/ai-agent/tools/__tests__/deepen-org.test.ts
```

All pass.

---

## Task 13: Push branch + open PR

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
```
Expected: ~10-12 commits matching the task order.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/ai-agent-pr4b
```

- [ ] **Step 3: Open the PR via web UI** (gh CLI not installed)

Title:
```
feat(ai-agent): PR4b — work queue + parent-agent tools (lands cold)
```

Body:
```markdown
## Summary
- Adds the work-queue subsystem per `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` §3.6 and §3.10.
- New types: `OrgRecord`, `OrgFrontierEntry`, `OrgGap`, `OrgRecordStatus`, `WorkQueueContext`.
- New `WorkQueue` class — in-memory, run-scoped, keyed by id; state transitions `partial → saturated → verified|rejected`; priority pick by `1 - (gaps.length / 3)`, ties by insertion order.
- Six new tools: `list_orgs`, `pick_next_partial`, `freeze_org`, `discover_org_candidates`, `harvest_serp`, `deepen_org`.
- `harvest_serp` runs server-side: classifies the URL, extracts LocalBusiness JSON-LD entries, creates partial records.
- `deepen_org` is a server-side state machine: walks the frontier, classifies + extracts each URL, merges into the record, transitions to `saturated` when gaps clear or budget exhausts.
- `buildTools` accepts an optional `workQueue` + `workQueueContext`. Queue tools are added when both are present; otherwise behavior is unchanged.
- New arg `aiAgent.maxToolCallsPerOrg` (default 5).
- **Lands cold:** the loop and source bootstrap don't construct a queue yet. PR4c wires queue tools into the LLM's `harvest`/`deepen+review` phases.

## Test plan
- [x] Work queue unit tests pass (state transitions, priority pick, mutation invariants).
- [x] Each new tool has its own test suite.
- [x] Existing 287 scraper-node tests still pass.
- [x] `buildTools` without `workQueue` opts unchanged.
- [x] `npm run build` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Show the GitHub create-PR URL printed by `git push`.**

---

## Self-Review

**Spec coverage** (against §3.6 + §3.7 + §3.10):

- §3.6 OrgRecord type → Task 1.
- §3.6 work queue (in-memory, run-scoped) → Task 3.
- §3.6 state transitions (partial → saturated → verified|rejected) → Task 3.
- §3.6 priority pick (`1 - gaps.length/3`) → Task 3 + Task 5.
- §3.7 deepening loop → Task 9.
- §3.10 `list_orgs` → Task 4.
- §3.10 `pick_next_partial` → Task 5.
- §3.10 `deepen_org` → Task 9.
- §3.10 `harvest_serp` → Task 8.
- §3.10 `discover_org_candidates` → Task 7.
- §3.10 `freeze_org` → Task 6.
- §4 `maxToolCallsPerOrg` arg → Task 2.
- **Spec deviation 1**: `freeze_org` finalizes as `verified` if record has any contact, `rejected` if not — spec says "force-finalize as partial". The plan's freeze semantic uses the existing terminal states rather than introducing a fifth state. Documented in Task 6.
- **Spec deviation 2**: `OrgRecord` excludes `fieldProvenance` and `conflicts` — those are PR4d's `review_org` artifacts. The fields exist on `OrgData` (PR4a) but aren't tracked at the queue level until reviews run.
- **Out-of-scope per plan**: phase wiring (PR4c), `fill_gap` and `review_org` (PR4d), `OrgRecord → OrgData` conversion at run end (PR4c).

**Placeholder scan**: searched for "TBD", "TODO", "implement later", "fill in details", "Add appropriate". One reference to "PR4c will wire" in Task 10 — that's a forward reference, not a placeholder. Acceptable.

**Type consistency**:
- `OrgRecord` shape consistent across Tasks 1, 3, 4, 5, 6, 7, 8, 9.
- `WorkQueueContext` interface (with `classifyPage` + `extractContacts`) consistent in Tasks 1, 7, 8, 9.
- `WorkQueue.insert` signature `Omit<OrgRecord, 'id' | 'perOrgToolCallsUsed'>` matches what tasks 8 and 9 pass.
- `WorkQueue.mutate` callback receives `OrgRecord` draft; tasks 9's mutator updates fields by name matching Task 1's interface.
- `WorkQueue.transition` enforces the same transition matrix used in Task 6 (`freeze_org` routes via `saturated` for partial-with-contacts).

**Open questions for plan-time**:

- **Q1**: Spec §3.7 lists `aggregator-detail → org-site` candidate addition (when an aggregator detail page links to an org's own site, the org URL should be added to frontier). Task 9's implementation only adds `contactCandidates` (which are same-origin from `org-site` pages). For aggregator-detail pages, the relevant candidates would be in `aggregatorCandidates` or somewhere. Decision: defer the aggregator-detail → org-site frontier addition to a follow-up; PR4b implements only the simpler same-origin contact-page case.
- **Q2**: `extractContacts` in `WorkQueueContext` takes raw HTML, not a `ClassifiedPage`. The implementer in PR2 already exposed `html` on `ClassifiedPage` (cheerio cleanup PR). Task 9 reads `page.html ?? ''`. This is fine but means `extractContacts` and `classifyPage` are partly redundant — both parse cheerio. Acceptable cost for clean separation. Could be optimized in a future PR by passing the parsed cheerio root through.
- **Q3**: `WorkQueue.mutate` allows the mutator to set `id` but the post-mutation invariant restores it. This is fine for safety but makes the mutator API mildly footgun-y (mutators can think they changed id and silently get reverted). Could throw on attempted id change instead. Decision: warn-and-restore is fine for PR4b; tighten in a code-quality follow-up if it bites.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-30-ai-agent-pr4b-work-queue.md`.
