# AI-Agent Overhaul — Design Spec

**Date:** 2026-04-29
**Scope:** `examples/scraper-node/src/` — primarily `sources/ai-agent/`, with knock-on changes in `scraper-service/`, `exporters/`, `types.ts`, and deletion of the legacy source adapters.
**Goal:** Replace the current "shallow tool-use loop with hand-written per-aggregator adapters" with a layered architecture: deterministic page classification + link discovery + a small extractor sub-agent for hard pages, sitting under a parent agent that maintains an explicit per-org work queue and runs deepening + cross-source merge + self-review.
**Approach:** Five sequenced PRs. Earlier PRs are strictly additive; the schema break and legacy-adapter deletion happen last and atomically.

---

## 1. Motivation

The current `ai-agent` source produces three classes of correctness and recall failures, all rooted in the same architectural gaps:

**A — Lossy page reads.** `fetch_url` truncates to 15,000 characters before the model ever sees the page (`fetch-url.ts:75-76`). For aggregator SERPs (200–800 KB of HTML, 30+ org cards), the first 15K rarely contains a single fully rendered card. For org sites with footer-resident contacts, the address typically sits past the cut. `extract_contacts` operates on the same truncated string (`extract-contacts.ts:39`), so the bug compounds. The model sees `truncated: true` but has no signal that "you got 3 of 30 cards."

**B — Shallow extraction.** The agent has no concept of "this org is partial, deepen it." `report_results` is a one-way emit; once an org is in `OrgScraper`'s dedup table (`scraper.ts:69`), the agent cannot retrieve, inspect, or refine it. There is no per-org URL frontier, no gap-filling, no cross-source merge. An aggregator detail page that yields a name + phone but no address gets emitted half-empty.

**C — Five sources, four broken.** Of the registered sources (`google`, `yandex`, `avito`, `cheerio`, `ai-agent`), only `web_search`-driven extraction works reliably in production. The hand-tuned aggregator adapters consume agent tool calls (via `search_source`) without yielding, and the agent has no signal that an adapter is bad — it picks them based on prompt descriptions and burns budget. The aggregator adapter pattern also doesn't generalize: every new directory site needs new code.

**D — Hostile pages defeat selectors.** Bootstrap utility soup, Tailwind/CSS-modules hashed class names, Next.js hydration blobs, and DOM patterns where phone numbers are split across multiple `<span>`s for typographic reasons all defeat the regex-and-cheerio approach in `extract-contacts.ts`. These pages are common — modern org sites and many aggregators ship them — and the deterministic extractor silently returns empty arrays.

This design addresses all four.

## 2. Approach

The new architecture is **layered**, with each layer reducing what the layer above must reason about:

1. **Server-side fetch with no LLM-context cap on extraction work.** The 15K character cap stays only on what gets returned *to the LLM as raw HTML*; deterministic extraction operates on the full body.
2. **Page-type classification** (server-side, deterministic). Every fetched URL is classified as `aggregator-landing | aggregator-serp | aggregator-detail | org-site | other` before the LLM sees anything.
3. **Link discovery** (server-side, deterministic). Outbound links are scored as candidate contact pages or candidate aggregators by URL/anchor heuristics. The aggregator candidates feed a known-aggregator registry; the contact-page candidates feed deepening.
4. **Deterministic extraction first.** Schema.org / JSON-LD, semantic HTML (`tel:`, `mailto:`, `<address>`, `[itemprop=...]`), and regex over cleaned body text run before any LLM call.
5. **Extractor sub-agent on miss.** When deterministic extraction fails on a substantive page, a focused, smaller LLM agent runs with a tight tool set (read additional blocks, parse JSON blobs, refetch same-origin) to handle Tailwind/Next.js/Bootstrap pages.
6. **Org work queue.** Records become first-class state with `status`, `confidence`, and `sources[]`. The parent agent reads/writes through tools.
7. **Deepening loop.** Partial records get auto-deepened: aggregator-detail → org-site → branches → contact pages.
8. **Gap-filling.** Records still partial after deepening trigger targeted web searches per missing field.
9. **Self-review.** A `review_org` LLM call resolves cross-source conflicts and promotes records to `verified`.

Three deletions:

