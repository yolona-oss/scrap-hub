# AI Agent Scraper Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `ai-agent` scraper source that uses an OpenAI-compatible LLM to autonomously drive search, delegation, fetching, and extraction — streaming results back through the existing scraper pipeline.

**Architecture:** New `packages/org-scraper/src/sources/ai-agent/` folder containing an `IScraperSource` implementation, an OpenAI-compatible client wrapper, an iteration loop, and four tools (`web_search`, `fetch_url`, `search_source`, `report_results`). Extends `IScraperSource.search()` to accept an optional `ServiceContext` so per-user `/sconfig scraper aiAgent.*` overrides merge on top of system-level `IScraperConfig.aiAgent` config. Agent emits results into an `AsyncQueue` via `report_results`; the source consumes the queue and yields to the caller.

**Tech Stack:** TypeScript, npm workspaces, `openai` SDK (new dependency), `axios` (already present), `cheerio` (already present). Spec: `docs/superpowers/specs/2026-04-22-ai-agent-scraper-source-design.md`.

**No commits:** The user has explicitly disabled commits for this work. Skip every "Commit" step. Do not run `git commit`. Stage changes only when the step explicitly says so.

---

## File Structure

**New files (all under `packages/org-scraper/src/sources/ai-agent/`):**
- `index.ts` — `AIAgentSource` class, registered with `SourceRegistry`
- `config.ts` — merge system + user config into a resolved `AIAgentConfig`
- `client.ts` — thin factory around the `openai` SDK for OpenAI-compatible endpoints
- `async-queue.ts` — small async iterator helper (`push`, `close`, `for await`)
- `prompts.ts` — system prompt builder
- `loop.ts` — agent iteration loop (sequential tool execution, safety limits)
- `tools/index.ts` — assembles the tool list for a given invocation
- `tools/types.ts` — `Tool` interface + OpenAI schema conversion helper
- `tools/web-search.ts` — `web_search` tool (serpapi | yandex | duckduckgo)
- `tools/fetch-url.ts` — `fetch_url` tool (axios GET + cheerio text extraction)
- `tools/delegate-source.ts` — `search_source` tool (wraps `SourceRegistry`)
- `tools/report-results.ts` — `report_results` tool (validates + pushes to queue)

**Modified files:**
- `packages/org-scraper/package.json` — add `openai` dependency
- `packages/org-scraper/src/scraper-config.ts` — extend `IScraperConfig` with `aiAgent` field
- `packages/org-scraper/src/sources/types.ts` — `IScraperSource.search()` gains optional `ServiceContext`
- `packages/org-scraper/src/scraper-service/scraper.ts` — `OrgScraper.run()` accepts and forwards context
- `packages/org-scraper/src/scraper-service/service.ts` — passes `this.getServiceContext()` into `scraper.run()`
- `packages/org-scraper/src/sources/index.ts` — register `ai-agent`

---

## Task 1: Add the `openai` dependency

**Files:**
- Modify: `packages/org-scraper/package.json`

- [ ] **Step 1: Add dependency**

Open `packages/org-scraper/package.json` and add `"openai": "^4.77.0"` to `dependencies` (keep alphabetical position — after `googleapis`, before `puppeteer-core`).

Result block:
```json
"dependencies": {
    "@cmd-hub/core": "*",
    "serpapi": "^2.1.0",
    "cheerio": "^1.0.0",
    "googleapis": "^144.0.0",
    "openai": "^4.77.0",
    "puppeteer-core": "^24.0.0",
    "axios": "^1.7.9"
}
```

- [ ] **Step 2: Install**

Run from the repo root: `npm install`
Expected: install succeeds, `node_modules/openai` appears, `package-lock.json` updated.

- [ ] **Step 3: Verify import resolves**

Run: `node -e "console.log(require('openai').OpenAI.name)"` (from `packages/org-scraper/`)
Expected output: `OpenAI`

- [ ] **Step 4: Stage but do not commit**

```bash
git add packages/org-scraper/package.json package-lock.json
```

---

## Task 2: Extend `IScraperConfig` with the `aiAgent` field

**Files:**
- Modify: `packages/org-scraper/src/scraper-config.ts`

- [ ] **Step 1: Add the new config interface + field**

Replace the contents of `packages/org-scraper/src/scraper-config.ts` with:

```typescript
import { ConfigRegistry } from '@core/config-registry'

export interface IAIAgentConfig {
    baseUrl?: string
    apiKey?: string
    model?: string
    temperature?: number
    webSearchProvider?: 'serpapi' | 'yandex' | 'duckduckgo'
    maxToolCalls?: number
    toolTimeoutMs?: number
    totalTimeoutMs?: number
}

export interface IScraperConfig {
    serpApiKey?: string
    yandexXmlUser?: string
    yandexXmlKey?: string
    chromePath?: string
    requestDelayMs?: number
    userAgent?: string
    googleSheets?: {
        credentials?: string | Record<string, any>
        spreadsheetId?: string
    }
    aiAgent?: IAIAgentConfig
}

export async function getScraperConfig(): Promise<IScraperConfig> {
    return ConfigRegistry.get<IScraperConfig>('scraper')
}
```

