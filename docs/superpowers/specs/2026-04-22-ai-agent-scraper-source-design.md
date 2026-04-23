# AI Agent Scraper Source — Design

**Date:** 2026-04-22
**Status:** Approved, pending implementation plan
**Scope:** First cut — single-threaded, sequential, single-endpoint. Parallelism and shared worker pool are deferred to future specs.

## 1. Overview

Add a new scraper source, `ai-agent`, that uses a local (or remote) OpenAI-compatible LLM as an autonomous research agent. Given a `SearchQuery`, the agent drives the search itself: it picks what to query, delegates to other registered sources when useful, fetches web pages, extracts organization data, and streams results back through the existing scraper pipeline.

The source follows the same `IScraperSource` contract as `google`, `yandex`, `avito`, `2gis`, etc. It slots into the existing scraper flow with no changes to user-facing commands.

## 2. Goals and non-goals

### Goals
- A new `ai-agent` source that plugs into `SourceRegistry` alongside existing sources.
- OpenAI-compatible HTTP client configurable to point at Ollama, LM Studio, llama.cpp server, vLLM, or a remote provider — one code path, one dependency (`openai` SDK).
- The agent has four tools: `web_search`, `fetch_url`, `search_source` (delegate to another registered source), `report_results` (stream findings back).
- Two-layer config: system-level (`IScraperConfig.aiAgent`) as default; per-user override via `/sconfig scraper aiAgent.<key>`. User config wins when both are set.
- Safety limits prevent runaway agents: max tool calls, per-tool timeout, total wall-clock timeout.
- Streaming results — `report_results` emits orgs into the scraper generator as the agent finds them, so the dashboard progress bar moves in real time.
- Configurable web-search backend (`serpapi` | `yandex` | `duckduckgo`).

### Non-goals (deferred to future specs)
- Parallel tool-call execution within one LLM response.
- Worker threads for CPU-bound work (HTML parsing).
- Sub-agent fan-out (`spawn_agents`).
- Multi-endpoint load balancing.
- A cmd-hub SDK-level shared worker pool.
- An OS-style scheduler integrated with the pool.
- Unit tests for the source (existing org-scraper sources have none; we match that pattern and rely on manual verification).

## 3. Architecture

### 3.1 File layout

```
packages/org-scraper/src/sources/ai-agent/
├── index.ts              # AIAgentSource class — IScraperSource impl, public export
├── client.ts             # OpenAI-compatible client wrapper (baseUrl + apiKey + model)
├── loop.ts               # Agent iteration loop: chat → tool calls → tool results → repeat
├── prompts.ts            # System prompt template
└── tools/
    ├── index.ts          # Assembles the tool registry passed to the loop
    ├── types.ts          # Tool interface (name, description, JSON schema, handler)
    ├── web-search.ts     # Tool: web_search(query, limit?)
    ├── fetch-url.ts      # Tool: fetch_url(url, mode?)
    ├── delegate-source.ts# Tool: search_source(source, query, limit?)
    └── report-results.ts # Tool: report_results(orgs) — pushes into the yield queue
```

Registered in `packages/org-scraper/src/sources/index.ts`:
```typescript
SourceRegistry.register('ai-agent', () => new AIAgentSource())
```

New dependency: `openai` in `packages/org-scraper/package.json`.

### 3.2 `IScraperSource` interface change

The agent needs per-user config via `ServiceContext`, which sources currently don't receive. Extend the interface:

```typescript
// packages/org-scraper/src/sources/types.ts
import { ServiceContext } from "../exporters/types"

export interface IScraperSource {
    readonly name: string
    readonly requiresApiKey: boolean
    search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,   // NEW — optional, backwards-compatible
    ): AsyncGenerator<OrgData>
}
```

Existing sources don't need to change — the parameter is optional and they ignore it. Thread the context through:

- `packages/org-scraper/src/scraper-service/scraper.ts` — `OrgScraper.run()` accepts `context?: ServiceContext`, forwards it to `source.search(query, onProgress, context)`.
- `packages/org-scraper/src/scraper-service/service.ts` — passes the already-available user context into `scraper.run()`. (The service has access to the user context because `OrgScraperService` is user-scoped.)

### 3.3 `AIAgentSource` — high-level flow