- All non-`ai-agent` source adapters (`google/`, `yandex/`, `avito/`, `cheerio/`).
- The `search_source` tool and its prompt entries.
- The singular fields on `OrgData` (`phone`, `email`, `address`, `source`, `url`) — replaced with multi-valued equivalents and provenance.

## 3. Architecture

### 3.1 Layer dependency graph

```
                      ┌─────────────────────────┐
                      │ Parent agent             │
                      │ (recon → plan → harvest  │
                      │  → deepen+review)        │
                      └────────────┬────────────┘
                                   │ via tools
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 ┌────────────┐         ┌────────────────────┐      ┌──────────────────┐
 │ web_search │         │ Org work queue      │      │ classify_page    │
 │ (Searxng)  │         │ (in-memory store)   │      │ (server-side)    │
 └────────────┘         └─────────┬──────────┘      └─────────┬────────┘
                                  │                            │
                                  │ feeds                      │ produces
                                  ▼                            ▼
                       ┌────────────────────┐       ┌──────────────────┐
                       │ deepen_org loop    │◄──────│ link discovery   │
                       │ (deterministic)    │       │ (server-side)    │
                       └─────────┬──────────┘       └──────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ extract_contacts             │
                  │ ┌───────────────────────────┐│
                  │ │ Deterministic first       ││
                  │ │ (schema.org, semantic     ││
                  │ │  HTML, regex)             ││
                  │ └─────────────┬─────────────┘│
                  │               │ on miss      │
                  │               ▼              │
                  │ ┌───────────────────────────┐│
                  │ │ Extractor sub-agent       ││
                  │ │ (smaller LLM,             ││
                  │ │  same-origin refetch)     ││
                  │ └───────────────────────────┘│
                  └──────────────────────────────┘
```

### 3.2 Page-type classifier

`classify_page(url)` runs server-side and returns:

```typescript
type PageType =
  | 'aggregator-landing'    // brand homepage of a known directory
  | 'aggregator-serp'       // search results / category listing on aggregator
  | 'aggregator-detail'     // single-org page on an aggregator
  | 'org-site'              // an organization's own website
  | 'other'                 // blog, forum, news, social, irrelevant

interface ClassifiedPage {
  url: string
  pageType: PageType
  confidence: number          // 0..1
  signals: string[]           // human-readable reasons; for logging/debug
  cleanedText: string         // post-strip body text, no LLM cap
  candidateBlocks: Block[]    // pre-extracted regions of interest
  jsonLdBlobs: unknown[]      // parsed JSON-LD entries
  nextDataBlob?: unknown      // parsed __NEXT_DATA__ if present
  contactCandidates: ScoredLink[]   // for org-site
  aggregatorCandidates: ScoredLink[] // links suspected to lead to aggregators
  branchCandidates: ScoredLink[]    // multi-location enumeration
}
```

Classification signals (any 2 of the same kind promote confidence):

- **aggregator-landing:** domain matches known-aggregator registry, page is small / homepage-shaped, no repeating cards.
- **aggregator-serp:** repeating card-like blocks (≥10), pagination controls, multiple `LocalBusiness` JSON-LD entries, breadcrumbs ending in `/catalog/` or `/firms/`.
- **aggregator-detail:** single `LocalBusiness` JSON-LD entry on a known-aggregator domain, breadcrumb depth ≥ 3 ending in a name-like segment.
- **org-site:** small number of `LocalBusiness` entries (1–3), `<header>`/`<footer>` with contacts, single-domain navigation. Often inferred by *absence* of aggregator signals.
- **other:** none of the above, or strong signals like blog markup, forum threads, social media domains.

The classifier never uses an LLM. False positives degrade gracefully: a misclassified `org-site` that's actually a SERP just yields whatever the deterministic extractor pulls; the parent agent sees low yield and moves on.

### 3.3 Link discovery and aggregator registry

Two scorers, sharing the same shape (`ScoredLink { url, score, reason, kind }`), running over outbound `<a>` elements on a fetched page:

**Contact-page scorer.** Used when `pageType === 'org-site'`. Same-origin only. Signals:

- Path matches `/(contact|контакт|kontakt|address|адрес|about|о[- _]?компании|locations|branch)` — base score 0.6.
- Anchor text matches `(контакт|connect|связь|address|адрес|телефон|phone)` — +0.3.
- Inside `<footer>` — +0.2.
- Inside `<header>`/`<nav>` — +0.1.
- Threshold: 0.3.