Note: all fields in `IAIAgentConfig` are optional on the interface — defaults get applied in the merger (Task 4). This lets users partially configure via `/config scraper aiAgent.model ...` without filling every field.

- [ ] **Step 2: Build to verify**

Run: `npm run build:scraper`
Expected: builds cleanly, no TS errors.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/scraper-config.ts
```

---

## Task 3: Extend `IScraperSource.search()` to accept `ServiceContext`

**Files:**
- Modify: `packages/org-scraper/src/sources/types.ts`

- [ ] **Step 1: Update the interface**

Replace the contents of `packages/org-scraper/src/sources/types.ts` with:

```typescript
import { OrgData, SearchQuery } from "../types"
import type { ServiceContext } from "../exporters/types"

export interface IScraperSource {
    readonly name: string
    readonly requiresApiKey: boolean

    search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
    ): AsyncGenerator<OrgData>
}

export type ScraperSourceFactory = () => IScraperSource
```

- [ ] **Step 2: Build — existing sources should still compile**

Run: `npm run build:scraper`
Expected: builds cleanly. Existing sources (`google-search.ts`, `yandex-search.ts`, etc.) don't declare the parameter — that's fine, TypeScript allows implementations with fewer parameters than the interface.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/types.ts
```

---

## Task 4: Thread `ServiceContext` through `OrgScraper.run()`

**Files:**
- Modify: `packages/org-scraper/src/scraper-service/scraper.ts`
- Modify: `packages/org-scraper/src/scraper-service/service.ts`

- [ ] **Step 1: Update `OrgScraper.run()` signature + forward to `source.search`**

In `packages/org-scraper/src/scraper-service/scraper.ts`:

Add the import at the top (merge with existing):
```typescript
import { ServiceContext } from "../exporters/types"
```

Change the `run()` signature to accept `context?: ServiceContext` as the last parameter. Replace the `run()` method — only the signature line and the `source.search(...)` call change:

```typescript
    async* run(
        onProgress: (msg: string) => void,
        onProgressBar: (name: string, current: number, total: number) => void,
        onProgressStatus: (name: string, status: 'active' | 'done' | 'failed' | 'skipped') => void,
        isPaused: () => boolean,
        context?: ServiceContext,
    ): AsyncGenerator<OrgData> {
        const sourceNames = this.query.sources.length > 0
            ? this.query.sources
            : SourceRegistry.available()

        const sourceLimit = this.query.maxResults

        for (const sourceName of sourceNames) {
            if (!this._isRunning) break
            if (!SourceRegistry.has(sourceName)) {
                onProgress(`${sourceName}: not found, skipping`)
                onProgressStatus(`scraping.${sourceName}`, 'skipped')
                continue
            }
            let sourceCount = 0
            let sourceFailed = false
            onProgressBar(`scraping.${sourceName}`, 0, sourceLimit)

            try {
                const source = SourceRegistry.create(sourceName)
                const gen = source.search(this.query, (n) => {
                    sourceCount = n
                    onProgressBar(`scraping.${sourceName}`, Math.min(n, sourceLimit), sourceLimit)
                }, context)

                for await (const org of gen) {
                    if (!this._isRunning) break

                    while (isPaused() && this._isRunning) {
                        await new Promise(r => setTimeout(r, 500))
                    }

                    if (this.addOrg(org)) {
                        yield org
                        onProgressBar(`scraping.${sourceName}`, Math.min(sourceCount, sourceLimit), sourceLimit)
                    }

                    if (sourceCount >= sourceLimit) {
                        onProgress(`${sourceName}: reached limit of ${sourceLimit}`)
                        break
                    }
                }
            } catch (e: any) {
                sourceFailed = true
                log.error(`Source "${sourceName}" error: ${e.message ?? e}`)
                onProgress(`${sourceName}: failed — ${e.message ?? e}`)
            }

            if (sourceFailed || sourceCount === 0) {
                onProgressStatus(`scraping.${sourceName}`, sourceFailed ? 'failed' : 'skipped')
                onProgress(`${sourceName}: ${sourceFailed ? 'FAILED' : 'no results'}`)
            } else {
                onProgressBar(`scraping.${sourceName}`, sourceCount, sourceLimit)
                onProgressStatus(`scraping.${sourceName}`, 'done')
                onProgress(`${sourceName}: ${sourceCount} found, ${this.results.length} total unique`)
            }
        }
    }
```

- [ ] **Step 2: Pass context from `service.ts` into `scraper.run()`**

In `packages/org-scraper/src/scraper-service/service.ts`, change the `scraper.run(...)` call inside `runWrapper()` to pass the service context as the 5th argument:

Old:
```typescript
        const generator = this.scraper.run(
            (msg) => this.sendToWorld(msg),
            (name, current, total) => this.emit('progress' as any, name, current, total),
            (name, status) => this.emit('progressStatus' as any, name, status),
            () => this.isPaused
        )
```

