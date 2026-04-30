# AI-Agent PR4d — fill_gap + review_org Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two LLM-judgment tools that close out the work-queue pipeline: `fill_gap(orgId, field)` runs a targeted web search for a single missing field on a partial record; `review_org(orgId)` runs an LLM call that resolves conflicts, sets confidence, and transitions the record's status. Both tools sit in the `deepen+review` phase (already plumbed in PR4c). Emission to `AsyncQueue<OrgData>` stays at the `deepen_org` saturated transition (PR4c semantic) and the `freeze_org` verified transition; PR4d does NOT change emit timing — `review_org` updates queue-state observability (status, confidence, conflicts, notes) but does not re-emit.

**Architecture:** `fill_gap` is a pure server-side tool: builds a targeted query (`"<orgName>" <field> <city>`), calls `web_search` via the existing Searxng-backed module, classifies the top hit, extracts contacts, picks values matching the missing field, adds them to the record (and to `record.conflicts` if they differ from existing values). Per-record per-field budget = 1 attempt; failure leaves the gap open. `review_org` is an LLM tool that calls the parent agent's existing OpenAI client with structured-output JSON, presents the record's accumulated phones/emails/addresses + sources + existing conflicts, asks for `verify | reject | still-partial` plus `resolutions[]` keyed to existing conflict values. The model never invents new values; the post-processor drops any value not already in the record. Both tools added to `deepen+review` toolset in `buildTools`.

**Tech Stack:** TypeScript, Node 20, OpenAI SDK 4.77 (existing parent client), `web_search` tool (existing), Jest 30.

**Spec reference:** §3.8 (gap-filling), §3.9 (self-review), §3.10 (parent-agent tools list `fill_gap`, `review_org`). Decisions locked in conversation: review is **decoupled from emit** (option B); records emit on saturated/verified per PR4c; review updates queue-state observability and conflict resolution but doesn't re-emit.

---

## Scope Boundaries

**IN scope (PR4d):**
- `fill_gap(orgId, field)` tool — targeted web search + extraction for a single field, conflict-aware merge.
- `review_org(orgId)` tool — LLM judgment on the record; updates status/confidence/conflicts/notes.
- Both tools registered in `deepen+review` phase via `tools/index.ts`.
- `LLMJudgeContext` injection seam (parent OpenAI client + model + temp) — added to `WorkQueueContext` or a sibling type.
- `OrgConflict` population — when `fill_gap` finds a value that differs from an existing one, surface it in `record.conflicts`.
- Tests for both tools using mocked `web_search` and mocked OpenAI client.
- `index.ts` (source bootstrap) wires `LLMJudgeContext` from the parent client + cfg.
- Updates to `deepen+review` prompt mentioning the new tools.

**NOT IN scope:**
- Changing emit semantics. `deepen_org` and `freeze_org` keep emitting per PR4c.
- New phases. Both tools are within the existing `deepen+review` phase.
- Re-architecting the work queue. `review_org` calls `workQueue.transition` and `workQueue.mutate` exactly like deepen does.
- Changing `OrgConflict` shape (PR4a defined it; PR4d uses it).

---

## File Structure

| File | Change |
|---|---|
| `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts` | Add `LLMJudgeContext` type. |
| `examples/scraper-node/src/sources/ai-agent/tools/fill-gap.ts` (new) | `makeFillGapTool(workQueue, ctx, query)` factory. |
| `examples/scraper-node/src/sources/ai-agent/tools/review-org.ts` (new) | `makeReviewOrgTool(workQueue, ctx)` factory. |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/fill-gap.test.ts` (new) | Unit tests with mocked web_search + classifyPage + extractContacts. |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/review-org.test.ts` (new) | Unit tests with mocked OpenAI client. |
| `examples/scraper-node/src/sources/ai-agent/tools/index.ts` | Add both tool factories to `deepen+review` toolset. |
| `examples/scraper-node/src/sources/ai-agent/prompts.ts` | Update `buildDeepenReviewInstructions` to mention `fill_gap` and `review_org`. |
| `examples/scraper-node/src/sources/ai-agent/index.ts` | Construct `LLMJudgeContext` from `cfg` and `client`; pass through. |
| `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts` | Update `WorkQueueContext` OR add `LLMJudgeContext` as a separate type. |

---

## Decisions Locked Before Implementation

- **Review-after-emit (option B from conversation).** PR4c emits records on `saturated` transition. PR4d's `review_org` updates queue-state but doesn't re-emit. This means downstream consumers see records before review; review's value is observability + conflict resolution + status finalization for run-end reporting.
- **`fill_gap` budget = 1 attempt per (orgId, field) pair.** Tracked via a per-record map; second call for the same gap returns "already attempted" without re-searching. Spec §3.8.
- **`fill_gap` query template**: `"<orgName>" <field-keyword> <city>`. Field keywords: phone → "телефон phone"; email → "email"; address → "адрес address". For Russian queries, Cyrillic + Latin keywords both used (web_search handles either).
- **`fill_gap` only fills *the requested field***. If extraction also returns other fields' values, they're discarded — the LLM has to call `fill_gap` again for them. Keeps the tool focused.
- **`fill_gap` adds values via `record.conflicts` if they differ from existing values**, otherwise direct merge. New conflict structure: `{field, values: [{value, sourceUrl}], resolution: 'unresolved'}`.
- **`review_org` LLM call uses the parent agent's client** (same `OpenAI` instance, same `cfg.model`, same `cfg.temperature`). Spec §3.9. The extractor sub-agent has a separate model — review uses parent.
- **`review_org` is forced to JSON output** via `response_format: { type: 'json_object' }` (OpenAI-compatible). Validated with a small zod-or-hand schema.
- **`review_org` cannot invent values.** Output schema: `decision: 'verify' | 'reject' | 'still-partial'`, `resolutions: { field, chosenIndex }[]` (chosenIndex into existing conflict.values), `rejectReason?`, `confidence: number`, `notes?: string[]`. Any new string in the output is dropped by the post-processor.
- **`review_org` decisions update queue-state**:
  - `verify`: status → `verified` (via `partial → saturated → verified` if needed). Confidence set. Conflict resolutions applied (chosenIndex picks; non-chosen values stay in `conflicts` with `resolution: 'review'`).
  - `reject`: status → `rejected`. Notes updated with rejectReason.
  - `still-partial`: stays partial. Notes updated. `gaps` may have been narrowed.