**Aggregator scorer.** Cross-origin. Signals:

- Domain in known-aggregator registry — score = registry confidence (0.8–1.0).
- Path matches `/(catalog|firms|companies|listings|directory)` — base 0.5.
- Anchor text matches `(каталог|справочник|directory|listings|companies)` — +0.2.
- Threshold: 0.5.

**Known-aggregator registry** (`aggregator-registry.ts`):

```typescript
interface AggregatorEntry {
  domain: string
  confidence: number      // 0..1, higher = more reliable
  notes?: string
}
const KNOWN_AGGREGATORS: AggregatorEntry[]
```

Initial entries: `zoon.ru`, `yandex.ru/maps`, `2gis.ru`, `flamp.ru`, `yell.ru`, `spr.ru`, `orgpage.ru`, `rusprofile.ru`. JSON-driven file in the repo; new aggregators are PRs, not refactors. **No aggregator adapters** — the registry just identifies pages so `harvest_serp` can run on them generically.

### 3.4 Deterministic extraction (first pass)

`extract_contacts(html)` is reorganized into a sequence of strategies, returning on the first successful one:

1. **JSON-LD `LocalBusiness`.** `<script type="application/ld+json">` parsed, `@type: LocalBusiness | Organization` items → name, telephone, email, address.
2. **Schema.org microdata.** `[itemtype="...LocalBusiness"]`, `[itemprop="telephone"]`, `[itemprop="email"]`, `[itemprop="address"]`, `[itemprop="streetAddress"]`.
3. **Semantic HTML.** `<a href="tel:...">`, `<a href="mailto:...">`, `<address>` elements, `[class*='contact']`, `[class*='адрес']`, `[class*='phone']`.
4. **Regex over cleaned body text.** Existing `PHONE_REGEX`, `EMAIL_REGEX`, `ADDRESS_REGEX` from `extract-contacts.ts:14-16`.

Result includes `extractionMethod: 'deterministic'` and which strategies fired. **Escalation triggers** to the extractor sub-agent (any one):

- Zero contacts found AND `cleanedText.length > 500`.
- Phone-shaped fragments exist but no complete phone (digit count ≥ 10 spread across short tokens within a small DOM neighborhood).
- High `tel:`-link density but address is missing entirely.
- Substantive `<script>` blob (`__NEXT_DATA__`, `__NUXT__`) present but JSON-LD parse yielded nothing.

When escalation fires, `extract_contacts` returns `{...partialResult, escalated: true}` and the deepening loop hands off to the extractor sub-agent.

### 3.5 Extractor sub-agent

A focused agent with its own model config, prompt, and tool loop. Lives at `examples/scraper-node/src/sources/ai-agent/extractor/`.

**Input** (constructed by the calling deterministic extractor):

```typescript
interface ExtractorInput {
  url: string
  pageType: PageType
  cleanedText: string                  // already capped at 8K for LLM context
  candidateBlocks: Block[]             // server-side extracted; full content
  jsonLdBlobs: unknown[]
  nextDataBlob?: unknown
  knownGoals: ('phone' | 'email' | 'address' | 'name')[]
  partialResult: Partial<ExtractionResult>  // what deterministic already found
}
```

**Tool set** (extractor-only; not visible to parent agent):

| Tool | Purpose | Cost |
|---|---|---|
| `read_blocks(selector)` | Read additional pre-extracted blocks (e.g. footer, header). No fetch. | Free (no budget) |
| `read_json_blob(name)` | Pull and parse a `<script>` blob by id/name. No fetch. | Free |
| `refetch(url, reason, mode?)` | Same-origin fetch. Counts against `maxRefetches`. | 1 refetch budget |
| `report_extraction(result)` | Terminal. Returns final extraction. | — |
| `report_incomplete(reason, hints?)` | Terminal. Hands back diagnostics, no result. | — |

**Refetch contract:**