New:
```typescript
        const generator = this.scraper.run(
            (msg) => this.sendToWorld(msg),
            (name, current, total) => this.emit('progress' as any, name, current, total),
            (name, status) => this.emit('progressStatus' as any, name, status),
            () => this.isPaused,
            this.getServiceContext(),
        )
```

- [ ] **Step 3: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 4: Stage**

```bash
git add packages/org-scraper/src/scraper-service/scraper.ts packages/org-scraper/src/scraper-service/service.ts
```

---

## Task 5: Create `AsyncQueue` helper

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/async-queue.ts`

- [ ] **Step 1: Write the file**

Create `packages/org-scraper/src/sources/ai-agent/async-queue.ts`:

```typescript
/**
 * Minimal async queue that can be iterated with `for await`.
 * Producers call push(v) to enqueue and close() when done.
 * The async iterator yields values in order and terminates after close()
 * once the buffer is drained.
 */
export class AsyncQueue<T> {
    private buffer: T[] = []
    private waiters: Array<(v: IteratorResult<T>) => void> = []
    private closed = false

    push(value: T): void {
        if (this.closed) return
        const waiter = this.waiters.shift()
        if (waiter) {
            waiter({ value, done: false })
        } else {
            this.buffer.push(value)
        }
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        while (this.waiters.length > 0) {
            const w = this.waiters.shift()!
            w({ value: undefined as any, done: true })
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: (): Promise<IteratorResult<T>> => {
                if (this.buffer.length > 0) {
                    return Promise.resolve({ value: this.buffer.shift()!, done: false })
                }
                if (this.closed) {
                    return Promise.resolve({ value: undefined as any, done: true })
                }
                return new Promise(resolve => this.waiters.push(resolve))
            },
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/async-queue.ts
```

---

## Task 6: Create config merger

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/config.ts`

- [ ] **Step 1: Write the merger**

Create `packages/org-scraper/src/sources/ai-agent/config.ts`:

```typescript
import { getScraperConfig, IAIAgentConfig, IScraperConfig } from "../../scraper-config"
import type { ServiceContext } from "../../exporters/types"

export interface ResolvedAIAgentConfig {
    baseUrl: string
    apiKey: string | undefined
    model: string
    temperature: number
    webSearchProvider: 'serpapi' | 'yandex' | 'duckduckgo'
    maxToolCalls: number
    toolTimeoutMs: number
    totalTimeoutMs: number
}

function pickProvider(system: IScraperConfig, chosen?: string): 'serpapi' | 'yandex' | 'duckduckgo' {
    if (chosen === 'serpapi' || chosen === 'yandex' || chosen === 'duckduckgo') return chosen
    if (system.serpApiKey) return 'serpapi'
    if (system.yandexXmlUser && system.yandexXmlKey) return 'yandex'
    return 'duckduckgo'
}

/**
 * Returns resolved config if baseUrl and model are present, else null.
 * Caller logs a warning and short-circuits when null.
 */
export async function resolveAIAgentConfig(context?: ServiceContext): Promise<ResolvedAIAgentConfig | null> {
    const system = await getScraperConfig()
    const sys: IAIAgentConfig = system.aiAgent ?? {}
    const user: IAIAgentConfig = ((context?.config as any)?.aiAgent) ?? {}

    const baseUrl = user.baseUrl ?? sys.baseUrl
    const model = user.model ?? sys.model
    if (!baseUrl || !model) return null

    return {
        baseUrl,
        apiKey: user.apiKey ?? sys.apiKey,
        model,
        temperature: user.temperature ?? sys.temperature ?? 0.2,
        webSearchProvider: pickProvider(system, user.webSearchProvider ?? sys.webSearchProvider),
        maxToolCalls: user.maxToolCalls ?? sys.maxToolCalls ?? 25,
        toolTimeoutMs: user.toolTimeoutMs ?? sys.toolTimeoutMs ?? 60_000,
        totalTimeoutMs: user.totalTimeoutMs ?? sys.totalTimeoutMs ?? 300_000,
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/config.ts
```

---

## Task 7: Create OpenAI-compatible client wrapper

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/client.ts`

- [ ] **Step 1: Write the wrapper**

Create `packages/org-scraper/src/sources/ai-agent/client.ts`:

```typescript
import { OpenAI } from "openai"
import { ResolvedAIAgentConfig } from "./config"

export function createClient(cfg: ResolvedAIAgentConfig): OpenAI {
    return new OpenAI({
        baseURL: cfg.baseUrl,
        // The OpenAI SDK requires a non-empty string; local servers accept any placeholder.
        apiKey: cfg.apiKey ?? 'local-no-key',
    })
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/client.ts
```

---

## Task 8: Create `Tool` types

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/tools/types.ts`

- [ ] **Step 1: Write the file**

Create `packages/org-scraper/src/sources/ai-agent/tools/types.ts`:

```typescript
import type { ChatCompletionTool } from "openai/resources/chat/completions"

export interface Tool {
    name: string
    description: string
    parameters: Record<string, any>
    handler: (args: any) => Promise<any>
}

export function toOpenAISchema(tool: Tool): ChatCompletionTool {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/tools/types.ts
```

---

## Task 9: Implement `web_search` tool

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/tools/web-search.ts`

- [ ] **Step 1: Write the tool**

Create `packages/org-scraper/src/sources/ai-agent/tools/web-search.ts`:

```typescript
import axios from "axios"
import * as cheerio from "cheerio"
import { Tool } from "./types"
import { getScraperConfig } from "../../../scraper-config"
import log from "@logger"

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
}

interface WebSearchResponse {
    results: WebSearchResult[]
    error?: string
}

export function makeWebSearchTool(provider: 'serpapi' | 'yandex' | 'duckduckgo'): Tool {
    return {
        name: 'web_search',
        description: 'Search the web for information. Returns a list of results with title, url, and snippet.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            },
            required: ['query'],
        },
        async handler(args): Promise<WebSearchResponse> {
            const query = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 10), 1), 50)
            if (!query) return { results: [], error: 'empty query' }

            try {
                if (provider === 'serpapi') return await searchSerpapi(query, limit)
                if (provider === 'yandex') return await searchYandex(query, limit)
                return await searchDuckDuckGo(query, limit)
            } catch (e: any) {
                log.error(`ai-agent.web_search[${provider}]: ${e.message ?? e}`)
                return { results: [], error: String(e.message ?? e) }
            }
        },
    }
}

