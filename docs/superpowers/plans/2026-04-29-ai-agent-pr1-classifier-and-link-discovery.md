# AI-Agent PR1 — Classifier + Link Discovery + Deterministic Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the strictly-additive foundation layer of the AI-agent overhaul: a server-side page-type classifier, link-discovery scorers, an aggregator registry, and a refactor of `extract_contacts` into a deterministic-first strategy chain. No LLM-visible behavior changes; existing 95 tests stay green and new ones cover the new modules.

**Architecture:** Six new internal helpers, no new LLM-facing tools. `classify_page(url)` server-side fetches + cheerio-parses a URL into a `ClassifiedPage` (page type, candidate blocks, JSON-LD, contact/aggregator/branch link candidates). Link scorers (`scoreContactLink`, `scoreAggregatorLink`) run over outbound `<a>`s. A small JSON-driven `aggregator-registry` identifies known directory domains. `extract_contacts` is restructured into a strategy sequence (JSON-LD → microdata → semantic HTML → regex) but its public Tool surface stays identical so the loop and prompt do not change.

**Tech Stack:** TypeScript, Node 20, cheerio 1.0, axios 1.7 (already wrapped by `sources/http.ts`), Jest 30 (ts-jest).

**Spec reference:** `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` §3.2, §3.3, §3.4, PR1.

---

## File Structure

All new files under `examples/scraper-node/src/sources/ai-agent/`. Internal helpers, not LLM-facing tools (those land in PR4).

| File | Responsibility |
|---|---|
| `aggregator-registry.ts` | The known-aggregator JSON list and a `matchAggregator(url)` lookup. |
| `aggregator-registry.json` | Static registry data: `[{ domain, confidence, notes? }]`. |
| `link-scorers.ts` | `scoreContactLink($a, baseUrl)` and `scoreAggregatorLink($a, baseUrl)`. Returns `ScoredLink \| null`. |
| `classify-page.ts` | `classifyPage(url, opts?)` — orchestrates fetch + cheerio + scorers + signal collection. Returns `ClassifiedPage`. |
| `page-types.ts` | Shared types: `PageType`, `ScoredLink`, `Block`, `ClassifiedPage`. |
| `tools/extraction-strategies.ts` | Pure functions: `extractFromJsonLd`, `extractFromMicrodata`, `extractFromSemanticHtml`, `extractFromRegex`. Each takes a `cheerio.CheerioAPI` (and optionally pre-parsed JSON-LD) and returns `Partial<ExtractionResult>`. |
| `tools/extract-contacts.ts` | **Modified.** Reorganizes the body of `handler` to call the strategies in order; merges results; returns the same shape as today plus a new `strategiesFired: string[]` field. The Tool definition (name/description/parameters) is unchanged. |

Tests:

| File | Covers |
|---|---|
| `aggregator-registry.test.ts` | registry shape, `matchAggregator` for known/unknown URLs |
| `link-scorers.test.ts` | scoring rules, threshold filtering, same-origin enforcement |
| `classify-page.test.ts` | each `PageType` classification on fixture HTML; signal collection |
| `extraction-strategies.test.ts` | each strategy in isolation against fixture HTML |
| (existing) `extract-contacts.test.ts` | stays green with the refactor; new test cases added for `strategiesFired` |

Fixtures (cheerio-loadable HTML strings, inline in tests where short, dedicated `.html` files where long):

`examples/scraper-node/src/sources/ai-agent/__fixtures__/`:
- `aggregator-serp-zoon.html` — synthetic SERP with 3 LocalBusiness JSON-LD entries + pagination.
- `aggregator-detail-zoon.html` — single LocalBusiness on zoon-shaped breadcrumb.
- `org-site-clinic.html` — semantic HTML: `<header>` phone, `<footer>` address, `<a href="/contacts">`.
- `org-site-tailwind.html` — same content but utility-class soup, no semantic HTML.
- `aggregator-landing-zoon.html` — bare homepage, registry-domain.
- `other-blog-post.html` — long-form article with one phone in body.

Use lowercase-kebab filenames; `__fixtures__/` is a Jest-conventional name and gets ignored by `transformIgnorePatterns` automatically.

---

## Decisions Locked Before Implementation

