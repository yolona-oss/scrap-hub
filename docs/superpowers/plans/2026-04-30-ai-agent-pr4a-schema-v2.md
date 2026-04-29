# AI-Agent PR4a — Schema v2 Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `OrgData` to multi-valued + provenance + status + confidence shape, update validator/dedup/emit pipeline, update JSON+CSV+Sheets exporters, leave the LLM-facing tools (`report_results`) accepting the old singular shape and translating internally. Atomic schema break, but self-contained: no work queue, no new tools, no new phases. Every existing test gets updated; LLM behavior unchanged.

**Architecture:** Three layers. (1) `types.ts` redefines `OrgData` per spec §5: required `phones[]`, `emails[]`, `addresses[]`, `sources[]`, `status`, `confidence`, `extractionMethod`; optional `branches[]`, `fieldProvenance`, `conflicts[]`, `notes[]`. URL/source/etc. all derived from `sources[]`. (2) `OrgScraper.addOrg` rewrites to array-aware merge with conflict surfacing. `emit.ts` validator updated for arrays. JSON exporter wraps in v2 envelope (`schemaVersion: 2`, `run` block, `countByStatus`). CSV/Sheets switch to long-format (one row per phone × address). (3) Adapters at the LLM tool surface: `report_results` accepts the same `{phone, email, address}` shape from the model and translates into v2 records server-side. Source adapters (yandex-business, fake, etc.) get a thin `wrapAsOrgData(legacyOrg)` helper.

**Tech Stack:** TypeScript, Node 20, Jest 30, cheerio for tests.

**Spec reference:** `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` §5 (output schema v2), §5.1 (exporter envelope). PR4a covers only the schema/validator/dedup/exporter layer. Work queue, harvest/deepen tools, and phase machine come in PR4b/PR4c/PR4d.

---

## Scope Boundaries

**IN scope (PR4a):**
- `OrgData` type redefinition.
- `emit.ts` validator updated for arrays.
- `OrgScraper.addOrg` array-aware merge + conflict surfacing.
- JSON exporter v2 envelope.
- CSV exporter long-format.
- Sheets exporter long-format.
- `report_results` tool: accept legacy shape from LLM, translate to v2.
- Source adapter helper `wrapAsOrgData()`.
- All existing tests updated to v2.

**NOT in scope (deferred):**
- Work queue (`OrgRecord` with id/status transitions) — PR4b.
- New parent-agent tools (`harvest_serp`, `deepen_org`, etc.) — PR4b.
- `harvest`/`deepen+review` phases in `loop.ts` — PR4c.
- `fill_gap`, `review_org` — PR4d.
- LLM prompt changes — PR4c.
- Branch enumeration — PR4b.
- Address structuring (`OrgAddress` with city/street/lat/lon) — keeping `string` for now; structured form lands when work queue produces it.

**Why this scope:** Schema v2 is the atomic break. Everything else builds on it. Landing it alone proves the type system and exporters work, gives golden-test fixtures something stable to assert against, and lets PR4b focus purely on the work-queue runtime.

---

## File Structure

| File | Change |
|---|---|
| `examples/scraper-node/src/types.ts` | **REWRITE.** v2 shape. |
| `examples/scraper-node/src/sources/ai-agent/tools/emit.ts:1-173` | Validator + emit helpers updated for arrays. |
| `examples/scraper-node/src/sources/ai-agent/tools/report-results.ts` | Translation layer: accept legacy `{phone, email, address}` from LLM, build v2 record. |
| `examples/scraper-node/src/scraper-service/scraper.ts:33-82` | `dedupKey` reads `phones[0]`/`addresses[0]`; `addOrg` array-aware merge with conflict capture. |
| `examples/scraper-node/src/exporters/json.ts` | v2 envelope: `schemaVersion: 2`, `run`, `countByStatus`. |
| `examples/scraper-node/src/plugins/csv.ts` | Long-format. |
| `examples/scraper-node/src/plugins/google-sheets.ts` | Long-format. |
| `examples/scraper-node/src/sources/types.ts` | Source adapter helper `wrapAsOrgData(legacy)`. |
| `examples/scraper-node/src/sources/yandex-business.ts` | Use `wrapAsOrgData()` helper. |
| `examples/scraper-node/src/sources/fake/index.ts` | Use `wrapAsOrgData()` helper. |
| `examples/scraper-node/src/sources/cheerio-web.ts` | Use `wrapAsOrgData()` helper. |
| `examples/scraper-node/src/ui-messages/org.ts` | Read `phones[0]`/`emails[0]`/`addresses[0]` for display. |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/emit.test.ts` | Updated for array shape. |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/report-results.test.ts` | Updated for v2 records. |
| `examples/scraper-node/src/sources/__tests__/yandex-business.test.ts` | Updated for v2 records. |
| (other test files) | Updated as compile errors surface. |

---

