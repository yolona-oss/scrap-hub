# AI-Agent Prompt Upgrade — Design Spec

**Date:** 2026-04-29
**Scope:** `examples/scraper-node/src/sources/ai-agent/`
**Goal:** Improve quality, recall, tool-budget efficiency, and workflow discipline of the LLM-driven `ai-agent` scraper source.
**Approach:** Variant 3b — recon → plan → execute phase machine, with response steering on every tool result.

---

## 1. Motivation

The current `ai-agent` source uses a single monolithic `buildSystemPrompt` (~25 lines) that bundles role, constraints, tool catalog, workflow, heuristics, and stop conditions. Tool responses are raw payloads with no per-turn guidance. The agent loop has one phase and no plan-then-execute structure. This produces four observable problems in production runs:

- **A — Quality:** orgs emitted with missing contact fields, wrong city, or low-confidence names; many `report_results` calls have all candidates rejected.
- **B — Recall:** the agent gives up early or thrashes between sources; runs return well below `maxResults`.
- **C — Tool-budget efficiency:** the agent burns its 25-call budget on dead-end pages, redundant `parse_html` invocations, and aggregator URLs it could have skipped.
- **D — Workflow discipline:** the agent re-reports `search_source` results despite the prompt warning, retries duplicates, and skips `parse_html` in favor of substring-searching HTML inline.

This design addresses all four.

## 2. Approach

Three-layer architecture:

- **Layer A — Static prompts** (`prompts.ts`): role, constraints, per-phase instructions. Composed by the loop.
- **Layer B — Dynamic per-turn steering** (`tools/*.ts`): every tool response carries a `hint` (situation-specific guidance) and `progress` (`{yielded, target, toolsUsed, toolBudget}`). The model reads guidance at the moment of decision, not from a stale static prompt.
- **Layer C — Phase machine** (`loop.ts`): explicit `recon → plan → execute → (revise → execute)*` state machine with `tool_choice` enforcement and per-phase tool-list filtering.

Three new tools:

- `extract_contacts(html)` — bundles tel/mailto/microdata/Russian-address extraction into one call (saves 2-3 calls per page vs. the current `fetch_url + parse_html × N` chain).
- `end_recon()` — model's signal to transition recon → plan.
- `revise_plan(reason)` — model's signal to transition execute → plan when the current plan fails.

## 3. Architecture

### 3.1 Phase machine

| Phase | `tool_choice` | Allowed tools | Model output |
|---|---|---|---|
| `recon` | `'required'` | `[web_search, end_recon]` | 1–10 web_search calls then `end_recon` |
| `plan` | `'none'` (tools omitted) | none | text containing `<plan>...</plan>` |
| `execute` | `'auto'` | `[web_search, fetch_url, parse_html, extract_contacts, search_source, report_results, revise_plan]` | tool calls or final answer |

Transitions:

```
recon ──(end_recon called OR reconSearches=10)──→ plan
                                                    │
plan  ──(<plan> extracted OR fallback)──→ execute   │
                                            │       │
                                            └──(revise_plan, after ≥2 turns)──┘
```

State variables added to `runAgentLoop`:

```
phase: 'recon' | 'plan' | 'execute'    // initial: 'recon'
reconSearches: number                  // initial: 0
executePhaseTurnsSinceLastPlan: number // initial: 0; resets on entry to execute
```

Existing state (`messages`, `toolCallsUsed`, `turn`, `seenCalls`, `startTime`) is unchanged.

### 3.2 Plan pinning

When the plan phase produces a plan:

1. Loop extracts `<plan>...</plan>` from `content` via regex.
2. Builds pin: `{role: 'system', content: 'Active research plan:\n' + planText + '\n\nFollow this plan. Call revise_plan() if it stops working.'}`.
3. **First plan:** `messages.splice(1, 0, pinMessage)` — inserts at index 1, right after the main system prompt at index 0.
4. **Subsequent plans (revisions):** `messages[1] = pinMessage` — replaces in place. Never accumulate.
5. Flips `phase = 'execute'`, resets `executePhaseTurnsSinceLastPlan = 0`.

The pin survives long execute phases — by turn 30 the model can still see the plan at messages[1], not buried under 50+ tool messages.

### 3.3 Per-phase prompt composition

The system message at `messages[0]` is rebuilt on every phase transition by composing named builders from `prompts.ts`:

