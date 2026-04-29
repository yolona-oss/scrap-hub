# AI-Agent Prompt Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `ai-agent` scraper source with a recon→plan→execute phase machine, response steering on every tool result, and three new tools (`extract_contacts`, `end_recon`, `revise_plan`) to improve quality, recall, tool-budget efficiency, and workflow discipline.

**Architecture:** Three-layer split: static prompts in `prompts.ts` composed per phase by the loop; tool responses carry `hint` + `progress` envelope for per-turn steering; `loop.ts` becomes a small state machine (`recon | plan | execute`) with `tool_choice` enforcement and per-phase tool whitelisting.

**Tech Stack:** TypeScript, OpenAI SDK chat-completions API, cheerio for HTML parsing, jest + ts-jest for tests. All work confined to `examples/scraper-node/src/sources/ai-agent/`.

**Spec:** `docs/superpowers/specs/2026-04-29-ai-agent-prompt-upgrade-design.md`

**Working directory:** All paths below are relative to `/home/data/projects/bots/scrap-hub`. Run jest from `examples/scraper-node/`.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts` | Tool: bundle tel/mailto/microdata/Russian-address extraction in one call |
| `examples/scraper-node/src/sources/ai-agent/tools/end-recon.ts` | Tool: model's signal to transition recon → plan |
| `examples/scraper-node/src/sources/ai-agent/tools/revise-plan.ts` | Tool: model's signal to transition execute → plan |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts` | Extraction-correctness tests |
| `examples/scraper-node/src/sources/ai-agent/__tests__/loop-phases.test.ts` | Phase-machine happy path + transitions |
| `examples/scraper-node/src/sources/ai-agent/__tests__/loop-revise-plan.test.ts` | revise_plan blocking + pin replacement |
| `examples/scraper-node/src/sources/ai-agent/__tests__/loop-recon-bounds.test.ts` | Recon budget cap + invalid-tool rejection |
| `examples/scraper-node/src/sources/ai-agent/__tests__/loop-invariants.test.ts` | Cross-cutting invariants (progress, dedup, no-budget-prefix) |

**Modified files:**

| Path | Change |
|---|---|
| `examples/scraper-node/src/sources/ai-agent/prompts.ts` | Full rewrite into named builders |
| `examples/scraper-node/src/sources/ai-agent/loop.ts` | Phase machine, plan extraction & pinning, envelope injection, removal of budget-prefix |
| `examples/scraper-node/src/sources/ai-agent/tools/index.ts` | Phase-aware `buildTools(phase)` |
| `examples/scraper-node/src/sources/ai-agent/tools/web-search.ts` | Hint logic + aggregator domain list |
| `examples/scraper-node/src/sources/ai-agent/tools/fetch-url.ts` | Hint logic |
| `examples/scraper-node/src/sources/ai-agent/tools/parse-html.ts` | Hint logic |
| `examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts` | Hint logic |
| `examples/scraper-node/src/sources/ai-agent/tools/report-results.ts` | Hint logic |
| `examples/scraper-node/src/sources/ai-agent/tools/__tests__/web-search.test.ts` | Add hint cases |
| `examples/scraper-node/src/sources/ai-agent/__tests__/loop-dedup.test.ts` | Removed (replaced by phase-aware tests) |

**Untouched (per spec Section 9):** `index.ts` (only signature update), `config.ts`, `client.ts`, `async-queue.ts`, `tools/types.ts`, `tools/emit.ts`.

---

## Build Sequence

Tasks are ordered for incremental, testable delivery. Each task ends green and commitable. Roughly:

1. **Tasks 1–3:** New `extract_contacts` tool (pure function, no loop changes, lowest risk).
2. **Tasks 4–5:** Two empty signaling tools (`end_recon`, `revise_plan`) — pure structure.
3. **Tasks 6–7:** Per-phase `buildTools` and `prompts.ts` builders (pure data, no loop changes yet).
4. **Tasks 8–10:** Loop refactor — phase state, recon, plan extraction & pinning.
5. **Tasks 11–13:** Loop refactor — execute phase, revise_plan blocking, envelope injection.
6. **Tasks 14–18:** Per-tool hints (one task per tool).
7. **Task 19:** Final verification — full test suite + build.

**Test commands** (run from `examples/scraper-node/`):
- All: `npx jest`
- One file: `npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
- One test: `npx jest -t "happy path"`
- Build: `npx tsc --build --pretty`

---

### Task 1: `extract_contacts` — phone & email extraction

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`

- [ ] **Step 1: Write the failing tests for phones and emails**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`:

```typescript
import { makeExtractContactsTool } from '../extract-contacts'

describe('extract_contacts — phones and emails', () => {
    const tool = makeExtractContactsTool()

    it('extracts phones from tel: anchors', async () => {
        const html = `<html><body><a href="tel:+74951234567">Call</a></body></html>`
        const result = await tool.handler({ html })
        expect(result.phones).toContain('+74951234567')
    })

    it('extracts phones from body text via regex', async () => {
        const html = `<html><body><p>Тел: +7 (495) 123-45-67</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.phones.length).toBeGreaterThan(0)
    })

    it('normalizes 8-prefix phone to +7', async () => {
        const html = `<html><body><p>8 (495) 123-45-67</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.phones).toContain('+74951234567')
    })

    it('extracts emails from mailto: anchors and lowercases them', async () => {
        const html = `<html><body><a href="mailto:Info@Test.RU">Email</a></body></html>`
        const result = await tool.handler({ html })
        expect(result.emails).toContain('info@test.ru')
    })

    it('extracts emails from body text', async () => {
        const html = `<html><body><p>Contact: hello@example.com</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.emails).toContain('hello@example.com')
    })

    it('dedups duplicate phones across sources', async () => {
        const html = `<html><body><a href="tel:+74951234567">A</a><p>+7 (495) 123-45-67</p></body></html>`
        const result = await tool.handler({ html })
        const matches = result.phones.filter((p: string) => p === '+74951234567')
        expect(matches).toHaveLength(1)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
Expected: FAIL — `Cannot find module '../extract-contacts'`.

- [ ] **Step 3: Implement minimal extract-contacts.ts (phones + emails only)**

Create `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`:

```typescript
import * as cheerio from "cheerio"
import { Tool } from "./types"
import { log } from "@cmd-hub/common"

interface ExtractResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    error?: string
}

const PHONE_REGEX = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g

function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1)
    if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
    if (digits.length === 10) return '+7' + digits
    return raw.trim()
}