- **`classify_page` is internal in this PR.** Not exposed as a Tool. The existing agent loop is untouched.
- **`fetch_url` 15K cap is unchanged.** The cap stays on what the LLM sees. New helpers (`classifyPage`) bypass the cap because they consume cheerio output server-side, never returning raw HTML to the model.
- **No new prompt strings.** `prompts.ts` not modified.
- **Aggregator registry initial entries:** `zoon.ru`, `yandex.ru/maps`, `2gis.ru`, `flamp.ru`, `yell.ru`, `spr.ru`, `orgpage.ru`, `rusprofile.ru`. JSON file, not a `.ts` literal — easier to extend later by PR.
- **Strategy order in `extract-contacts`:** JSON-LD → microdata → semantic HTML → regex. Each strategy returns a partial; results are unioned into sets and deduped (today's behavior); `strategiesFired` records which contributed non-empty data.
- **The existing `ExtractResult` shape (`extract-contacts.ts:5-12`) is preserved** with one optional addition: `strategiesFired?: string[]`. No callers break.
- **Worktree:** `.worktrees/ai-agent-classifier`, branch `feature/ai-agent-classifier`. Already created and `npm install`ed; baseline 95 ai-agent tests green.

---

## Task 1: Page-types module — shared TypeScript types

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/page-types.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/page-types.test.ts`:

```typescript
import type { PageType, ScoredLink, Block, ClassifiedPage } from '../page-types'

describe('page-types module', () => {
    it('exports PageType union with the five expected variants', () => {
        const _exhaustive: Record<PageType, true> = {
            'aggregator-landing': true,
            'aggregator-serp': true,
            'aggregator-detail': true,
            'org-site': true,
            'other': true,
        }
        expect(Object.keys(_exhaustive).length).toBe(5)
    })

    it('ScoredLink has url, score, reason, kind', () => {
        const link: ScoredLink = { url: 'https://x', score: 0.8, reason: 'r', kind: 'contact-page' }
        expect(link.kind).toBe('contact-page')
    })

    it('Block has selector, text, optional tels and mails', () => {
        const block: Block = { selector: 'footer', text: 'foo', tels: ['+7'], mails: ['a@b'] }
        expect(block.tels).toEqual(['+7'])
    })

    it('ClassifiedPage has all required fields', () => {
        const cp: ClassifiedPage = {
            url: 'https://x',
            pageType: 'org-site',
            confidence: 0.9,
            signals: [],
            cleanedText: '',
            candidateBlocks: [],
            jsonLdBlobs: [],
            contactCandidates: [],
            aggregatorCandidates: [],
            branchCandidates: [],
        }
        expect(cp.pageType).toBe('org-site')
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `examples/scraper-node/`:
```bash
npx jest src/sources/ai-agent/__tests__/page-types.test.ts -v
```
Expected: FAIL with "Cannot find module '../page-types'".

- [ ] **Step 3: Implement the page-types module**

Create `examples/scraper-node/src/sources/ai-agent/page-types.ts`:

```typescript
export type PageType =
    | 'aggregator-landing'
    | 'aggregator-serp'
    | 'aggregator-detail'
    | 'org-site'
    | 'other'

export type LinkKind =
    | 'contact-page'
    | 'aggregator'
    | 'branch'

export interface ScoredLink {
    url: string
    score: number
    reason: string
    kind: LinkKind
}

export interface Block {
    selector: string
    text: string
    tels?: string[]
    mails?: string[]
}

export interface ClassifiedPage {
    url: string
    pageType: PageType
    confidence: number
    signals: string[]
    cleanedText: string
    candidateBlocks: Block[]
    jsonLdBlobs: unknown[]
    nextDataBlob?: unknown
    contactCandidates: ScoredLink[]
    aggregatorCandidates: ScoredLink[]
    branchCandidates: ScoredLink[]
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/sources/ai-agent/__tests__/page-types.test.ts -v
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/page-types.ts \
        examples/scraper-node/src/sources/ai-agent/__tests__/page-types.test.ts
git commit -m "feat(ai-agent): add page-types module"
```

---

## Task 2: Aggregator registry — JSON data

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/aggregator-registry.json`

- [ ] **Step 1: Create the JSON registry**

Create `examples/scraper-node/src/sources/ai-agent/aggregator-registry.json`:

```json
[
    { "domain": "zoon.ru", "confidence": 1.0, "notes": "Russia-wide multi-category org directory" },
    { "domain": "yandex.ru/maps", "confidence": 1.0, "notes": "Yandex Maps; structured business listings" },
    { "domain": "2gis.ru", "confidence": 0.9, "notes": "Russia + CIS local directory" },
    { "domain": "flamp.ru", "confidence": 0.9, "notes": "Russian review aggregator" },
    { "domain": "yell.ru", "confidence": 0.8, "notes": "Russian Yellow Pages" },
    { "domain": "spr.ru", "confidence": 0.8, "notes": "Russian business directory" },
    { "domain": "orgpage.ru", "confidence": 0.8, "notes": "Russian org directory" },
    { "domain": "rusprofile.ru", "confidence": 0.7, "notes": "Russian legal-entity registry; partial contacts" }
]
```

- [ ] **Step 2: Commit (no tests yet — registry covered by Task 3)**

```bash
git add examples/scraper-node/src/sources/ai-agent/aggregator-registry.json
git commit -m "feat(ai-agent): add aggregator registry JSON"
```

---

## Task 3: Aggregator registry — lookup module

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/aggregator-registry.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/__tests__/aggregator-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/aggregator-registry.test.ts`:

```typescript
import { matchAggregator, listAggregators, type AggregatorEntry } from '../aggregator-registry'

describe('aggregator-registry', () => {
    it('matches a known top-level aggregator domain', () => {
        const m = matchAggregator('https://zoon.ru/spb/medical/')
        expect(m).not.toBeNull()
        expect(m?.domain).toBe('zoon.ru')
        expect(m?.confidence).toBe(1.0)
    })

    it('matches a path-prefixed entry like yandex.ru/maps', () => {
        const m = matchAggregator('https://yandex.ru/maps/2/saint-petersburg/search/')
        expect(m?.domain).toBe('yandex.ru/maps')
    })

    it('does not match a yandex.ru subpath that is not /maps', () => {
        expect(matchAggregator('https://yandex.ru/news/')).toBeNull()
    })

    it('returns null for unknown domains', () => {
        expect(matchAggregator('https://acme-clinic.ru/')).toBeNull()
    })

    it('handles www. prefix transparently', () => {
        const m = matchAggregator('https://www.zoon.ru/')
        expect(m?.domain).toBe('zoon.ru')
    })

    it('lists all aggregator entries', () => {
        const list = listAggregators()
        expect(Array.isArray(list)).toBe(true)
        expect(list.length).toBeGreaterThanOrEqual(8)
        expect(list.every((e: AggregatorEntry) =>
            typeof e.domain === 'string' && typeof e.confidence === 'number'
        )).toBe(true)
    })

    it('returns a defensive copy from listAggregators', () => {
        const a = listAggregators()
        const b = listAggregators()
        expect(a).not.toBe(b)
    })

    it('rejects malformed input gracefully', () => {
        expect(matchAggregator('not-a-url')).toBeNull()
        expect(matchAggregator('')).toBeNull()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/__tests__/aggregator-registry.test.ts -v
```
Expected: FAIL with "Cannot find module '../aggregator-registry'".

- [ ] **Step 3: Implement the registry module**

Create `examples/scraper-node/src/sources/ai-agent/aggregator-registry.ts`:

```typescript
import registryJson from './aggregator-registry.json'

export interface AggregatorEntry {
    domain: string
    confidence: number
    notes?: string
}

const REGISTRY: ReadonlyArray<AggregatorEntry> = Object.freeze(
    (registryJson as AggregatorEntry[]).map(e => Object.freeze({ ...e })),
)

/** Strip leading `www.` from a host. */
function normalizeHost(host: string): string {
    return host.replace(/^www\./i, '').toLowerCase()
}

/**
 * Match a URL against the aggregator registry. Returns the first matching
 * entry by `domain` (which may include a path prefix like `yandex.ru/maps`),
 * or null if no entry matches.
 */
export function matchAggregator(url: string): AggregatorEntry | null {
    if (!url) return null
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    const host = normalizeHost(parsed.hostname)
    const pathname = parsed.pathname || '/'

    for (const entry of REGISTRY) {
        const slash = entry.domain.indexOf('/')
        if (slash === -1) {
            if (host === entry.domain) return entry
        } else {
            const entryHost = entry.domain.slice(0, slash)
            const entryPath = entry.domain.slice(slash) // includes leading '/'
            if (host === entryHost && pathname.startsWith(entryPath)) return entry
        }
    }
    return null
}

/** Return a defensive copy of all entries. */
export function listAggregators(): AggregatorEntry[] {
    return REGISTRY.map(e => ({ ...e }))
}
```

- [ ] **Step 4: Configure JSON imports for ts-jest if not already**

Check `examples/scraper-node/tsconfig.json`:
```bash
grep -E '"resolveJsonModule"|"esModuleInterop"' examples/scraper-node/tsconfig.json
```
Expected: both `true`. If `resolveJsonModule` is missing, add it under `compilerOptions`.

(Auditor note: scraper-node's tsconfig already has `resolveJsonModule: true` based on its build working with other JSON imports. Verify, do not assume.)

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx jest src/sources/ai-agent/__tests__/aggregator-registry.test.ts -v
```
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/aggregator-registry.ts \
        examples/scraper-node/src/sources/ai-agent/__tests__/aggregator-registry.test.ts
git commit -m "feat(ai-agent): add aggregator-registry lookup module"
```

---

## Task 4: Link scorers — contact-page and aggregator scoring

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/link-scorers.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/__tests__/link-scorers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/link-scorers.test.ts`:

```typescript
import * as cheerio from 'cheerio'
import { scoreContactLink, scoreAggregatorLink } from '../link-scorers'

const BASE = 'https://acme-clinic.ru/'

function loadAnchor(html: string): cheerio.Cheerio<any> {
    const $ = cheerio.load(`<html><body>${html}</body></html>`)
    return $('a').first()
}

describe('scoreContactLink', () => {
    it('scores a /contacts path link high', () => {
        const $ = cheerio.load(`<html><body><footer><a href="/contacts">Контакты</a></footer></body></html>`)
        const $a = $('a').first()
        const link = scoreContactLink($a, $, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThan(0.8)
        expect(link!.kind).toBe('contact-page')
        expect(link!.url).toBe('https://acme-clinic.ru/contacts')
    })

    it('scores Cyrillic /контакты path with anchor text', () => {
        const $ = cheerio.load(`<html><body><a href="/контакты">Связаться</a></body></html>`)
        const $a = $('a').first()
        const link = scoreContactLink($a, $, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThanOrEqual(0.6)
    })

    it('rejects cross-origin contact links', () => {
        const $ = cheerio.load(`<html><body><a href="https://other-site.ru/contacts">Contacts</a></body></html>`)
        const $a = $('a').first()
        expect(scoreContactLink($a, $, BASE)).toBeNull()
    })

    it('returns null for a link below threshold', () => {
        const $ = cheerio.load(`<html><body><a href="/random">Random</a></body></html>`)
        const $a = $('a').first()
        expect(scoreContactLink($a, $, BASE)).toBeNull()
    })

    it('boosts links inside <footer>', () => {
        const $f = cheerio.load(`<html><body><footer><a href="/about">О нас</a></footer></body></html>`)
        const linkInFooter = scoreContactLink($f('a').first(), $f, BASE)
        const $h = cheerio.load(`<html><body><a href="/about">О нас</a></body></html>`)
        const linkPlain = scoreContactLink($h('a').first(), $h, BASE)
        expect(linkInFooter).not.toBeNull()
        // /about scores 0.6 base + 0.3 anchor (О нас does NOT match) => 0.6
        // in footer: +0.2 => 0.8 vs plain 0.6
        expect(linkInFooter!.score).toBeGreaterThan(linkPlain?.score ?? 0)
    })

    it('skips anchors with empty href', () => {
        const $ = cheerio.load(`<html><body><a>No href</a></body></html>`)
        const $a = $('a').first()
        expect(scoreContactLink($a, $, BASE)).toBeNull()
    })
})

describe('scoreAggregatorLink', () => {
    it('scores a known-aggregator-domain link via registry confidence', () => {
        const $ = cheerio.load(`<html><body><a href="https://zoon.ru/spb/">Каталог</a></body></html>`)
        const $a = $('a').first()
        const link = scoreAggregatorLink($a, $, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThanOrEqual(0.8)
        expect(link!.kind).toBe('aggregator')
    })

    it('scores a /catalog/ path link from an unknown domain', () => {
        const $ = cheerio.load(`<html><body><a href="https://some-directory.ru/catalog/dentists">Каталог</a></body></html>`)
        const $a = $('a').first()
        const link = scoreAggregatorLink($a, $, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThan(0.5)
    })

    it('returns null for a generic same-origin link', () => {
        const $ = cheerio.load(`<html><body><a href="/about">About</a></body></html>`)
        const $a = $('a').first()
        expect(scoreAggregatorLink($a, $, BASE)).toBeNull()
    })

    it('handles relative URLs by resolving against base', () => {
        const $ = cheerio.load(`<html><body><a href="/catalog/x">Каталог</a></body></html>`)
        const $a = $('a').first()
        const link = scoreAggregatorLink($a, $, BASE)
        // same-origin /catalog → should score path heuristic
        expect(link).not.toBeNull()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/__tests__/link-scorers.test.ts -v
```
Expected: FAIL with "Cannot find module '../link-scorers'".

- [ ] **Step 3: Implement the scorers**

Create `examples/scraper-node/src/sources/ai-agent/link-scorers.ts`:

```typescript
import type * as cheerio from 'cheerio'
import { matchAggregator } from './aggregator-registry'
import type { ScoredLink } from './page-types'

const CONTACT_PATH_RE = /\/(contact|контакт|kontakt|address|адрес|about|о[- _]?компании|locations|branch)/i
const CONTACT_ANCHOR_RE = /(контакт|связь|address|адрес|телефон|phone|contact)/i

const AGGREGATOR_PATH_RE = /\/(catalog|firms|companies|listings|directory|каталог|справочник)/i
const AGGREGATOR_ANCHOR_RE = /(каталог|справочник|directory|listings|companies)/i

const CONTACT_THRESHOLD = 0.3
const AGGREGATOR_THRESHOLD = 0.5

function resolveHref(href: string, baseUrl: string): string | null {
    if (!href) return null
    try {
        return new URL(href, baseUrl).toString()
    } catch {
        return null
    }
}

function isSameOrigin(a: string, b: string): boolean {
    try {
        return new URL(a).origin === new URL(b).origin
    } catch {
        return false
    }
}

function isInside($a: cheerio.Cheerio<any>, $: cheerio.CheerioAPI, selector: string): boolean {
    return $a.closest(selector).length > 0
}

export function scoreContactLink(
    $a: cheerio.Cheerio<any>,
    $: cheerio.CheerioAPI,
    baseUrl: string,
): ScoredLink | null {
    const href = ($a.attr('href') ?? '').trim()
    const url = resolveHref(href, baseUrl)
    if (!url) return null
    if (!isSameOrigin(url, baseUrl)) return null

    const text = ($a.text() ?? '').trim()
    let score = 0
    const reasons: string[] = []

    const path = (() => {
        try { return new URL(url).pathname } catch { return '' }
    })()

    if (CONTACT_PATH_RE.test(path)) { score += 0.6; reasons.push('path') }
    if (CONTACT_ANCHOR_RE.test(text)) { score += 0.3; reasons.push('anchor') }
    if (isInside($a, $, 'footer')) { score += 0.2; reasons.push('footer') }
    else if (isInside($a, $, 'header,nav')) { score += 0.1; reasons.push('header/nav') }

    if (score < CONTACT_THRESHOLD) return null

    return {
        url,
        score: Math.round(score * 100) / 100,
        reason: reasons.join('+'),
        kind: 'contact-page',
    }
}

export function scoreAggregatorLink(
    $a: cheerio.Cheerio<any>,
    $: cheerio.CheerioAPI,
    baseUrl: string,
): ScoredLink | null {
    const href = ($a.attr('href') ?? '').trim()
    const url = resolveHref(href, baseUrl)
    if (!url) return null

    const text = ($a.text() ?? '').trim()
    let score = 0
    const reasons: string[] = []

    const matched = matchAggregator(url)
    if (matched) {
        score += matched.confidence
        reasons.push(`registry:${matched.domain}`)
    } else {
        const path = (() => {
            try { return new URL(url).pathname } catch { return '' }
        })()
        if (AGGREGATOR_PATH_RE.test(path)) { score += 0.5; reasons.push('path') }
        if (AGGREGATOR_ANCHOR_RE.test(text)) { score += 0.2; reasons.push('anchor') }
    }

    if (score < AGGREGATOR_THRESHOLD) return null

    return {
        url,
        score: Math.round(score * 100) / 100,
        reason: reasons.join('+'),
        kind: 'aggregator',
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/sources/ai-agent/__tests__/link-scorers.test.ts -v
```
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/link-scorers.ts \
        examples/scraper-node/src/sources/ai-agent/__tests__/link-scorers.test.ts
git commit -m "feat(ai-agent): add link scorers for contact and aggregator candidates"
```

---

## Task 5: Page classifier — classify-page module

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/classify-page.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/__tests__/classify-page.test.ts`
- Create fixtures under `examples/scraper-node/src/sources/ai-agent/__fixtures__/`

- [ ] **Step 1: Create fixture HTML files**

Create `examples/scraper-node/src/sources/ai-agent/__fixtures__/aggregator-serp-zoon.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
    <title>Стоматологии в Санкт-Петербурге — Zoon</title>
    <link rel="canonical" href="https://zoon.ru/spb/medical/">
</head>
<body>
    <nav><a href="/">Главная</a> / <a href="/spb/">СПб</a> / Стоматологии</nav>
    <main>
        <article class="card">
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"LocalBusiness","name":"Стом-Клиника А","telephone":"+7 (812) 100-10-10"}
            </script>
            <h3><a href="/spb/medical/clinic-a/">Стом-Клиника А</a></h3>
        </article>
        <article class="card">
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"LocalBusiness","name":"Стом-Клиника Б","telephone":"+7 (812) 200-20-20"}
            </script>
            <h3><a href="/spb/medical/clinic-b/">Стом-Клиника Б</a></h3>
        </article>
        <article class="card">
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"LocalBusiness","name":"Стом-Клиника В","telephone":"+7 (812) 300-30-30"}
            </script>
            <h3><a href="/spb/medical/clinic-c/">Стом-Клиника В</a></h3>
        </article>
        <nav class="pagination"><a href="?page=2">2</a><a href="?page=3">3</a></nav>
    </main>
</body>
</html>
```

Create `examples/scraper-node/src/sources/ai-agent/__fixtures__/aggregator-detail-zoon.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head><title>Стом-Клиника А — Zoon</title></head>
<body>
    <nav>Главная / СПб / Стоматологии / Стом-Клиника А</nav>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"LocalBusiness","name":"Стом-Клиника А","telephone":"+7 (812) 100-10-10","address":{"@type":"PostalAddress","streetAddress":"ул. Ленина, 1"}}
    </script>
    <h1>Стом-Клиника А</h1>
    <p>Адрес: ул. Ленина, 1</p>
    <p>Телефон: <a href="tel:+78121001010">+7 (812) 100-10-10</a></p>
    <a href="https://clinic-a.ru/" rel="nofollow">Сайт</a>
</body>
</html>
```

Create `examples/scraper-node/src/sources/ai-agent/__fixtures__/aggregator-landing-zoon.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head><title>Zoon — Каталог организаций</title></head>
<body>
    <header><h1>Zoon</h1><nav><a href="/spb/">СПб</a><a href="/msk/">Москва</a></nav></header>
    <main>
        <h2>Популярные категории</h2>
        <ul><li><a href="/spb/medical/">Медицина</a></li><li><a href="/spb/auto/">Авто</a></li></ul>
    </main>
    <footer><p>&copy; Zoon</p></footer>
</body>
</html>
```

Create `examples/scraper-node/src/sources/ai-agent/__fixtures__/org-site-clinic.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head><title>Стом-Клиника А — Стоматология в СПб</title></head>
<body>
    <header>
        <h1>Стом-Клиника А</h1>
        <a href="tel:+78121001010">+7 (812) 100-10-10</a>
    </header>
    <nav>
        <a href="/about">О нас</a>
        <a href="/services">Услуги</a>
        <a href="/contacts">Контакты</a>
    </nav>
    <main><p>Современная стоматология в Санкт-Петербурге.</p></main>
    <footer>
        <address itemprop="address">г. Санкт-Петербург, ул. Ленина, 1</address>
        <a href="mailto:info@clinic-a.ru">info@clinic-a.ru</a>
    </footer>
</body>
</html>
```

Create `examples/scraper-node/src/sources/ai-agent/__fixtures__/other-blog-post.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head><title>10 советов по выбору стоматолога — Блог</title></head>
<body>
    <article>
        <h1>10 советов по выбору стоматолога</h1>
        <p>Когда выбираете стоматолога, обращайте внимание на отзывы. Можно позвонить +7 (812) 555-55-55 для консультации.</p>
        <p>Текст продолжается на много абзацев...</p>
    </article>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/__tests__/classify-page.test.ts`:

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { classifyPageFromHtml } from '../classify-page'

const FIXTURES = path.join(__dirname, '..', '__fixtures__')

function loadFixture(name: string): string {
    return fs.readFileSync(path.join(FIXTURES, name), 'utf-8')
}

describe('classifyPageFromHtml', () => {
    it('classifies a Zoon SERP as aggregator-serp with high confidence', () => {
        const html = loadFixture('aggregator-serp-zoon.html')
        const result = classifyPageFromHtml('https://zoon.ru/spb/medical/', html)

        expect(result.pageType).toBe('aggregator-serp')
        expect(result.confidence).toBeGreaterThan(0.7)
        expect(result.signals).toEqual(expect.arrayContaining([
            expect.stringMatching(/jsonld-localbusiness/),
        ]))
        expect(result.jsonLdBlobs.length).toBe(3)
    })

    it('classifies a Zoon detail page as aggregator-detail', () => {
        const html = loadFixture('aggregator-detail-zoon.html')
        const result = classifyPageFromHtml('https://zoon.ru/spb/medical/clinic-a/', html)

        expect(result.pageType).toBe('aggregator-detail')
        expect(result.jsonLdBlobs.length).toBe(1)
    })

    it('classifies a Zoon homepage as aggregator-landing', () => {
        const html = loadFixture('aggregator-landing-zoon.html')
        const result = classifyPageFromHtml('https://zoon.ru/', html)

        expect(result.pageType).toBe('aggregator-landing')
    })

    it('classifies an org-site clinic page', () => {
        const html = loadFixture('org-site-clinic.html')
        const result = classifyPageFromHtml('https://clinic-a.ru/', html)

        expect(result.pageType).toBe('org-site')
        expect(result.contactCandidates.length).toBeGreaterThanOrEqual(1)
        expect(result.contactCandidates.some(c => c.url === 'https://clinic-a.ru/contacts')).toBe(true)
    })

    it('classifies a long blog post as other', () => {
        const html = loadFixture('other-blog-post.html')
        const result = classifyPageFromHtml('https://blog.example.com/dentist-tips/', html)

        expect(result.pageType).toBe('other')
    })

    it('populates cleanedText for downstream extraction', () => {
        const html = loadFixture('org-site-clinic.html')
        const result = classifyPageFromHtml('https://clinic-a.ru/', html)
        expect(result.cleanedText.length).toBeGreaterThan(0)
        expect(result.cleanedText).not.toContain('<')  // tags stripped
    })

    it('extracts aggregator candidate links from an org page that links to zoon', () => {
        const html = `<html><body>
            <main>About us.</main>
            <footer><a href="https://zoon.ru/spb/medical/clinic-a/">Мы на Zoon</a></footer>
        </body></html>`
        const result = classifyPageFromHtml('https://clinic-a.ru/', html)
        expect(result.aggregatorCandidates.some(c => c.url.startsWith('https://zoon.ru/'))).toBe(true)
    })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/__tests__/classify-page.test.ts -v
```
Expected: FAIL with "Cannot find module '../classify-page'".

- [ ] **Step 4: Implement the classifier**

Create `examples/scraper-node/src/sources/ai-agent/classify-page.ts`:

```typescript
import * as cheerio from 'cheerio'
import { httpGet } from '../http'
import { matchAggregator } from './aggregator-registry'
import { scoreContactLink, scoreAggregatorLink } from './link-scorers'
import { log } from '@cmd-hub/common'
import type { ClassifiedPage, PageType, ScoredLink, Block } from './page-types'

const TOP_K_LINKS = 5

interface ClassificationDraft {
    pageType: PageType
    confidence: number
    signals: string[]
}

function parseJsonLd($: cheerio.CheerioAPI): unknown[] {
    const blobs: unknown[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim()
        if (!raw) return
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) blobs.push(...parsed)
            else blobs.push(parsed)
        } catch {
            // malformed JSON-LD; ignore. Note: not fatal — sites ship broken LD often.
        }
    })
    return blobs
}

function isLocalBusiness(blob: unknown): boolean {
    if (!blob || typeof blob !== 'object') return false
    const t = (blob as any)['@type']
    if (typeof t === 'string') return /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(t)
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(x))
    return false
}

function parseNextData($: cheerio.CheerioAPI): unknown | undefined {
    const raw = $('script#__NEXT_DATA__').contents().text().trim()
    if (!raw) return undefined
    try {
        return JSON.parse(raw)
    } catch {
        return undefined
    }
}

function buildCleanedText($: cheerio.CheerioAPI): string {
    const $clone = cheerio.load($.html())
    $clone('script, style, noscript').remove()
    return $clone('body').text().replace(/\s+/g, ' ').trim()
}

function buildCandidateBlocks($: cheerio.CheerioAPI): Block[] {
    const blocks: Block[] = []
    for (const sel of ['header', 'footer', '[class*="contact"]', '[class*="footer"]']) {
        $(sel).each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim()
            if (!text) return
            const tels: string[] = []
            const mails: string[] = []
            $(el).find('a[href^="tel:"]').each((_, a) => {
                const h = $(a).attr('href')
                if (h) tels.push(h.replace(/^tel:/i, '').trim())
            })
            $(el).find('a[href^="mailto:"]').each((_, a) => {
                const h = $(a).attr('href')
                if (h) mails.push(h.replace(/^mailto:/i, '').trim())
            })
            blocks.push({ selector: sel, text, tels, mails })
        })
    }
    return blocks
}

function discoverLinks(
    $: cheerio.CheerioAPI,
    baseUrl: string,
): { contacts: ScoredLink[], aggregators: ScoredLink[] } {
    const contacts: ScoredLink[] = []
    const aggregators: ScoredLink[] = []
    const seenContact = new Set<string>()
    const seenAggregator = new Set<string>()

    $('a[href]').each((_, el) => {
        const $a = $(el)
        const c = scoreContactLink($a, $, baseUrl)
        if (c && !seenContact.has(c.url)) {
            seenContact.add(c.url)
            contacts.push(c)
        }
        const a = scoreAggregatorLink($a, $, baseUrl)
        if (a && !seenAggregator.has(a.url)) {
            seenAggregator.add(a.url)
            aggregators.push(a)
        }
    })

    contacts.sort((a, b) => b.score - a.score)
    aggregators.sort((a, b) => b.score - a.score)
    return {
        contacts: contacts.slice(0, TOP_K_LINKS),
        aggregators: aggregators.slice(0, TOP_K_LINKS),
    }
}

function classifyShape(
    url: string,
    $: cheerio.CheerioAPI,
    jsonLd: unknown[],
): ClassificationDraft {
    const signals: string[] = []
    const localBusinessCount = jsonLd.filter(isLocalBusiness).length

    const aggregatorEntry = matchAggregator(url)
    const onAggregatorDomain = aggregatorEntry !== null
    if (onAggregatorDomain) signals.push(`registry:${aggregatorEntry.domain}`)

    if (localBusinessCount >= 3) signals.push(`jsonld-localbusiness:${localBusinessCount}`)
    else if (localBusinessCount === 1) signals.push('jsonld-localbusiness:1')

    const cardCount = $('article, [class*="card"]').length
    if (cardCount >= 5) signals.push(`cards:${cardCount}`)

    const hasPagination = $('a[href*="page="], [class*="pagination"] a').length > 0
    if (hasPagination) signals.push('pagination')

    const breadcrumb = $('nav, [class*="breadcrumb"]').first().text()
    const breadcrumbDeep = breadcrumb.split('/').filter(s => s.trim()).length >= 3
    if (breadcrumbDeep) signals.push('breadcrumb-deep')

    let path = ''
    try { path = new URL(url).pathname } catch { /* ignore */ }
    const pathLooksList = /\/(catalog|firms|companies|listings|directory|каталог|справочник)/i.test(path)
    if (pathLooksList) signals.push('path-list-shaped')

    // SERP: many cards or many LocalBusiness + (pagination or list-shaped path) — typically on aggregator
    if (
        (localBusinessCount >= 3 || cardCount >= 5) &&
        (hasPagination || pathLooksList || onAggregatorDomain)
    ) {
        return { pageType: 'aggregator-serp', confidence: 0.85, signals }
    }

    // Detail: 1 LocalBusiness on aggregator domain with deep breadcrumb
    if (localBusinessCount === 1 && onAggregatorDomain && breadcrumbDeep) {
        return { pageType: 'aggregator-detail', confidence: 0.85, signals }
    }

    // Landing: aggregator domain, root path or shallow, no business records
    if (onAggregatorDomain && localBusinessCount === 0 && (path === '/' || path.length <= 5)) {
        return { pageType: 'aggregator-landing', confidence: 0.8, signals }
    }

    // Org site: not on aggregator domain, has tel:/mailto: links or has 1 LocalBusiness
    const hasTel = $('a[href^="tel:"]').length > 0
    const hasMail = $('a[href^="mailto:"]').length > 0
    if (!onAggregatorDomain && (hasTel || hasMail || localBusinessCount === 1)) {
        if (hasTel) signals.push('tel-link')
        if (hasMail) signals.push('mailto-link')
        return { pageType: 'org-site', confidence: 0.75, signals }
    }

    return { pageType: 'other', confidence: 0.5, signals }
}

/** Pure function over an HTML string — easy to unit-test against fixtures. */
export function classifyPageFromHtml(url: string, html: string): ClassifiedPage {
    const $ = cheerio.load(html)
    const jsonLd = parseJsonLd($)
    const nextData = parseNextData($)
    const draft = classifyShape(url, $, jsonLd)
    const cleanedText = buildCleanedText($)
    const candidateBlocks = buildCandidateBlocks($)
    const { contacts, aggregators } = discoverLinks($, url)

    return {
        url,
        pageType: draft.pageType,
        confidence: draft.confidence,
        signals: draft.signals,
        cleanedText,
        candidateBlocks,
        jsonLdBlobs: jsonLd,
        nextDataBlob: nextData,
        contactCandidates: contacts,
        aggregatorCandidates: aggregators,
        branchCandidates: [], // Branch enumeration deferred to PR4
    }
}

/** Network-fetching wrapper. Same-shape return as the pure variant. */
export async function classifyPage(
    url: string,
    opts?: { signal?: AbortSignal },
): Promise<ClassifiedPage> {
    log.trace(`ai-agent.classifyPage: ${url}`)
    const res = await httpGet(url, {
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        validateStatus: s => s < 600,
        signal: opts?.signal,
    })
    if (res.status >= 400) {
        return {
            url,
            pageType: 'other',
            confidence: 0,
            signals: [`http-${res.status}`],
            cleanedText: '',
            candidateBlocks: [],
            jsonLdBlobs: [],
            contactCandidates: [],
            aggregatorCandidates: [],
            branchCandidates: [],
        }
    }
    const html = typeof res.data === 'string' ? res.data : String(res.data ?? '')
    return classifyPageFromHtml(url, html)
}
```

- [ ] **Step 5: Run the classify-page tests to verify they pass**

```bash
npx jest src/sources/ai-agent/__tests__/classify-page.test.ts -v
```
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the full ai-agent test suite to verify no regressions**

```bash
npx jest src/sources/ai-agent
```
Expected: ≥ 95 + 4 + 8 + 10 + 7 = 124 tests passing, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/classify-page.ts \
        examples/scraper-node/src/sources/ai-agent/__tests__/classify-page.test.ts \
        examples/scraper-node/src/sources/ai-agent/__fixtures__/
git commit -m "feat(ai-agent): add page-type classifier with link discovery"
```

---

## Task 6: Extraction strategies — pure functions

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/tools/extraction-strategies.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extraction-strategies.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extraction-strategies.test.ts`:

```typescript
import * as cheerio from 'cheerio'
import {
    extractFromJsonLd,
    extractFromMicrodata,
    extractFromSemanticHtml,
    extractFromRegex,
} from '../extraction-strategies'

describe('extractFromJsonLd', () => {
    it('extracts name, telephone, email, address from a LocalBusiness blob', () => {
        const blob = {
            '@type': 'LocalBusiness',
            name: 'Стом-Клиника А',
            telephone: '+7 (812) 100-10-10',
            email: 'info@clinic-a.ru',
            address: { '@type': 'PostalAddress', streetAddress: 'ул. Ленина, 1' },
        }
        const r = extractFromJsonLd([blob])
        expect(r.candidateName).toBe('Стом-Клиника А')
        expect(r.phones).toContain('+78121001010')
        expect(r.emails).toContain('info@clinic-a.ru')
        expect(r.addresses?.[0]).toMatch(/Ленина/)
    })

    it('handles an array of LocalBusiness blobs', () => {
        const blobs = [
            { '@type': 'LocalBusiness', name: 'A', telephone: '+78121001010' },
            { '@type': 'LocalBusiness', name: 'B', telephone: '+78122002020' },
        ]
        const r = extractFromJsonLd(blobs)
        expect(r.phones).toEqual(expect.arrayContaining(['+78121001010', '+78122002020']))
    })

    it('returns empty result when no LocalBusiness present', () => {
        const r = extractFromJsonLd([{ '@type': 'WebPage' }])
        expect(r.phones ?? []).toHaveLength(0)
    })

    it('handles malformed entries without throwing', () => {
        expect(() => extractFromJsonLd([null, undefined, 'string', 42])).not.toThrow()
    })
})

describe('extractFromMicrodata', () => {
    it('extracts itemprop="address"', () => {
        const $ = cheerio.load('<div itemprop="address">ул. Тверская, 7</div>')
        const r = extractFromMicrodata($)
        expect(r.addresses).toContain('ул. Тверская, 7')
    })

    it('extracts itemprop="telephone"', () => {
        const $ = cheerio.load('<span itemprop="telephone">+7 (812) 100-10-10</span>')
        const r = extractFromMicrodata($)
        expect(r.phones?.length).toBeGreaterThan(0)
    })

    it('extracts itemprop="name" as candidate name', () => {
        const $ = cheerio.load('<h1 itemprop="name">Acme Clinic</h1>')
        const r = extractFromMicrodata($)
        expect(r.candidateName).toBe('Acme Clinic')
    })
})

describe('extractFromSemanticHtml', () => {
    it('extracts tel: anchors', () => {
        const $ = cheerio.load('<a href="tel:+78121001010">Call</a>')
        const r = extractFromSemanticHtml($)
        expect(r.phones).toContain('+78121001010')
    })

    it('extracts mailto: anchors and lowercases', () => {
        const $ = cheerio.load('<a href="mailto:Info@X.RU">Email</a>')
        const r = extractFromSemanticHtml($)
        expect(r.emails).toContain('info@x.ru')
    })

    it('extracts text inside <address>', () => {
        const $ = cheerio.load('<address>г. Санкт-Петербург, ул. Ленина, 1</address>')
        const r = extractFromSemanticHtml($)
        expect(r.addresses?.[0]).toMatch(/Ленина/)
    })
})

describe('extractFromRegex', () => {
    it('extracts +7 phone from cleaned text', () => {
        const r = extractFromRegex('Звоните +7 (812) 100-10-10 или пишите.')
        expect(r.phones?.length).toBeGreaterThan(0)
    })

    it('extracts email from cleaned text', () => {
        const r = extractFromRegex('Email: hello@test.ru thanks')
        expect(r.emails).toContain('hello@test.ru')
    })

    it('extracts Russian-style address pattern', () => {
        const r = extractFromRegex('Наш адрес: ул. Пушкина, 12 — приходите.')
        expect(r.addresses?.[0]).toMatch(/Пушкина/)
    })

    it('returns empty arrays for blank input', () => {
        const r = extractFromRegex('')
        expect(r.phones ?? []).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/tools/__tests__/extraction-strategies.test.ts -v
```
Expected: FAIL with "Cannot find module '../extraction-strategies'".

- [ ] **Step 3: Implement the strategies**

Create `examples/scraper-node/src/sources/ai-agent/tools/extraction-strategies.ts`:

```typescript
import type * as cheerio from 'cheerio'

export interface PartialExtraction {
    phones?: string[]
    emails?: string[]
    addresses?: string[]
    candidateName?: string
}

const PHONE_REGEX = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const ADDRESS_REGEX = /(?:ул\.|улица|пр\.|проспект|пер\.|переулок|д\.|дом)\s+[А-ЯЁа-яё0-9\s,.-]{3,80}/g

export function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1)
    if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
    if (digits.length === 10) return '+7' + digits
    return raw.trim()
}

function flattenAddress(addr: unknown): string | undefined {
    if (!addr) return undefined
    if (typeof addr === 'string') return addr
    if (typeof addr === 'object') {
        const a = addr as Record<string, unknown>
        const parts = [a.streetAddress, a.addressLocality, a.postalCode]
            .filter(p => typeof p === 'string') as string[]
        if (parts.length) return parts.join(', ')
    }
    return undefined
}

function isLocalBusinessType(t: unknown): boolean {
    if (typeof t === 'string') return /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(t)
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(x))
    return false
}

export function extractFromJsonLd(blobs: unknown[]): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()
    let candidateName = ''

    for (const blob of blobs) {
        if (!blob || typeof blob !== 'object') continue
        const b = blob as Record<string, unknown>
        if (!isLocalBusinessType(b['@type'])) continue

        if (typeof b.name === 'string' && !candidateName) candidateName = b.name
        if (typeof b.telephone === 'string') phones.add(normalizePhone(b.telephone))
        if (typeof b.email === 'string') emails.add(b.email.toLowerCase())
        const a = flattenAddress(b.address)
        if (a) addresses.add(a)
    }

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
        candidateName: candidateName || undefined,
    }
}

export function extractFromMicrodata($: cheerio.CheerioAPI): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()
    let candidateName = ''

    $('[itemprop="telephone"]').each((_, el) => {
        const t = $(el).text().trim()
        if (t) phones.add(normalizePhone(t))
    })
    $('[itemprop="email"]').each((_, el) => {
        const t = $(el).text().trim()
        if (t) emails.add(t.toLowerCase())
    })
    $('[itemprop="address"], [itemprop="streetAddress"]').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        if (t) addresses.add(t)
    })
    const nm = $('[itemprop="name"]').first().text().trim()
    if (nm) candidateName = nm

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
        candidateName: candidateName || undefined,
    }
}

export function extractFromSemanticHtml($: cheerio.CheerioAPI): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()

    $('a[href^="tel:"]').each((_, el) => {
        const h = ($(el).attr('href') ?? '').replace(/^tel:/i, '').trim()
        if (h) phones.add(normalizePhone(h))
    })
    $('a[href^="mailto:"]').each((_, el) => {
        const h = ($(el).attr('href') ?? '').replace(/^mailto:/i, '').trim().toLowerCase()
        if (h) emails.add(h)
    })
    $('address').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        if (t) addresses.add(t)
    })
    $('.address, .adres, .contacts__address, [class*="address"]').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        if (t) addresses.add(t)
    })

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
    }
}

export function extractFromRegex(text: string): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()

    for (const m of text.match(PHONE_REGEX) ?? []) phones.add(normalizePhone(m))
    for (const m of text.match(EMAIL_REGEX) ?? []) emails.add(m.toLowerCase())
    for (const m of text.match(ADDRESS_REGEX) ?? []) {
        addresses.add(m.replace(/\s+/g, ' ').trim())
    }

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/sources/ai-agent/tools/__tests__/extraction-strategies.test.ts -v
```
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/extraction-strategies.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/extraction-strategies.test.ts
git commit -m "feat(ai-agent): add deterministic extraction strategies"
```

---

## Task 7: Refactor extract-contacts to use the strategy chain

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts:1-95`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts` (add new test cases)

- [ ] **Step 1: Read the current extract-contacts.ts**

```bash
cat examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts
```
Confirm shape:
- Tool name `extract_contacts`, parameters `{ html: string }`.
- Result `{ phones, emails, addresses, candidateName, error?, hint? }`.
- Internal regexes and `normalizePhone` will be replaced by extraction-strategies.ts.

- [ ] **Step 2: Add new test cases for `strategiesFired`**

Append to `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`:

```typescript
describe('extract_contacts — strategy reporting', () => {
    const tool = makeExtractContactsTool()

    it('reports jsonld when JSON-LD LocalBusiness is present', async () => {
        const html = `
            <html><body>
                <script type="application/ld+json">
                {"@type":"LocalBusiness","name":"X","telephone":"+78121001010"}
                </script>
            </body></html>
        `
        const r = await tool.handler({ html })
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['jsonld']))
    })

    it('reports semantic-html for tel: links', async () => {
        const html = `<html><body><a href="tel:+78121001010">x</a></body></html>`
        const r = await tool.handler({ html })
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['semantic-html']))
    })

    it('reports regex when phones come only from body text', async () => {
        const html = `<html><body><p>Call +7 (812) 100-10-10 today</p></body></html>`
        const r = await tool.handler({ html })
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['regex']))
    })

    it('records multiple strategies when several fired', async () => {
        const html = `
            <html><body>
                <script type="application/ld+json">
                {"@type":"LocalBusiness","name":"X","telephone":"+78121001010"}
                </script>
                <a href="mailto:a@b.ru">m</a>
            </body></html>
        `
        const r = await tool.handler({ html })
        expect(r.strategiesFired?.length).toBeGreaterThanOrEqual(2)
    })

    it('omits strategiesFired field when html is empty', async () => {
        const r = await tool.handler({ html: '' })
        expect(r.error).toBe('empty html')
        expect(r.strategiesFired).toBeUndefined()
    })
})
```

- [ ] **Step 3: Refactor extract-contacts.ts**

Overwrite `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`:

```typescript
import * as cheerio from "cheerio"
import { Tool } from "./types"
import { log } from "@cmd-hub/common"
import {
    extractFromJsonLd,
    extractFromMicrodata,
    extractFromSemanticHtml,
    extractFromRegex,
    type PartialExtraction,
} from "./extraction-strategies"

interface ExtractResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    strategiesFired?: string[]
    error?: string
    hint?: string
}

const MAX_PER_FIELD = 10

function mergeInto(
    acc: { phones: Set<string>, emails: Set<string>, addresses: Set<string>, name: string },
    p: PartialExtraction,
): boolean {
    let contributed = false
    for (const x of p.phones ?? []) if (!acc.phones.has(x)) { acc.phones.add(x); contributed = true }
    for (const x of p.emails ?? []) if (!acc.emails.has(x)) { acc.emails.add(x); contributed = true }
    for (const x of p.addresses ?? []) if (!acc.addresses.has(x)) { acc.addresses.add(x); contributed = true }
    if (!acc.name && p.candidateName) { acc.name = p.candidateName; contributed = true }
    return contributed
}

function parseJsonLdBlobs($: cheerio.CheerioAPI): unknown[] {
    const blobs: unknown[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim()
        if (!raw) return
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) blobs.push(...parsed)
            else blobs.push(parsed)
        } catch { /* ignore broken JSON-LD */ }
    })
    return blobs
}

function pickCandidateName($: cheerio.CheerioAPI, current: string): string {
    if (current) return current
    const title = $('title').first().text().trim()
    if (title) return title
    const og = $('meta[property="og:title"]').attr('content')?.trim() ?? ''
    if (og) return og
    const h1 = $('h1').first().text().trim()
    if (h1) return h1
    return ''
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
                const acc = { phones: new Set<string>(), emails: new Set<string>(), addresses: new Set<string>(), name: '' }
                const fired: string[] = []

                const jsonLd = parseJsonLdBlobs($)
                if (mergeInto(acc, extractFromJsonLd(jsonLd))) fired.push('jsonld')
                if (mergeInto(acc, extractFromMicrodata($))) fired.push('microdata')
                if (mergeInto(acc, extractFromSemanticHtml($))) fired.push('semantic-html')

                const cleanedText = (() => {
                    const $clone = cheerio.load(html)
                    $clone('script, style, noscript').remove()
                    return $clone('body').text().replace(/\s+/g, ' ').trim()
                })()
                if (mergeInto(acc, extractFromRegex(cleanedText))) fired.push('regex')

                const phones = Array.from(acc.phones).slice(0, MAX_PER_FIELD)
                const emails = Array.from(acc.emails).slice(0, MAX_PER_FIELD)
                const addresses = Array.from(acc.addresses).slice(0, MAX_PER_FIELD)
                const candidateName = pickCandidateName($, acc.name)

                const totalContacts = phones.length + emails.length + addresses.length
                const hint = totalContacts === 0
                    ? "no structured contacts found — try parse_html with a custom selector, or check the page's footer/contacts subpath"
                    : `found ${totalContacts} contacts — call report_results with the org details`

                log.debug(`ai-agent.extract_contacts: phones=${phones.length} emails=${emails.length} addresses=${addresses.length} fired=[${fired.join(',')}] name="${candidateName.slice(0, 40)}"`)
                return { phones, emails, addresses, candidateName, strategiesFired: fired, hint }
            } catch (e: any) {
                log.warn(`ai-agent.extract_contacts: ${e.message ?? e}`)
                return { phones: [], emails: [], addresses: [], candidateName: '', error: String(e.message ?? e) }
            }
        },
    }
}
```

- [ ] **Step 4: Run the existing extract-contacts tests to verify no regressions**

```bash
npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts -v
```
Expected: PASS — all original tests + 5 new strategy-reporting tests.

If any original test fails, the failure is the regression — read the test, read the change, and fix the code (not the test) unless the test is asserting outdated behavior. Likely failure modes:
- "candidate name" priority changed: original picks `<title>` first, new code picks JSON-LD `name` first, then microdata, then falls back to `<title>`. If a test relied on `<title>` winning when JSON-LD also has a name, the test reflects old behavior — update the assertion.
- Phone normalization edge cases: same regex/function, should be identical.

- [ ] **Step 5: Run the full ai-agent test suite**

```bash
npx jest src/sources/ai-agent
```
Expected: ≥ 124 + 14 + 5 = 143 tests, all passing.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
git commit -m "refactor(ai-agent): rewire extract-contacts onto strategy chain"
```