async function searchSerpapi(query: string, limit: number): Promise<WebSearchResponse> {
    const apiKey = (await getScraperConfig()).serpApiKey
    if (!apiKey) return { results: [], error: 'serpApiKey not configured' }

    const params = new URLSearchParams({
        api_key: apiKey,
        engine: 'google',
        q: query,
        num: String(limit),
        hl: 'ru',
        gl: 'ru',
    })
    const res = await axios.get(`https://serpapi.com/search.json?${params}`, { timeout: 15000 })
    const organic = (res.data?.organic_results ?? []) as any[]
    const results = organic.slice(0, limit).map(r => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
    }))
    return { results }
}

async function searchYandex(query: string, limit: number): Promise<WebSearchResponse> {
    const cfg = await getScraperConfig()
    if (!cfg.yandexXmlUser || !cfg.yandexXmlKey) {
        return { results: [], error: 'yandex XML credentials not configured' }
    }
    const url = `https://yandex.ru/search/xml?user=${encodeURIComponent(cfg.yandexXmlUser)}&key=${encodeURIComponent(cfg.yandexXmlKey)}&query=${encodeURIComponent(query)}&l10n=ru&sortby=rlv&filter=none&groupby=attr%3Dd.mode%3Ddeep.groups-on-page%3D${limit}.docs-in-group%3D1`
    const res = await axios.get(url, { timeout: 15000 })
    const $ = cheerio.load(res.data, { xmlMode: true })
    const results: WebSearchResult[] = []
    $('doc').each((_, el) => {
        if (results.length >= limit) return
        const $el = $(el)
        results.push({
            title: $el.find('title').text().trim(),
            url: $el.find('url').text().trim(),
            snippet: $el.find('passage, headline').first().text().trim(),
        })
    })
    return { results }
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebSearchResponse> {
    const res = await axios.post(
        'https://html.duckduckgo.com/html/',
        new URLSearchParams({ q: query }).toString(),
        {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            validateStatus: s => s < 500,
        },
    )
    const $ = cheerio.load(res.data)
    const results: WebSearchResult[] = []
    $('.result').each((_, el) => {
        if (results.length >= limit) return
        const $el = $(el)
        const a = $el.find('a.result__a').first()
        const url = a.attr('href') ?? ''
        const title = a.text().trim()
        const snippet = $el.find('.result__snippet').first().text().trim()
        if (title && url) results.push({ title, url, snippet })
    })
    return { results }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/tools/web-search.ts
```

---

## Task 10: Implement `fetch_url` tool

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/tools/fetch-url.ts`

- [ ] **Step 1: Write the tool**

Create `packages/org-scraper/src/sources/ai-agent/tools/fetch-url.ts`:

```typescript
import axios from "axios"
import * as cheerio from "cheerio"
import { Tool } from "./types"
import log from "@logger"

const MAX_CONTENT_CHARS = 15_000

interface FetchResult {
    status: number
    content: string
    truncated: boolean
    error?: string
}

export function makeFetchUrlTool(): Tool {
    return {
        name: 'fetch_url',
        description: 'Fetch a web page. Returns extracted text (mode=text) or raw HTML (mode=html), truncated to 15000 chars.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                mode: { type: 'string', enum: ['text', 'html'], default: 'text' },
            },
            required: ['url'],
        },
        async handler(args): Promise<FetchResult> {
            const url = String(args?.url ?? '').trim()
            const mode: 'text' | 'html' = args?.mode === 'html' ? 'html' : 'text'
            if (!url) return { status: 0, content: '', truncated: false, error: 'empty url' }

            try {
                const res = await axios.get(url, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'ru-RU,ru;q=0.9',
                    },
                    maxContentLength: 5_000_000,
                    validateStatus: s => s < 600,
                })

                const status = res.status
                if (status >= 400) {
                    return { status, content: '', truncated: false, error: `HTTP ${status}` }
                }

                const body = typeof res.data === 'string' ? res.data : String(res.data ?? '')
                let content: string
                if (mode === 'html') {
                    content = body
                } else {
                    const $ = cheerio.load(body)
                    $('script, style, noscript').remove()
                    content = $('body').text().replace(/\s+/g, ' ').trim()
                }

                const truncated = content.length > MAX_CONTENT_CHARS
                if (truncated) content = content.slice(0, MAX_CONTENT_CHARS)
                return { status, content, truncated }
            } catch (e: any) {
                log.debug(`ai-agent.fetch_url: ${url}: ${e.message ?? e}`)
                return { status: 0, content: '', truncated: false, error: String(e.message ?? e) }
            }
        },
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/tools/fetch-url.ts
```

---

## Task 11: Implement `search_source` tool

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/tools/delegate-source.ts`

- [ ] **Step 1: Write the tool**

Create `packages/org-scraper/src/sources/ai-agent/tools/delegate-source.ts`:

```typescript
import { Tool } from "./types"
import { SourceRegistry } from "../../registry"
import { OrgData, SearchQuery } from "../../../types"
import log from "@logger"

interface DelegateResult {
    orgs: OrgData[]
    error?: string
}

export function makeDelegateSourceTool(baseQuery: SearchQuery): Tool {
    const available = SourceRegistry.available().filter(n => n !== 'ai-agent')
    return {
        name: 'search_source',
        description: `Delegate to a registered scraper source. Available sources: ${available.join(', ')}. Returns a list of organizations already parsed by that source.`,
        parameters: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'Source name from the available list' },
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            required: ['source', 'query'],
        },
        async handler(args): Promise<DelegateResult> {
            const sourceName = String(args?.source ?? '').trim()
            const queryStr = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 20), 1), 50)

            if (sourceName === 'ai-agent') return { orgs: [], error: 'cannot recurse into ai-agent' }
            if (!SourceRegistry.has(sourceName)) return { orgs: [], error: `unknown source "${sourceName}"` }
            if (!queryStr) return { orgs: [], error: 'empty query' }

            const subQuery: SearchQuery = {
                query: queryStr,
                city: baseQuery.city,
                sources: [sourceName],
                maxResults: limit,
            }

            try {
                const source = SourceRegistry.create(sourceName)
                const orgs: OrgData[] = []
                const gen = source.search(subQuery, () => { /* no-op progress */ })
                for await (const org of gen) {
                    orgs.push(org)
                    if (orgs.length >= limit) break
                }
                return { orgs }
            } catch (e: any) {
                log.error(`ai-agent.search_source[${sourceName}]: ${e.message ?? e}`)
                return { orgs: [], error: String(e.message ?? e) }
            }
        },
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/tools/delegate-source.ts
```

---

## Task 12: Implement `report_results` tool

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/tools/report-results.ts`