export function makeExtractContactsTool(): Tool {
    return {
        name: 'extract_contacts',
        description: "Extract phone numbers, emails, and addresses from HTML in one call. Use this instead of multiple parse_html calls. Pass HTML returned by fetch_url(mode='html'). Returns {phones, emails, addresses, candidateName} arrays plus a hint on what to do next.",
        parameters: {
            type: 'object',
            properties: {
                html: { type: 'string', description: 'HTML body returned by fetch_url(mode=html)' },
            },
            required: ['html'],
        },
        async handler(args): Promise<ExtractResult> {
            const html = String(args?.html ?? '')
            if (!html) return { phones: [], emails: [], addresses: [], candidateName: '', error: 'empty html' }

            try {
                const $ = cheerio.load(html)

                const phoneSet = new Set<string>()
                $('a[href^="tel:"]').each((_, el) => {
                    const href = $(el).attr('href') ?? ''
                    const raw = href.replace(/^tel:/i, '').trim()
                    if (raw) phoneSet.add(normalizePhone(raw))
                })
                const bodyText = $('body').text()
                for (const m of bodyText.match(PHONE_REGEX) ?? []) phoneSet.add(normalizePhone(m))
                const phones = Array.from(phoneSet).slice(0, 10)

                const emailSet = new Set<string>()
                $('a[href^="mailto:"]').each((_, el) => {
                    const href = $(el).attr('href') ?? ''
                    const raw = href.replace(/^mailto:/i, '').trim().toLowerCase()
                    if (raw) emailSet.add(raw)
                })
                for (const m of bodyText.match(EMAIL_REGEX) ?? []) emailSet.add(m.toLowerCase())
                const emails = Array.from(emailSet).slice(0, 10)

                log.debug(`ai-agent.extract_contacts: phones=${phones.length} emails=${emails.length}`)
                return { phones, emails, addresses: [], candidateName: '' }
            } catch (e: any) {
                log.warn(`ai-agent.extract_contacts: ${e.message ?? e}`)
                return { phones: [], emails: [], addresses: [], candidateName: '', error: String(e.message ?? e) }
            }
        },
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
git commit -m "feat(ai-agent): add extract_contacts tool — phones+emails

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `extract_contacts` — addresses

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`

- [ ] **Step 1: Write failing tests for addresses**

Append to `extract-contacts.test.ts`:

```typescript
describe('extract_contacts — addresses', () => {
    const tool = makeExtractContactsTool()

    it('extracts address from itemprop="address"', async () => {
        const html = `<html><body><div itemprop="address">ул. Тверская, 7</div></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses).toContain('ул. Тверская, 7')
    })

    it('extracts address from itemprop="streetAddress"', async () => {
        const html = `<html><body><span itemprop="streetAddress">пр. Невский, 28</span></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses).toContain('пр. Невский, 28')
    })

    it('extracts address from .address class', async () => {
        const html = `<html><body><div class="address">ул. Арбат, д. 12</div></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses).toContain('ул. Арбат, д. 12')
    })

    it('extracts Russian address from body text via regex', async () => {
        const html = `<html><body><p>Наш офис: г. Москва, ул. Ленина, 5</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses.some((a: string) => /Ленина/.test(a))).toBe(true)
    })

    it('dedups addresses across sources', async () => {
        const html = `<html><body><div class="address">ул. Тверская, 7</div><p>ул. Тверская, 7</p></body></html>`
        const result = await tool.handler({ html })
        const matches = result.addresses.filter((a: string) => a === 'ул. Тверская, 7')
        expect(matches).toHaveLength(1)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts -t address`
Expected: FAIL — addresses array is always empty.

- [ ] **Step 3: Implement address extraction**

In `extract-contacts.ts`, add the address constants near the top:

```typescript
const ADDRESS_REGEX = /(?:ул\.|улица|пр\.|проспект|пер\.|переулок|д\.|дом)\s+[А-ЯЁа-яё0-9\s,.-]{3,80}/g
const ADDRESS_SELECTORS = '[itemprop="address"], [itemprop="streetAddress"], .address, .adres, .contacts__address'
```

Inside the handler, replace the `addresses: []` placeholder with real extraction. Add this block after the email extraction:

```typescript
                const addressSet = new Set<string>()
                $(ADDRESS_SELECTORS).each((_, el) => {
                    const text = $(el).text().replace(/\s+/g, ' ').trim()
                    if (text) addressSet.add(text)
                })
                for (const m of bodyText.match(ADDRESS_REGEX) ?? []) {
                    addressSet.add(m.replace(/\s+/g, ' ').trim())
                }
                const addresses = Array.from(addressSet).slice(0, 10)
```

Update the return:

```typescript
                log.debug(`ai-agent.extract_contacts: phones=${phones.length} emails=${emails.length} addresses=${addresses.length}`)
                return { phones, emails, addresses, candidateName: '' }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
Expected: PASS — all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
git commit -m "feat(ai-agent): extract_contacts addresses (microdata + regex)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `extract_contacts` — candidateName + edge cases + hint

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`

- [ ] **Step 1: Write failing tests for candidateName, edge cases, and hint**

Append to `extract-contacts.test.ts`:

```typescript
describe('extract_contacts — candidateName', () => {
    const tool = makeExtractContactsTool()

    it('uses <title> when present', async () => {
        const html = `<html><head><title>Адвокат Иванов</title></head><body></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('Адвокат Иванов')
    })

    it('falls back to itemprop="name" when no title', async () => {
        const html = `<html><body><span itemprop="name">ООО Ромашка</span></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('ООО Ромашка')
    })

    it('falls back to <h1> when no title or itemprop', async () => {
        const html = `<html><body><h1>Юридический центр</h1></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('Юридический центр')
    })

    it('returns empty string when nothing matches', async () => {
        const html = `<html><body><p>Just text</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('')
    })
})

describe('extract_contacts — edge cases', () => {
    const tool = makeExtractContactsTool()

    it('returns error envelope on empty html', async () => {
        const result = await tool.handler({ html: '' })
        expect(result.error).toBe('empty html')
        expect(result.phones).toEqual([])
    })

    it('returns empty arrays on garbage html without throwing', async () => {
        const result = await tool.handler({ html: '<<<>>>' })
        expect(result.phones).toEqual([])
        expect(result.emails).toEqual([])
        expect(result.addresses).toEqual([])
    })
})

describe('extract_contacts — hint', () => {
    const tool = makeExtractContactsTool()

    it('emits "no structured contacts" hint when nothing found', async () => {
        const result = await tool.handler({ html: '<html><body>Nothing here</body></html>' })
        expect(result.hint).toMatch(/no structured contacts/i)
    })

    it('emits "found N contacts" hint when contacts found', async () => {
        const html = `<html><body><a href="tel:+74951234567">x</a></body></html>`
        const result = await tool.handler({ html })
        expect(result.hint).toMatch(/found.*report_results/i)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
Expected: FAIL — candidateName always empty, no hint field.

- [ ] **Step 3: Implement candidateName and hint logic**

In `extract-contacts.ts`, update the `ExtractResult` interface:

```typescript
interface ExtractResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    error?: string
    hint?: string
}
```

Inside the handler, after the addresses block and before the `return`:

```typescript
                let candidateName = ''
                const titleText = $('title').first().text().trim()
                if (titleText) candidateName = titleText
                if (!candidateName) candidateName = $('[itemprop="name"]').first().text().trim()
                if (!candidateName) candidateName = $('h1').first().text().trim()
                if (!candidateName) candidateName = $('meta[property="og:title"]').attr('content')?.trim() ?? ''

                const totalContacts = phones.length + emails.length + addresses.length
                const hint = totalContacts === 0
                    ? "no structured contacts found — try parse_html with a custom selector, or check the page's footer/contacts subpath"
                    : `found ${totalContacts} contacts — call report_results with the org details`

                log.debug(`ai-agent.extract_contacts: phones=${phones.length} emails=${emails.length} addresses=${addresses.length} name="${candidateName.slice(0, 40)}"`)
                return { phones, emails, addresses, candidateName, hint }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`
Expected: PASS — all ~17 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
git commit -m "feat(ai-agent): extract_contacts candidateName + hint logic

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `end_recon` tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/end-recon.ts`

- [ ] **Step 1: Create end-recon.ts**

```typescript
import { Tool } from "./types"

export function makeEndReconTool(): Tool {
    return {
        name: 'end_recon',
        description: 'Call when you have enough information from web_search calls to write a research plan. Looking at 1-3 search results is usually enough; do not exhaust the recon budget. Returns nothing meaningful; the next turn will be a planning turn.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        async handler(): Promise<{ ok: boolean, hint: string }> {
            return {
                ok: true,
                hint: 'next turn is planning. Output a <plan>...</plan> reflecting what you learned in recon',
            }
        },
    }
}
```

- [ ] **Step 2: Build to verify type-correctness**

Run: `cd examples/scraper-node && npx tsc --build --pretty`
Expected: SUCCESS — no errors.

- [ ] **Step 3: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/end-recon.ts
git commit -m "feat(ai-agent): add end_recon signaling tool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `revise_plan` tool

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/revise-plan.ts`

- [ ] **Step 1: Create revise-plan.ts**

```typescript
import { Tool } from "./types"

export function makeRevisePlanTool(): Tool {
    return {
        name: 'revise_plan',
        description: "Call when the current plan is not working — e.g. chosen sources keep returning rejects, the topic landscape turned out different than expected, or you've hit a dead end. The next turn will be a planning turn where you must emit a new <plan>...</plan> reflecting what you learned. Use sparingly; each revision costs an LLM turn.",
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Brief reason why the current plan is failing' },
            },
            required: ['reason'],
        },
        async handler(args): Promise<{ ok: boolean, reasonAccepted: string, hint: string }> {
            return {
                ok: true,
                reasonAccepted: String(args?.reason ?? '').slice(0, 500),
                hint: 'next turn is planning. Output a new <plan>...</plan> reflecting why the current plan failed',
            }
        },
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `cd examples/scraper-node && npx tsc --build --pretty`
Expected: SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/revise-plan.ts
git commit -m "feat(ai-agent): add revise_plan signaling tool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Phase-aware `buildTools`

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/index.ts`

- [ ] **Step 1: Replace the existing `buildTools` with the phase-aware version**

Replace the entire content of `examples/scraper-node/src/sources/ai-agent/tools/index.ts` with:

```typescript
import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeParseHtmlTool } from "./parse-html"
import { makeDelegateSourceTool } from "./delegate-source"
import { makeReportResultsTool } from "./report-results"
import { makeExtractContactsTool } from "./extract-contacts"
import { makeEndReconTool } from "./end-recon"
import { makeRevisePlanTool } from "./revise-plan"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import type { ReportState } from "./emit"

export type { ReportState } from "./emit"
export type AgentPhase = 'recon' | 'plan' | 'execute'

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    phase: AgentPhase,
): Promise<Tool[]> {
    if (phase === 'plan') return []
    if (phase === 'recon') {
        return [makeWebSearchTool(query), makeEndReconTool()]
    }
    return [
        makeWebSearchTool(query),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        makeExtractContactsTool(),
        await makeDelegateSourceTool(query, queue, state),
        makeReportResultsTool(queue, query, state),
        makeRevisePlanTool(),
    ]
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
```

- [ ] **Step 2: Build to verify**

Run: `cd examples/scraper-node && npx tsc --build --pretty`
Expected: ERROR — `loop.ts` calls `buildTools` with the old 3-arg signature. We fix that in Task 8.

- [ ] **Step 3: Commit (broken-build commit is OK; next task fixes loop)**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/index.ts
git commit -m "feat(ai-agent): phase-aware buildTools(query, queue, state, phase)

Build temporarily broken — loop.ts updated in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Rewrite `prompts.ts` into named builders

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/prompts.ts`

- [ ] **Step 1: Replace prompts.ts with the new builder library**

Replace the entire content of `examples/scraper-node/src/sources/ai-agent/prompts.ts` with:

```typescript
import { SearchQuery } from "../../types"

export function buildRolePrompt(query: SearchQuery): string {
    const cityBlock = query.city
        ? `\nCity (decline to the appropriate Russian case for the surrounding sentence — locative for "в …", e.g. "Москва" → "в Москве", "Санкт-Петербург" → "в Санкт-Петербурге"): ${query.city}`
        : ''

    const cityRules = query.city
        ? `\n\nCity discipline (STRICT):
- Target city: "${query.city}". ALL emitted organizations must be located in this city.
- For BOTH web_search and search_source: pass ONLY the topic in the \`query\` argument (e.g. "адвокат"). The framework normalizes every search to use "${query.city}" — if you write a different city, it will be silently replaced. Do not include city names in your queries; they are wasted tokens.
- If a candidate's address is in a different city, DROP it — do not pass it to report_results. Out-of-city orgs are auto-rejected at the emit boundary anyway, but skipping them upstream saves your tool budget.`
        : ''

    return `You are an organization research agent.

Language: respond and search in Russian (ru-RU). If the query is transliterated Latin, transliterate back to Cyrillic before searching.${cityBlock}${cityRules}

Quality bar — every emitted organization must have:
- name (required, non-empty string)
- at least one of: phone, email, address. Without one of these, the org is rejected at the emit boundary and your tool budget is wasted.
- source (string — where you found it)
- url (optional)

Global rule: do not repeat the same tool call with identical arguments. Each (tool, args) pair is invoked once per run; duplicates return an error and waste a turn.

Target query: "${query.query}"
Target count: ${query.maxResults}

Read every tool response's "hint" and "progress" fields — they tell you what to try next and where you stand against your budget.`
}

export function buildReconInstructions(query: SearchQuery): string {
    return `Phase: RECONNAISSANCE.
Your job right now is to map the search landscape — not to extract contacts.

- Call web_search 1–10 times with broad queries to learn what kinds of pages exist for "${query.query}".
- Look at result domains and snippets to recognize patterns (directory aggregators, official sites, social media, blog roundups).
- Do NOT fetch_url, parse_html, extract_contacts, or report anything yet. Those tools are unavailable in this phase.
- When you've seen enough (usually 1–3 searches), call end_recon to move on to planning.
- Recon searches count against your tool budget; do not waste them.`
}

export function buildPlanInstructions(): string {
    return `Phase: PLANNING.
Based on what you saw in recon, write a research plan inside <plan>...</plan> tags.

A good plan:
- Names specific source types you will prioritize ("directory aggregators like 2gis", "individual firm websites", "search_source('yandex-business')").
- States what you will NOT spend tool calls on.
- Sets a rough budget split (e.g. "10 calls on aggregators, 10 on individual sites, 5 reserve").

Soft suggestion: plans of 100–300 tokens tend to get followed; very long plans get summarized away.

Do not call any tools this turn. Output only the plan.`
}

export function buildExecuteInstructions(query: SearchQuery): string {
    return `Phase: EXECUTION.
Follow the plan pinned above. Use the tools to discover and report organizations.

Workflow heuristics:
- Standard chain: web_search → fetch_url(mode='html') → extract_contacts(html) → report_results.
- Use search_source as a fallback when web evidence is thin or aggregators dominate.
- Read each tool response's "hint" field — it tells you what to try next based on what just happened.
- Read each tool response's "progress" field — when yielded reaches ${query.maxResults}, stop emitting tool calls.

Call revise_plan(reason) if the current plan stops working — for example, the chosen sources keep returning rejects, or the topic landscape turned out different than expected. Note: revise_plan is unavailable for the first 2 execute turns after a (re)plan; give the plan a chance.`
}

export function buildPlanPin(planText: string): { role: 'system', content: string } {
    return {
        role: 'system',
        content: `Active research plan:\n${planText}\n\nFollow this plan. Call revise_plan() if it stops working.`,
    }
}

export function buildUserPrompt(query: SearchQuery): string {
    const cityClause = query.city
        ? ` in the city "${query.city}" (use the appropriate Russian case in any phrasing)`
        : ''
    return `Find up to ${query.maxResults} organizations matching: "${query.query}"${cityClause}. Begin with reconnaissance: a few broad web_search calls to understand the landscape, then end_recon and write your research plan.`
}
```

- [ ] **Step 2: Build (still broken until Task 8)**

Run: `cd examples/scraper-node && npx tsc --build --pretty`
Expected: errors from `loop.ts` (calling `buildSystemPrompt` which no longer exists). Errors from `prompts.ts` itself: NONE.

- [ ] **Step 3: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/prompts.ts
git commit -m "refactor(ai-agent): split prompts into named per-phase builders

Build still broken — loop.ts updated in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `loop.ts` — phase state machine; recon + plan phases wired

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/loop.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/index.ts`
- Delete: `examples/scraper-node/src/sources/ai-agent/__tests__/loop-dedup.test.ts`

This is the biggest task. We rewrite `runAgentLoop` to use the phase machine. Tasks 11–13 fill in execute logic, revise blocking, and finalize envelope tests.

- [ ] **Step 1: Replace loop.ts with the phase-machine version (execute is a stub for now)**

Replace the entire content of `examples/scraper-node/src/sources/ai-agent/loop.ts` with:

```typescript
import { OpenAI } from "openai"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions"
import { Tool, toOpenAISchema, buildTools, AgentPhase } from "./tools"
import { ResolvedAIAgentConfig } from "./config"
import {
    buildRolePrompt,
    buildReconInstructions,
    buildPlanInstructions,
    buildExecuteInstructions,
    buildPlanPin,
    buildUserPrompt,
} from "./prompts"
import { SearchQuery, OrgData } from "../../types"
import { AsyncQueue } from "./async-queue"
import type { ReportState } from "./tools"
import { log } from "@cmd-hub/common"

export interface AgentToolCallInfo {
    name: string
    args: string
    durationMs: number
    ok: boolean
    error?: string
}

export interface AgentLoopHooks {
    onToolCall?: (info: AgentToolCallInfo) => void
    signal?: AbortSignal
}

const RECON_BUDGET = 10
const REVISE_MIN_EXECUTE_TURNS = 2

function isAbortError(e: any, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true
    const name = e?.name
    return name === 'APIUserAbortError' || name === 'AbortError' || name === 'CanceledError'
}

interface ProgressFields {
    yielded: number
    target: number
    toolsUsed: number
    toolBudget: number
}

function buildProgress(state: ReportState, query: SearchQuery, toolsUsed: number, cfg: ResolvedAIAgentConfig): ProgressFields {
    return {
        yielded: state.yielded,
        target: query.maxResults,
        toolsUsed,
        toolBudget: cfg.maxToolCalls,
    }
}

function buildSystemMessage(query: SearchQuery, phase: AgentPhase): ChatCompletionMessageParam {
    const role = buildRolePrompt(query)
    let phaseBlock: string
    switch (phase) {
        case 'recon': phaseBlock = buildReconInstructions(query); break
        case 'plan': phaseBlock = buildPlanInstructions(); break
        case 'execute': phaseBlock = buildExecuteInstructions(query); break
    }
    return { role: 'system', content: `${role}\n\n${phaseBlock}` }
}

export async function runAgentLoop(
    client: OpenAI,
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    cfg: ResolvedAIAgentConfig,
    hooks?: AgentLoopHooks,
): Promise<void> {
    const signal = hooks?.signal

    let phase: AgentPhase = 'recon'
    let toolCallsUsed = 0
    let reconSearches = 0
    let executePhaseTurnsSinceLastPlan = 0
    let turn = 0
    const startTime = Date.now()
    const seenCalls = new Set<string>()
    let planPinned = false

    const messages: ChatCompletionMessageParam[] = [
        buildSystemMessage(query, 'recon'),
        { role: 'user', content: buildUserPrompt(query) },
    ]

    let tools = await buildTools(query, queue, state, phase)
    let toolByName = new Map(tools.map(t => [t.name, t]))

    function pushToolResult(id: string, result: any) {
        const progress = buildProgress(state, query, toolCallsUsed, cfg)
        const wrapped = { ...(result ?? {}), progress }
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(wrapped) })
    }
    function pushToolError(id: string, error: string) {
        pushToolResult(id, { error })
    }
    async function transitionToPlan(reason: string) {
        log.info(`ai-agent.loop: recon→plan after ${reconSearches} searches (${reason})`)
        phase = 'plan'
        messages[0] = buildSystemMessage(query, 'plan')
        tools = await buildTools(query, queue, state, 'plan')
        toolByName = new Map(tools.map(t => [t.name, t]))
    }

    log.debug(`ai-agent.loop: starting phase=recon model=${cfg.model} maxToolCalls=${cfg.maxToolCalls}`)

    while (true) {
        if (signal?.aborted) return
        if (Date.now() - startTime > cfg.totalTimeoutMs) {
            log.warn(`ai-agent.loop: total timeout (${cfg.totalTimeoutMs}ms) exceeded after ${turn} turns, ${toolCallsUsed} tool calls`)
            return
        }

        if (phase === 'recon') {
            turn++
            const requestTools: ChatCompletionTool[] = tools.map(toOpenAISchema)
            const reqStart = Date.now()
            let response
            try {
                response = await client.chat.completions.create(
                    {
                        model: cfg.model,
                        temperature: cfg.temperature,
                        messages,
                        tools: requestTools,
                        tool_choice: 'required',
                    },
                    { signal },
                )
            } catch (e: any) {
                if (isAbortError(e, signal)) return
                log.error(`ai-agent.loop: LLM request failed (recon turn ${turn}): ${e.message ?? e}`)
                return
            }
            log.trace(`ai-agent.loop: recon turn ${turn} response in ${Date.now() - reqStart}ms`)

            const choice = response.choices?.[0]
            if (!choice) { log.warn('ai-agent.loop: LLM returned no choices'); return }
            const assistantMsg = choice.message
            messages.push(assistantMsg as ChatCompletionMessageParam)

            const toolCalls = assistantMsg.tool_calls ?? []
            if (toolCalls.length === 0) {
                log.warn(`ai-agent.loop: recon turn ${turn} produced no tool call — forcing transition to plan`)
                await transitionToPlan('recon-no-tool-call')
                continue
            }

            for (const call of toolCalls) {
                if (call.type !== 'function') {
                    pushToolError(call.id, 'unsupported tool call type')
                    continue
                }
                const name = call.function.name
                if (name !== 'web_search' && name !== 'end_recon') {
                    log.warn(`ai-agent.loop: recon phase rejected tool ${name}`)
                    pushToolError(call.id, 'recon phase: only web_search and end_recon allowed')
                    continue
                }

                let parsed: any
                try { parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {} }
                catch (e: any) { pushToolError(call.id, `invalid arguments: ${e.message ?? e}`); continue }

                if (name === 'end_recon') {
                    const tool = toolByName.get('end_recon')!
                    const result = await tool.handler(parsed, signal)
                    pushToolResult(call.id, result)
                    await transitionToPlan('end_recon-called')
                    break
                }

                if (toolCallsUsed >= cfg.maxToolCalls) {
                    pushToolError(call.id, 'max tool calls reached, transition to plan')
                    await transitionToPlan('budget-exhausted-in-recon')
                    break
                }
                const dedupKey = `${name}:${canonicalJson(parsed)}`
                if (seenCalls.has(dedupKey)) {
                    pushToolError(call.id, `duplicate call: ${name} was already invoked with these exact arguments earlier this run. Vary the arguments or proceed.`)
                    toolCallsUsed++
                    continue
                }
                seenCalls.add(dedupKey)
                toolCallsUsed++
                reconSearches++

                const tool = toolByName.get('web_search')!
                const callStart = Date.now()
                const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs, signal)
                if (signal?.aborted) return
                const durationMs = Date.now() - callStart
                hooks?.onToolCall?.({ name, args: JSON.stringify(parsed), durationMs, ok: !result?.error, error: result?.error })
                pushToolResult(call.id, result)

                if (reconSearches >= RECON_BUDGET) {
                    log.warn(`ai-agent.loop: recon budget (${RECON_BUDGET}) exhausted, forcing plan phase`)
                    messages.push({ role: 'user', content: 'Recon budget exhausted. Write your plan now.' })
                    await transitionToPlan('recon-budget-exhausted')
                    break
                }
            }
            continue
        }

        if (phase === 'plan') {
            turn++
            const reqStart = Date.now()
            let response
            try {
                response = await client.chat.completions.create(
                    {
                        model: cfg.model,
                        temperature: cfg.temperature,
                        messages,
                        tool_choice: 'none',
                    },
                    { signal },
                )
            } catch (e: any) {
                if (isAbortError(e, signal)) return
                log.error(`ai-agent.loop: LLM request failed (plan turn ${turn}): ${e.message ?? e}`)
                return
            }
            log.trace(`ai-agent.loop: plan turn ${turn} response in ${Date.now() - reqStart}ms`)

            const choice = response.choices?.[0]
            if (!choice) { log.warn('ai-agent.loop: LLM returned no choices'); return }
            const assistantMsg = choice.message
            messages.push(assistantMsg as ChatCompletionMessageParam)

            const content = (typeof assistantMsg.content === 'string' ? assistantMsg.content : '') ?? ''
            let planText = extractPlan(content)
            if (!planText) {
                messages.push({ role: 'user', content: 'Wrap your plan in <plan>...</plan> tags. Output the plan now.' })
                let retry
                try {
                    retry = await client.chat.completions.create(
                        { model: cfg.model, temperature: cfg.temperature, messages, tool_choice: 'none' },
                        { signal },
                    )
                } catch (e: any) {
                    if (isAbortError(e, signal)) return
                    log.error(`ai-agent.loop: plan re-prompt failed: ${e.message ?? e}`)
                    return
                }
                const retryChoice = retry.choices?.[0]
                if (!retryChoice) return
                const retryMsg = retryChoice.message
                messages.push(retryMsg as ChatCompletionMessageParam)
                const retryContent = (typeof retryMsg.content === 'string' ? retryMsg.content : '') ?? ''
                planText = extractPlan(retryContent) || retryContent || ''
            }

            const pin = buildPlanPin(planText)
            if (planPinned) {
                messages[1] = pin as ChatCompletionMessageParam
                log.debug(`ai-agent.loop: plan pin replaced`)
            } else {
                messages.splice(1, 0, pin as ChatCompletionMessageParam)
                planPinned = true
                log.debug(`ai-agent.loop: plan pin inserted`)
            }
            log.info(`ai-agent.loop: plan→execute, plan ${planText.length} chars`)

            phase = 'execute'
            executePhaseTurnsSinceLastPlan = 0
            messages[0] = buildSystemMessage(query, 'execute')
            tools = await buildTools(query, queue, state, 'execute')
            toolByName = new Map(tools.map(t => [t.name, t]))
            continue
        }

        log.error('ai-agent.loop: execute phase not yet implemented')
        return
    }
}

function extractPlan(content: string): string {
    const match = /<plan>([\s\S]+?)<\/plan>/i.exec(content)
    if (match) return match[1].trim()
    return ''
}

function canonicalJson(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
    const keys = Object.keys(v as Record<string, unknown>).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson((v as any)[k])).join(',') + '}'
}

async function executeWithTimeout(tool: Tool, args: any, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) return { error: 'cancelled' }
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<any>(resolve => {
        timer = setTimeout(() => {
            log.warn(`ai-agent.loop: tool "${tool.name}" timeout after ${timeoutMs}ms`)
            resolve({ error: `tool "${tool.name}" timeout after ${timeoutMs}ms` })
        }, timeoutMs)
    })
    let abortListener: (() => void) | undefined
    const abortPromise = signal
        ? new Promise<any>(resolve => {
            abortListener = () => resolve({ error: 'cancelled' })
            signal.addEventListener('abort', abortListener, { once: true })
        })
        : null
    try {
        const handlerResult = tool.handler(args, signal).catch(e => {
            if (isAbortError(e, signal)) return { error: 'cancelled' }
            return { error: String(e?.message ?? e) }
        })
        const racers: Promise<any>[] = [handlerResult, timeoutPromise]
        if (abortPromise) racers.push(abortPromise)
        return await Promise.race(racers)
    } finally {
        if (timer) clearTimeout(timer)
        if (abortListener) signal?.removeEventListener('abort', abortListener)
    }
}
```

- [ ] **Step 2: Update `index.ts` to pass `queue` and `state` to `runAgentLoop`**

Read the current call site at `examples/scraper-node/src/sources/ai-agent/index.ts` (around line 48).

Replace the line:

```typescript
        const loopPromise = runAgentLoop(client, query, tools, cfg, { onToolCall, signal })
```

with:

```typescript
        const loopPromise = runAgentLoop(client, query, queue, reportState, cfg, { onToolCall, signal })
```

Remove the now-unused `tools` variable (the `await buildTools(...)` line) and the `log.trace(\`ai-agent.search: tools=...\`)` line. The cleaned-up section becomes:

```typescript
        const client = createClient(cfg)
        const queue = new AsyncQueue<OrgData>()
        const reportState: ReportState = { yielded: 0 }

        const onAbort = () => queue.close()
        signal?.addEventListener('abort', onAbort, { once: true })

        const liveLog = context?.events?.liveLog
        const onToolCall = liveLog
            ? (info: AgentToolCallInfo) => liveLog([
                `🤖 ${info.name} (${info.durationMs}ms)${info.ok ? '' : ` — ${info.error ?? 'error'}`}: ${info.args.slice(0, 60)}`,
            ])
            : undefined

        const loopPromise = runAgentLoop(client, query, queue, reportState, cfg, { onToolCall, signal })
```

Update the imports at the top of `index.ts`: change `import { buildTools, ReportState } from "./tools"` to `import { ReportState } from "./tools"`.

- [ ] **Step 3: Delete the old loop-dedup.test.ts**

The old test scripted `runAgentLoop(client, query, tools, cfg)` with a tools array passed in — that signature no longer exists. Equivalent dedup coverage moves to `loop-recon-bounds.test.ts` (Task 9) and `loop-invariants.test.ts` (Task 13).

```bash
git rm examples/scraper-node/src/sources/ai-agent/__tests__/loop-dedup.test.ts
```

- [ ] **Step 4: Build to verify**

Run: `cd examples/scraper-node && npx tsc --build --pretty`
Expected: SUCCESS (execute phase exists as stub but is type-correct).

- [ ] **Step 5: Run all scraper-node tests**

Run: `cd examples/scraper-node && npx jest`
Expected: PASS — `extract-contacts.test.ts` and any non-loop tests pass; loop-dedup.test.ts is gone; loop-phases / loop-recon-bounds don't exist yet.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/loop.ts examples/scraper-node/src/sources/ai-agent/index.ts
git commit -m "refactor(ai-agent): phase machine — recon + plan phases wired

- runAgentLoop signature: (client, query, queue, state, cfg, hooks)
- recon phase: tool_choice=required, [web_search, end_recon] only
- plan phase: tool_choice=none, extracts <plan>...</plan>, pins at messages[1]
- execute phase: stub (next commit)
- Old loop-dedup.test.ts removed; equivalent coverage in upcoming phase tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Recon-phase tests

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/__tests__/loop-recon-bounds.test.ts`

- [ ] **Step 1: Write failing tests for recon bounds**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/loop-recon-bounds.test.ts`:

```typescript
import { runAgentLoop } from '../loop'
import { AsyncQueue } from '../async-queue'
import type { OrgData, SearchQuery } from '../../../types'
import type { ResolvedAIAgentConfig } from '../config'
import type { ReportState } from '../tools'

class FakeOpenAIClient {
    private script: any[]
    public requests: any[] = []
    constructor(script: any[]) { this.script = [...script] }
    chat = {
        completions: {
            create: async (req: any): Promise<any> => {
                this.requests.push(req)
                if (this.script.length === 0) throw new Error('FakeOpenAIClient: ran out of scripted responses')
                const msg = this.script.shift()
                return { choices: [{ message: msg }] }
            },
        },
    }
}

const baseQuery: SearchQuery = {
    query: 'адвокат',
    city: 'Санкт-Петербург',
    sources: [],
    maxResults: 10,
}

const cfg: ResolvedAIAgentConfig = {
    model: 'test-model',
    temperature: 0.0,
    baseUrl: 'http://x',
    apiKey: '',
    maxToolCalls: 50,
    toolTimeoutMs: 1000,
    totalTimeoutMs: 60_000,
}

function callMessage(toolName: string, args: object, id = 'c1') {
    return {
        role: 'assistant',
        content: '',
        tool_calls: [{ id, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }],
    }
}

const planMessage = { role: 'assistant', content: '<plan>start with aggregator search</plan>', tool_calls: [] }
const finishMessage = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — recon bounds', () => {
    it('rejects disallowed tool calls during recon', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMessage('report_results', { orgs: [] }, 'a'),
            callMessage('end_recon', {}, 'b'),
            planMessage,
            finishMessage,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const secondReq = client.requests[1]
        const lastToolMsg = secondReq.messages.filter((m: any) => m.role === 'tool').pop()
        expect(lastToolMsg.content).toMatch(/recon phase: only web_search and end_recon allowed/)
    })

    it('forces transition to plan after RECON_BUDGET (10) web_search calls', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const reconCalls = Array.from({ length: 10 }, (_, i) =>
            callMessage('web_search', { query: 'q' + i }, 'r' + i),
        )
        const client = new FakeOpenAIClient([
            ...reconCalls,
            planMessage,
            finishMessage,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const planReq = client.requests[10]
        expect(planReq.tool_choice).toBe('none')
    })

    it('global dedup applies in recon (same web_search args twice)', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMessage('web_search', { query: 'X' }, 'a'),
            callMessage('web_search', { query: 'X' }, 'b'),
            callMessage('end_recon', {}, 'c'),
            planMessage,
            finishMessage,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const thirdReq = client.requests[2]
        const dupErrMsg = thirdReq.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'b')
        expect(dupErrMsg.content).toMatch(/duplicate call/)
    })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/__tests__/loop-recon-bounds.test.ts`
Expected: PASS — recon machinery from Task 8 covers these.

If any test fails, fix `loop.ts` accordingly (most likely candidates: dedup error path, or budget force-transition off-by-one).

- [ ] **Step 3: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/__tests__/loop-recon-bounds.test.ts
git commit -m "test(ai-agent): recon phase bounds and discipline

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Plan-phase tests

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/__tests__/loop-phases.test.ts`

- [ ] **Step 1: Write tests for plan extraction and pinning**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/loop-phases.test.ts`:

```typescript
import { runAgentLoop } from '../loop'
import { AsyncQueue } from '../async-queue'
import type { OrgData, SearchQuery } from '../../../types'
import type { ResolvedAIAgentConfig } from '../config'
import type { ReportState } from '../tools'

class FakeOpenAIClient {
    private script: any[]
    public requests: any[] = []
    constructor(script: any[]) { this.script = [...script] }
    chat = {
        completions: {
            create: async (req: any): Promise<any> => {
                this.requests.push(req)
                if (this.script.length === 0) throw new Error('FakeOpenAIClient: ran out of scripted responses')
                const msg = this.script.shift()
                return { choices: [{ message: msg }] }
            },
        },
    }
}

const baseQuery: SearchQuery = { query: 'адвокат', city: 'СПб', sources: [], maxResults: 5 }
const cfg: ResolvedAIAgentConfig = {
    model: 'test', temperature: 0, baseUrl: 'http://x', apiKey: '',
    maxToolCalls: 25, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — plan extraction & pinning', () => {
    it('extracts plan from <plan>...</plan> tags and pins at messages[1]', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: 'My plan: <plan>do A then B</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const executeReq = client.requests[2]
        const pin = executeReq.messages[1]
        expect(pin.role).toBe('system')
        expect(pin.content).toContain('Active research plan:')
        expect(pin.content).toContain('do A then B')
    })

    it('falls back to whole content when <plan> tags missing twice', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: 'first response, no tags', tool_calls: [] },
            { role: 'assistant', content: 'still no tags here', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const executeReq = client.requests[3]
        const pin = executeReq.messages[1]
        expect(pin.content).toContain('still no tags here')
    })

    it('plan phase request uses tool_choice=none and omits tools', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const planReq = client.requests[1]
        expect(planReq.tool_choice).toBe('none')
        expect(planReq.tools).toBeUndefined()
    })

    it('execute phase request uses tool_choice=auto with full tool set', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const execReq = client.requests[2]
        expect(execReq.tool_choice).toBe('auto')
        const toolNames = execReq.tools.map((t: any) => t.function.name)
        expect(toolNames).toEqual(expect.arrayContaining([
            'web_search', 'fetch_url', 'parse_html', 'extract_contacts',
            'report_results', 'revise_plan',
        ]))
    })
})
```

Note: `search_source` is intentionally omitted from the assertion because it depends on `SourceRegistry.availableFor()` returning at least one usable source — in the test environment it may not. The remaining 6 tools are deterministic.

- [ ] **Step 2: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/__tests__/loop-phases.test.ts`
Expected: PASS — Task 8's plan-phase code handles these.

The execute-phase happy-path test ("`finishMsg` after plan transition") relies on the execute phase NOT being a stub. This is the bridge to Task 11.

If the execute test fails with "execute phase not yet implemented", that's expected — comment out that test temporarily, ship Task 11 next, then uncomment and re-verify.

- [ ] **Step 3: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/__tests__/loop-phases.test.ts
git commit -m "test(ai-agent): plan extraction, pinning, per-phase request shapes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `loop.ts` — execute phase (without revise_plan blocking)

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/loop.ts`

- [ ] **Step 1: Replace the execute-phase stub with the real loop body**

In `loop.ts`, find:

```typescript
        log.error('ai-agent.loop: execute phase not yet implemented')
        return
    }
}
```

Replace with:

```typescript
        if (phase === 'execute') {
            turn++
            executePhaseTurnsSinceLastPlan++
            const requestTools: ChatCompletionTool[] = tools.map(toOpenAISchema)
            const reqStart = Date.now()
            let response
            try {
                response = await client.chat.completions.create(
                    {
                        model: cfg.model,
                        temperature: cfg.temperature,
                        messages,
                        tools: requestTools,
                        tool_choice: 'auto',
                    },
                    { signal },
                )
            } catch (e: any) {
                if (isAbortError(e, signal)) return
                log.error(`ai-agent.loop: LLM request failed (execute turn ${turn}): ${e.message ?? e}`)
                return
            }
            log.trace(`ai-agent.loop: execute turn ${turn} response in ${Date.now() - reqStart}ms`)

            const choice = response.choices?.[0]
            if (!choice) { log.warn('ai-agent.loop: LLM returned no choices'); return }
            const assistantMsg = choice.message
            messages.push(assistantMsg as ChatCompletionMessageParam)

            const toolCalls = assistantMsg.tool_calls ?? []
            if (toolCalls.length === 0) {
                log.info(`ai-agent.loop: agent finished after ${turn} turns, ${toolCallsUsed} tool calls`)
                return
            }

            let revisedThisTurn = false
            for (const call of toolCalls) {
                if (revisedThisTurn) break
                if (call.type !== 'function') {
                    pushToolError(call.id, 'unsupported tool call type')
                    continue
                }
                const name = call.function.name

                let parsed: any
                try { parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {} }
                catch (e: any) { pushToolError(call.id, `invalid arguments: ${e.message ?? e}`); continue }

                if (name === 'revise_plan') {
                    const tool = toolByName.get('revise_plan')!
                    const result = await tool.handler(parsed, signal)
                    pushToolResult(call.id, result)
                    log.warn(`ai-agent.loop: execute→plan via revise_plan after ${executePhaseTurnsSinceLastPlan} turns. reason: ${parsed?.reason ?? '(none)'}`)
                    phase = 'plan'
                    messages[0] = buildSystemMessage(query, 'plan')
                    tools = await buildTools(query, queue, state, 'plan')
                    toolByName = new Map(tools.map(t => [t.name, t]))
                    revisedThisTurn = true
                    continue
                }

                if (toolCallsUsed >= cfg.maxToolCalls) {
                    pushToolError(call.id, 'max tool calls reached, wrap up with report_results')
                    continue
                }

                const tool = toolByName.get(name)
                if (!tool) {
                    log.warn(`ai-agent.loop: agent called unknown tool "${name}"`)
                    pushToolError(call.id, `unknown tool "${name}"`)
                    continue
                }

                const dedupKey = `${tool.name}:${canonicalJson(parsed)}`
                if (seenCalls.has(dedupKey)) {
                    log.warn(`ai-agent.loop: ${tool.name} duplicate call rejected (vary args)`)
                    pushToolError(call.id, `duplicate call: ${tool.name} was already invoked with these exact arguments earlier this run. Vary the arguments or proceed to the next step.`)
                    toolCallsUsed++
                    continue
                }
                seenCalls.add(dedupKey)
                toolCallsUsed++

                const callStart = Date.now()
                const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs, signal)
                if (signal?.aborted) return
                const durationMs = Date.now() - callStart
                if (result?.error) log.warn(`ai-agent.loop: ${tool.name} returned error: ${result.error}`)
                hooks?.onToolCall?.({ name: tool.name, args: JSON.stringify(parsed), durationMs, ok: !result?.error, error: result?.error })
                pushToolResult(call.id, result)
            }
            continue
        }
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `cd examples/scraper-node && npx tsc --build --pretty`
Expected: SUCCESS.

- [ ] **Step 3: Run all tests**

Run: `cd examples/scraper-node && npx jest`
Expected: PASS — phase tests, recon tests, extract-contacts tests all green.

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/loop.ts
git commit -m "feat(ai-agent): execute phase loop with all tools + dedup + budget

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `revise_plan` blocking + tests

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/loop.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/__tests__/loop-revise-plan.test.ts`

- [ ] **Step 1: Write failing tests for revise_plan blocking**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/loop-revise-plan.test.ts`:

```typescript
import { runAgentLoop } from '../loop'
import { AsyncQueue } from '../async-queue'
import type { OrgData, SearchQuery } from '../../../types'
import type { ResolvedAIAgentConfig } from '../config'
import type { ReportState } from '../tools'

class FakeOpenAIClient {
    private script: any[]
    public requests: any[] = []
    constructor(script: any[]) { this.script = [...script] }
    chat = {
        completions: {
            create: async (req: any): Promise<any> => {
                this.requests.push(req)
                if (this.script.length === 0) throw new Error('FakeOpenAIClient: ran out of scripted responses')
                const msg = this.script.shift()
                return { choices: [{ message: msg }] }
            },
        },
    }
}

const baseQuery: SearchQuery = { query: 'q', city: 'СПб', sources: [], maxResults: 5 }
const cfg: ResolvedAIAgentConfig = {
    model: 'test', temperature: 0, baseUrl: 'http://x', apiKey: '',
    maxToolCalls: 25, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — revise_plan blocking', () => {
    it('rejects revise_plan called on the first execute turn', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('revise_plan', { reason: 'bad plan' }, 'rp1'),
            callMsg('parse_html', { html: '<a href="tel:+71234567890">x</a>', selector: 'a' }, 't1'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const reqAfterBlocked = client.requests[3]
        const blockedResult = reqAfterBlocked.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'rp1')
        expect(blockedResult.content).toMatch(/give the current plan at least 2 execute turns/)
        expect(reqAfterBlocked.tool_choice).toBe('auto')
    })

    it('allows revise_plan after 2 execute turns and replaces pin in place', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>plan A</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),
            callMsg('parse_html', { html: '<y/>', selector: 'y' }, 't2'),
            callMsg('revise_plan', { reason: 'A failed' }, 'rp1'),
            { role: 'assistant', content: '<plan>plan B</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[6]
        expect(finalReq.messages[1].role).toBe('system')
        expect(finalReq.messages[1].content).toContain('plan B')
        expect(finalReq.messages[1].content).not.toContain('plan A')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/__tests__/loop-revise-plan.test.ts`
Expected: FAIL — first test fails because revise_plan executes immediately without the blocking guard.

- [ ] **Step 3: Add blocking guard to loop.ts**

In `loop.ts`, find the `revise_plan` block in execute phase:

```typescript
                if (name === 'revise_plan') {
                    const tool = toolByName.get('revise_plan')!
```

Insert the guard before that `tool` line:

```typescript
                if (name === 'revise_plan') {
                    if (executePhaseTurnsSinceLastPlan < REVISE_MIN_EXECUTE_TURNS) {
                        log.debug(`ai-agent.loop: revise_plan rejected (only ${executePhaseTurnsSinceLastPlan} execute turns elapsed)`)
                        pushToolError(call.id, `revise_plan unavailable: give the current plan at least ${REVISE_MIN_EXECUTE_TURNS} execute turns before revising. Try the plan; if it still fails, revise then.`)
                        continue
                    }
                    const tool = toolByName.get('revise_plan')!
```

(Keep the rest of the revise_plan block — handler call, log, phase transition, `revisedThisTurn = true`.)

- [ ] **Step 4: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/__tests__/loop-revise-plan.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Run all tests**

Run: `cd examples/scraper-node && npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/loop.ts examples/scraper-node/src/sources/ai-agent/__tests__/loop-revise-plan.test.ts
git commit -m "feat(ai-agent): revise_plan blocked for first 2 execute turns

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Loop invariants test (progress always present, no budget prefix)

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/__tests__/loop-invariants.test.ts`

- [ ] **Step 1: Write invariant tests**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/loop-invariants.test.ts`:

```typescript
import { runAgentLoop } from '../loop'
import { AsyncQueue } from '../async-queue'
import type { OrgData, SearchQuery } from '../../../types'
import type { ResolvedAIAgentConfig } from '../config'
import type { ReportState } from '../tools'

class FakeOpenAIClient {
    private script: any[]
    public requests: any[] = []
    constructor(script: any[]) { this.script = [...script] }
    chat = {
        completions: {
            create: async (req: any): Promise<any> => {
                this.requests.push(req)
                if (this.script.length === 0) throw new Error('FakeOpenAIClient: ran out of scripted responses')
                const msg = this.script.shift()
                return { choices: [{ message: msg }] }
            },
        },
    }
}

const baseQuery: SearchQuery = { query: 'q', city: 'СПб', sources: [], maxResults: 5 }
const cfg: ResolvedAIAgentConfig = {
    model: 'test', temperature: 0, baseUrl: 'http://x', apiKey: '',
    maxToolCalls: 4, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — invariants', () => {
    it('every tool-role message has a progress field', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),
            callMsg('end_recon', {}, 'r2'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        expect(toolMsgs.length).toBeGreaterThan(0)
        for (const m of toolMsgs) {
            const parsed = JSON.parse(m.content)
            expect(parsed.progress).toBeDefined()
            expect(parsed.progress.target).toBe(5)
            expect(parsed.progress.toolBudget).toBe(4)
            expect(typeof parsed.progress.yielded).toBe('number')
            expect(typeof parsed.progress.toolsUsed).toBe('number')
        }
    })

    it('budget prefix string is gone (no [budget: prefix anywhere)', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),
            callMsg('end_recon', {}, 'r2'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),
            callMsg('parse_html', { html: '<y/>', selector: 'y' }, 't2'),
            callMsg('parse_html', { html: '<z/>', selector: 'z' }, 't3'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        for (const m of toolMsgs) {
            expect(m.content).not.toMatch(/^\[budget:/)
        }
    })

    it('end_recon and revise_plan do not increment toolsUsed', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),
            callMsg('end_recon', {}, 'r2'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),
            callMsg('parse_html', { html: '<y/>', selector: 'y' }, 't2'),
            callMsg('revise_plan', { reason: 'r' }, 'rp1'),
            { role: 'assistant', content: '<plan>p2</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        const lastToolMsg = toolMsgs[toolMsgs.length - 1]
        const lastProgress = JSON.parse(lastToolMsg.content).progress
        expect(lastProgress.toolsUsed).toBe(3)
    })
})
```

- [ ] **Step 2: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/__tests__/loop-invariants.test.ts`
Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `cd examples/scraper-node && npx jest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/__tests__/loop-invariants.test.ts
git commit -m "test(ai-agent): loop invariants — progress field, no budget prefix

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `web_search` hints

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/web-search.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/web-search.test.ts`

- [ ] **Step 1: Write failing tests for the hint helper**

Append to `examples/scraper-node/src/sources/ai-agent/tools/__tests__/web-search.test.ts`:

```typescript
import { buildWebSearchHint } from '../web-search'

describe('buildWebSearchHint', () => {
    it('returns synonyms hint for empty results without error', () => {
        const hint = buildWebSearchHint([])
        expect(hint).toMatch(/synonyms/)
    })

    it('returns backend-failed hint for empty results with error', () => {
        const hint = buildWebSearchHint([], 'searxng down')
        expect(hint).toMatch(/backend failed/)
    })

    it('returns aggregator hint when >50% of domains are aggregators', () => {
        const results = [
            { title: 'A', url: 'https://2gis.ru/x', snippet: '' },
            { title: 'B', url: 'https://yell.ru/y', snippet: '' },
            { title: 'C', url: 'https://example.com/z', snippet: '' },
        ]
        const hint = buildWebSearchHint(results)
        expect(hint).toMatch(/search_source/)
    })

    it('returns diverse-fetch hint when results are mostly unique domains', () => {
        const results = [
            { title: 'A', url: 'https://a.com/x', snippet: '' },
            { title: 'B', url: 'https://b.com/y', snippet: '' },
            { title: 'C', url: 'https://c.com/z', snippet: '' },
        ]
        const hint = buildWebSearchHint(results)
        expect(hint).toMatch(/fetch the top/)
    })

    it('returns no hint for 1-2 results (below the >=3 threshold)', () => {
        const results = [{ title: 'A', url: 'https://a.com/x', snippet: '' }]
        const hint = buildWebSearchHint(results)
        expect(hint).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/web-search.test.ts -t buildWebSearchHint`
Expected: FAIL — `buildWebSearchHint` not exported.

- [ ] **Step 3: Implement `buildWebSearchHint` and wire into the handler**

In `web-search.ts`, add after the imports (before `makeWebSearchTool`):

```typescript
const AGGREGATOR_DOMAINS = [
    '2gis.ru', 'yell.ru', 'zoon.ru', 'yandex.ru', 'yandex.com',
    'spravochnik.org', 'orgpage.ru', 'rusprofile.ru', 'list-org.com',
]

function isAggregatorDomain(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase()
        return AGGREGATOR_DOMAINS.some(d => host === d || host.endsWith('.' + d))
    } catch {
        return false
    }
}

export function buildWebSearchHint(results: WebSearchResult[], error?: string): string | undefined {
    if (results.length === 0) {
        return error
            ? 'search backend failed — try a different query phrasing or fall back to search_source'
            : 'no results — try synonyms or related terms (e.g. broader category, English transliteration, professional jargon)'
    }
    if (results.length < 3) return undefined
    const aggregatorCount = results.filter(r => isAggregatorDomain(r.url)).length
    if (aggregatorCount / results.length > 0.5) {
        return "aggregator-heavy results — search_source('yandex-business') will be cheaper than scraping these one by one"
    }
    return 'diverse results — fetch the top 2-3 for direct contact extraction'
}
```

In the handler, modify the success path:

```typescript
            try {
                const results = await searchSearxng(baseUrl, query, limit, signal)
                log.debug(`ai-agent.web_search: ${results.length} results via searxng`)
                const hint = buildWebSearchHint(results)
                return hint ? { results, hint } : { results }
            } catch (e: any) {
                const error = String(e?.message ?? e)
                log.debug(`ai-agent.web_search: 0 results (searxng: ${error})`)
                const hint = buildWebSearchHint([], error)
                return { results: [], error, hint }
            }
```

- [ ] **Step 4: Run hint tests to verify they pass**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/web-search.test.ts`
Expected: PASS — all hint tests + existing tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/web-search.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/web-search.test.ts
git commit -m "feat(ai-agent): web_search hint — empty/aggregator/diverse heuristics

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `fetch_url` hints

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/fetch-url.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/fetch-url.test.ts`

- [ ] **Step 1: Write failing tests for fetch_url hints**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/fetch-url.test.ts`:

```typescript
import { buildFetchUrlHint } from '../fetch-url'

describe('buildFetchUrlHint', () => {
    it('returns skip hint for HTTP 4xx', () => {
        const hint = buildFetchUrlHint({ status: 404, content: '', truncated: false, error: 'HTTP 404' }, 'text')
        expect(hint).toMatch(/skip this URL/)
    })

    it('returns skip hint for HTTP 5xx', () => {
        const hint = buildFetchUrlHint({ status: 502, content: '', truncated: false, error: 'HTTP 502' }, 'text')
        expect(hint).toMatch(/skip this URL/)
    })

    it('text mode with no contact markers — try html mode hint', () => {
        const hint = buildFetchUrlHint({ status: 200, content: 'just plain text about lawyers', truncated: false }, 'text')
        expect(hint).toMatch(/mode='html'/)
    })

    it('text mode with phone markers — call report_results hint', () => {
        const hint = buildFetchUrlHint({ status: 200, content: 'тел: +7 (495) 123-45-67', truncated: false }, 'text')
        expect(hint).toMatch(/report_results/)
    })

    it('html mode with thin body — skip hint', () => {
        const hint = buildFetchUrlHint({ status: 200, content: '<html></html>', truncated: false }, 'html')
        expect(hint).toMatch(/skip/)
    })

    it('html mode with normal body — call extract_contacts hint', () => {
        const longBody = '<html><body>' + 'x'.repeat(800) + '</body></html>'
        const hint = buildFetchUrlHint({ status: 200, content: longBody, truncated: false }, 'html')
        expect(hint).toMatch(/extract_contacts/)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/fetch-url.test.ts`
Expected: FAIL — `buildFetchUrlHint` not exported.

- [ ] **Step 3: Implement `buildFetchUrlHint` and wire into the handler**

In `fetch-url.ts`, add (above the `makeFetchUrlTool` function):

```typescript
export function buildFetchUrlHint(
    result: { status: number, content: string, truncated: boolean, error?: string },
    mode: 'text' | 'html',
): string | undefined {
    if (result.status >= 400 || result.status === 0) {
        return 'page unavailable — skip this URL, try the next search result'
    }
    if (mode === 'html') {
        if (result.content.length < 500) return 'thin page — likely SPA or 404 disguised as 200; skip'
        return 'now call extract_contacts(html) to pull tel/mailto/address in one step'
    }
    const hasMarker = /@|\+7|тел/i.test(result.content)
    return hasMarker
        ? 'contacts visible in text — call report_results directly with the extracted org'
        : "no contact markers in extracted text — try mode='html' to inspect markup, or skip this page"
}
```

In the handler, modify the returns:

```typescript
                if (status >= 400) {
                    log.debug(`ai-agent.fetch_url: ${url} HTTP ${status}`)
                    const result = { status, content: '', truncated: false, error: `HTTP ${status}` }
                    return { ...result, hint: buildFetchUrlHint(result, mode) }
                }
                // ... after content + truncated computed:
                log.debug(`ai-agent.fetch_url: ${url} ${status} ${content.length}ch${truncated ? ' (truncated)' : ''}`)
                const result = { status, content, truncated }
                return { ...result, hint: buildFetchUrlHint(result, mode) }
```

For the catch block:

```typescript
            } catch (e: any) {
                log.warn(`ai-agent.fetch_url: ${url}: ${e.message ?? e}`)
                const result = { status: 0, content: '', truncated: false, error: String(e.message ?? e) }
                return { ...result, hint: buildFetchUrlHint(result, mode) }
            }
```

- [ ] **Step 4: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/fetch-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/fetch-url.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/fetch-url.test.ts
git commit -m "feat(ai-agent): fetch_url hint — http/text/html branch heuristics

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `parse_html` hints

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/parse-html.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/parse-html.test.ts`

- [ ] **Step 1: Write failing tests**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/parse-html.test.ts`:

```typescript
import { buildParseHtmlHint } from '../parse-html'

describe('buildParseHtmlHint', () => {
    it('returns broader-selector hint when 0 matches', () => {
        const hint = buildParseHtmlHint({ matches: [], count: 0, truncated: false })
        expect(hint).toMatch(/broader selector/)
    })

    it('returns narrow-selector hint when truncated', () => {
        const hint = buildParseHtmlHint({ matches: ['a', 'b'], count: 2, truncated: true })
        expect(hint).toMatch(/narrow your selector/)
    })

    it('returns no hint for normal results', () => {
        const hint = buildParseHtmlHint({ matches: ['x'], count: 1, truncated: false })
        expect(hint).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/parse-html.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and wire**

In `parse-html.ts`, add (above `makeParseHtmlTool`):

```typescript
export function buildParseHtmlHint(result: { matches: string[], count: number, truncated: boolean }): string | undefined {
    if (result.count === 0) return 'selector matched nothing — try a broader selector, or extract_contacts(html) which bundles common contact patterns'
    if (result.truncated) return 'more matches available — narrow your selector if you only need the first few'
    return undefined
}
```

In the handler, modify the success return:

```typescript
                const truncated = found.length > matches.length
                log.debug(`ai-agent.parse_html: selector="${selector}" extract=${extract} matches=${matches.length}/${found.length}${truncated ? ' (truncated)' : ''}`)
                const result = { matches, count: matches.length, truncated }
                const hint = buildParseHtmlHint(result)
                return hint ? { ...result, hint } : result
```

- [ ] **Step 4: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/parse-html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/parse-html.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/parse-html.test.ts
git commit -m "feat(ai-agent): parse_html hint — empty matches and truncation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `search_source` (delegate-source) hints

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/delegate-source.test.ts`

- [ ] **Step 1: Write failing tests**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/delegate-source.test.ts`:

```typescript
import { buildSearchSourceHint } from '../delegate-source'

describe('buildSearchSourceHint', () => {
    it('returns nothing-found hint when accepted=0 and rejected=0', () => {
        const hint = buildSearchSourceHint({ accepted: 0, rejected: 0, totalYielded: 0 })
        expect(hint).toMatch(/returned nothing/)
    })

    it('returns all-rejected hint when accepted=0 rejected>0', () => {
        const hint = buildSearchSourceHint({ accepted: 0, rejected: 5, totalYielded: 0 })
        expect(hint).toMatch(/all failed validation/)
    })

    it('returns good-signal hint when accepted>0 rejected=0', () => {
        const hint = buildSearchSourceHint({ accepted: 5, rejected: 0, totalYielded: 5 })
        expect(hint).toMatch(/good signal/)
    })

    it('returns mixed-quality hint when both >0', () => {
        const hint = buildSearchSourceHint({ accepted: 3, rejected: 2, totalYielded: 3 })
        expect(hint).toMatch(/mixed quality/)
        expect(hint).toMatch(/40%/)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/delegate-source.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and wire**

In `delegate-source.ts`, add (above `makeDelegateSourceTool`):

```typescript
export function buildSearchSourceHint(outcome: { accepted: number, rejected: number, totalYielded: number }): string {
    const { accepted, rejected } = outcome
    if (accepted === 0 && rejected === 0) return 'source returned nothing for this query — try a different source or web_search'
    if (accepted === 0 && rejected > 0) return 'source returned items but all failed validation (missing contacts or wrong city) — switch back to web_search'
    if (accepted > 0 && rejected === 0) return 'good signal from this source — consider another search_source call with a related query'
    const rate = Math.round((rejected / (accepted + rejected)) * 100)
    return `mixed quality — keep going but expect ~${rate}% rejects`
}
```

In the handler, modify the success-path return:

```typescript
                log.debug(`ai-agent.search_source[${sourceName}]: accepted=${accepted} rejected=${rejected} totalYielded=${state.yielded}`)
                const outcome = { accepted, rejected, totalYielded: state.yielded }
                return { ...outcome, hint: buildSearchSourceHint(outcome) }
            } catch (e: any) {
                log.error(`ai-agent.search_source[${sourceName}]: ${e.message ?? e}`)
                return { accepted, rejected, totalYielded: state.yielded, error: String(e.message ?? e) }
            }
```

(No hint on the error path — error is the signal.)

- [ ] **Step 4: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/delegate-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/delegate-source.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/delegate-source.test.ts
git commit -m "feat(ai-agent): search_source hint — outcome quadrants

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `report_results` hints

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/report-results.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/report-results.test.ts`

- [ ] **Step 1: Write failing tests**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/report-results.test.ts`:

```typescript
import { buildReportResultsHint } from '../report-results'

describe('buildReportResultsHint', () => {
    const city = 'СПб'

    it('returns all-rejected hint when accepted=0', () => {
        const hint = buildReportResultsHint({ accepted: 0, rejected: 3, totalYielded: 0 }, 5, city)
        expect(hint).toMatch(/all candidates rejected/)
        expect(hint).toMatch(/СПб/)
    })

    it('returns target-reached hint when totalYielded >= target', () => {
        const hint = buildReportResultsHint({ accepted: 2, rejected: 0, totalYielded: 5 }, 5, city)
        expect(hint).toMatch(/target reached/)
    })

    it('returns remaining-count hint when partial', () => {
        const hint = buildReportResultsHint({ accepted: 2, rejected: 0, totalYielded: 3 }, 5, city)
        expect(hint).toMatch(/2 more orgs needed/)
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/report-results.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and wire**

In `report-results.ts`, add (above `makeReportResultsTool`):

```typescript
export function buildReportResultsHint(
    outcome: { accepted: number, rejected: number, totalYielded: number },
    target: number,
    city?: string,
): string {
    if (outcome.accepted === 0) {
        const cityClause = city ? ` and address mentions ${city}` : ''
        return `all candidates rejected — check that each org has name + at least one of phone/email/address${cityClause}`
    }
    if (outcome.totalYielded >= target) return 'target reached — emit no more tool calls to finish'
    const remaining = target - outcome.totalYielded
    return `${remaining} more orgs needed — keep searching`
}
```

In the handler:

```typescript
        async handler(args) {
            const orgs = Array.isArray(args?.orgs) ? args.orgs : []
            log.trace(`ai-agent.report_results: ${orgs.length} candidate(s)`)
            const outcome = emitMany(orgs, queue, state, query, 'ai-agent')
            log.debug(`ai-agent.report_results: accepted=${outcome.accepted} rejected=${outcome.rejected} totalYielded=${outcome.totalYielded}`)
            return { ...outcome, hint: buildReportResultsHint(outcome, query.maxResults, query.city) }
        },
```

- [ ] **Step 4: Run tests**

Run: `cd examples/scraper-node && npx jest src/sources/ai-agent/tools/__tests__/report-results.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/report-results.ts examples/scraper-node/src/sources/ai-agent/tools/__tests__/report-results.test.ts
git commit -m "feat(ai-agent): report_results hint — rejection / progress / done

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Final verification — full test suite + monorepo build

**Files:** none (verification only)

- [ ] **Step 1: Run all scraper-node tests**

Run: `cd examples/scraper-node && npx jest`
Expected: All tests PASS. New test count should be ≥40 above baseline.

- [ ] **Step 2: Build the entire monorepo**

Run: `npm run build` from repo root.
Expected: SUCCESS.

- [ ] **Step 3: Run each package's tests**

```bash
cd packages/common && npx jest
cd ../core && npx jest
cd ../transport && npx jest
cd ../node && npx jest
cd ../../plugins/storage/mongo && npx jest
cd ../../../examples/scraper-node && npx jest
```

Expected: all green. The 322-test baseline plus new ai-agent tests.

- [ ] **Step 4: Eyeball the composed system message**

Read `examples/scraper-node/src/sources/ai-agent/prompts.ts` and mentally concatenate `buildRolePrompt(query) + '\n\n' + buildExecuteInstructions(query)` for a sample `SearchQuery({query: 'адвокат', city: 'СПб', sources: [], maxResults: 10})`. Confirm it reads coherently and the hard rules (city, contact requirement, dedup) are present.

- [ ] **Step 5: No commit needed for this task**

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task(s) |
|---|---|
| §3.1 phase machine | Tasks 8 (recon+plan), 11 (execute), 12 (revise blocking) |
| §3.2 plan pinning | Task 8 (insert+replace logic) |
| §3.3 per-phase prompt composition | Tasks 7 (builders), 8 (composition in `buildSystemMessage`) |
| §4.1 prompts.ts builders | Task 7 |
| §4.2 envelope + per-tool hints | Tasks 8 (envelope), 14–18 (per-tool hints) |
| §4.3 extract_contacts | Tasks 1–3 |
| §4.4 end_recon | Task 4 |
| §4.5 revise_plan + 2-turn block | Tasks 5 (tool), 12 (blocking) |
| §4.6 phase-aware buildTools | Task 6 |
| §5 data flow | Implicit across Tasks 8, 11 |
| §5.1 message-list invariants | Task 13 |
| §6 error handling per phase | Tasks 8, 11, 12 |
| §7 logging | Tasks 8, 11, 12 |
| §8 testing tiers 1–4 | Tasks 9, 10, 12, 13, 14–18, 1–3 |
| §9 files touched | All tasks |
| §10 out-of-scope items | Not implemented (correct) |

All sections covered.

**2. Placeholder scan:** None. Every step has actual code or commands. ✓

**3. Type consistency:**
- `runAgentLoop(client, query, queue, state, cfg, hooks?)` — used consistently in Tasks 8, 9, 10, 12, 13.
- `buildTools(query, queue, state, phase)` — used consistently in Tasks 6, 8.
- `ReportState` re-exported from `./tools` (Task 6), imported in tests as `import type { ReportState } from '../tools'`. ✓
- `AgentPhase` exported from `tools/index.ts` (Task 6), imported in `loop.ts` (Task 8). ✓
- `buildPlanPin` returns `{role: 'system', content: string}` — used in Task 8 with `as ChatCompletionMessageParam` cast. ✓
- Hint helper exports: `buildWebSearchHint`, `buildFetchUrlHint`, `buildParseHtmlHint`, `buildSearchSourceHint`, `buildReportResultsHint` — each defined and tested in their respective tasks. ✓
- `RECON_BUDGET = 10` and `REVISE_MIN_EXECUTE_TURNS = 2` — module-level consts in `loop.ts` (Task 8). Task 12 uses `REVISE_MIN_EXECUTE_TURNS` from the same file. ✓

Plan complete and self-reviewed.