---

## Task 8: Full-package verification

**Files:**
- (none modified)

- [ ] **Step 1: Run the full scraper-node test suite**

```bash
cd examples/scraper-node
bash scripts/test.sh
```
Expected: all scraper-node tests pass. 95 baseline → ~143 ai-agent + remaining non-ai-agent tests.

- [ ] **Step 2: Run the typecheck/build**

```bash
bash scripts/build.sh
```
Expected: no type errors. Specifically, the new modules (`page-types.ts`, `aggregator-registry.ts`, `link-scorers.ts`, `classify-page.ts`, `extraction-strategies.ts`) compile with no `any`-leakage warnings or implicit-any errors.

If a build error references the JSON import (`Cannot find module './aggregator-registry.json'` or "missing type declarations"):
- Verify `compilerOptions.resolveJsonModule: true` in `examples/scraper-node/tsconfig.json`.
- Verify `compilerOptions.esModuleInterop: true`.

- [ ] **Step 3: Run repo-wide tests via top-level**

From the repo root:
```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-classifier
npm test --workspaces --if-present 2>&1 | tail -30
```
Expected: all workspaces green. If any *non-scraper-node* package fails, that's a pre-existing issue unrelated to this PR — note in the commit body and proceed.

- [ ] **Step 4: No commit needed (verification only)**