- [ ] **Step 1: Write the tool**

Create `packages/org-scraper/src/sources/ai-agent/tools/report-results.ts`:

```typescript
import { Tool } from "./types"
import { OrgData, SearchQuery } from "../../../types"
import { AsyncQueue } from "../async-queue"

interface ReportResult {
    accepted: number
    rejected: number
    totalYielded: number
}

interface ReportState {
    yielded: number
}

export function makeReportResultsTool(
    queue: AsyncQueue<OrgData>,
    query: SearchQuery,
    state: ReportState,
): Tool {
    return {
        name: 'report_results',
        description: 'Emit found organizations immediately. Call this as soon as you have valid results — do not batch everything until the end. Returns totalYielded so you know when to stop.',
        parameters: {
            type: 'object',
            properties: {
                orgs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            source: { type: 'string' },
                            phone: { type: ['string', 'null'] },
                            email: { type: ['string', 'null'] },
                            address: { type: ['string', 'null'] },
                            url: { type: 'string' },
                        },
                        required: ['name', 'source'],
                    },
                },
            },
            required: ['orgs'],
        },
        async handler(args): Promise<ReportResult> {
            const orgs = Array.isArray(args?.orgs) ? args.orgs : []
            let accepted = 0
            let rejected = 0

            for (const raw of orgs) {
                const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
                const phone = raw?.phone ? String(raw.phone) : null
                const email = raw?.email ? String(raw.email) : null
                const address = raw?.address ? String(raw.address) : null
                const source = typeof raw?.source === 'string' && raw.source.trim() ? raw.source.trim() : 'ai-agent'
                const url = typeof raw?.url === 'string' ? raw.url : undefined

                if (!name || (!phone && !email && !address)) {
                    rejected++
                    continue
                }

                queue.push({ name, source, phone, email, address, url })
                accepted++
                state.yielded++

                if (state.yielded >= query.maxResults) break
            }

            return { accepted, rejected, totalYielded: state.yielded }
        },
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/tools/report-results.ts
```