- **`review_org` runs at most 1 LLM call per `review_org` invocation.** No tool-use loop. Single completion.
- **`review_org` uses 1 budget unit** (one LLM call). Counts against `maxToolCalls` like any other tool.
- **`review_org` per-record cap = 1 attempt.** Calling `review_org(orgId)` after a successful review returns "already reviewed". Tracked via record `notes` containing `'reviewed'` flag, or a separate set in the queue. Decision: track in record `notes` array (`['reviewed:<timestamp>']`).
- **`fill_gap` and `review_org` are added to `deepen+review` phase** in `tools/index.ts`. Not exposed in `harvest`.
- **Worktree:** `.worktrees/ai-agent-pr4d`, branch `feature/ai-agent-pr4d`. Already created and `npm install`ed; baseline 256/256 ai-agent tests + 308 total scraper-node green.

---

## Task 1: Add `LLMJudgeContext` type

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/types.test.ts` (extend)

- [ ] **Step 1: Append the test**

Append to `examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/types.test.ts`, inside the existing `describe`:

```typescript
    it('LLMJudgeContext has callJudge function', () => {
        const ctx: import('../types').LLMJudgeContext = {
            callJudge: async (_messages: unknown[]) => ({ content: '{}' }),
        }
        expect(typeof ctx.callJudge).toBe('function')
    })
```

- [ ] **Step 2: Verify failing**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4d/examples/scraper-node
npx tsc --noEmit -p tsconfig.json
```

Expected: type error on `LLMJudgeContext`.

- [ ] **Step 3: Add the type**

Append to `examples/scraper-node/src/sources/ai-agent/work-queue/types.ts`:

```typescript
/** Injection seam for LLM judgment calls (review_org). Wraps the OpenAI client
 *  with a single-shot completion that forces JSON output. */
export interface LLMJudgeContext {
    /** Single-shot completion with `response_format: { type: 'json_object' }`.
     *  Returns the assistant message's text content, or null if empty. */
    callJudge(messages: unknown[]): Promise<{ content: string | null }>
}
```

Re-export from `work-queue/index.ts`:

```typescript
export type { ..., LLMJudgeContext } from './types'
```

- [ ] **Step 4: Verify pass**

```bash
npx jest src/sources/ai-agent/work-queue/__tests__/types.test.ts
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/work-queue/types.ts \
        examples/scraper-node/src/sources/ai-agent/work-queue/index.ts \
        examples/scraper-node/src/sources/ai-agent/work-queue/__tests__/types.test.ts
git commit -m "feat(ai-agent): add LLMJudgeContext type for review_org"
```

---

## Task 2: fill_gap tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/fill-gap.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/fill-gap.test.ts`

`fill_gap` runs a targeted web search for one missing field, classifies + extracts the top result, adds the field's values to the record (or to `record.conflicts` if they differ from existing values).

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/fill-gap.test.ts`:

```typescript
import { makeFillGapTool } from '../fill-gap'
import { WorkQueue } from '../../work-queue'
import type { ClassifiedPage } from '../../page-types'
import type { OrgGap } from '../../work-queue'
import type { SearchQuery } from '../../../../types'

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
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
    ...overrides,
})

const QUERY: SearchQuery = { query: 'q', city: 'Санкт-Петербург', sources: ['ai-agent'], maxResults: 100 }