---

## Task 9: Wire up — verify nothing is silently dead

**Files:**
- Read-only: `examples/scraper-node/src/sources/ai-agent/loop.ts`
- Read-only: `examples/scraper-node/src/sources/ai-agent/tools/index.ts`

- [ ] **Step 1: Grep for stray imports of the new modules**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-classifier
grep -r "classifyPage\|matchAggregator\|scoreContactLink\|scoreAggregatorLink" examples/scraper-node/src --include='*.ts' | grep -v '__tests__\|__fixtures__'
```
Expected: only the new files mention each other. The classifier and scorers are NOT yet imported by `loop.ts` or any tool — that's correct for PR1.

If anything in `loop.ts` or `tools/index.ts` imports them, it's a leftover from drafting — remove it.

- [ ] **Step 2: Confirm extract-contacts strategies are actually invoked**

```bash
grep -n "extractFromJsonLd\|extractFromMicrodata\|extractFromSemanticHtml\|extractFromRegex" examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts
```
Expected: 4 import lines + 4 call sites.

- [ ] **Step 3: No commit needed**

---

## Task 10: Push the branch and open the PR

**Files:**
- (none modified)

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
```
Expected: 7 commits, in this order:
1. feat(ai-agent): add page-types module
2. feat(ai-agent): add aggregator registry JSON
3. feat(ai-agent): add aggregator-registry lookup module
4. feat(ai-agent): add link scorers for contact and aggregator candidates
5. feat(ai-agent): add page-type classifier with link discovery
6. feat(ai-agent): add deterministic extraction strategies
7. refactor(ai-agent): rewire extract-contacts onto strategy chain

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/ai-agent-classifier
```

- [ ] **Step 3: Create the PR**

```bash
gh pr create --title "feat(ai-agent): PR1 — server-side classifier + link discovery + deterministic extraction" --body "$(cat <<'EOF'
## Summary
- Adds the foundation layer of the AI-agent overhaul (`docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md`, PR1).
- New internal modules: page-types, aggregator-registry, link-scorers, classify-page, extraction-strategies.
- Refactors `extract_contacts` onto a deterministic strategy chain (JSON-LD → microdata → semantic HTML → regex). Tool surface unchanged; adds `strategiesFired: string[]` to the result for observability.
- Strictly additive: no LLM-visible behavior change. The classifier and link discoverers are not yet wired into the loop — that lands in PR4.