| Phase | `messages[0].content` |
|---|---|
| recon | `buildRolePrompt(query) + '\n\n' + buildReconInstructions(query)` |
| plan | `buildRolePrompt(query) + '\n\n' + buildPlanInstructions()` |
| execute | `buildRolePrompt(query) + '\n\n' + buildExecuteInstructions(query)` |

`buildRolePrompt` is constant (role, language, city discipline, quality bar, dedup warning) — always the same content across phases. Only the trailing instructions section swaps.

`buildUserPrompt(query)` runs once at boot; the user message at `messages[1]` initially (becomes `messages[2]` after the plan pin is inserted).

## 4. Components

### 4.1 `prompts.ts` — new builders

```
buildRolePrompt(query: SearchQuery): string
buildReconInstructions(query: SearchQuery): string
buildPlanInstructions(): string
buildExecuteInstructions(query: SearchQuery): string
buildPlanPin(planText: string): { role: 'system', content: string }
buildUserPrompt(query: SearchQuery): string  // unchanged in spirit
```

`buildRolePrompt` — role line; Russian-language rule with transliteration; city discipline (the strict version with the address-mismatch rule); "name + at least one of phone/email/address" quality bar; global dedup warning. ~25 lines.

`buildReconInstructions` — declares the recon phase, instructs 1–10 broad `web_search` calls to map the landscape, forbids `fetch_url`/`parse_html`/`report_results` in recon, instructs `end_recon` when ready.

`buildPlanInstructions` — declares the plan phase, requires `<plan>...</plan>` tags, lists what a good plan contains (named source types, what NOT to spend tool calls on, rough budget split). Includes soft suggestion: *"plans of 100–300 tokens tend to get followed; very long plans get summarized away."* No hard token cap.

`buildExecuteInstructions` — declares the execute phase, points to plan pin above, names the standard chain (`web_search → fetch_url(html) → extract_contacts → report_results`), instructs the model to read `hint` and `progress` on every response, mentions `revise_plan` as the escape hatch.

`buildPlanPin` — produces the synthetic system message; identical text shape every time, only `planText` varies.