describe('fill_gap tool', () => {
    it('fills the requested field via web_search + extract', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ phones: ['+78121001010'], gaps: ['email', 'address'] as OrgGap[] }))

        // Mock the web_search → classify → extract chain.
        const ctx = {
            webSearch: jest.fn().mockResolvedValue({
                results: [{ url: 'https://acme.ru/', title: 'Acme', snippet: '' }],
            }),
            classifyPage: jest.fn().mockResolvedValue(fakePage({ html: '<html><body>info@acme.ru</body></html>' })),
            extractContacts: jest.fn().mockResolvedValue({
                phones: [], emails: ['info@acme.ru'], addresses: [], candidateName: '',
            }),
        }

        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.error).toBeUndefined()
        const after = wq.get(r.id)!
        expect(after.emails).toContain('info@acme.ru')
        expect(after.gaps).not.toContain('email')
    })

    it('returns error for unknown field', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            webSearch: jest.fn(), classifyPage: jest.fn(), extractContacts: jest.fn(),
        }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'bogus' })
        expect(out.error).toMatch(/field/i)
    })

    it('returns error for unknown orgId', async () => {
        const wq = new WorkQueue()
        const ctx = { webSearch: jest.fn(), classifyPage: jest.fn(), extractContacts: jest.fn() }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: 'nope', field: 'phone' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns no-op result when field is not in gaps', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ phones: ['+7'], gaps: ['email', 'address'] as OrgGap[] }))
        const ctx = { webSearch: jest.fn(), classifyPage: jest.fn(), extractContacts: jest.fn() }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'phone' })
        expect(out.alreadyFilled).toBe(true)
        expect(ctx.webSearch).not.toHaveBeenCalled()
    })

    it('per-(orgId, field) budget of 1: second call short-circuits', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = {
            webSearch: jest.fn().mockResolvedValue({ results: [] }),  // no results → gap stays
            classifyPage: jest.fn(),
            extractContacts: jest.fn(),
        }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'email' })
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.alreadyAttempted).toBe(true)
        expect(ctx.webSearch).toHaveBeenCalledTimes(1)
    })

    it('discards extracted values for fields other than the requested one', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = {
            webSearch: jest.fn().mockResolvedValue({ results: [{ url: 'https://x', title: '', snippet: '' }] }),
            classifyPage: jest.fn().mockResolvedValue(fakePage()),
            extractContacts: jest.fn().mockResolvedValue({
                phones: ['+78122002020'],  // not requested; should be discarded
                emails: ['info@acme.ru'],
                addresses: ['ул. Ленина, 5'],  // not requested; discarded
                candidateName: '',
            }),
        }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'email' })
        const after = wq.get(r.id)!
        expect(after.emails).toContain('info@acme.ru')
        expect(after.phones).toEqual([])  // discarded
        expect(after.addresses).toEqual([])  // discarded
    })

    it('surfaces a conflict when extracted value differs from existing value', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            phones: ['+78121001010'],
            gaps: ['email'] as OrgGap[],
        }))
        // Force the field to be 'phone' (a gap that already has a value would be unusual,
        // but the conflict logic exercises this case). Pre-populate phones AND gap=phone:
        wq.mutate(r.id, draft => {
            draft.gaps = ['phone']  // claim phone as a gap even though one exists
        })
        const ctx = {
            webSearch: jest.fn().mockResolvedValue({ results: [{ url: 'https://x', title: '', snippet: '' }] }),
            classifyPage: jest.fn().mockResolvedValue(fakePage()),
            extractContacts: jest.fn().mockResolvedValue({
                phones: ['+78122002020'], emails: [], addresses: [], candidateName: '',
            }),
        }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'phone' })
        const after = wq.get(r.id)!
        expect(after.phones).toContain('+78121001010')  // existing kept
        expect(after.phones).toContain('+78122002020')  // new added
        expect(after.conflicts?.length ?? 0).toBeGreaterThan(0)
        expect(after.conflicts?.[0].field).toBe('phone')
    })

    it('handles web_search returning no results gracefully', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = {
            webSearch: jest.fn().mockResolvedValue({ results: [] }),
            classifyPage: jest.fn(),
            extractContacts: jest.fn(),
        }
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.error).toBeUndefined()
        expect(out.foundValue).toBeUndefined()
        expect(ctx.classifyPage).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Verify failing**

```bash
npx jest src/sources/ai-agent/tools/__tests__/fill-gap.test.ts
```

- [ ] **Step 3: Implement fill_gap**