## Decisions Locked Before Implementation

- **Singulars removed wholesale.** No `phone`, `email`, `address`, `source`, `url` fields on `OrgData`. Per spec §5.
- **`OrgAddress` stays as `string` for now**, not the structured form (`{full, city, street, ...}`). Structured form lands when something actually produces it (work queue + extractor in PR4b/PR4d). For PR4a, `addresses: string[]`. This is a deviation from spec §5 worth flagging — see open questions Q1.
- **`branches?: OrgBranch[]` exists in the type but stays empty** through PR4a. Filled by harvest_serp / deepen in PR4b.
- **`fieldProvenance` and `conflicts` exist as optional** but stay undefined through PR4a. Filled by review_org in PR4d.
- **`status: 'partial'` is the default** for everything emitted in PR4a. The work queue's `verified | rejected` transitions happen in PR4b/PR4d. So PR4a effectively emits `status: 'partial'` records, but with the right shape for the rest of the chain.
- **`confidence: 0.5` default** for things produced before review. 1.0 for structured-source records (yandex-business API). Documented in `wrapAsOrgData()`.
- **`extractionMethod`** values: `'deterministic'` for sources/regex; `'extractor-llm'` when extract_contacts escalates and the extractor produces values; `'mixed'` reserved for PR4d.
- **`report_results` keeps its legacy `{phone, email, address}` parameter shape** so existing prompts work unchanged. The handler translates server-side into a v2 record. This is the lowest-risk path — PR4c will swap prompts and parameters together.
- **Long-format CSV/Sheets**: one row per `(name, phone, email, address)` cross-product, deduped on the row level. Empty arrays still produce one row with nulls.
- **JSON exporter v2 envelope** matches spec §5.1 exactly. `run.toolCallsUsed` and `run.extractionsByMethod` stay zero-valued in PR4a since there's no run-state collector yet.
- **Source removal stays for PR5.** Adapter helpers translate legacy → v2 here; PR5 deletes adapters entirely.
- **Worktree:** `.worktrees/ai-agent-pr4`, branch `feature/ai-agent-pr4`. Already created and `npm install`ed; baseline 213 ai-agent tests + scraper-node total 274 + 2 from cheerio cleanup = 276 green at HEAD.

---

## Task 1: Define v2 OrgData and supporting types

**Files:**
- Modify: `examples/scraper-node/src/types.ts`
- Test: `examples/scraper-node/src/__tests__/types.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/__tests__/types.test.ts`:

```typescript
import type { OrgData, OrgSourceRef, OrgBranch, OrgConflict, FieldProvenance, SearchQuery } from '../types'

describe('v2 types', () => {
    it('OrgData requires multi-valued contact fields and metadata', () => {
        const r: OrgData = {
            name: 'Acme Clinic',
            phones: ['+78121001010'],
            emails: ['info@acme.ru'],
            addresses: ['ул. Ленина, 1'],
            sources: [{
                url: 'https://acme.ru/',
                kind: 'org-site',
                extractedAt: '2026-04-30T00:00:00Z',
                extractionMethod: 'deterministic',
            }],
            status: 'partial',
            confidence: 0.5,
            extractionMethod: 'deterministic',
        }
        expect(r.phones).toEqual(['+78121001010'])
        expect(r.status).toBe('partial')
        expect(r.confidence).toBe(0.5)
    })

    it('OrgData allows empty arrays', () => {
        const r: OrgData = {
            name: 'X',
            phones: [],
            emails: [],
            addresses: [],
            sources: [],
            status: 'partial',
            confidence: 0,
            extractionMethod: 'deterministic',
        }
        expect(r.phones).toEqual([])
    })

    it('OrgData accepts optional branches, fieldProvenance, conflicts, notes', () => {
        const branch: OrgBranch = { address: 'ул. Пушкина, 5', phones: ['+78122002020'] }
        const conflict: OrgConflict = {
            field: 'phone',
            values: [{ value: '+78121001010', sourceUrl: 'a' }, { value: '+78121001011', sourceUrl: 'b' }],
        }
        const provenance: FieldProvenance = {
            phones: [{ value: '+78121001010', sourceUrl: 'a' }],
        }
        const r: OrgData = {
            name: 'X',
            phones: ['+78121001010'],
            emails: [],
            addresses: [],
            sources: [],
            branches: [branch],
            conflicts: [conflict],
            fieldProvenance: provenance,
            notes: ['multi-branch'],
            status: 'verified',
            confidence: 0.9,
            extractionMethod: 'mixed',
        }
        expect(r.branches?.[0].address).toMatch(/Пушкина/)
        expect(r.conflicts?.[0].field).toBe('phone')
    })

    it('OrgSourceRef has the five canonical kinds', () => {
        const kinds: OrgSourceRef['kind'][] = [
            'aggregator-landing', 'aggregator-serp', 'aggregator-detail', 'org-site', 'web-search',
        ]
        for (const k of kinds) {
            const ref: OrgSourceRef = {
                url: 'https://x',
                kind: k,
                extractedAt: '2026-04-30T00:00:00Z',
                extractionMethod: 'deterministic',
            }
            expect(ref.kind).toBe(k)
        }
    })

    it('SearchQuery still carries sources[] (PR5 removes; PR4a leaves)', () => {
        const q: SearchQuery = { query: 'q', sources: ['ai-agent'], maxResults: 100 }
        expect(q.maxResults).toBe(100)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4/examples/scraper-node
npx jest src/__tests__/types.test.ts
```
Expected: FAIL — types not defined.