```typescript
class AIAgentSource implements IScraperSource {
    readonly name = 'ai-agent'
    readonly requiresApiKey = false  // see 3.4 for why

    async* search(query, onProgress, context) {
        const cfg = mergeConfig(await getScraperConfig(), context)
        if (!cfg.baseUrl || !cfg.model) {
            log.warn("ai-agent: baseUrl or model not configured, skipping")
            return
        }

        const client = createClient(cfg)
        const queue = new AsyncQueue<OrgData>()   // report_results pushes here
        const tools = buildTools(query, queue, cfg, context)

        // Fire-and-forget: loop drives the agent and pushes to queue
        const loopPromise = runLoop(client, query, tools, cfg)
            .catch(e => log.error(`ai-agent loop error: ${e.message ?? e}`))
            .finally(() => queue.close())

        let found = 0
        for await (const org of queue) {
            found++
            onProgress(found)
            yield org
            if (found >= query.maxResults) break
        }

        await loopPromise  // ensure loop finishes or errors are surfaced
    }
}
```

`AsyncQueue` is a small helper inside the ai-agent folder — a bounded async iterator with `push()` / `close()` / async iteration. Nothing fancy; ~30 lines.

### 3.4 Why `requiresApiKey = false`

The existing `requiresApiKey` field gates a source from running if no API key is set. For the ai-agent:
- Local servers (Ollama) typically don't need an API key.
- The real startup gate is `baseUrl` + `model`, not `apiKey`.

So `requiresApiKey` stays `false`. The source checks `baseUrl` and `model` itself at the top of `search()` and bails out cleanly (logs a warning, returns empty generator) if either is missing. This matches the `google-search.ts:13` pattern of self-gating inside `search()`.

## 4. Configuration

### 4.1 System-level shape

Extend `IScraperConfig` in `packages/org-scraper/src/scraper-config.ts`:

```typescript
export interface IScraperConfig {
    // ... existing fields ...

    aiAgent?: {
        baseUrl: string               // e.g. http://localhost:11434/v1, http://localhost:1234/v1, https://api.openai.com/v1
        apiKey?: string               // optional (local servers often don't need one)
        model: string                 // e.g. "llama3.1:8b", "qwen2.5:14b", "gpt-4o-mini"
        temperature?: number          // default 0.2
        webSearchProvider?: 'serpapi' | 'yandex' | 'duckduckgo'  // default: auto (first available key)
        maxToolCalls?: number         // default 25
        toolTimeoutMs?: number        // default 60000
        totalTimeoutMs?: number       // default 300000 (5 min)
    }
}
```

Set via `/config scraper` (MongoDB `SystemConfig`) using existing infrastructure:
```
/config scraper aiAgent {"baseUrl":"http://localhost:11434/v1","model":"qwen2.5:14b"}
/config scraper aiAgent.model qwen2.5:14b
```

### 4.2 Per-user overrides

Per-user overrides use the existing `/sconfig scraper` mechanism (`packages/cmd-hub/src/ui/command-processor/built-in-cmd/sconfig-cmd.ts`). The sconfig command already supports dotted keys and JSON values — no new command needed.

```
/sconfig scraper aiAgent.model qwen2.5:14b
/sconfig scraper aiAgent.baseUrl http://localhost:11434/v1
/sconfig scraper aiAgent {"model":"qwen2.5:14b","temperature":0.3}
```

Per-user values live in `AccountModule.data.config.aiAgent.*` and are read from `ServiceContext.config.aiAgent`.

### 4.3 Merge order

Inside the source:
```typescript
const systemCfg = (await getScraperConfig()).aiAgent ?? {}
const userCfg   = (context?.config as any)?.aiAgent ?? {}

const merged = {
    baseUrl:           userCfg.baseUrl           ?? systemCfg.baseUrl,
    apiKey:            userCfg.apiKey            ?? systemCfg.apiKey,
    model:             userCfg.model             ?? systemCfg.model,
    temperature:       userCfg.temperature       ?? systemCfg.temperature       ?? 0.2,
    webSearchProvider: userCfg.webSearchProvider ?? systemCfg.webSearchProvider ?? autoPickProvider(systemCfg),
    maxToolCalls:      userCfg.maxToolCalls      ?? systemCfg.maxToolCalls      ?? 25,
    toolTimeoutMs:     userCfg.toolTimeoutMs     ?? systemCfg.toolTimeoutMs     ?? 60_000,
    totalTimeoutMs:    userCfg.totalTimeoutMs    ?? systemCfg.totalTimeoutMs    ?? 300_000,
}
```

User-level keys win over system-level. This matches the existing `google-sheets.ts` pattern.

`autoPickProvider(systemCfg)` picks the first available: if `serpApiKey` is set → `serpapi`; else if `yandexXmlUser`+`yandexXmlKey` set → `yandex`; else `duckduckgo`.

## 5. The agent loop

### 5.1 Pseudocode