Create `examples/scraper-node/src/sources/ai-agent/tools/fill-gap.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue, OrgGap } from '../work-queue'
import type { ClassifiedPage } from '../page-types'
import type { OrgSourceRef, SearchQuery } from '../../../types'
import { log } from '@cmd-hub/common'

const VALID_FIELDS: OrgGap[] = ['phone', 'email', 'address']

const FIELD_KEYWORDS: Record<OrgGap, string> = {
    phone: 'телефон phone',
    email: 'email',
    address: 'адрес address',
}

export interface FillGapContext {
    webSearch: (args: { query: string, count?: number }, opts?: { signal?: AbortSignal }) => Promise<{
        results: Array<{ url: string, title?: string, snippet?: string }>
    }>
    classifyPage: (url: string, opts?: { signal?: AbortSignal }) => Promise<ClassifiedPage>
    extractContacts: (html: string, opts?: { signal?: AbortSignal, pageUrl?: string }) => Promise<{
        phones: string[]
        emails: string[]
        addresses: string[]
        candidateName: string
    }>
}

interface AttemptedKey {
    orgId: string
    field: OrgGap
}

export function makeFillGapTool(
    workQueue: WorkQueue,
    ctx: FillGapContext,
    query: SearchQuery,
): Tool {
    const attempted = new Set<string>()
    const keyOf = (k: AttemptedKey) => `${k.orgId}::${k.field}`

    return {
        name: 'fill_gap',
        description: 'Run a targeted web search for a single missing field on an org record. Per-(org, field) budget of 1; second call for the same gap is a no-op. Use this only for partial records that have already been deepened.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
                field: { type: 'string', enum: ['phone', 'email', 'address'] },
            },
            required: ['orgId', 'field'],
        },
        async handler(args, signal) {
            const orgId = String(args?.orgId ?? '')
            const fieldRaw = String(args?.field ?? '')

            if (!VALID_FIELDS.includes(fieldRaw as OrgGap)) {
                return { error: `field must be one of: ${VALID_FIELDS.join(', ')}` }
            }
            const field = fieldRaw as OrgGap

            const record = workQueue.get(orgId)
            if (!record) return { error: `org id ${orgId} not found` }

            // No-op if the field is not actually a gap (already filled).
            if (!record.gaps.includes(field)) {
                return { orgId, field, alreadyFilled: true }
            }

            // Per-(org, field) attempt budget.
            const attemptKey = keyOf({ orgId, field })
            if (attempted.has(attemptKey)) {
                return { orgId, field, alreadyAttempted: true }
            }
            attempted.add(attemptKey)

            // Build query: name + field keyword + city.
            const keyword = FIELD_KEYWORDS[field]
            const cityClause = query.city ? ` ${query.city}` : ''
            const searchQuery = `"${record.name}" ${keyword}${cityClause}`

            log.trace(`ai-agent.fill_gap: orgId=${orgId} field=${field} query="${searchQuery}"`)

            // Run search.
            let searchResults
            try {
                searchResults = await ctx.webSearch({ query: searchQuery, count: 3 }, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.fill_gap: web_search failed: ${e?.message ?? e}`)
                return { orgId, field, error: `web_search failed: ${e?.message ?? e}` }
            }

            const topResult = searchResults.results?.[0]
            if (!topResult?.url) {
                log.debug(`ai-agent.fill_gap: ${searchQuery} → no results`)
                return { orgId, field, foundValue: undefined, attempted: true }
            }

            // Classify + extract.
            let page: ClassifiedPage
            try {
                page = await ctx.classifyPage(topResult.url, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.fill_gap: classify ${topResult.url} failed: ${e?.message ?? e}`)
                return { orgId, field, error: `classify failed: ${e?.message ?? e}` }
            }

            let extracted
            try {
                extracted = await ctx.extractContacts(page.html ?? '', { signal, pageUrl: topResult.url })
            } catch (e: any) {
                log.warn(`ai-agent.fill_gap: extract ${topResult.url} failed: ${e?.message ?? e}`)
                return { orgId, field, error: `extract failed: ${e?.message ?? e}` }
            }

            // Pick values for the requested field only.
            const fieldValuesKey = field === 'phone' ? 'phones' : field === 'email' ? 'emails' : 'addresses'
            const candidates = extracted[fieldValuesKey] ?? []

            if (candidates.length === 0) {
                return { orgId, field, foundValue: undefined, attempted: true }
            }

            // Merge: union into the record's array; if existing value differs, surface conflict.
            const sourceRef: OrgSourceRef = {
                url: topResult.url,
                kind: 'web-search',
                extractedAt: new Date().toISOString(),
                extractionMethod: 'deterministic',
            }

            workQueue.mutate(orgId, draft => {
                const existingArr = draft[fieldValuesKey]
                let foundConflict = false
                for (const v of candidates) {
                    if (existingArr.includes(v)) continue
                    // Conflict detection: existing values present + new value differs.
                    if (existingArr.length > 0) {
                        foundConflict = true
                        if (!draft.conflicts) draft.conflicts = []
                        const existingConflict = draft.conflicts.find(c => c.field === field)
                        if (existingConflict) {
                            for (const old of existingArr) {
                                if (!existingConflict.values.some(cv => cv.value === old)) {
                                    existingConflict.values.push({ value: old, sourceUrl: '' })
                                }
                            }
                            existingConflict.values.push({ value: v, sourceUrl: topResult.url })
                        } else {
                            draft.conflicts.push({
                                field: field as 'name' | 'phone' | 'email' | 'address',
                                values: [
                                    ...existingArr.map(old => ({ value: old, sourceUrl: '' })),
                                    { value: v, sourceUrl: topResult.url },
                                ],
                                resolution: 'unresolved',
                            })
                        }
                    }
                    existingArr.push(v)
                }

                // Update gaps if the field is now populated.
                if (existingArr.length > 0) {
                    draft.gaps = draft.gaps.filter(g => g !== field)
                }

                // Add source ref if not already present.
                if (!draft.sources.some(s => s.url === sourceRef.url && s.kind === sourceRef.kind)) {
                    draft.sources.push(sourceRef)
                }
            })

            const updated = workQueue.get(orgId)!
            log.debug(`ai-agent.fill_gap: orgId=${orgId} field=${field} → ${candidates.length} candidate(s); gaps remaining=${updated.gaps.length}`)

            return {
                orgId,
                field,
                foundValue: candidates[0],
                addedCount: candidates.length,
                gapsRemaining: updated.gaps,
                attempted: true,
            }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/fill-gap.test.ts
```

Expected: 8/8 passing.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/fill-gap.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/fill-gap.test.ts
git commit -m "feat(ai-agent): add fill_gap tool (per-field web-search backfill)"
```

---

## Task 3: review_org tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/review-org.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/review-org.test.ts`

`review_org` runs a single LLM call asking for `verify | reject | still-partial`, plus resolutions to existing conflicts. Updates queue-state. Doesn't re-emit (PR4c handles emission).

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/review-org.test.ts`:

```typescript
import { makeReviewOrgTool } from '../review-org'
import { WorkQueue } from '../../work-queue'
import type { OrgGap } from '../../work-queue'

const seed = (overrides: any = {}) => ({
    status: 'partial' as const,
    name: 'Acme',
    phones: ['+78121001010'], emails: ['info@acme.ru'], addresses: ['ул. Ленина, 1'],
    sources: [],
    gaps: [] as OrgGap[],  // saturated-shape default
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
    ...overrides,
})

function fakeJudge(content: string) {
    return {
        callJudge: jest.fn().mockResolvedValue({ content }),
    }
}

describe('review_org tool', () => {
    it('verifies a saturated record', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.9,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        expect(out.decision).toBe('verify')
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(wq.get(r.id)?.confidence).toBe(0.9)
    })

    it('rejects a record', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = fakeJudge(JSON.stringify({
            decision: 'reject',
            confidence: 0.1,
            rejectReason: 'name does not match query topic',
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        expect(after.status).toBe('rejected')
        expect(after.notes.some(n => n.includes('name does not match'))).toBe(true)
    })

    it('keeps still-partial status', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = fakeJudge(JSON.stringify({
            decision: 'still-partial',
            confidence: 0.4,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx)
        await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('partial')
    })

    it('applies resolutions to existing conflicts', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            phones: ['+78121001010', '+78122002020'],
            conflicts: [{
                field: 'phone',
                values: [
                    { value: '+78121001010', sourceUrl: 'a' },
                    { value: '+78122002020', sourceUrl: 'b' },
                ],
                resolution: 'unresolved',
            }],
        }))
        wq.transition(r.id, 'saturated')
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.85,
            resolutions: [{ field: 'phone', chosenIndex: 0 }],
        }))
        const tool = makeReviewOrgTool(wq, ctx)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        expect(after.conflicts?.[0].chosenIndex).toBe(0)
        expect(after.conflicts?.[0].resolution).toBe('review')
    })

    it('returns error for unknown id', async () => {
        const wq = new WorkQueue()
        const ctx = fakeJudge('{}')
        const tool = makeReviewOrgTool(wq, ctx)
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns error if record is already terminal', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'rejected')
        const ctx = fakeJudge('{}')
        const tool = makeReviewOrgTool(wq, ctx)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/terminal|already/i)
    })

    it('returns error on malformed LLM response', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = fakeJudge('not valid json {{')
        const tool = makeReviewOrgTool(wq, ctx)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/parse|response/i)
    })

    it('per-record cap: second review_org call for the same orgId is no-op', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = fakeJudge(JSON.stringify({
            decision: 'still-partial',
            confidence: 0.3,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx)
        await tool.handler({ orgId: r.id })
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.alreadyReviewed).toBe(true)
        expect(ctx.callJudge).toHaveBeenCalledTimes(1)
    })

    it('does NOT push to AsyncQueue (decoupled from emit; PR4c handles emission)', async () => {
        // No AsyncQueue is passed to makeReviewOrgTool — verifies the constructor signature.
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const ctx = fakeJudge(JSON.stringify({ decision: 'verify', confidence: 0.9, resolutions: [] }))
        const tool = makeReviewOrgTool(wq, ctx)
        // If review_org needed an AsyncQueue, the call would error. It doesn't.
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.decision).toBe('verify')
    })

    it('rejects from saturated when LLM rejects (saturated → rejected allowed)', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const ctx = fakeJudge(JSON.stringify({
            decision: 'reject',
            confidence: 0.0,
            rejectReason: 'mistake in classification',
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx)
        await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('rejected')
    })
})
```

- [ ] **Step 2: Verify failing**

```bash
npx jest src/sources/ai-agent/tools/__tests__/review-org.test.ts
```

- [ ] **Step 3: Implement review_org**

Create `examples/scraper-node/src/sources/ai-agent/tools/review-org.ts`:

```typescript
import type { Tool } from './types'
import type { WorkQueue, LLMJudgeContext } from '../work-queue'
import { log } from '@cmd-hub/common'