- [ ] **Step 3: Rewrite `types.ts`**

Replace `examples/scraper-node/src/types.ts` entirely:

```typescript
export type OrgStatus = 'verified' | 'partial' | 'rejected'

export type OrgExtractionMethod = 'deterministic' | 'extractor-llm' | 'mixed'

export type OrgSourceKind =
    | 'aggregator-landing'
    | 'aggregator-serp'
    | 'aggregator-detail'
    | 'org-site'
    | 'web-search'

export interface OrgSourceRef {
    url: string
    kind: OrgSourceKind
    extractedAt: string  // ISO8601
    extractionMethod: 'deterministic' | 'extractor-llm'
}

export interface OrgBranch {
    name?: string
    address: string
    phones?: string[]
    emails?: string[]
}

export interface OrgConflictValue {
    value: string
    sourceUrl: string
}

export interface OrgConflict {
    field: 'name' | 'phone' | 'email' | 'address'
    values: OrgConflictValue[]
    resolution?: 'auto' | 'review' | 'unresolved'
    chosenIndex?: number
}

export interface FieldProvenance {
    name?: { value: string, sourceUrl: string }
    phones?: { value: string, sourceUrl: string }[]
    emails?: { value: string, sourceUrl: string }[]
    addresses?: { value: string, sourceUrl: string }[]
}

export interface OrgData {
    name: string
    phones: string[]
    emails: string[]
    addresses: string[]
    sources: OrgSourceRef[]
    status: OrgStatus
    confidence: number  // 0..1
    extractionMethod: OrgExtractionMethod
    branches?: OrgBranch[]
    fieldProvenance?: FieldProvenance
    conflicts?: OrgConflict[]
    notes?: string[]
}

export interface SearchQuery {
    query: string
    city?: string
    sources: string[]
    maxResults: number
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/types.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: many errors across consumers. **Don't fix them yet.** Note them as the work queue for the next tasks. Save the count: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/types.ts \
        examples/scraper-node/src/__tests__/types.test.ts
git commit -m "feat(types): redefine OrgData for schema v2 (multi-valued + provenance + status)"
```

This commit *will* leave the build broken — that's intentional. The next tasks fix consumers one by one.

---

## Task 2: Add `wrapAsOrgData` helper for source adapters

**Files:**
- Modify: `examples/scraper-node/src/sources/types.ts`
- Test: `examples/scraper-node/src/sources/__tests__/wrap-as-org-data.test.ts` (new)

Source adapters (yandex-business, fake, cheerio-web) currently produce legacy-shape org records. Rather than rewrite each adapter, we add a small helper. PR5 deletes the legacy adapters entirely.

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/__tests__/wrap-as-org-data.test.ts`:

```typescript
import { wrapAsOrgData } from '../types'