---

## Task 13: Assemble the tool registry

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/tools/index.ts`

- [ ] **Step 1: Write the assembler**

Create `packages/org-scraper/src/sources/ai-agent/tools/index.ts`:

```typescript
import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeDelegateSourceTool } from "./delegate-source"
import { makeReportResultsTool } from "./report-results"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import { ResolvedAIAgentConfig } from "../config"

export interface ReportState {
    yielded: number
}

export function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    cfg: ResolvedAIAgentConfig,
    state: ReportState,
): Tool[] {
    return [
        makeWebSearchTool(cfg.webSearchProvider),
        makeFetchUrlTool(),
        makeDelegateSourceTool(query),
        makeReportResultsTool(queue, query, state),
    ]
}

export { Tool, toOpenAISchema } from "./types"
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/tools/index.ts
```

---

## Task 14: Create the system prompt builder

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/prompts.ts`

- [ ] **Step 1: Write the builder**

Create `packages/org-scraper/src/sources/ai-agent/prompts.ts`:

```typescript
import { SearchQuery } from "../../types"
import { SourceRegistry } from "../registry"

export function buildSystemPrompt(query: SearchQuery): string {
    const availableSources = SourceRegistry.available()
        .filter(n => n !== 'ai-agent')
        .join(', ') || '(none registered)'

    const cityClause = query.city ? ` in ${query.city}` : ''

    return `You are an organization research agent. Given a search query, find real businesses matching it.

Available tools:
- web_search(query, limit): general web search via the configured provider.
- fetch_url(url, mode): fetch a web page. mode='text' returns extracted text, 'html' returns raw HTML (truncated to 15000 chars).
- search_source(source, query, limit): delegate to a specialized scraper source. Available sources: ${availableSources}. This is often the fastest way to get structured business data.
- report_results(orgs): emit found organizations immediately. Call this as soon as you have results — do not wait until the end.

Each organization must have:
- name (required, string)
- at least one of: phone, email, address
- source (string — where you found it)
- url (optional)

Rules:
- Call report_results as soon as you find valid orgs. Don't batch everything to the end.
- Stop when you have ${query.maxResults} unique organizations or when further searches yield nothing new.
- Don't fabricate data. If a phone or address isn't in the source, leave it null.
- Prefer search_source for structured business listings when the right source exists.

Target query: "${query.query}"${cityClause}
Target count: ${query.maxResults}`
}

export function buildUserPrompt(query: SearchQuery): string {
    const cityClause = query.city ? ` in ${query.city}` : ''
    return `Find up to ${query.maxResults} organizations matching: "${query.query}"${cityClause}. Begin by choosing a strategy, then execute tools. Emit results via report_results as you find them.`
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/prompts.ts
```

---

## Task 15: Implement the agent loop

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/loop.ts`

- [ ] **Step 1: Write the loop**

Create `packages/org-scraper/src/sources/ai-agent/loop.ts`:

```typescript
import { OpenAI } from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { Tool, toOpenAISchema } from "./tools"
import { ResolvedAIAgentConfig } from "./config"
import { buildSystemPrompt, buildUserPrompt } from "./prompts"
import { SearchQuery } from "../../types"
import log from "@logger"

export async function runAgentLoop(
    client: OpenAI,
    query: SearchQuery,
    tools: Tool[],
    cfg: ResolvedAIAgentConfig,
): Promise<void> {
    const toolByName = new Map(tools.map(t => [t.name, t]))
    const openAITools = tools.map(toOpenAISchema)

    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt(query) },
        { role: 'user', content: buildUserPrompt(query) },
    ]

    let toolCallsUsed = 0
    const startTime = Date.now()

    while (true) {
        if (Date.now() - startTime > cfg.totalTimeoutMs) {
            log.warn(`ai-agent: total timeout (${cfg.totalTimeoutMs}ms) exceeded`)
            return
        }

        let response
        try {
            response = await client.chat.completions.create({
                model: cfg.model,
                temperature: cfg.temperature,
                messages,
                tools: openAITools,
                tool_choice: 'auto',
            })
        } catch (e: any) {
            log.error(`ai-agent: LLM request failed: ${e.message ?? e}`)
            return
        }

        const choice = response.choices?.[0]
        if (!choice) {
            log.warn('ai-agent: LLM returned no choices')
            return
        }

        const assistantMsg = choice.message
        messages.push(assistantMsg as ChatCompletionMessageParam)

        const toolCalls = assistantMsg.tool_calls ?? []
        if (toolCalls.length === 0) {
            // Agent ended with a content message — done.
            return
        }

        for (const call of toolCalls) {
            if (call.type !== 'function') {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: 'unsupported tool call type' }),
                })
                continue
            }

            if (toolCallsUsed >= cfg.maxToolCalls) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: 'max tool calls reached, wrap up with report_results' }),
                })
                continue
            }
            toolCallsUsed++

            const tool = toolByName.get(call.function.name)
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `unknown tool "${call.function.name}"` }),
                })
                continue
            }

            let parsed: any
            try {
                parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {}
            } catch (e: any) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `invalid arguments: ${e.message ?? e}` }),
                })
                continue
            }

            const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs)
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            })
        }
    }
}