const FIELDS = ['name', 'phone', 'email', 'address'] as const

interface ReviewDecision {
    decision: 'verify' | 'reject' | 'still-partial'
    confidence: number
    rejectReason?: string
    resolutions?: { field: string, chosenIndex: number }[]
    notes?: string[]
}

function clamp01(n: unknown): number {
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 1) return 1
    return n
}

function parseDecision(content: string | null): ReviewDecision | null {
    if (!content) return null
    let parsed
    try {
        parsed = JSON.parse(content)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const decision = parsed.decision
    if (decision !== 'verify' && decision !== 'reject' && decision !== 'still-partial') return null

    const resolutions: ReviewDecision['resolutions'] = []
    if (Array.isArray(parsed.resolutions)) {
        for (const r of parsed.resolutions) {
            if (
                r && typeof r === 'object'
                && typeof r.field === 'string'
                && FIELDS.includes(r.field as typeof FIELDS[number])
                && typeof r.chosenIndex === 'number'
                && r.chosenIndex >= 0
            ) {
                resolutions.push({ field: r.field, chosenIndex: r.chosenIndex })
            }
        }
    }

    const notes: string[] = []
    if (Array.isArray(parsed.notes)) {
        for (const n of parsed.notes) {
            if (typeof n === 'string') notes.push(n)
        }
    }

    return {
        decision,
        confidence: clamp01(parsed.confidence),
        rejectReason: typeof parsed.rejectReason === 'string' ? parsed.rejectReason : undefined,
        resolutions,
        notes,
    }
}

function buildSystemPrompt(): string {
    return [
        'You are reviewing an organization record built by a research pipeline. Your job is to decide whether the record is trustworthy enough to verify, should be rejected, or needs more work.',
        '',
        'You will be shown the record (name, phones, emails, addresses, sources, conflicts) plus instructions. Output a single JSON object with this shape:',
        '{',
        '  "decision": "verify" | "reject" | "still-partial",',
        '  "confidence": number between 0 and 1,',
        '  "resolutions": [{"field": "phone"|"email"|"address"|"name", "chosenIndex": <integer index into the existing conflict\'s values array>}],',
        '  "rejectReason": "string explaining the reject" (only when decision = reject),',
        '  "notes": ["short notes about your reasoning"]',
        '}',
        '',
        'Rules:',
        '1. NEVER invent values. resolutions must reference indices into the existing conflict\'s values array. If you think a conflict has no good answer, do not include it in resolutions; the unresolved values stay.',
        '2. Resolution priority: org\'s own website > aggregator-detail > web-search. Address with a building number beats one without.',
        '3. Reject when the name is fuzzy-different across sources (the record may describe two different orgs), or the contacts look fabricated, or the address is outside the target city.',
        '4. still-partial: the record has gaps that more work could fill. The deepening pipeline may run again.',
        '5. confidence: 0.9+ for explicit structured data with no conflicts; 0.7 for clearly-formatted contacts; 0.5 or below for ambiguous text.',
        '',
        'Output ONLY the JSON object. No prose.',
    ].join('\n')
}

function buildUserPrompt(record: import('../work-queue').OrgRecord): string {
    return [
        `Record:`,
        `  name: ${record.name}`,
        `  phones: ${JSON.stringify(record.phones)}`,
        `  emails: ${JSON.stringify(record.emails)}`,
        `  addresses: ${JSON.stringify(record.addresses)}`,
        `  sources: ${JSON.stringify(record.sources.map(s => ({ url: s.url, kind: s.kind })))}`,
        `  conflicts: ${JSON.stringify(record.conflicts ?? [])}`,
        `  gaps: ${JSON.stringify(record.gaps)}`,
        `  status: ${record.status}`,
        '',
        'Decide.',
    ].join('\n')
}

export function makeReviewOrgTool(workQueue: WorkQueue, ctx: LLMJudgeContext): Tool {
    return {
        name: 'review_org',
        description: 'Run an LLM review on an org record. Updates status (verify/reject/still-partial), confidence, and conflict resolutions. Per-record cap of 1 review. Note: review does NOT re-emit; saturated/verified emit happens in deepen_org/freeze_org.',
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
            if (record.notes.some(n => n.startsWith('reviewed:'))) {
                return { orgId, alreadyReviewed: true }
            }

            const messages = [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: buildUserPrompt(record) },
            ]

            log.trace(`ai-agent.review_org: orgId=${orgId}`)
            let response
            try {
                response = await ctx.callJudge(messages)
            } catch (e: any) {
                log.warn(`ai-agent.review_org: callJudge failed: ${e?.message ?? e}`)
                return { error: `judge failed: ${e?.message ?? e}` }
            }

            const decision = parseDecision(response.content)
            if (!decision) {
                log.warn(`ai-agent.review_org: failed to parse response: ${response.content?.slice(0, 200) ?? '(empty)'}`)
                return { error: 'failed to parse review response' }
            }

            // Apply decision to the record.
            workQueue.mutate(orgId, draft => {
                draft.confidence = decision.confidence
                draft.notes.push(`reviewed:${new Date().toISOString()}`)
                if (decision.notes && decision.notes.length > 0) {
                    for (const n of decision.notes) draft.notes.push(n)
                }
                if (decision.decision === 'reject' && decision.rejectReason) {
                    draft.notes.push(`rejected: ${decision.rejectReason}`)
                }
                if (draft.conflicts && decision.resolutions && decision.resolutions.length > 0) {
                    for (const res of decision.resolutions) {
                        const conflict = draft.conflicts.find(c => c.field === res.field)
                        if (conflict && res.chosenIndex < conflict.values.length) {
                            conflict.chosenIndex = res.chosenIndex
                            conflict.resolution = 'review'
                        }
                    }
                }
            })

            // Apply status transition.
            if (decision.decision === 'verify') {
                if (record.status === 'partial') {
                    workQueue.transition(orgId, 'saturated')
                }
                workQueue.transition(orgId, 'verified')
            } else if (decision.decision === 'reject') {
                workQueue.transition(orgId, 'rejected')
            }
            // still-partial: no transition.

            const final = workQueue.get(orgId)!
            log.debug(`ai-agent.review_org: orgId=${orgId} → ${decision.decision} confidence=${decision.confidence}`)

            return {
                orgId,
                decision: decision.decision,
                confidence: decision.confidence,
                status: final.status,
                rejectReason: decision.rejectReason,
                resolutionsApplied: decision.resolutions?.length ?? 0,
            }
        },
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/review-org.test.ts
```

Expected: 9/9 passing.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/review-org.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/review-org.test.ts
git commit -m "feat(ai-agent): add review_org tool (LLM judgment for queue records)"
```

---

## Task 4: Wire into buildTools (deepen+review phase)

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/index.ts`

Add `fill_gap` and `review_org` factories to the `deepen+review` toolset. Both need their respective contexts (`FillGapContext`, `LLMJudgeContext`).

- [ ] **Step 1: Read current tools/index.ts to see the deepen+review toolset**

```bash
cat examples/scraper-node/src/sources/ai-agent/tools/index.ts
```

- [ ] **Step 2: Add the imports + tool factories**

Add imports at the top:

```typescript
import { makeFillGapTool, type FillGapContext } from "./fill-gap"
import { makeReviewOrgTool } from "./review-org"
import type { LLMJudgeContext } from "../work-queue"
```

Extend `BuildToolsOptions`:

```typescript
export interface BuildToolsOptions {
    extractorRunner?: ExtractorRunner
    workQueue?: WorkQueue
    workQueueContext?: WorkQueueContext
    maxToolCallsPerOrg?: number
    /** Context for fill_gap tool (web_search + classify + extract). Optional in PR4d
     *  for backward compat; production wires it in index.ts. */
    fillGapContext?: FillGapContext
    /** Context for review_org tool (LLM judge). Optional in PR4d. */
    llmJudgeContext?: LLMJudgeContext
}
```

In the `deepen+review` phase block, add the new tools:

```typescript
if (phase === 'deepen+review' && opts.workQueue && opts.workQueueContext) {
    // ... existing tools ...
    if (opts.fillGapContext) {
        tools.push(makeFillGapTool(opts.workQueue, opts.fillGapContext, query))
    }
    if (opts.llmJudgeContext) {
        tools.push(makeReviewOrgTool(opts.workQueue, opts.llmJudgeContext))
    }
}
```

(Use the actual existing structure — read `tools/index.ts` first to get the exact insertion point.)

- [ ] **Step 3: Verify tests pass**

```bash
npx jest src/sources/ai-agent
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/index.ts
git commit -m "feat(ai-agent): wire fill_gap + review_org into deepen+review toolset"
```

---

## Task 5: Construct contexts in source bootstrap (index.ts)

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/index.ts`

The source bootstrap currently constructs `WorkQueueContext` (for harvest_serp/deepen_org/discover). PR4d adds `FillGapContext` (which needs the same web_search + classify + extract trio plus the source's existing `webSearch` runner) and `LLMJudgeContext` (which wraps the parent OpenAI client).

- [ ] **Step 1: Read current index.ts to find the WorkQueueContext construction**

```bash
cat examples/scraper-node/src/sources/ai-agent/index.ts | head -80
```

- [ ] **Step 2: Add the two new contexts**

After `WorkQueueContext` is built, add:

```typescript
const fillGapContext: FillGapContext = {
    webSearch: async (args, opts) => {
        // Use the existing web_search tool's handler; build a minimal Tool ourselves to call it.
        const tool = makeWebSearchTool(query)
        const result = await tool.handler({ query: args.query, count: args.count }, opts?.signal)
        return { results: result?.results ?? [] }
    },
    classifyPage: workQueueContext.classifyPage,
    extractContacts: workQueueContext.extractContacts,
}

const llmJudgeContext: LLMJudgeContext = {
    callJudge: async (messages) => {
        const response = await client.chat.completions.create({
            model: cfg.model,
            temperature: cfg.temperature,
            messages: messages as any,
            response_format: { type: 'json_object' },
        })
        return { content: response.choices?.[0]?.message?.content ?? null }
    },
}
```

Pass them to `runAgentLoop`:

```typescript
const loopPromise = runAgentLoop(client, query, queue, reportState, cfg, {
    onToolCall, signal,
    workQueue,
    workQueueContext,
    fillGapContext,        // NEW
    llmJudgeContext,       // NEW
    maxToolCallsPerOrg: cfg.maxToolCallsPerOrg,
})
```

`runAgentLoop` already accepts `BuildToolsOptions` (via the hooks parameter). Verify by reading `loop.ts:96` for the function signature.

- [ ] **Step 3: Update runAgentLoop signature if needed**

Open `examples/scraper-node/src/sources/ai-agent/loop.ts`. Find the `AgentLoopHooks` interface (around line 80-95). Add:

```typescript
fillGapContext?: FillGapContext
llmJudgeContext?: LLMJudgeContext
```

Pass them through to `buildTools` calls (search for `buildTools(query, queue,`):

```typescript
const buildToolsOpts: BuildToolsOptions = {
    extractorRunner,
    workQueue: hooks?.workQueue,
    workQueueContext: hooks?.workQueueContext,
    fillGapContext: hooks?.fillGapContext,
    llmJudgeContext: hooks?.llmJudgeContext,
    maxToolCallsPerOrg: hooks?.maxToolCallsPerOrg,
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/sources/ai-agent
```

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/index.ts \
        examples/scraper-node/src/sources/ai-agent/loop.ts
git commit -m "feat(ai-agent): wire fillGapContext + llmJudgeContext from bootstrap"
```

---

## Task 6: Update buildDeepenReviewInstructions prompt

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/prompts.ts`

Tell the LLM the new tools exist.

- [ ] **Step 1: Read the existing buildDeepenReviewInstructions**

```bash
grep -n "buildDeepenReviewInstructions" examples/scraper-node/src/sources/ai-agent/prompts.ts
```

- [ ] **Step 2: Add fill_gap and review_org guidance**

The prompt should now include:

```
Tools in this phase:
- list_orgs(status?, limit?) — see what's in the queue
- pick_next_partial() — get the highest-priority partial record
- deepen_org(orgId) — walk the record's frontier, classify+extract URLs (server-side state machine; up to 10 fetches per org)
- fill_gap(orgId, field) — targeted web search for one missing field; per-(org, field) budget of 1
- review_org(orgId) — LLM judgment: verify/reject/still-partial; per-record budget of 1
- freeze_org(orgId) — force-finalize a partial: verified if it has at least one contact, else rejected
- revise_plan(reason) — bounce back to plan phase if strategy stops working

Workflow heuristics:
- Process the queue from most-promising (fewest gaps) to most-broken. pick_next_partial picks; deepen_org fills gaps via the record's frontier.
- After deepen_org, if gaps remain, try fill_gap(orgId, field) for the most useful missing field. (One attempt per gap; failure means the gap stays.)
- After all gaps filled OR fill_gap exhausted, call review_org(orgId) to get an LLM verdict on whether the record is trustworthy. Verified records are kept; rejected records are dropped from final output.
- When you've exhausted partials OR are running out of budget, call freeze_org on the remaining partials to finalize them.

Stop conditions: queue has no more partials, total budget exhausted, or wall-clock timeout. When stopping, send a final assistant message (no tool call) summarizing.
```

(Adapt to match the existing prompt's tone — read it first.)

- [ ] **Step 3: Verify**

```bash
npx jest src/sources/ai-agent
```

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/prompts.ts
git commit -m "feat(ai-agent): document fill_gap + review_org in deepen+review prompt"
```

---

## Task 7: Full verification

- [ ] **Step 1: Build whole repo**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4d
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run scraper-node tests**

```bash
cd examples/scraper-node && bash scripts/test.sh 2>&1 | tail -8
```

Expected: ~330 tests passing (308 baseline + ~22 from PR4d).

- [ ] **Step 3: Run repo-wide**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4d
npm test --workspaces --if-present 2>&1 | grep -E "^(Tests:|Test Suites:|FAIL)"
```

Expected: every workspace green (modulo the known packages/common flake — re-run if it fires).

---

## Task 8: Push branch + open PR

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected: 6 commits matching tasks 1-6.

- [ ] **Step 2: Push**

```bash
git push -u origin feature/ai-agent-pr4d
```

- [ ] **Step 3: PR title and body**

Title:
```
feat(ai-agent): PR4d — fill_gap + review_org (last spec PR)
```

Body:
```markdown
## Summary
- Final PR of the AI-agent overhaul per `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md`. Closes the work-queue pipeline with the two LLM-judgment tools.
- New `fill_gap(orgId, field)` tool: builds a targeted web-search query (`"<orgName>" <field-keyword> <city>`), classifies + extracts the top result, picks values for the requested field only. Per-(org, field) budget of 1.
- New `review_org(orgId)` tool: single-shot LLM call (parent client, JSON output) that decides `verify | reject | still-partial`, sets confidence, and applies resolutions to existing conflicts. Per-record budget of 1.
- New `LLMJudgeContext` injection seam wraps the parent OpenAI client with `response_format: { type: 'json_object' }`.
- Both tools registered in `deepen+review` phase via `buildTools`.
- Source bootstrap (`index.ts`) constructs `FillGapContext` (reuses web_search + classify + extract from PR1/PR4b/PR4c) and `LLMJudgeContext` (wraps parent client).
- **Emit semantic unchanged**: PR4c emits records on `deepen_org` saturated transition + `freeze_org` verified. PR4d's `review_org` updates queue-state observability (status, confidence, conflicts, notes) but does NOT re-emit. Records that get rejected by review_org have already been emitted by PR4c — they appear in the AsyncQueue but with status='rejected' on the queue side. Downstream consumers can filter by status.
- Spec deviation flagged: review-after-emit (option B). The spec's pseudocode in §3.9 doesn't explicitly say review gates emission; PR4c established the saturated→emit semantic and PR4d preserves it.

## Test plan
- [x] fill_gap unit tests (~8): field validation, no-op when filled, per-attempt budget, value-discard for non-requested fields, conflict surfacing.
- [x] review_org unit tests (~9): verify/reject/still-partial decisions, conflict resolution, malformed JSON handling, per-record cap, decoupling from emit.
- [x] Existing 308 scraper-node tests still pass.
- [x] `npm run build` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review

**Spec coverage** (against §3.8 + §3.9):

- §3.8 fill_gap: targeted web search for one missing field → Task 2.
- §3.8 query template (`"<orgName>" <field> <city>`) → Task 2.
- §3.8 per-record gap-fill budget = 1 attempt per gap → Task 2 (`attempted` Set).
- §3.9 review_org LLM call → Task 3.
- §3.9 input shape (record + resolutionRules) → Task 3 (system prompt embeds rules).
- §3.9 output schema (decision/resolutions/rejectReason/remainingGaps/confidence) → Task 3 (parseDecision).
- §3.9 "LLM does not invent values" → Task 3 (resolutions reference existing indices only).
- §3.9 verify/reject/still-partial → Task 3 (queue-state updates).
- §3.10 `fill_gap` + `review_org` in deepen+review phase → Task 4.

**Open questions for plan-time:**

- **Q1**: Should `review_org` re-trigger emission for verified records? The plan says no (review-after-emit, option B). But if a record was emitted as `saturated` (PR4c) and then `review_org` rejects it, the AsyncQueue<OrgData> still contains the rejected record. Downstream filtering by `status` is needed. Acceptable for PR4d; could be tightened in a follow-up by having the source's outer loop drop rejected records.
- **Q2**: Should `fill_gap` have a confidence-score effect? Currently it adds values without changing confidence. `review_org` is the place that adjusts confidence. Acceptable.
- **Q3**: The `web_search` tool from PR4c is wired through `makeWebSearchTool(query)`. PR4d's `fill_gap` also uses it. Calling it twice (once in harvest, once in fill_gap) doesn't share results — there's a per-run cache in the agent loop but `fill_gap` doesn't go through that cache. Acceptable for now; cache integration would be a follow-up.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-30-ai-agent-pr4d-fill-gap-review.md`.