describe('wrapAsOrgData', () => {
    it('wraps a singular legacy record into v2 shape', () => {
        const r = wrapAsOrgData({
            name: 'Acme',
            phone: '+78121001010',
            email: 'info@acme.ru',
            address: 'ул. Ленина, 1',
            url: 'https://acme.ru/',
            source: 'yandex-business',
        })
        expect(r.name).toBe('Acme')
        expect(r.phones).toEqual(['+78121001010'])
        expect(r.emails).toEqual(['info@acme.ru'])
        expect(r.addresses).toEqual(['ул. Ленина, 1'])
        expect(r.sources).toHaveLength(1)
        expect(r.sources[0].kind).toBe('aggregator-detail')
        expect(r.sources[0].url).toBe('https://acme.ru/')
        expect(r.status).toBe('partial')
        expect(r.confidence).toBe(1.0)
        expect(r.extractionMethod).toBe('deterministic')
    })

    it('drops null contact fields', () => {
        const r = wrapAsOrgData({
            name: 'X', phone: null, email: null, address: null, source: 'fake',
        })
        expect(r.phones).toEqual([])
        expect(r.emails).toEqual([])
        expect(r.addresses).toEqual([])
        expect(r.sources).toHaveLength(0)
    })

    it('respects optional kind override', () => {
        const r = wrapAsOrgData({
            name: 'X', phone: '+7', email: null, address: null,
            url: 'https://x', source: 'web-search',
        }, { kind: 'web-search' })
        expect(r.sources[0].kind).toBe('web-search')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest src/sources/__tests__/wrap-as-org-data.test.ts
```
Expected: FAIL — function not exported.

- [ ] **Step 3: Read current `sources/types.ts` and append `wrapAsOrgData`**

Read first to see what's there:

```bash
cat examples/scraper-node/src/sources/types.ts
```

Append at the end:

```typescript
import type { OrgData, OrgSourceKind } from '../types'

/** Legacy singular-shape record produced by older source adapters. */
export interface LegacyOrgRecord {
    name: string
    phone: string | null
    email: string | null
    address: string | null
    url?: string
    source: string
}

export interface WrapAsOrgDataOptions {
    /** Override the inferred source kind (default: 'aggregator-detail'). */
    kind?: OrgSourceKind
}

/** Translate a legacy singular-shape org record into v2 OrgData. Used by source adapters
 *  during the transition. PR5 deletes all legacy adapters; this helper goes with them. */
export function wrapAsOrgData(legacy: LegacyOrgRecord, opts: WrapAsOrgDataOptions = {}): OrgData {
    const phones = legacy.phone ? [legacy.phone] : []
    const emails = legacy.email ? [legacy.email] : []
    const addresses = legacy.address ? [legacy.address] : []
    const url = legacy.url
    const kind = opts.kind ?? 'aggregator-detail'
    const sources = url
        ? [{
            url,
            kind,
            extractedAt: new Date().toISOString(),
            extractionMethod: 'deterministic' as const,
        }]
        : []
    return {
        name: legacy.name,
        phones,
        emails,
        addresses,
        sources,
        status: 'partial',
        confidence: 1.0,  // Legacy adapters have hand-coded selectors; trust their output.
        extractionMethod: 'deterministic',
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest src/sources/__tests__/wrap-as-org-data.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/types.ts \
        examples/scraper-node/src/sources/__tests__/wrap-as-org-data.test.ts
git commit -m "feat(sources): add wrapAsOrgData helper for legacy adapter translation"
```

---

## Task 3: Update emit.ts validator for v2

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/emit.ts:1-173`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/emit.test.ts`

`emit.ts` is the validation gate. Current rules: name + at least one of phone/email/validated-address. New rules (per spec §5 validation gate update): name + at least one of `phones.length > 0`, `emails.length > 0`, `addresses.length > 0`. Address validation rules apply per-element.

- [ ] **Step 1: Read current emit.ts**

```bash
cat examples/scraper-node/src/sources/ai-agent/tools/emit.ts
```

Note the existing exports (`emitOrg`, `emitMany`, `ReportState`, validation helpers) and the address validator functions — these must be preserved with array-aware signatures.

- [ ] **Step 2: Update emit.ts**

The transformation is mechanical:
- Functions taking `org: { phone?, email?, address? }` now take `org: { phones, emails, addresses }`.
- Validation: `org.phone || org.email || org.address` becomes `org.phones.length || org.emails.length || org.addresses.length`.
- Address validator runs over `org.addresses` (already an array per element).

Open `emit.ts` and apply these changes throughout. The function names and exported symbols stay identical. ReportState shape (`{accepted, rejected, currentBatchAccepted, ...}`) is unchanged — those are counters.

- [ ] **Step 3: Update emit.test.ts**

Open `examples/scraper-node/src/sources/ai-agent/tools/__tests__/emit.test.ts`. Wherever a test constructs an org with `{phone: '+7...', email: 'x@y', address: '...'}`, change to `{phones: ['+7...'], emails: ['x@y'], addresses: ['...']}` plus the required v2 fields (`name`, `sources: []`, `status: 'partial'`, `confidence: 0.5`, `extractionMethod: 'deterministic'`).

For tests asserting "rejected because no contact": remove the singular contact, set arrays to `[]`.

- [ ] **Step 4: Run emit tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/emit.test.ts
```
Expected: all pre-existing tests pass against v2 shape. If any fails because of legitimate semantic change (validator now accepts an org with `addresses[0] === ''` where it would previously have rejected `address: ''` — both should reject), fix the validator to maintain behavior, not the test.

- [ ] **Step 5: Run typecheck and observe errors decrease**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"
```

Should be lower than after Task 1.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/emit.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/emit.test.ts
git commit -m "feat(ai-agent): update emit validator for v2 array shape"
```

---

## Task 4: Update report-results to translate legacy → v2

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/report-results.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/report-results.test.ts`

`report-results` is the LLM-facing tool. Existing prompts pass `{phone, email, address}` per org. Keeping that param shape (PR4c will swap) — the handler translates to v2 before emitting.

- [ ] **Step 1: Read current report-results.ts**

```bash
cat examples/scraper-node/src/sources/ai-agent/tools/report-results.ts
```

- [ ] **Step 2: Update report-results.ts**

The Tool's `parameters` schema stays unchanged (the LLM still sees `phone/email/address`). The handler:
1. Maps each input org from `{name, phone, email, address, url}` to v2 OrgData via the same shape as `wrapAsOrgData`, but adapt:
   - `extractionMethod: 'extractor-llm'` (or `'deterministic'` if the agent ran extract-contacts deterministic-only — but for PR4a default `'deterministic'`).
   - `kind: 'org-site'` if a URL is provided, else `[]` for sources.
   - `confidence: 0.7` (LLM-emitted via report_results — less trust than legacy adapter).
2. Calls `emitMany([...v2records], state, query, queue)` with the new shape.

- [ ] **Step 3: Update report-results.test.ts**

Tests construct expected `OrgData` records — convert from singular to array shape. Helpers in the test for building expected records can stay if their shape is updated.

- [ ] **Step 4: Run tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/report-results.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/report-results.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/report-results.test.ts
git commit -m "feat(ai-agent): report_results translates LLM legacy-shape into v2 records"
```

---

## Task 5: Update scraper.ts dedup + array-aware merge

**Files:**
- Modify: `examples/scraper-node/src/scraper-service/scraper.ts:33-82`

`dedupKey` and `addOrg` are the storage layer. The dedup key stays semantically the same (`name::phone || name::address`) but now reads `phones[0]` / `addresses[0]`. The merge expands arrays, surfaces conflicts (when a new value differs from an existing single value, both get kept).

- [ ] **Step 1: Read current scraper.ts:33-82**

```bash
sed -n '33,82p' examples/scraper-node/src/scraper-service/scraper.ts
```

- [ ] **Step 2: Update dedupKey + addOrg**

Replace the `dedupKey` function:

```typescript
function dedupKey(org: OrgData): string {
    const name = normalizeString(org.name)
    const phone = org.phones[0] ? normalizeString(org.phones[0]) : ''
    const address = org.addresses[0] ? normalizeString(org.addresses[0]) : ''
    // Primary: name+phone, fallback: name+address
    return phone ? `${name}::${phone}` : `${name}::${address}`
}
```

Replace the `addOrg` method body (the merge):

```typescript
private addOrg(org: OrgData): boolean {
    const key = dedupKey(org)
    if (this.seen.has(key)) {
        const existing = this.seen.get(key)!
        // Array union for each contact field.
        for (const x of org.phones) if (!existing.phones.includes(x)) existing.phones.push(x)
        for (const x of org.emails) if (!existing.emails.includes(x)) existing.emails.push(x)
        for (const x of org.addresses) if (!existing.addresses.includes(x)) existing.addresses.push(x)
        for (const s of org.sources) {
            if (!existing.sources.some(e => e.url === s.url && e.kind === s.kind)) {
                existing.sources.push(s)
            }
        }
        // Confidence: take the higher of the two (more sources = more confident).
        if (org.confidence > existing.confidence) existing.confidence = org.confidence
        return false
    }
    this.seen.set(key, org)
    this.results.push(org)
    return true
}
```

- [ ] **Step 3: Run scraper tests if they exist**

```bash
npx jest src/scraper-service
```

If existing tests construct `OrgData` literals, update them inline to v2 shape. Same find-and-replace pattern as emit tests.

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/scraper-service/scraper.ts
git commit -m "feat(scraper): array-aware dedup merge with source-ref union"
```

---

## Task 6: Update legacy source adapters to use wrapAsOrgData

**Files:**
- Modify: `examples/scraper-node/src/sources/yandex-business.ts`
- Modify: `examples/scraper-node/src/sources/fake/index.ts`
- Modify: `examples/scraper-node/src/sources/cheerio-web.ts`
- Modify: `examples/scraper-node/src/sources/__tests__/yandex-business.test.ts`

- [ ] **Step 1: Read each adapter and find the OrgData construction sites**

```bash
grep -n "name:\|email:\|phone:\|address:" examples/scraper-node/src/sources/yandex-business.ts examples/scraper-node/src/sources/fake/index.ts examples/scraper-node/src/sources/cheerio-web.ts | head -40
```

Each adapter has 1-3 places where it builds an `OrgData` literal. Wrap each with `wrapAsOrgData()`:

Before:
```typescript
yield { name, phone, email, address, source: 'yandex-business', url }
```

After:
```typescript
yield wrapAsOrgData({ name, phone, email, address, source: 'yandex-business', url })
```

The `url`, `name`, `phone`, `email`, `address`, `source` field names stay identical at the *call site* (they're keys on the legacy input object), so the diff is small.

- [ ] **Step 2: Apply the changes per adapter**

For each adapter file, add the import:
```typescript
import { wrapAsOrgData } from './types'  // or '../types' depending on path
```

Then wrap each `OrgData` construction with `wrapAsOrgData(...)`.

- [ ] **Step 3: Update yandex-business.test.ts**

Where the test asserts on a returned org's `phone` field, change to `phones[0]`. Same for email/address.

- [ ] **Step 4: Run source tests**

```bash
npx jest src/sources/__tests__
```

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/yandex-business.ts \
        examples/scraper-node/src/sources/fake/index.ts \
        examples/scraper-node/src/sources/cheerio-web.ts \
        examples/scraper-node/src/sources/__tests__/yandex-business.test.ts
git commit -m "feat(sources): wrap legacy adapter outputs in v2 OrgData"
```

---

## Task 7: Update JSON exporter to v2 envelope

**Files:**
- Modify: `examples/scraper-node/src/exporters/json.ts`
- Test: `examples/scraper-node/src/exporters/__tests__/json.test.ts` (new if not exists)

- [ ] **Step 1: Check if there's a json exporter test**

```bash
ls examples/scraper-node/src/exporters/__tests__/ 2>/dev/null
```

If no test, create one. If yes, extend it.

- [ ] **Step 2: Write/update the test**

Create or modify `examples/scraper-node/src/exporters/__tests__/json.test.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { JsonExporter } from '../json'
import type { OrgData, SearchQuery } from '../../types'

const ORG: OrgData = {
    name: 'Acme', phones: ['+78121001010'], emails: [], addresses: [],
    sources: [], status: 'partial', confidence: 0.5, extractionMethod: 'deterministic',
}
const QUERY: SearchQuery = { query: 'q', sources: [], maxResults: 10 }

describe('JsonExporter v2 envelope', () => {
    let tmpDir: string

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'json-export-test-'))
        process.chdir(tmpDir)
    })

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('writes a v2 envelope with schemaVersion=2 and run/countByStatus blocks', async () => {
        const exporter = new JsonExporter()
        const result = await exporter.export([ORG], QUERY)
        const payload = JSON.parse(fs.readFileSync(result.filePath!, 'utf-8'))
        expect(payload.schemaVersion).toBe(2)
        expect(payload.run).toBeDefined()
        expect(payload.run.toolCallsUsed).toBe(0)  // no run-state collector in PR4a
        expect(payload.countByStatus).toEqual({ verified: 0, partial: 1, rejected: 0 })
        expect(payload.results).toHaveLength(1)
        expect(payload.results[0].phones).toEqual(['+78121001010'])
    })
})
```

- [ ] **Step 3: Update json.ts**

Replace the export body with:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from './types'
import { OrgData, SearchQuery } from '../types'
import { log } from '@cmd-hub/common'

export class JsonExporter implements IExporter {
    readonly name = 'json'
    readonly fileExtension = '.json'

    async export(data: OrgData[], query: SearchQuery): Promise<ExportResult> {
        log.debug(`json-exporter.export: rows=${data.length} query="${query.query}"`)
        const dir = path.join('storage', 'exports')
        try {
            fs.mkdirSync(dir, { recursive: true })
        } catch (e: any) {
            log.error(`json-exporter.export: mkdir "${dir}" failed: ${e?.message ?? e}`)
            throw e
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const safeQuery = query.query.replace(/[^a-zA-Zа-яА-Я0-9 ]/g, '').slice(0, 30).trim().replace(/ /g, '_')
        const fileName = `orgs_${safeQuery}_${timestamp}.json`
        const filePath = path.join(dir, fileName)

        const countByStatus = {
            verified: data.filter(d => d.status === 'verified').length,
            partial: data.filter(d => d.status === 'partial').length,
            rejected: data.filter(d => d.status === 'rejected').length,
        }
        const aggregatorsHit = Array.from(new Set(
            data.flatMap(d => d.sources)
                .filter(s => s.kind.startsWith('aggregator'))
                .map(s => {
                    try { return new URL(s.url).hostname } catch { return '' }
                })
                .filter(Boolean)
        ))

        const payload = {
            schemaVersion: 2 as const,
            query,
            exportedAt: new Date().toISOString(),
            run: {
                agentVersion: process.env.npm_package_version ?? 'unknown',
                parentModel: '',           // populated in PR4c when run state collected
                extractorModel: '',        // populated in PR4c
                toolCallsUsed: 0,
                extractionsByMethod: { deterministic: 0, llm: 0 },
                durationMs: 0,
                pagesFetched: 0,
                aggregatorsHit,
            },
            count: data.length,
            countByStatus,
            results: data,
        }
        const json = JSON.stringify(payload, null, 2)
        try {
            fs.writeFileSync(filePath, json, 'utf-8')
            log.info(`json-exporter.export: wrote ${data.length} rows to ${filePath} (${json.length}b)`)
        } catch (e: any) {
            log.error(`json-exporter.export: writeFileSync "${filePath}" failed: ${e?.message ?? e}`)
            throw e
        }

        return {
            type: 'file',
            filePath,
            message: `Exported ${data.length} organizations to ${fileName}`,
        }
    }
}
```

- [ ] **Step 4: Run test**

```bash
npx jest src/exporters/__tests__/json.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/exporters/json.ts \
        examples/scraper-node/src/exporters/__tests__/json.test.ts
git commit -m "feat(exporters): JSON v2 envelope with schemaVersion + run + countByStatus"
```

---

## Task 8: Update CSV + Sheets exporters to long-format

**Files:**
- Modify: `examples/scraper-node/src/plugins/csv.ts`
- Modify: `examples/scraper-node/src/plugins/google-sheets.ts`

Long-format = one row per `(org, phone, email, address)` cross-product. Empty arrays still produce one row with empty cells.

- [ ] **Step 1: Read current csv.ts**

```bash
cat examples/scraper-node/src/plugins/csv.ts
```

- [ ] **Step 2: Implement long-format row generator**

Add a helper inside csv.ts:

```typescript
function toLongFormatRows(org: OrgData): Array<{
    name: string
    phone: string
    email: string
    address: string
    status: string
    confidence: number
    extractionMethod: string
    sourceUrls: string
}> {
    const phones = org.phones.length ? org.phones : ['']
    const emails = org.emails.length ? org.emails : ['']
    const addresses = org.addresses.length ? org.addresses : ['']
    const sourceUrls = org.sources.map(s => s.url).join(';')
    const rows = []
    for (const phone of phones) {
        for (const email of emails) {
            for (const address of addresses) {
                rows.push({
                    name: org.name,
                    phone, email, address,
                    status: org.status,
                    confidence: org.confidence,
                    extractionMethod: org.extractionMethod,
                    sourceUrls,
                })
            }
        }
    }
    return rows
}
```

Replace the existing row-building loop in csv.ts with:

```typescript
const allRows = data.flatMap(toLongFormatRows)
```

Update the CSV header columns to: `name,phone,email,address,status,confidence,extractionMethod,sourceUrls`.

- [ ] **Step 3: Repeat for google-sheets.ts**

Same row generator pattern. Sheets export uses arrays of arrays for the API; build them the same way.

- [ ] **Step 4: Add a quick test**

If CSV has tests, add a long-format check; otherwise skip (smoke-test it manually via `npm run start:node` is out of scope for PR4a).

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/plugins/csv.ts \
        examples/scraper-node/src/plugins/google-sheets.ts
git commit -m "feat(exporters): CSV + Sheets long-format (one row per phone × email × address)"
```

---

## Task 9: Update ui-messages/org.ts for display

**Files:**
- Modify: `examples/scraper-node/src/ui-messages/org.ts`

The Telegram UI reads `phone`, `email`, `address` for display. Switch to `phones[0]`, `emails[0]`, `addresses[0]` (primary value for display).

- [ ] **Step 1: Read + update**

```bash
cat examples/scraper-node/src/ui-messages/org.ts
```

Replace `org.phone` with `org.phones[0] ?? ''` (similarly for email/address). If there are conditionals like `if (org.phone)`, use `if (org.phones.length)`.

- [ ] **Step 2: Commit**

```bash
git add examples/scraper-node/src/ui-messages/org.ts
git commit -m "feat(ui-messages): display phones[0]/emails[0]/addresses[0]"
```

---

## Task 10: Sweep remaining typecheck errors

**Files:**
- Various test files and minor consumers.

The earlier tasks fix the structural changes. Remaining errors should be in test files constructing `OrgData` literals, or smaller consumers.

- [ ] **Step 1: Run typecheck and triage**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4
npx tsc --noEmit -p examples/scraper-node/tsconfig.json 2>&1 | grep "error TS" | head -40
```

Each error points to a file:line constructing an old-shape OrgData. For each:

- If it's a test asserting on `.phone` / `.email` / `.address`, change to `.phones[0]` etc.
- If it's a test constructing `{phone: '+7'}`, change to `{phones: ['+7'], emails: [], addresses: [], sources: [], status: 'partial', confidence: 0.5, extractionMethod: 'deterministic'}` plus `name`.

- [ ] **Step 2: Apply fixes file by file**

For each file with errors, read it, patch the construction sites, re-run typecheck. Continue until 0 errors.

- [ ] **Step 3: Run full ai-agent suite**

```bash
cd examples/scraper-node && npx jest src/sources/ai-agent
```

- [ ] **Step 4: Commit accumulated fixes**

```bash
git add -A
git commit -m "feat(tests): update OrgData literals to v2 shape across test files"
```

(One commit is fine for the test-file sweep — it's mechanical.)

---

## Task 11: Full repo verification

- [ ] **Step 1: Build whole repo**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4
npm run build 2>&1 | tail -5
```

- [ ] **Step 2: Run scraper-node tests**

```bash
cd examples/scraper-node && bash scripts/test.sh 2>&1 | tail -8
```
Expected: all green. Test count similar to baseline (~280) since this PR is mostly mechanical updates plus a few new test files.

- [ ] **Step 3: Run repo-wide tests**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-pr4
npm test --workspaces --if-present 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL"
```
Expected: every workspace green. Possible flake on packages/common per PR2/PR3 history; rerun if flake.

- [ ] **Step 4: Verify full ai-agent suite green**

```bash
cd examples/scraper-node && npx jest src/sources/ai-agent
```

---

## Task 12: Push branch + open PR

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
```
Expected: ~10 commits matching the task order.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/ai-agent-pr4
```

- [ ] **Step 3: Open the PR via web UI** (gh CLI not installed)

Title:
```
feat(ai-agent): PR4a — schema v2 break (multi-valued OrgData + provenance)
```

Body:
```markdown
## Summary
- Schema v2 break per `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` §5.
- `OrgData` redefined: required `phones[]`, `emails[]`, `addresses[]`, `sources[]`, `status`, `confidence`, `extractionMethod`. Singular `phone`/`email`/`address`/`source`/`url` removed.
- `emit.ts` validator + `OrgScraper.addOrg` updated for arrays. Dedup key reads `phones[0]`/`addresses[0]`.
- JSON exporter wraps in v2 envelope (`schemaVersion: 2`, `run`, `countByStatus`, `aggregatorsHit`).
- CSV + Sheets exporters switch to long-format (one row per phone × email × address).
- Legacy source adapters (yandex-business, fake, cheerio-web) translate via `wrapAsOrgData()`. Deleted in PR5.
- LLM-facing `report_results` keeps its legacy `{phone, email, address}` parameter shape and translates server-side. PR4c will swap prompts + parameters together.
- `OrgAddress` stays as `string` for now (not yet structured per spec §5). Structured form lands when work queue produces it (PR4b/PR4d).
- `branches`, `fieldProvenance`, `conflicts` are typed but stay empty/undefined until PR4b/PR4d.

## Test plan
- [x] All ai-agent tests green.
- [x] Full scraper-node test suite green.
- [x] Repo-wide tests green.
- [x] `npm run build` clean.
- [x] JSON exporter writes valid v2 envelope.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Show the GitHub create-PR URL** (printed by `git push`).

---

## Self-Review

**Spec coverage** (against §5 + §5.1):

- §5 OrgData required fields: `phones[]`, `emails[]`, `addresses[]`, `urls`, `branches?`, `sources`, `fieldProvenance?`, `conflicts?`, `status`, `confidence`, `extractionMethod`, `notes?` → Task 1.
  - **Spec deviation 1**: spec says `urls: string[]` but Option A from prior conversation (derive from `sources`, no separate `urls` field) is locked. Implemented per Option A.
  - **Spec deviation 2**: spec says `OrgAddress` is structured (`{full, city, street, ...}`), Task 1 keeps `addresses: string[]`. Reason: nothing produces structured addresses yet in PR4a. Promoted to v3-or-PR4d when the extractor or work-queue actually emits structure.
- §5 OrgSourceRef → Task 1.
- §5 FieldProvenance → Task 1.
- §5 OrgConflict → Task 1.
- §5 validation gate update → Task 3.
- §5 dedup merge updated → Task 5.
- §5.1 Exporter envelope → Task 7.
- §5.1 CSV/Sheets long-format → Task 8.

**Placeholder scan**: searched for "TBD", "TODO", "implement later", "fill in details", "Add appropriate". One reference to "fix the validator to maintain behavior" in Task 3 Step 4 — that's contingent guidance for *if* a test fails, not a placeholder for the implementer to invent. Acceptable.

**Type consistency**:
- `OrgData` shape consistent across Tasks 1-7.
- `OrgSourceKind` enum exhaustive: 5 values listed in Task 1, used by `wrapAsOrgData` (Task 2 default `'aggregator-detail'`), `report-results` (Task 4 default `'org-site'`), JSON exporter (Task 7 filters `kind.startsWith('aggregator')`).
- `wrapAsOrgData` signature matches the test fixtures in Task 2.
- `addOrg` array-aware merge in Task 5 matches the dedup key change.

**Open questions for plan-time**:

- **Q1** (already flagged): `OrgAddress` stays as `string` for PR4a. Confirm at execute time that this is acceptable, or upgrade to structured before merge. My recommendation: stay `string`; structure when something needs it.
- **Q2**: `confidence` defaults — `1.0` for legacy adapters (Task 2), `0.7` for `report_results` (Task 4), `0.5` for unknown. These are educated guesses; will tune in PR4d when `review_org` exists.
- **Q3**: `aggregatorsHit` in JSON envelope (Task 7) is derived from `sources[].url` filtered by `kind.startsWith('aggregator')`. Reasonable proxy for "what aggregators did the run hit?" Could be wrong if PR4b's work queue ends up emitting source refs with different kind values.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-30-ai-agent-pr4a-schema-v2.md`.