async function executeWithTimeout(tool: Tool, args: any, timeoutMs: number): Promise<any> {
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<any>(resolve => {
        timer = setTimeout(() => resolve({ error: `tool "${tool.name}" timeout after ${timeoutMs}ms` }), timeoutMs)
    })
    try {
        const result = await Promise.race([
            tool.handler(args).catch(e => ({ error: String(e?.message ?? e) })),
            timeoutPromise,
        ])
        return result
    } finally {
        if (timer) clearTimeout(timer)
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/loop.ts
```

---

## Task 16: Implement `AIAgentSource`

**Files:**
- Create: `packages/org-scraper/src/sources/ai-agent/index.ts`

- [ ] **Step 1: Write the source**

Create `packages/org-scraper/src/sources/ai-agent/index.ts`:

```typescript
import { IScraperSource } from "../types"
import { OrgData, SearchQuery } from "../../types"
import type { ServiceContext } from "../../exporters/types"
import { resolveAIAgentConfig } from "./config"
import { createClient } from "./client"
import { AsyncQueue } from "./async-queue"
import { buildTools, ReportState } from "./tools"
import { runAgentLoop } from "./loop"
import log from "@logger"

export class AIAgentSource implements IScraperSource {
    readonly name = 'ai-agent'
    readonly requiresApiKey = false

    async* search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
    ): AsyncGenerator<OrgData> {
        const cfg = await resolveAIAgentConfig(context)
        if (!cfg) {
            log.warn('ai-agent: baseUrl or model not configured (system or user), skipping')
            return
        }

        const client = createClient(cfg)
        const queue = new AsyncQueue<OrgData>()
        const reportState: ReportState = { yielded: 0 }
        const tools = buildTools(query, queue, cfg, reportState)

        const loopPromise = runAgentLoop(client, query, tools, cfg)
            .catch(e => log.error(`ai-agent loop error: ${e?.message ?? e}`))
            .finally(() => queue.close())

        let found = 0
        for await (const org of queue) {
            found++
            onProgress(found)
            yield org
            if (found >= query.maxResults) break
        }

        await loopPromise
    }
}
```

- [ ] **Step 2: Build**

Run: `npm run build:scraper`
Expected: builds cleanly.

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/ai-agent/index.ts
```

---

## Task 17: Register `ai-agent` in the source registry

**Files:**
- Modify: `packages/org-scraper/src/sources/index.ts`

- [ ] **Step 1: Update the registration file**

Replace the contents of `packages/org-scraper/src/sources/index.ts` with:

```typescript
import { SourceRegistry } from "./registry"
import { GoogleSearchSource } from "./google-search"
import { YandexSearchSource } from "./yandex-search"
import { YandexBusinessSource } from "./yandex-business"
import { AvitoSource } from "./avito"
import { AIAgentSource } from "./ai-agent"

export { SourceRegistry } from "./registry"
export type { IScraperSource, ScraperSourceFactory } from "./types"

export function registerSources() {
    SourceRegistry.register('google', () => new GoogleSearchSource())
    SourceRegistry.register('yandex', () => new YandexSearchSource())
    SourceRegistry.register('yandex-business', () => new YandexBusinessSource())
    SourceRegistry.register('avito', () => new AvitoSource())
    SourceRegistry.register('ai-agent', () => new AIAgentSource())
}
```

- [ ] **Step 2: Build all packages**

Run: `npm run build`
Expected: builds cleanly end-to-end (org-scraper + app).

- [ ] **Step 3: Stage**

```bash
git add packages/org-scraper/src/sources/index.ts
```

---

## Task 18: End-to-end type check and SDK tests

**Files:** none

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: all three packages build cleanly. No TS errors.

- [ ] **Step 2: SDK tests still pass**

Run: `npm run test`
Expected: `@cmd-hub/core` test suite passes. (We didn't change the SDK; this confirms nothing upstream broke.)

---

## Task 19: Manual verification

**Files:** none — this task is operational.

Each scenario needs the app running against a real LLM endpoint. Use `npm run start` to launch.

- [ ] **Scenario 1: Config sanity**

In the bot UI:
```
/config scraper aiAgent {"baseUrl":"http://localhost:11434/v1","model":"qwen2.5:7b"}
/config scraper
```
Expected: second command shows the `aiAgent` block with the values set.

- [ ] **Scenario 2: Missing config skips cleanly**

Clear config:
```
/config scraper aiAgent {}
```
Then start a scrape using only `ai-agent`:
```
/scrape query:"coffee shops" sources:ai-agent limit:5
```
Expected: logs show `ai-agent: baseUrl or model not configured, skipping`. Service completes with zero results from `ai-agent`. No crash.

- [ ] **Scenario 3: Local Ollama happy path**

Requires: Ollama running locally with a model pulled (e.g. `ollama pull qwen2.5:7b`).

```
/config scraper aiAgent {"baseUrl":"http://localhost:11434/v1","model":"qwen2.5:7b"}
/scrape query:"coffee shops moscow" sources:ai-agent limit:10
```
Expected: progress bar advances, results stream in, final count ≈ 10. Inspect logs for `ai-agent` tool-call activity (`web_search`, `fetch_url`, `search_source`, `report_results`).

- [ ] **Scenario 4: Per-user override**

As user A (primary user — the one whose session runs the command):
```
/sconfig scraper aiAgent.model llama3.1:8b
/sconfig scraper
```
Expected: `sconfig scraper` shows `aiAgent.model` set. Run the same scrape — check trace/debug logs to confirm `llama3.1:8b` is hit on Ollama (not the system default). Then clear:
```
/sconfig scraper aiAgent.model ""
```
(or `/sconfig scraper --clear`) and verify fallback to system model.

- [ ] **Scenario 5: Web search provider switch**

Set provider explicitly:
```
/config scraper aiAgent.webSearchProvider duckduckgo
```
Run a query that nudges the agent to use `web_search` (e.g. `/scrape query:"independent bookstores london" sources:ai-agent limit:5`). Check logs for `ai-agent.web_search[duckduckgo]` entries. Repeat with `serpapi` (requires `serpApiKey`) and `yandex` (requires `yandexXmlUser`+`yandexXmlKey`).

- [ ] **Scenario 6: Delegation to existing sources**

With Russian-language query, the prompt should guide the agent toward `search_source`:
```
/scrape query:"кафе москва" sources:ai-agent limit:10
```
Expected: trace logs show at least one `ai-agent.search_source[...]` call (typically to `yandex-business`, `2gis`, or `avito`).

- [ ] **Scenario 7: Safety limit enforcement**

Force a tight budget:
```
/config scraper aiAgent.maxToolCalls 3
/scrape query:"restaurants berlin" sources:ai-agent limit:20
```
Expected: agent loop exits after 3 tool calls. Logs show `max tool calls reached, wrap up with report_results`. Final result count matches whatever the agent emitted in those 3 calls (possibly 0).

Restore after:
```
/config scraper aiAgent.maxToolCalls 25
```

- [ ] **Scenario 8: Combined with other sources**

```
/scrape query:"кафе москва" sources:ai-agent,2gis limit:20
```
Expected: both sources run (serially per existing scraper behavior). Dedup happens across sources via `OrgScraper.addOrg()` — same-name+phone pairs merge.

---

## Self-Review

**Spec coverage check** — walking through the spec sections:
- §3.1 file layout → Tasks 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 (one file each), Task 17 (registry). ✓
- §3.2 interface change → Task 3. ✓
- §3.3 `AIAgentSource` high-level flow → Task 16. ✓
- §3.4 `requiresApiKey = false` rationale → implemented in Task 16, self-gates in Task 16 Step 1 and Task 6 (returns null when baseUrl/model missing). ✓
- §4.1 system config shape → Task 2. ✓
- §4.2 per-user overrides via existing `/sconfig` → verified in Task 19 Scenario 4 (no code changes needed — existing command works). ✓
- §4.3 merge order → Task 6. ✓
- §5.1 loop pseudocode → Task 15. ✓
- §5.2 system prompt → Task 14. ✓
- §5.3 four tool contracts → Tasks 9, 10, 11, 12. ✓
- §6 error handling (tool-level, agent-level, startup gates, content-level) → covered across Tasks 9–12 (catch/wrap into `{ error }`), Task 15 (LLM failures, timeouts, maxToolCalls, malformed args), Task 16 (startup gate), Task 12 (content validation). ✓
- §7 manual verification → Task 19. ✓
- §8 out-of-scope → explicitly not implemented; no task needed. ✓

**Placeholder scan** — no TBDs, no "add appropriate X", no "similar to Task N", no skipped code blocks. ✓

**Type consistency** —
- `ResolvedAIAgentConfig` defined in Task 6, used in Tasks 7, 13, 15, 16. Matches.
- `Tool` interface in Task 8, used in Tasks 9, 10, 11, 12, 13, 15. Matches.
- `AsyncQueue<OrgData>` in Task 5, used in Tasks 12, 13, 16. Matches.
- `ReportState` defined in Task 13 (exported from `tools/index.ts`), used in Task 16 import path matches. Also referenced inside Task 12's `makeReportResultsTool` signature — both use the same `{ yielded: number }` shape. ✓
- `buildTools(query, queue, cfg, state)` signature in Task 13 matches the call site in Task 16. ✓
- `ServiceContext` imported from `../exporters/types` consistently (Task 3, Task 4 scraper.ts, Task 6, Task 16). ✓
- Tool names (`web_search`, `fetch_url`, `search_source`, `report_results`) consistent across prompt (Task 14), schemas (Tasks 9–12), and loop dispatch (Task 15 via `toolByName` map keyed on `tool.name`). ✓

**Commit policy** — every task's final step says "Stage" and never "Commit". The plan header calls this out explicitly. ✓

---

**End of plan.**