What gets removed from the current monolithic prompt:
- Tool catalog enumeration (each tool's own `description` carries this)
- Numbered workflow section (replaced by `buildExecuteInstructions` + tool hints)
- "Each org must have …" reminder (`report_results` hint says it at the moment of rejection)
- "After search_source, READ totalYielded and rejected" (the tool's own hint analyzes this)
- "Stop when totalYielded reaches X" (carried by `progress` every turn + `report_results` hint)

### 4.2 `tools/*.ts` — response envelope and per-tool hints

**Common envelope** (added to every tool response by the loop, not by individual tools):

```typescript
{
  ...handlerResult,
  hint?: string,                                       // optional, per-tool
  progress: {                                          // always present
    yielded: number,    // state.yielded
    target: number,     // query.maxResults
    toolsUsed: number,  // toolCallsUsed
    toolBudget: number, // cfg.maxToolCalls
  }
}
```

`progress` injection lives in the loop's tool-result-push site. Tools stay ignorant of loop state. The existing budget-prefix string injection (`loop.ts:196-199`) is removed — `progress` replaces it.

**Per-tool hints** (each tool computes its own `hint` from its result, returns `{...result, hint?}`):

- **`web_search`:**
  - 0 results, no error → *"no results — try synonyms or related terms (e.g. broader category, English transliteration, professional jargon)"*
  - 0 results with searxng error → *"search backend failed — try a different query phrasing or fall back to search_source"*
  - ≥3 results, >50% domains in aggregator list → *"aggregator-heavy results — search_source('yandex-business') will be cheaper than scraping these one by one"*
  - ≥3 results, mostly unique domains → *"diverse results — fetch the top 2-3 for direct contact extraction"*
  - Otherwise → no hint

  Aggregator domain list (hardcoded inline in `web-search.ts`): `2gis.ru, yell.ru, zoon.ru, yandex.ru, yandex.com, spravochnik.org, orgpage.ru, rusprofile.ru, list-org.com`.

- **`fetch_url`:**
  - HTTP 4xx/5xx → *"page unavailable — skip this URL, try the next search result"*
  - mode=text, no `@`/`+7`/`тел` markers → *"no contact markers in extracted text — try mode='html' to inspect markup, or skip this page"*
  - mode=html, body length < 500 chars → *"thin page — likely SPA or 404 disguised as 200; skip"*
  - mode=html, normal → *"now call extract_contacts(html) to pull tel/mailto/address in one step"*
  - mode=text with phone/email markers present → *"contacts visible in text — call report_results directly with the extracted org"*

- **`parse_html`:**
  - 0 matches → *"selector matched nothing — try a broader selector, or extract_contacts(html) which bundles common contact patterns"*
  - ≥1 matches with `truncated=true` → *"more matches available — narrow your selector if you only need the first few"*
  - Otherwise → no hint (the matches are the answer)

- **`extract_contacts`** (new):
  - 0 phones, 0 emails, 0 addresses → *"no structured contacts found — try parse_html with a custom selector, or check the page's footer/contacts subpath"*
  - ≥1 contact → *"found N contacts — call report_results with the org details"*

- **`search_source`:**
  - accepted=0, rejected=0 → *"source returned nothing for this query — try a different source or web_search"*
  - accepted=0, rejected>0 → *"source returned items but all failed validation (missing contacts or wrong city) — switch back to web_search"*
  - accepted>0, rejected=0 → *"good signal from this source — consider another search_source call with a related query"*
  - accepted>0, rejected>0 → *"mixed quality — keep going but expect ~${rejectionRate}% rejects"*

- **`report_results`:**
  - accepted=0 → *"all candidates rejected — check that each org has name + at least one of phone/email/address, and address mentions ${query.city}"*
  - accepted>0, totalYielded < target → *"${remaining} more orgs needed — keep searching"*
  - totalYielded ≥ target → *"target reached — emit no more tool calls to finish"*

- **`end_recon`** (new) → *"next turn is planning. Output a `<plan>...</plan>` reflecting what you learned in recon"*

- **`revise_plan`** (new) → *"next turn is planning. Output a new `<plan>...</plan>` reflecting why the current plan failed"*

Hint length is not enforced. Authors keep them short by convention. No lint test.

### 4.3 New tool: `extract_contacts` (`tools/extract-contacts.ts`)

```typescript
{
  name: 'extract_contacts',
  description: "Extract phone numbers, emails, and addresses from HTML in one call. Use this instead of multiple parse_html calls. Pass HTML returned by fetch_url(mode='html'). Returns {phones, emails, addresses, candidateName} arrays plus a hint on what to do next.",
  parameters: {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'HTML body returned by fetch_url(mode=html)' },
    },
    required: ['html'],
  },
  handler: async (args) => { ... },
}
```

**Extraction strategy:**

| Field | Strategy |
|---|---|
| `phones` | `a[href^="tel:"]` href values, plus regex `/(?:\+7\|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g` over body text. Dedup, normalize to `+7XXXXXXXXXX`. |
| `emails` | `a[href^="mailto:"]` href values, plus regex `/[\w.+-]+@[\w-]+\.[\w.-]+/g` over body text. Dedup, lowercased. |
| `addresses` | Cheerio: `[itemprop="address"]`, `[itemprop="streetAddress"]`, `.address`, `.adres`, `.contacts__address`. Plus regex `/(?:ул\.|улица\|пр\.|проспект\|пер\.|переулок\|д\.|дом)\s+[А-ЯЁа-яё0-9\s,.-]{3,80}/g` over text. Dedup. |
| `candidateName` | First non-empty: `<title>`, `[itemprop="name"]`, `<h1>`, `og:title` meta. Single string, may be empty. |

Caps: first 10 of each kind. All extraction patterns inline in `extract-contacts.ts` (no shared `extract-contacts-patterns.ts` — these are private to this tool; truly shared parsing primitives live in `cheerio-extract.ts`).

**Response shape:**

```typescript
{
  phones: string[],
  emails: string[],
  addresses: string[],
  candidateName: string,
  error?: string,
  hint?: string,                     // per Section 4.2
  progress: { ... }                  // injected by loop
}
```

**Failure modes:**
- Empty html → `{phones: [], emails: [], addresses: [], candidateName: '', error: 'empty html'}`
- Cheerio parse throws → caught, returns same empty shape with `error: String(e)`

### 4.4 New tool: `end_recon` (`tools/end-recon.ts`)

```typescript
{
  name: 'end_recon',
  description: 'Call when you have enough information from web_search calls to write a research plan. Looking at 1-3 search results is usually enough; do not exhaust the recon budget. Returns nothing meaningful; the next turn will be a planning turn.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => ({ ok: true }),
}
```

Loop integration:
- Available only when `phase === 'recon'`. Outside recon: `{error: 'end_recon is only available during reconnaissance'}` (defense-in-depth; per-phase tool list should already prevent this).
- Does NOT count against `toolCallsUsed`.
- Does NOT enter `seenCalls` dedup set.
- Triggers `phase = 'plan'` for the next turn.

### 4.5 New tool: `revise_plan` (`tools/revise-plan.ts`)

```typescript
{
  name: 'revise_plan',
  description: "Call when the current plan is not working — e.g. chosen sources keep returning rejects, the topic landscape turned out different than expected, or you've hit a dead end. The next turn will be a planning turn where you must emit a new <plan>...</plan> reflecting what you learned. Use sparingly; each revision costs an LLM turn.",
  parameters: {
    type: 'object',
    properties: { reason: { type: 'string', description: 'Brief reason why the current plan is failing' } },
    required: ['reason'],
  },
  handler: async (args) => ({ ok: true, reasonAccepted: String(args?.reason ?? '').slice(0, 500) }),
}
```

Loop integration:
- Available only when `phase === 'execute'`.
- Does NOT count against `toolCallsUsed`.
- Does NOT enter `seenCalls` dedup set (a stuck model may legitimately revise twice with similar reasons).
- **Blocked for the first 2 execute-phase assistant turns since the last plan.** If `executePhaseTurnsSinceLastPlan < 2`, the loop returns `{error: 'revise_plan unavailable: give the current plan at least 2 execute turns before revising. Try the plan; if it still fails, revise then.', toolsUsed, toolBudget}` and stays in execute. After ≥2 turns: handler runs, `log.warn` with reason, `phase = 'plan'`.
- An "execute turn" = one assistant message in execute phase, regardless of how many tool calls it contains.

### 4.6 `tools/index.ts` — phase-aware `buildTools`

Current signature: `buildTools(query, queue, state) → Promise<Tool[]>` returning all 5 tools always.

New signature: `buildTools(query, queue, state, phase: 'recon' | 'plan' | 'execute') → Promise<Tool[]>`:

| Phase | Tools returned |
|---|---|
| recon | `[web_search, end_recon]` |
| plan | `[]` |
| execute | `[web_search, fetch_url, parse_html, extract_contacts, search_source, report_results, revise_plan]` |

Called once per phase transition by the loop, not per turn.

The per-phase filter is the **enforcement mechanism** for phase discipline — combined with `tool_choice`, the model literally cannot call disallowed tools in a given phase.

## 5. Data Flow

```
search() called
  │
  ├─ phase = 'recon', state init
  ├─ tools = buildTools(query, queue, state, 'recon')
  ├─ messages = [systemMsg(role+recon), userMsg]
  │
  ▼ RECON LOOP
  while phase === 'recon':
    LLM request {tools, tool_choice: 'required'}
    └─ web_search → handler runs → loop wraps {hint, progress} → push
        reconSearches++, toolCallsUsed++, seenCalls.add()
    └─ end_recon → handler {ok:true} → loop wraps → push
        phase = 'plan'
    └─ if reconSearches === 10 → force phase = 'plan' regardless
  │
  ▼ PLAN PHASE (single turn)
  rebuild messages[0] with role+planInstructions
  tools = buildTools(..., 'plan')  // []
  LLM request {tools omitted, tool_choice: 'none'}
  ├─ extract <plan>...</plan>; if missing, re-prompt once; if still missing, use whole content
  ├─ build pin = buildPlanPin(planText)
  ├─ first plan: messages.splice(1, 0, pin); subsequent: messages[1] = pin
  ├─ phase = 'execute', executePhaseTurnsSinceLastPlan = 0
  │
  ▼ EXECUTE LOOP
  rebuild messages[0] with role+executeInstructions
  tools = buildTools(..., 'execute')
  while phase === 'execute':
    executePhaseTurnsSinceLastPlan++
    LLM request {tools, tool_choice: 'auto'}
    ├─ no tool_calls → DONE, return
    ├─ revise_plan:
    │   if executePhaseTurnsSinceLastPlan < 2: return error envelope, stay
    │   else: handler, log.warn, phase = 'plan'
    └─ any other: existing path (dedup, budget, execute, wrap, push)
    check totalTimeoutMs and signal.aborted (existing)
```

### 5.1 Message-list invariants

The loop guarantees:

1. `messages[0]` is always the main system message (content varies per phase).
2. When a plan exists, `messages[1]` is always the plan pin (synthetic system role).
3. Plan revisions replace `messages[1]` in place — never accumulate.
4. Every tool-role message has content as a JSON string with at least a `progress` field. Errors included.
5. `seenCalls` is global across phases.
6. `toolCallsUsed` counts only real-work tools (the original 5 + `extract_contacts`). Excludes `end_recon`, `revise_plan`. Includes recon-phase `web_search` calls.

## 6. Error Handling

### Recon phase

| Error | Handling |
|---|---|
| Model emits no tool call | Re-prompt: `{role: 'user', content: 'You must call web_search or end_recon. Output a tool call now.'}`. Cap: 2 retries, then force `phase = 'plan'`. |
| Model calls disallowed tool | Defense-in-depth: respond `{error: 'recon phase: only web_search and end_recon allowed', progress}`. Stay in recon. |
| `web_search` returns error | Existing path — error returned with hint. Recon continues. |
| `reconSearches === 10` | After the 10th response is pushed: force `phase = 'plan'`, inject `{role: 'user', content: 'Recon budget exhausted. Write your plan now.'}`. |

### Plan phase

| Error | Handling |
|---|---|
| No `<plan>...</plan>` tags | Re-prompt once: `{role: 'user', content: 'Wrap your plan in <plan>...</plan> tags. Output the plan now.'}`. If still missing → fall back to using whole content as the plan. Don't loop forever. |
| Empty plan content | Treat as the no-tags case — use whole (possibly empty) content. Hard constraints in role prompt still apply. |
| Model attempts a tool call despite `tool_choice: 'none'` | Ignore tool call, treat text content as plan, `log.warn`. |
| LLM request fails | Existing path — log and return. |

### Execute phase

| Error | Handling |
|---|---|
| All existing paths (unknown tool, invalid JSON, dedup, max tool calls, timeout, abort) | Unchanged. |
| `revise_plan` called too early | Return error envelope, no transition. |
| New tool throws | Existing `executeWithTimeout` catches → `{error: ...}`. Wrapped with envelope. |
| Plan pin missing when expected | Defensive check: `log.error` and continue. Recoverable — model just won't have plan to follow this turn. |

### Removed: budget-prefix string injection

Current `loop.ts:196-199` prepends `[budget: X/Y tool calls left] ` to tool result content when remaining ≤ half. Removed. `progress` field replaces it (always present, structured, available from turn 0).

## 7. Logging

| Event | Level | Message |
|---|---|---|
| Phase transition recon→plan | `log.info` | `ai-agent.loop: recon→plan after ${reconSearches} searches` |
| Phase transition plan→execute | `log.info` | `ai-agent.loop: plan→execute, plan ${planText.length} chars` |
| Phase transition execute→plan (revise) | `log.warn` | `ai-agent.loop: execute→plan via revise_plan after ${executePhaseTurnsSinceLastPlan} turns. reason: ${reason}` |
| `revise_plan` rejected (too early) | `log.debug` | `ai-agent.loop: revise_plan rejected (only ${n} execute turns elapsed)` |
| Recon-phase invalid tool call | `log.warn` | `ai-agent.loop: recon phase rejected tool ${name}` |
| Plan pin update | `log.debug` | `ai-agent.loop: plan pin ${first ? 'inserted' : 'replaced'}` |
| Recon budget exhausted | `log.warn` | `ai-agent.loop: recon budget (10) exhausted, forcing plan phase` |

Existing logs unchanged.

## 8. Testing

### Tier 1 — Phase machine correctness

`__tests__/loop-phases.test.ts`, `loop-revise-plan.test.ts`, `loop-recon-bounds.test.ts`. ~7 tests:

- Happy path recon→plan→execute→done with messages[0]/[1] invariants.
- Recon budget exhaustion (10 web_search → force plan).
- Recon rejects disallowed tool calls.
- Plan re-prompt when `<plan>` tags missing first time.
- Plan fallback when tags missing both times.
- `revise_plan` blocked for first 2 execute turns.
- Plan pin replacement keeps messages[1] unchanged (not appended).

### Tier 2 — Invariants

`__tests__/loop-invariants.test.ts`. ~5 tests:

- `progress` always present in every tool-role message.
- `seenCalls` global across phase boundaries.
- `end_recon` and `revise_plan` don't increment `toolCallsUsed`.
- Plan pin survives 30+ tool messages.
- Budget-prefix string is gone.

### Tier 3 — Tool hints

Per-tool test files (existing + new). ~22 tests across `web_search`, `fetch_url`, `parse_html`, `extract_contacts`, `search_source`, `report_results`. Each branch of each hint tree is asserted.

### Tier 4 — `extract_contacts` extraction

`tools/__tests__/extract-contacts.test.ts`. ~9 tests covering: tel/mailto anchors; phone/email regex over body text; itemprop and class-based addresses; Russian-address regex; `<title>` candidate name; empty html; malformed html.

### Total

~43 new test cases. Existing 34 scraper-node tests stay green.

### Explicitly NOT testing

- Hint length (trust authors).
- Per-LLM-model behavior (flaky, model-version-sensitive, doesn't catch what we care about).
- Token counts (brittle).
- Real-LLM integration (telemetry from production runs is the right feedback loop here).

## 9. Files Touched

**Modified:**

- `examples/scraper-node/src/sources/ai-agent/prompts.ts` — full rewrite into named builders (Section 4.1).
- `examples/scraper-node/src/sources/ai-agent/loop.ts` — phase machine, plan extraction & pinning, per-phase request shape, envelope injection, removal of budget-prefix string.
- `examples/scraper-node/src/sources/ai-agent/tools/index.ts` — phase-aware `buildTools` signature.
- `examples/scraper-node/src/sources/ai-agent/tools/web-search.ts` — hint logic, aggregator domain list.
- `examples/scraper-node/src/sources/ai-agent/tools/fetch-url.ts` — hint logic.
- `examples/scraper-node/src/sources/ai-agent/tools/parse-html.ts` — hint logic.
- `examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts` — hint logic for `search_source`.
- `examples/scraper-node/src/sources/ai-agent/tools/report-results.ts` — hint logic.
- Existing test files — add hint cases.

**New:**

- `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`
- `examples/scraper-node/src/sources/ai-agent/tools/end-recon.ts`
- `examples/scraper-node/src/sources/ai-agent/tools/revise-plan.ts`
- `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
- `examples/scraper-node/src/sources/ai-agent/__tests__/loop-phases.test.ts`
- `examples/scraper-node/src/sources/ai-agent/__tests__/loop-revise-plan.test.ts`
- `examples/scraper-node/src/sources/ai-agent/__tests__/loop-recon-bounds.test.ts`
- `examples/scraper-node/src/sources/ai-agent/__tests__/loop-invariants.test.ts`

**Untouched:**

- `examples/scraper-node/src/sources/ai-agent/index.ts` — `AIAgentSource.search()` entry point. The phase machine is internal to `runAgentLoop`.
- `examples/scraper-node/src/sources/ai-agent/config.ts` — no new config knobs (recon-cap=10, execute-turn-min=2, hint length all hardcoded by design).
- `examples/scraper-node/src/sources/ai-agent/client.ts` — OpenAI client unchanged.
- `examples/scraper-node/src/sources/ai-agent/async-queue.ts` — unchanged.
- `examples/scraper-node/src/sources/ai-agent/tools/types.ts` — `Tool` type and `toOpenAISchema` unchanged.
- `examples/scraper-node/src/sources/ai-agent/tools/emit.ts` — `emitOrg`/`emitMany` unchanged; the city-stem matching and contact-required check are still the validation gate.

## 10. Out of Scope

Decisions explicitly deferred (record here so they don't get re-litigated):

- **Per-revision tool budget cost.** `revise_plan` is free (only LLM-turn latency self-throttles). If telemetry shows runaway revisions in production, revisit.
- **Forced reassess cadence.** Reassess is on-demand only via `revise_plan`. No timer-based "every K turns" reassess.
- **Plan token cap.** Soft suggestion only ("100–300 tends to get followed"); no hard truncation.
- **Phase tag in role prompt.** Role prompt is fully constant. Phase signal lives in instructions section + `tool_choice` + tools list.
- **Hint length enforcement.** Trust authors; no lint test.
- **Aggregator list as config.** Hardcoded inline in `web-search.ts`; evolves with the prompt-engineering, not as ops-tunable config.
- **Real-LLM integration tests.** Not built. Production telemetry (the new logs) is the feedback loop.
- **Plan-then-execute for non-LLM sources.** This design is specific to `ai-agent`. The other sources (`yandex-business`, `cheerio-web`, `http`, `city-query`) are unchanged.