```
runLoop(client, query, tools, cfg):
    messages = [systemPrompt(query), userPrompt(query)]
    toolCallsUsed = 0
    startTime = now()

    while true:
        if now() - startTime > cfg.totalTimeoutMs:
            log warning "ai-agent: total timeout exceeded"
            return

        response = await client.chat.completions.create({
            model: cfg.model,
            temperature: cfg.temperature,
            messages,
            tools: tools.toOpenAISchemas(),
            tool_choice: 'auto',
        })

        assistantMsg = response.choices[0].message
        messages.push(assistantMsg)

        if !assistantMsg.tool_calls or assistantMsg.tool_calls.length == 0:
            # Agent chose to end with a content message. Done.
            return

        # Execute tool calls SEQUENTIALLY (parallel is deferred to future spec)
        for call in assistantMsg.tool_calls:
            if toolCallsUsed >= cfg.maxToolCalls:
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: 'max tool calls reached, wrap up with report_results' })
                })
                continue

            toolCallsUsed++
            result = await executeToolWithTimeout(call, tools, cfg.toolTimeoutMs)
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
```

`executeToolWithTimeout` runs the handler inside `Promise.race([handler(args), timeoutReject(ms)])`. On timeout or handler error, it returns `{ error: '<msg>' }` — never throws. The loop keeps running; the agent sees the error and adjusts.

### 5.2 System prompt

Lives in `prompts.ts`:

```
You are an organization research agent. Given a search query, find real businesses matching it.

Available tools:
- web_search(query, limit): general web search via the configured provider.
- fetch_url(url, mode): fetch a web page. mode='text' returns extracted text, 'html' returns raw HTML (truncated).
- search_source(source, query, limit): delegate to a specialized scraper source. Available sources: {availableSources}. This is often the fastest way to get structured business data.
- report_results(orgs): emit found organizations immediately. Call this as soon as you have results — do not wait until the end.

Each organization must have:
- name (required, string)
- at least one of: phone, email, address
- source (string — where you found it)
- url (optional)

Rules:
- Call report_results as soon as you find valid orgs. Don't batch everything to the end.
- Stop when you have {maxResults} unique organizations or when further searches yield nothing new.
- Don't fabricate data. If a phone or address isn't in the source, leave it null.
- Prefer search_source for structured business listings when the right source exists.

Target query: "{query}"{cityClause}
Target count: {maxResults}
```

`{availableSources}` = `SourceRegistry.available().filter(n => n !== 'ai-agent')`.
`{cityClause}` = ` in ${city}` if city is set, else empty.

### 5.3 Tool contracts (JSON schemas)

Each tool defines the shape the LLM receives. Handlers live in individual files.

```typescript
// tools/types.ts
export interface Tool {
    name: string
    description: string
    parameters: Record<string, any>  // JSON Schema
    handler(args: any): Promise<any>
}
```

**`web_search`**
```
parameters: {
    type: 'object',
    properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
    },
    required: ['query'],
}
returns: { results: Array<{ title: string, url: string, snippet: string }> }
```
Provider dispatch: `serpapi` uses existing SerpAPI key and endpoint; `yandex` uses existing Yandex XML creds; `duckduckgo` hits `https://html.duckduckgo.com/html/` and cheerio-parses the results (no key needed). Errors return `{ results: [], error: '<msg>' }`.

**`fetch_url`**
```
parameters: {
    type: 'object',
    properties: {
        url: { type: 'string' },
        mode: { type: 'string', enum: ['text','html'], default: 'text' },
    },
    required: ['url'],
}
returns: { status: number, content: string, truncated: boolean, error?: string }
```
Uses `axios` with 15s timeout (overridden by `toolTimeoutMs` outer wrapper). `text` mode: `cheerio.load(html)` → strip script/style → `$('body').text()`. `html` mode: raw HTML. Both modes truncate `content` to 15000 characters; set `truncated: true` if cut.

**`search_source`**
```
parameters: {
    type: 'object',
    properties: {
        source: { type: 'string', description: 'Source name from the available list' },
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    required: ['source', 'query'],
}
returns: { orgs: OrgData[], error?: string }
```
Recursion guard: rejects `source === 'ai-agent'` with `{ orgs: [], error: 'cannot recurse into ai-agent' }`. Rejects unknown sources with the registry's "Unknown source" error wrapped in `{ orgs: [], error: ... }`. Creates a transient `SearchQuery` with `sources: [source]`, `maxResults: limit`, and the agent's query, collects up to `limit` orgs, returns them.