## Test plan
- [ ] All ai-agent tests pass (baseline 95 → ~143).
- [ ] `npx jest src/sources/ai-agent` clean.
- [ ] `bash scripts/build.sh` clean.
- [ ] No production loop.ts changes; agent runs identically.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 4: No commit needed**

---

## Self-Review

**Spec coverage** (per spec sections referenced in this plan):

- §3.2 (page-type classifier) → Task 1 (types), Task 5 (`classifyPage`).
- §3.3 (link discovery + aggregator registry) → Task 2, Task 3, Task 4.
- §3.4 (deterministic extraction strategy chain) → Task 6, Task 7.
- PR1 scope ("strictly additive, no LLM-visible behavior change") → Task 9 verifies no `loop.ts` / `tools/index.ts` import the new modules.
- "15K cap stays on `fetch_url`" → confirmed: classifier uses `httpGet` directly without the cap, but does not return raw HTML to the LLM. `fetch_url` tool unchanged.
- Test fixtures cover all 5 PageTypes (Task 5 fixtures).

**Placeholder scan:** searched the plan for "TBD", "TODO", "implement later", "fill in details", "add appropriate", "similar to". One reference to "PR4" in Task 5's classifier code — `branchCandidates: []` with comment "deferred to PR4" — that's intentional (the type is in the contract but the implementation lands later) and not a placeholder for *this* PR's work.

**Type consistency:**
- `ScoredLink.kind`: defined as `'contact-page' | 'aggregator' | 'branch'` in `page-types.ts`; `link-scorers.ts` returns `'contact-page'` and `'aggregator'`; `'branch'` is unused in PR1 but legal (PR4 fills it).
- `PartialExtraction` shape matches between `extraction-strategies.ts` and consumers in `extract-contacts.ts`.
- `ClassifiedPage`: uses `ScoredLink[]` for `contactCandidates`/`aggregatorCandidates`/`branchCandidates`; consumers don't exist yet in this PR.
- `ExtractResult` adds `strategiesFired?: string[]` — strict superset of today's shape, no caller breaks.

**Commit hygiene:** 7 commits, each one buildable + tested independently. No "WIP" or "fix" commits. Conventional-commit style matching the existing repo log.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-29-ai-agent-pr1-classifier-and-link-discovery.md`.