- **Same-origin only.** `new URL(target).origin === new URL(originalUrl).origin`. Cross-origin returns an error.
- **Hard cap.** `maxRefetches` (default 3). Beyond that, `refetch` returns budget-exhausted error.
- **Declared intent.** `reason: 'contact-page' | 'branch-detail' | 'iframe-content' | 'alternate-format' | 'other'`. Logged.
- **Refetched content goes through the same server-side preprocessing** (cleanedText, candidateBlocks, JSON-LD parse). Returned to the extractor in the same shape as the initial input.

**Excluded tools** (deliberately not in the extractor's set, even though parent has them): `web_search`, `search_source`, cross-origin `refetch`, sub-agent recursion.

**Termination conditions** (any one):

1. `report_extraction` or `report_incomplete` called.
2. `maxToolCallsPerPage` (default 8) exceeded → forced termination.
3. `timeoutMs` (default 45000) exceeded → forced termination.
4. Refetch budget exhausted AND extractor calls a tool that would have refetched → terminate with current partial.

**Output** flows through the same validation gate (`emit.ts:115`) as deterministic results. The validator does not know which path produced the data; it only checks shape and field validity.

**Configuration** lives under `args/aiAgent/extractor/*` (see §4).

### 3.6 Org work queue

In-memory store, lifecycle-scoped to one scraper run. Replaces "fire-and-forget `report_results`" with explicit record state.

```typescript
interface OrgRecord {
  id: string                          // generated; stable within run
  status: 'partial' | 'saturated' | 'verified' | 'rejected'
  name: string
  phones: string[]
  emails: string[]
  addresses: OrgAddress[]
  branches: OrgBranch[]
  sources: OrgSourceRef[]
  fieldProvenance: FieldProvenance
  conflicts: OrgConflict[]
  gaps: ('phone' | 'email' | 'address')[]
  frontier: { url: string, reason: string, score: number }[]
  confidence: number
  extractionMethod: 'deterministic' | 'extractor-llm' | 'mixed'
  notes: string[]
  perOrgToolCallsUsed: number         // budget tracking
}
```

**State transitions:**

- `partial` → `saturated`: all fields in `gaps` are filled or all `frontier` URLs exhausted; awaiting review.
- `saturated` → `verified`: `review_org` accepts the record.
- `saturated` → `rejected`: `review_org` rejects.
- `partial` → `rejected`: validation gate rejects on first emit, or reviewer rejects partial.
- `verified | rejected` are terminal.

**Dedup** at insertion: existing `name::phone || name::address` rule (`scraper.ts:69`), upgraded to merge into the existing record's arrays rather than discarding. Conflicts surfaced into `record.conflicts`.

**Queue operations** (parent-agent-facing tools):

- `list_orgs(status?, limit?)` — read.
- `pick_next_partial()` — returns the highest-priority partial record; priority = `1 - (gaps.length / 3)` (closer to verified first).
- `deepen_org(orgId)` — runs the deepening loop on a record (see §3.7).
- `fill_gap(orgId, field)` — runs targeted web search + extraction for a missing field.
- `review_org(orgId)` — LLM self-review (see §3.8).
- `freeze_org(orgId)` — force-finalize a record as `partial` if budget runs out.

### 3.7 Deepening loop

`deepen_org(orgId)` is implemented mostly server-side; LLM is only consulted at branch points.

```
while record.status === 'partial' and record.frontier non-empty
                  and record.perOrgToolCallsUsed < perOrgBudget:

  url = pop highest-scored frontier entry

  page = classify_page(url)              # server-side, no LLM
  result = extract_contacts(page)        # deterministic-first, escalates if needed

  merge result into record:
    arrays unioned, deduped
    new conflicts surfaced
    fieldProvenance updated

  if page.pageType === 'org-site':
    record.frontier += page.contactCandidates (top 3)
    record.frontier += page.branchCandidates (top 5)
  if page.pageType === 'aggregator-detail' and record has no canonical org URL:
    record.frontier += page.outboundOrgSiteCandidates (top 1)

  if record.gaps is empty:
    record.status = 'saturated'
    break
```

Per-org budget (`maxToolCallsPerOrg`, default 5). Counts: each `classify_page` + each `extract_contacts` (including any escalation to the sub-agent).

### 3.8 Gap-filling

For records that exit deepening still `partial` with non-empty `gaps`, `fill_gap(orgId, field)` runs:

```
query = build_gap_query(record, field)
       e.g. '"ACME Clinic" address Saint-Petersburg'

results = web_search(query, count=3)

for each result:
  page = classify_page(url)
  extracted = extract_contacts(page)
  if extracted has the missing field:
    candidate = { value, sourceUrl: url, confidence }
    add to record.conflicts[field] OR fill record[field]
    break
```

Per-record gap-fill budget: 1 attempt per gap. Fail → field stays empty, record stays partial.

### 3.9 Self-review

`review_org(orgId)` is an LLM call (parent's model). Input:

```typescript
{
  record: OrgRecord,
  resolutionRules: [
    "Org-site source beats aggregator on conflict.",
    "Address with a building number beats one without.",
    "Phone formatted as +7... canonical; rewrite if needed.",
    "Reject if name across sources is fuzzy-different (Levenshtein > 5 on normalized form)."
  ]
}
```

Output (structured, JSON-mode):

```typescript
{
  decision: 'verify' | 'reject' | 'still-partial',
  resolutions: { field: 'phone' | 'email' | 'address', chosenIndex: number, reason: string }[],
  rejectReason?: string,
  remainingGaps?: string[],   // for still-partial
  confidence: number          // 0..1
}
```

The LLM does not invent values. It only chooses among existing values in `record.conflicts[field].values`. Any new value in the output is dropped by the post-processor.

Decisions update record state: `verify` → `status: 'verified'`, `confidence` set; `reject` → `status: 'rejected'` with `notes`; `still-partial` → enqueues additional `fill_gap` calls for `remainingGaps`.

### 3.10 Parent agent phase model

Extends the existing `recon → plan → execute` (`loop.ts:90`) with a fourth phase:

```
recon → plan → harvest → deepen+review (loop until budget/saturation)
```

| Phase | `tool_choice` | Allowed tools | Output |
|---|---|---|---|
| `recon` | `'required'` | `web_search`, `end_recon` | broad map of search landscape |
| `plan` | `'none'` | none | `<plan>...</plan>` text |
| `harvest` | `'auto'` | `web_search`, `classify_page`, `harvest_serp`, `discover_org_candidates` | populates work queue with partials |
| `deepen+review` | `'auto'` | `list_orgs`, `pick_next_partial`, `deepen_org`, `fill_gap`, `review_org`, `freeze_org`, `revise_plan` | promotes partials to verified/rejected |

`harvest_serp(url)` is a parent-facing tool that runs server-side: classifies, extracts all org cards from an aggregator-serp, creates one partial record per card, returns ids and a summary. **The LLM never sees raw HTML through this path.**

`discover_org_candidates(url)` is similar for arbitrary URLs that the model wants to investigate without committing to deepening: returns the page classification + a summary of what would be added to the queue.

Termination of `deepen+review`: queue has no `partial` records, OR `toolCallsUsed >= cfg.maxToolCalls`, OR `totalTimeoutMs` exceeded. Remaining partials are frozen via `freeze_org` and emitted as-is.

## 4. Configuration

Args tree extension under `args/aiAgent/` (`scraper-service/args-tree.ts:152`):

```
args/aiAgent/
  model                            # parent (existing)
  baseUrl                          # existing
  temperature                      # existing, default 0.5
  maxToolCalls                     # existing, default 100
  toolTimeoutMs                    # existing
  totalTimeoutMs                   # existing
  maxToolCallsPerOrg               # NEW, default 5
  extractor/
    enabled                        # NEW, default true
    model                          # NEW, default = parent's model
    baseUrl                        # NEW, default = parent's baseUrl
    temperature                    # NEW, default 0.1
    maxRefetches                   # NEW, default 3
    maxToolCallsPerPage            # NEW, default 8
    timeoutMs                      # NEW, default 45000
```

Resolution:

- `extractor/model` and `extractor/baseUrl` default to parent's values when not specified. Single-model Ollama setups Just Work.
- `extractor/enabled: false` disables escalation; `extract_contacts` returns deterministic-only results, even on a miss.
- `extractor/temperature` is `0.1` (extraction is structured, not creative). Documented in the arg description.
- `maxToolCallsPerOrg` is the deepening budget; total budget across all orgs is bounded by `maxToolCalls`.

`resolveExtractorConfig(parentCfg, args)` lives next to `resolveAIAgentConfig` (`config.ts:27`). Returns `null` if parent is null or `enabled: false`.

The `args/exporters/*` slice is not introduced — JSON exporter is the canonical output, format choices for CSV/Sheets are hard-coded long-format (one row per phone × address combination).

## 5. Output schema (v2)

`OrgData` is **redefined** with no backward compat. All singular fields are removed.

```typescript
// examples/scraper-node/src/types.ts

export interface OrgData {
  name: string
  phones: string[]
  emails: string[]
  addresses: OrgAddress[]
  branches?: OrgBranch[]
  sources: OrgSourceRef[]
  fieldProvenance?: FieldProvenance
  conflicts?: OrgConflict[]
  status: 'verified' | 'partial' | 'rejected'
  confidence: number              // 0..1
  extractionMethod: 'deterministic' | 'extractor-llm' | 'mixed'
  notes?: string[]
}

export interface OrgAddress {
  full: string                    // canonical formatted string
  city?: string
  street?: string
  building?: string
  postalCode?: string
  lat?: number
  lon?: number
  sourceUrl?: string              // URL where this address came from
}

export interface OrgBranch {
  name?: string
  address: OrgAddress
  phones?: string[]
  emails?: string[]
}

export interface OrgSourceRef {
  url: string
  kind: 'aggregator-landing' | 'aggregator-serp' | 'aggregator-detail'
       | 'org-site' | 'web-search'
  extractedAt: string             // ISO8601
  extractionMethod: 'deterministic' | 'extractor-llm'
}

export interface FieldProvenance {
  name?: { value: string, sourceUrl: string }
  phones?: { value: string, sourceUrl: string }[]
  emails?: { value: string, sourceUrl: string }[]
  addresses?: { value: string, sourceUrl: string }[]
}

export interface OrgConflict {
  field: 'name' | 'phone' | 'email' | 'address'
  values: { value: string, sourceUrl: string }[]
  resolution?: 'auto' | 'review' | 'unresolved'
  chosenIndex?: number
}

export interface SearchQuery {
  query: string
  city?: string
  maxResults: number
  // `sources: string[]` is REMOVED — only ai-agent exists post-PR5
}
```

**Derivation rules** (no field is duplicated):

- "The org's canonical website URL" = `record.sources.find(s => s.kind === 'org-site')?.url`. No top-level `url` field.
- "Primary phone for display" = `record.phones[0]` (consumers choose).
- "All known URLs" = derived from `sources`, never stored separately.

**Validation gate** (`emit.ts:115`) updated:

- `name` non-empty (unchanged).
- At least one of `phones.length > 0`, `emails.length > 0`, `addresses.length > 0` (was: at least one singular non-null).
- Address validation rules (from `emit.ts:51-104`) apply per-element to `addresses[].full`.

### 5.1 Exporter envelope (v2)

JSON exporter (`exporters/json.ts:32`) wraps with:

```typescript
{
  schemaVersion: 2,
  query: SearchQuery,
  exportedAt: string,
  run: {
    agentVersion: string,
    parentModel: string,
    extractorModel: string,
    toolCallsUsed: number,
    extractionsByMethod: { deterministic: number, llm: number },
    durationMs: number,
    pagesFetched: number,
    aggregatorsHit: string[]
  },
  count: number,
  countByStatus: { verified: number, partial: number, rejected: number },
  results: OrgData[]
}
```

CSV/Sheets exporters: long-format, one row per `(org, phone, address)` cross-product. Columns: `name, phone, email, address, city, status, confidence, extractionMethod, sourceUrls, notes`. `sourceUrls` is `;`-joined.

## 6. PR sequencing

Five PRs. Each is independently shippable and leaves the system in a working state.

### PR1 — Server-side classifier + link discovery + deterministic extraction

Strictly additive. No schema change, no LLM behavior change visible to the parent agent.

- Add `examples/scraper-node/src/sources/ai-agent/classify-page.ts`.
- Add `examples/scraper-node/src/sources/ai-agent/discover-links.ts`.
- Add `examples/scraper-node/src/sources/ai-agent/aggregator-registry.ts` + initial JSON.
- Refactor `extract-contacts.ts` into the deterministic-first strategy chain (§3.4); deterministic-only in this PR (no escalation flag yet).
- The 15K cap on `fetch_url` stays for now. New tools that need raw bodies for extraction call new server-side helpers that bypass the cap.
- Tests: classifier unit tests, scorer unit tests, deterministic-extractor regression tests.

After this PR, the existing agent works exactly as before, but the building blocks for PR2-4 are in place.

### PR2 — Extractor sub-agent (one-shot, no refetch)

Adds the extractor agent without refetch capability. Args slice added.

- Add `examples/scraper-node/src/sources/ai-agent/extractor/{index.ts,config.ts,prompts.ts,loop.ts}`.
- Add extractor tools: `read_blocks`, `read_json_blob`, `report_extraction`, `report_incomplete`.
- Wire escalation: `extract_contacts` flips to `escalated: true` on miss; deepening loop calls extractor when escalated.
- Add `args/aiAgent/extractor/*` to the args tree.
- Add `resolveExtractorConfig` to `config.ts`.
- Defaults: `enabled: true`, model/baseUrl inherit from parent, temp 0.1.
- Tests: extractor agent runs on fixture HTML (Tailwind page, Next.js page, Bootstrap page).

`enabled: false` is recommended for staged rollout — let users opt in on real workloads first.

### PR3 — Refetch with same-origin enforcement

Adds the `refetch` tool to the extractor.

- Implement `refetch(url, reason, mode?)` with same-origin check, budget tracking, declared intent.
- Refetch results pass through `classify_page` and `extract_contacts` deterministic strategies before being returned to the extractor.
- Tests: cross-origin refetch rejected, budget exhaustion behavior, refetched content properly preprocessed.

### PR4 — Schema v2 + work queue + deepening + gap-fill + review

The atomic break. Schema changes, LLM phase model changes, golden test fixtures update.

- Redefine `OrgData` and friends in `types.ts` (§5).
- Update `emit.ts:115` validator for arrays.
- Update `OrgScraper.addOrg` (`scraper.ts:69`) for array-aware merge and conflict surfacing.
- Add work queue: `examples/scraper-node/src/sources/ai-agent/work-queue.ts`.
- Add parent-agent tools: `list_orgs`, `pick_next_partial`, `deepen_org`, `fill_gap`, `review_org`, `freeze_org`, `harvest_serp`, `discover_org_candidates`.
- Add fourth phase `deepen+review` to `loop.ts` (§3.10). `recon` and `plan` unchanged; `execute` becomes `harvest`.
- Update prompts for new phases.
- Update JSON exporter to v2 envelope (`exporters/json.ts:32`).
- Update CSV/Sheets exporters to long-format.
- Update golden scraper test fixtures.
- Tests: work queue state transitions, deepening loop on fixture sites, review on fixture conflicts.

This is the largest PR. The schema break is deliberately atomic — partial migration would mean two `OrgData` types coexisting, which is worse.

### PR5 — Delete legacy sources

After PR1-4 are stable.

- Delete `examples/scraper-node/src/sources/{google,yandex,avito,cheerio}/`.
- Delete `examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts`.
- Delete `search_source` from prompts (`prompts.ts:11`, `prompts.ts:99`).
- Simplify `SourceRegistry` (`source-registry.ts`) — collapses to either a no-op or a single-entry registry; preserve the type seam for future structured adapters.
- Remove `sources: string[]` from `SearchQuery` and from `args-tree.ts:152`.
- Delete per-source tests, mocks, fixtures.

## 7. Cost and latency expectations

**Per-run cost shifts:**

- **Parent agent tool calls:** roughly halved per discovered org. The parent no longer reasons about "fetch this URL, parse the HTML, decide if it's an aggregator" — that's now one `classify_page` call returning structured output.
- **Extractor sub-agent calls:** 30–50% of fetched pages on hard runs. Smaller model (configurable; defaults to parent's model — recommend smaller for cost-sensitive runs). Per-page budget bounded.
- **Net LLM cost:** roughly 1.5–3× current on hard pages, similar to current on easy pages (deterministic short-circuits).
- **Net yield:** dramatically higher on aggregator SERPs (no truncation), modestly higher on hostile pages (extractor handles them), comparable on simple pages.

**Latency:**

- Deepening adds sequential page fetches per org. Mitigation: harvest phase batches `classify_page` calls for SERP results in parallel.
- Extractor calls are sequential per page by default. Cross-page parallelization is straightforward in `harvest_serp`.

## 8. Risks and mitigations

**R1: Deterministic classifier misclassifies pages.** Low confidence: false positives degrade gracefully (extractor still runs, just on the wrong assumption); false negatives mean the page is treated as `other` and skipped. Mitigation: log all signals, allow the parent agent to override classification via `discover_org_candidates`.

**R2: Extractor sub-agent hallucinates contacts.** Mitigation: structured-output JSON mode, validation gate (`emit.ts:115`) rejects city-mismatched addresses regardless of source, `review_org` discards low-confidence records.

**R3: Refetch budget allows extractor to recurse on a multi-branch org and consume disproportionate resources.** Mitigation: `maxRefetches: 3` is a hard cap; extractor returns `report_incomplete` rather than continuing if budget exhausted.

**R4: Aggregator registry is incomplete.** Mitigation: heuristic aggregator detection (§3.2) catches unknown directories. Registry is JSON-driven, easy to extend.

**R5: Schema v2 break orphans existing CSV consumers.** Mitigation: this is intended (per "no backward compat at all"). CSV format is now long-format; documentation update + changelog entry in PR4.

**R6: PR4 is large enough to be hard to review.** Mitigation: it's atomic by necessity (schema change). Internal sub-tasks (work queue, deepening, gap-fill, review, exporters) can be separate commits within the PR for review legibility.

**R7: Golden scraper test (per `project_distributed_migration` memory) regresses during PR1-3.** Mitigation: PR1-3 are additive; the test should remain green throughout. PR4 explicitly updates the test fixtures as part of its scope.

## 9. Out of scope

- Multi-gateway support (already dropped per `project_distributed_scope`).
- Persistent work queue across runs. The queue is in-memory, run-scoped.
- Cross-run learning (per-domain hint cache survives only within a run).
- Per-aggregator structured adapters. Generic auto-parser is the path; if a specific aggregator becomes a hot bottleneck it can be added back as a special-case classifier rule, not a separate source.
- LLM-driven aggregator discovery (the parent agent is not asked "find aggregators on the web" — it discovers them via `web_search` and the registry tags them).
- Telegram UI changes. The richer schema is for downstream files; chat presentation stays simple (primary phone/email/address per org).

## 10. Open questions for plan-time

These are flagged here so the implementation plan for each PR can resolve them with code in hand:

- **Q1 (PR1):** Should `classify_page` be exposed as an LLM-facing tool from day one, or only used internally by `harvest_serp` and `deepen_org`? Defer until PR4 — keep it internal in PR1.
- **Q2 (PR2):** Extractor prompt — system prompt structure, role framing, output schema enforcement. Will write during PR2 plan.
- **Q3 (PR4):** Conflict resolution when multiple sources have equal confidence — does `review_org` always pick or sometimes punt? Default: punt to `still-partial` and flag.
- **Q4 (PR4):** Deepening priority — is "closest to verified first" right, or "most-yielding source first"? Will measure in PR4.
- **Q5 (PR5):** Should `SourceRegistry` survive as a type seam for future structured adapters, or be deleted entirely? Keeping the seam costs nothing; default keep.

---

## Self-check against conversation

Mapped each design decision back to where it was settled in the chat:

- 15K cap is a correctness bug → §1.A, §3.1, §3.4.
- Three page types: aggregator landing, aggregator SERP, org site → §3.2.
- Deepening: aggregator → org-site → branches; cross-source merge → §3.6, §3.7.
- Auto-find contact pages and aggregators → §3.3.
- Sub-agent for hard pages (Tailwind/Next.js/Bootstrap) → §3.5, §1.D.
- Sub-agent model is configurable, defaults from parent (Ollama setup) → §4.
- Sub-agent allowed to refetch → §3.5, PR3.
- Delete all non-ai-agent sources → PR5.
- web_search + auto-parser as the only path → §2, §3.10, PR5.
- Schema extended; all singulars removed; multi-valued; no backward compat → §5.
- Confidence is a number (0..1) → §5.
- Top-level `urls` derived from `sources`, not stored → §5 derivation rules.