**`report_results`**
```
parameters: {
    type: 'object',
    properties: {
        orgs: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name:    { type: 'string' },
                    source:  { type: 'string' },
                    phone:   { type: ['string','null'] },
                    email:   { type: ['string','null'] },
                    address: { type: ['string','null'] },
                    url:     { type: 'string' },
                },
                required: ['name', 'source'],
            },
        },
    },
    required: ['orgs'],
}
returns: { accepted: number, rejected: number, totalYielded: number }
```
Handler validates each org: requires non-empty `name`, and at least one of `phone|email|address`. Invalid orgs counted in `rejected`. Valid orgs pushed to the `AsyncQueue`. Handler returns so the agent knows how many passed — the agent can use `totalYielded` vs `query.maxResults` to decide when to stop.

## 6. Error handling

### 6.1 Tool-level
- Any tool handler exception → caught, returned as `{ error: '<msg>' }` (or provider-appropriate shape: `{ results: [], error }`, `{ orgs: [], error }`, etc.).
- Tool timeout (`Promise.race` against `toolTimeoutMs`) → same `{ error: 'tool timeout' }` shape.
- `fetch_url` HTTP 4xx/5xx → `{ status, content: '', error: 'HTTP <code>' }`. Not treated as exception.

### 6.2 Agent-level
- LLM returns malformed tool args → JSON parse wrapped in try/catch; on failure return `{ error: 'invalid arguments: <detail>' }`.
- LLM API unreachable / auth failure → logged via `@logger` with `error` level; loop exits; source yields whatever was already in the queue.
- `maxToolCalls` exceeded → remaining tool calls in the current response get `{ error: 'max tool calls reached, wrap up with report_results' }`. Loop continues for one more round so the agent can call `report_results` with what it has, then exits.
- `totalTimeoutMs` exceeded → logged as warning; loop exits cleanly. Already-reported orgs stay in the queue.

### 6.3 Startup gates
- Missing `baseUrl` or `model` (system + user both empty) → logged as warning, generator returns with zero results. Matches `google-search.ts:13` pattern.

### 6.4 Content-level
- `report_results` receives malformed orgs → individual orgs dropped, counted in `rejected`, handler still returns success.
- Dedup is handled by the existing `OrgScraper.addOrg()` — duplicates across the agent's batches are silently merged upstream.
- Pages >15000 chars → truncated in `fetch_url`; `truncated: true` returned so the agent can fetch a different URL if truncation matters.

## 7. Manual verification plan

No automated tests (matching org-scraper's existing pattern). Verify by:

1. **Local Ollama happy path.** Install Ollama + `qwen2.5:7b` or similar. Configure `/config scraper aiAgent {"baseUrl":"http://localhost:11434/v1","model":"qwen2.5:7b"}`. Run `/scrape "coffee shops moscow" --sources ai-agent --limit 10`. Expect progress bar to advance, results to stream into the dashboard, final count ≈ 10.
2. **LM Studio endpoint.** Point `baseUrl` at `http://localhost:1234/v1`. Same flow.
3. **Remote OpenAI.** Point `baseUrl` at `https://api.openai.com/v1`, set `apiKey`, use `gpt-4o-mini`. Same flow.
4. **Per-user override.** As user A: `/sconfig scraper aiAgent.model llama3.1:8b`. As user B: no override. Both run the same command — logs should show each using their own model.
5. **Web search provider switch.** Set `aiAgent.webSearchProvider` to each of `serpapi`, `yandex`, `duckduckgo` in turn. Verify via logs that each provider is actually hit.
6. **Delegation to existing source.** With a fast local model, prompt should lead the agent to call `search_source('2gis', ...)` for Russian queries. Verify via trace logs.
7. **Safety limits.** Set `maxToolCalls: 3`. Run a query. Expect loop to exit after 3 tool calls, with whatever results `report_results` received up to that point.
8. **Missing config.** Clear both system and user `aiAgent` config. Run the command — expect clean skip with warning log, zero results, no crash.

## 8. Out of scope (future specs)

When the time comes, these become separate design documents:

- **SDK shared worker pool** — `@core/worker-pool` with pluggable task registration, numeric priorities 0–20, quota + priority scheduling semantics.
- **SDK scheduler** — built on top of the worker pool; recurring/delayed tasks, aging, fair-share, cancellation/retry policy, lifecycle observability.
- **AI-agent parallelism upgrade** — parallel tool calls within one LLM response, HTML parsing via worker pool, `spawn_agents` stateless fan-out, multi-endpoint load balancing. Consumes the shared pool + scheduler when those land.

Each of those has its own design conversation and spec.
