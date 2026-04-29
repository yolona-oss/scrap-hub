# AI-Agent PR2 — Extractor Sub-Agent (One-Shot, No Refetch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a focused LLM sub-agent that escalates from `extract_contacts` when deterministic strategies miss on substantive pages. Lands cold (no caller until PR4) but is fully wired through `extract_contacts` itself, so any future caller of that tool gets escalation for free.

**Architecture:** A small loop module under `examples/scraper-node/src/sources/ai-agent/extractor/` runs an OpenAI-compatible chat completion with a tight tool set: `read_blocks`, `read_json_blob`, `report_extraction`, `report_incomplete`. Refetch (`refetch`) is reserved for PR3. The extractor consumes a pre-extracted `ExtractorInput` (cleanedText + candidateBlocks + jsonLdBlobs) — it never sees raw HTML. Escalation triggers from `extract-contacts.ts:60-95` when deterministic strategies miss but the page is substantive (text > 500 chars, or phone-fragments-no-complete-phone, or substantive script blob with empty JSON-LD).

**Tech Stack:** TypeScript, Node 20, OpenAI SDK 4.77 (already wired), cheerio 1.0, Jest 30 (ts-jest).

**Spec reference:** `docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md` §3.5, PR2 (refetch deferred to PR3).

---

## File Structure

All new files under `examples/scraper-node/src/sources/ai-agent/extractor/`. The module is internal — no LLM-facing tool surface (the parent agent's `extract_contacts` is the only consumer, and even that calls into the extractor as an internal escalation, not as a parent-tool call).

| File | Responsibility |
|---|---|
| `extractor/types.ts` | `ExtractorInput`, `ExtractionResult`, `ExtractorTool`, `ExtractorReport`. Mirrors but does not extend `tools/types.ts` because extractor tools have a different signature (no abort signal threading, terminal vs. non-terminal split). |
| `extractor/config.ts` | `ResolvedExtractorConfig` + `resolveExtractorConfig(parentCfg, args)`. Returns null when parent is null OR `extractor.enabled === false`. |
| `extractor/prompts.ts` | System prompt + per-tool hints. |
| `extractor/loop.ts` | `runExtractor(input, cfg, signal): Promise<ExtractionResult>`. Runs an OpenAI chat completion in a tight loop until terminal tool call OR `maxToolCallsPerPage` OR `timeoutMs`. |
| `extractor/index.ts` | Re-exports `runExtractor`, `ExtractorInput`, `ExtractionResult`, `resolveExtractorConfig`. |
| `extractor/tools/read-blocks.ts` | Server-side tool: returns extra pre-extracted blocks by selector keyword. |
| `extractor/tools/read-json-blob.ts` | Server-side tool: parses a `<script>` blob from `input.nextDataBlob` or `input.jsonLdBlobs`. |
| `extractor/tools/report-extraction.ts` | Terminal tool: validates structured output, returns the result. |
| `extractor/tools/report-incomplete.ts` | Terminal tool: hands back diagnostics. |

| File | Modification |
|---|---|
| `scraper-service/args-tree.ts:115-130` | Add `extractor?: ExtractorSettings` field to `AIAgentSettings`; define `ExtractorSettings` class with `enabled`, `model`, `baseUrl`, `apiKey`, `temperature`, `maxToolCallsPerPage`, `timeoutMs`. **No `maxRefetches`** — PR3. |
| `sources/ai-agent/tools/extract-contacts.ts:48-98` | Add escalation path: when no contacts found AND page is substantive AND extractor is configured AND `enabled`, call `runExtractor(...)`. Merge the result into `acc`. |
| `sources/ai-agent/config.ts:5-13` | Extend `ResolvedAIAgentConfig` with optional `extractor: ResolvedExtractorConfig | null` field. |
| `examples/scraper-node/config.json` | No change required — the new args slice has defaults. |

Tests:

| File | Covers |
|---|---|
| `extractor/__tests__/types.test.ts` | Type shapes (compile-time exhaustiveness checks). |
| `extractor/__tests__/config.test.ts` | `resolveExtractorConfig` inheritance and disable paths. |
| `extractor/__tests__/loop.test.ts` | Integration with mocked OpenAI client: terminal tool calls, budget exhaustion, timeout. |
| `extractor/tools/__tests__/read-blocks.test.ts` | Block selector lookup. |
| `extractor/tools/__tests__/read-json-blob.test.ts` | JSON blob retrieval. |
| `extractor/tools/__tests__/report-extraction.test.ts` | Result validation gate. |
| `extractor/tools/__tests__/report-incomplete.test.ts` | Incomplete diagnostic shape. |
| `tools/__tests__/extract-contacts.test.ts` | Append: escalation path triggers + happy-path passes through. |

OpenAI mocking pattern: jest.mock the `client.ts` module to return a stub `OpenAI` instance whose `chat.completions.create` resolves to scripted responses per call. This is the same pattern as the existing `loop-phases.test.ts` tests.

---

## Decisions Locked Before Implementation

- **Single-model default**: when `extractor.model` is unset, falls back to parent's `model`. Same for `baseUrl`. Documented in arg description: *"Different model recommended (e.g. smaller/faster); falls back to parent's model when unset."*
- **`extractor.enabled: true` by default.** PR2 lands cold (no caller until PR4 wires the deepening loop), so this default has no runtime effect today; the choice signals intent.
- **`maxToolCallsPerPage: 8`** default. **`timeoutMs: 45000`** default. **`temperature: 0.1`** default.
- **No refetch in PR2.** The `refetch` tool, `maxRefetches` arg, and same-origin enforcement all land in PR3.
- **Extractor input is pre-extracted server-side.** The extractor never sees raw HTML — `cleanedText` is capped at 8K chars, `candidateBlocks` are pre-extracted by `extract-contacts`, `jsonLdBlobs` are already parsed.
- **Escalation triggers** (any one):
  - Zero contacts found AND `cleanedText.length > 500`.
  - At least one phone-shaped fragment (digits matching loose pattern) but no complete phone matched.
  - Substantive `<script>` blob present (`__NEXT_DATA__` non-empty OR any JSON-LD blob length > 200 chars) but JSON-LD strategy yielded nothing.
- **Worktree:** `.worktrees/ai-agent-extractor`, branch `feature/ai-agent-extractor`. Already created and `npm install`ed; baseline 144 ai-agent tests green.

---

## Task 1: Extractor types module

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/types.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/types.test.ts`:

```typescript
import type {
    ExtractorInput,
    ExtractionResult,
    ExtractorTool,
    ExtractorReport,
} from '../types'

describe('extractor types', () => {
    it('ExtractorInput has the expected required and optional fields', () => {
        const input: ExtractorInput = {
            url: 'https://example.com/',
            pageType: 'org-site',
            cleanedText: 'about us...',
            candidateBlocks: [],
            jsonLdBlobs: [],
            knownGoals: ['phone', 'address'],
            partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
        }
        expect(input.knownGoals).toEqual(['phone', 'address'])
    })

    it('ExtractionResult shape', () => {
        const r: ExtractionResult = {
            outcome: 'extraction',
            phones: ['+78121001010'],
            emails: [],
            addresses: [],
            candidateName: 'Acme',
            confidence: 0.85,
            notes: ['phone via extractor'],
            toolCallsUsed: 3,
        }
        expect(r.outcome).toBe('extraction')
        expect(r.confidence).toBe(0.85)
    })

    it('ExtractionResult can be incomplete', () => {
        const r: ExtractionResult = {
            outcome: 'incomplete',
            reason: 'no contact markers found',
            hints: ['try /contacts page'],
            toolCallsUsed: 5,
        }
        expect(r.outcome).toBe('incomplete')
    })

    it('ExtractorTool has name, description, parameters, handler, and a terminal flag', () => {
        const t: ExtractorTool = {
            name: 'noop',
            description: 'no op',
            parameters: { type: 'object', properties: {} },
            terminal: false,
            handler: async () => ({ ok: true }),
        }
        expect(t.terminal).toBe(false)
    })

    it('ExtractorReport allows extraction or incomplete', () => {
        const r1: ExtractorReport = { outcome: 'extraction', phones: ['+7'], emails: [], addresses: [], candidateName: '', confidence: 0.5 }
        const r2: ExtractorReport = { outcome: 'incomplete', reason: 'no hits' }
        expect(r1.outcome).toBe('extraction')
        expect(r2.outcome).toBe('incomplete')
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-extractor/examples/scraper-node
npx jest src/sources/ai-agent/extractor/__tests__/types.test.ts -v
```
Expected: FAIL with "Cannot find module '../types'".

- [ ] **Step 3: Implement the types**

Create `examples/scraper-node/src/sources/ai-agent/extractor/types.ts`:

```typescript
import type { Block, PageType } from '../page-types'

export type ExtractorGoal = 'phone' | 'email' | 'address' | 'name'

export interface ExtractorInput {
    url: string
    pageType: PageType
    cleanedText: string
    candidateBlocks: Block[]
    jsonLdBlobs: unknown[]
    nextDataBlob?: unknown
    knownGoals: ExtractorGoal[]
    partialResult: {
        phones: string[]
        emails: string[]
        addresses: string[]
        candidateName: string
    }
}

export interface ExtractorReportExtraction {
    outcome: 'extraction'
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    confidence: number
    notes?: string[]
}

export interface ExtractorReportIncomplete {
    outcome: 'incomplete'
    reason: string
    hints?: string[]
}

export type ExtractorReport = ExtractorReportExtraction | ExtractorReportIncomplete

export type ExtractionResult =
    | (ExtractorReportExtraction & { toolCallsUsed: number })
    | (ExtractorReportIncomplete & { toolCallsUsed: number })

export interface ExtractorTool {
    name: string
    description: string
    parameters: Record<string, any>
    terminal: boolean
    handler: (args: any, ctx: { input: ExtractorInput }) => Promise<unknown>
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/types.test.ts -v
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/extractor/types.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/__tests__/types.test.ts
git commit -m "feat(ai-agent): add extractor types module"
```

---

## Task 2: Args tree extension — ExtractorSettings

**Files:**
- Modify: `examples/scraper-node/src/sources/scraper-service/args-tree.ts:59-130`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/args-tree.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/args-tree.test.ts`:

```typescript
import { ScraperArgs, type AIAgentConfig } from '../../../../scraper-service/args-tree'

describe('AIAgentSettings.extractor', () => {
    it('AIAgentConfig type includes optional extractor field', () => {
        // Compile-time check: this assignment must typecheck.
        const cfg: AIAgentConfig = {
            model: 'qwen2.5:7b',
            baseUrl: 'http://localhost:11434/v1',
            extractor: {
                enabled: true,
                model: 'qwen2.5:3b',
                baseUrl: 'http://localhost:11434/v1',
                temperature: 0.1,
                maxToolCallsPerPage: 8,
                timeoutMs: 45000,
            },
        }
        expect(cfg.extractor?.enabled).toBe(true)
    })

    it('ScraperArgs.aiAgent.extractor is optional', () => {
        const args: ScraperArgs = new ScraperArgs()
        expect(args.aiAgent).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/args-tree.test.ts
```
Expected: FAIL — `extractor` not on type.

- [ ] **Step 3: Add ExtractorSettings + field**

In `examples/scraper-node/src/scraper-service/args-tree.ts`, INSERT a new `ExtractorSettings` class **before** `class AIAgentSettings` (around line 60):

```typescript
class ExtractorSettings {
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Enable extractor sub-agent escalation when deterministic extraction misses',
        type: 'boolean',
        choices: ['true', 'false'],
        default: 'true',
    })
    enabled?: boolean

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor model id. Different model recommended (smaller/faster); falls back to parent aiAgent.model when empty.',
        choices: ['', 'qwen2.5:3b', 'qwen2.5:7b', 'qwen3:8b', 'gpt-4o-mini'],
        default: '',
    })
    model?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor base URL. Falls back to parent aiAgent.baseUrl when empty.',
        default: '',
    })
    baseUrl?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor API key. Falls back to parent aiAgent.apiKey when empty.',
        default: '',
    })
    apiKey?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor sampling temperature (0..1). Lower = more structured.',
        type: 'number',
        choices: ['0.0', '0.1', '0.2', '0.5'],
        default: '0.1',
        validator: zeroToOne,
    })
    temperature?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor max tool calls per page',
        type: 'number',
        choices: ['4', '8', '16'],
        default: '8',
        validator: positiveInt,
    })
    maxToolCallsPerPage?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor whole-call timeout (ms)',
        type: 'number',
        choices: ['15000', '30000', '45000', '90000'],
        default: '45000',
        validator: positiveInt,
    })
    timeoutMs?: number
}
```

Then ADD a `extractor` field to the existing `AIAgentSettings` class (after `apiKey?: string` at line 129):

```typescript
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor sub-agent settings (one-shot LLM extraction on hostile pages)',
        childClass: ExtractorSettings,
    })
    extractor?: ExtractorSettings
```

- [ ] **Step 4: Run the test to verify it passes + build is clean**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/args-tree.test.ts
npx tsc --noEmit -p tsconfig.json
```
Expected: tests pass, typecheck clean.

- [ ] **Step 5: Run full ai-agent suite for regressions**

```bash
npx jest src/sources/ai-agent
```
Expected: 144 + 5 (Task 1) + 2 (this task) = 151. No regressions.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/scraper-service/args-tree.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/__tests__/args-tree.test.ts
git commit -m "feat(ai-agent): add extractor.* args slice under aiAgent"
```

---

## Task 3: Extractor config resolver

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/config.ts`
- Modify: `examples/scraper-node/src/sources/ai-agent/config.ts:5-13` (extend ResolvedAIAgentConfig)
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/config.test.ts`:

```typescript
import { resolveExtractorConfig } from '../config'
import type { ResolvedAIAgentConfig } from '../../config'

const PARENT: ResolvedAIAgentConfig = {
    baseUrl: 'http://parent/v1',
    apiKey: 'parent-key',
    model: 'qwen-parent',
    temperature: 0.5,
    maxToolCalls: 100,
    toolTimeoutMs: 60000,
    totalTimeoutMs: 3600000,
    extractor: null,
}

describe('resolveExtractorConfig', () => {
    it('returns null when parent is null', () => {
        expect(resolveExtractorConfig(null, { enabled: true } as any)).toBeNull()
    })

    it('returns null when extractor.enabled is explicitly false', () => {
        expect(resolveExtractorConfig(PARENT, { enabled: false } as any)).toBeNull()
    })

    it('returns null when extractor settings absent', () => {
        expect(resolveExtractorConfig(PARENT, undefined)).toBeNull()
    })

    it('inherits parent model when extractor.model is empty', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, model: '' } as any)
        expect(r?.model).toBe('qwen-parent')
    })

    it('inherits parent baseUrl when extractor.baseUrl is empty', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, baseUrl: '' } as any)
        expect(r?.baseUrl).toBe('http://parent/v1')
    })

    it('inherits parent apiKey when extractor.apiKey is empty', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, apiKey: '' } as any)
        expect(r?.apiKey).toBe('parent-key')
    })

    it('overrides with extractor model when set', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true, model: 'qwen-small' } as any)
        expect(r?.model).toBe('qwen-small')
    })

    it('applies defaults for temperature, maxToolCallsPerPage, timeoutMs', () => {
        const r = resolveExtractorConfig(PARENT, { enabled: true } as any)
        expect(r?.temperature).toBe(0.1)
        expect(r?.maxToolCallsPerPage).toBe(8)
        expect(r?.timeoutMs).toBe(45000)
    })

    it('respects explicit overrides', () => {
        const r = resolveExtractorConfig(PARENT, {
            enabled: true, temperature: 0.3, maxToolCallsPerPage: 4, timeoutMs: 30000,
        } as any)
        expect(r?.temperature).toBe(0.3)
        expect(r?.maxToolCallsPerPage).toBe(4)
        expect(r?.timeoutMs).toBe(30000)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/config.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Extend ResolvedAIAgentConfig in `sources/ai-agent/config.ts`**

In `examples/scraper-node/src/sources/ai-agent/config.ts`, add the field to `ResolvedAIAgentConfig`:

```typescript
import type { ResolvedExtractorConfig } from './extractor/config'

export interface ResolvedAIAgentConfig {
    baseUrl: string
    apiKey: string | undefined
    model: string
    temperature: number
    maxToolCalls: number
    toolTimeoutMs: number
    totalTimeoutMs: number
    extractor: ResolvedExtractorConfig | null  // NEW
}
```

In `resolveAIAgentConfig`, populate the field:

```typescript
import { resolveExtractorConfig } from './extractor/config'

// inside resolveAIAgentConfig, after building `resolved`:
resolved.extractor = resolveExtractorConfig(resolved, ai.extractor)
```

Note: pass `resolved` (the ResolvedAIAgentConfig in progress) so the extractor sees the *resolved* parent values, not the raw `ai.*` slice.

- [ ] **Step 4: Implement extractor/config.ts**

Create `examples/scraper-node/src/sources/ai-agent/extractor/config.ts`:

```typescript
import type { ResolvedAIAgentConfig } from '../config'
import { log } from '@cmd-hub/common'

export interface ResolvedExtractorConfig {
    enabled: true
    baseUrl: string
    apiKey: string | undefined
    model: string
    temperature: number
    maxToolCallsPerPage: number
    timeoutMs: number
}

interface ExtractorArgsSlice {
    enabled?: boolean
    model?: string
    baseUrl?: string
    apiKey?: string
    temperature?: number
    maxToolCallsPerPage?: number
    timeoutMs?: number
}

export function resolveExtractorConfig(
    parent: ResolvedAIAgentConfig | null,
    args: ExtractorArgsSlice | undefined,
): ResolvedExtractorConfig | null {
    if (!parent) {
        log.debug('extractor.config: parent is null → extractor disabled')
        return null
    }
    if (args === undefined) {
        log.debug('extractor.config: args undefined → extractor disabled')
        return null
    }
    if (args.enabled === false) {
        log.debug('extractor.config: enabled=false → extractor disabled')
        return null
    }

    const resolved: ResolvedExtractorConfig = {
        enabled: true,
        baseUrl: args.baseUrl || parent.baseUrl,
        apiKey: args.apiKey || parent.apiKey,
        model: args.model || parent.model,
        temperature: args.temperature ?? 0.1,
        maxToolCallsPerPage: args.maxToolCallsPerPage ?? 8,
        timeoutMs: args.timeoutMs ?? 45000,
    }
    log.debug(`extractor.config: resolved model=${resolved.model} (parent=${parent.model}) baseUrl=${resolved.baseUrl} maxToolCallsPerPage=${resolved.maxToolCallsPerPage}`)
    return resolved
}
```

- [ ] **Step 5: Run the test to verify it passes + ai-agent suite**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/config.test.ts
npx jest src/sources/ai-agent
npx tsc --noEmit -p tsconfig.json
```
Expected: tests pass, full suite still green, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/extractor/config.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/__tests__/config.test.ts \
        examples/scraper-node/src/sources/ai-agent/config.ts
git commit -m "feat(ai-agent): add extractor config resolver with parent inheritance"
```

---

## Task 4: Extractor tools — read_blocks, read_json_blob

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/tools/read-blocks.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/tools/read-json-blob.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/read-blocks.test.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/read-json-blob.test.ts`

- [ ] **Step 1: Write the read-blocks test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/read-blocks.test.ts`:

```typescript
import { makeReadBlocksTool } from '../read-blocks'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [
        { selector: 'header', text: 'header text', tels: [], mails: [] },
        { selector: 'footer', text: 'footer text +7 (812) 100', tels: ['+78121001010'], mails: [] },
        { selector: '[class*="contact"]', text: 'contact: foo', tels: [], mails: ['x@y.ru'] },
    ],
    jsonLdBlobs: [],
    knownGoals: ['phone', 'address'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('read_blocks', () => {
    const tool = makeReadBlocksTool()

    it('returns the requested block by selector substring', async () => {
        const r: any = await tool.handler({ selector: 'footer' }, { input: INPUT })
        expect(r.blocks).toHaveLength(1)
        expect(r.blocks[0].text).toMatch(/footer/)
    })

    it('returns multiple blocks when selector matches several', async () => {
        const r: any = await tool.handler({ selector: 'contact' }, { input: INPUT })
        expect(r.blocks).toHaveLength(1)
    })

    it('returns all blocks when selector is "*" or empty', async () => {
        const r: any = await tool.handler({ selector: '*' }, { input: INPUT })
        expect(r.blocks).toHaveLength(3)
    })

    it('returns empty array when no match', async () => {
        const r: any = await tool.handler({ selector: 'nonexistent' }, { input: INPUT })
        expect(r.blocks).toEqual([])
    })

    it('terminal flag is false', () => {
        expect(tool.terminal).toBe(false)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/extractor/tools/__tests__/read-blocks.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement read_blocks**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/read-blocks.ts`:

```typescript
import type { ExtractorTool } from '../types'

export function makeReadBlocksTool(): ExtractorTool {
    return {
        name: 'read_blocks',
        description: 'Read additional pre-extracted blocks from the current page. selector matches by substring against block.selector ("header", "footer", "contact", "address", "*" for all).',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'Substring to match against block selectors, or "*" for all.' },
            },
            required: ['selector'],
        },
        terminal: false,
        async handler(args, ctx) {
            const sel = String(args?.selector ?? '').trim()
            if (!sel || sel === '*') {
                return { blocks: ctx.input.candidateBlocks }
            }
            const blocks = ctx.input.candidateBlocks.filter(b => b.selector.toLowerCase().includes(sel.toLowerCase()))
            return { blocks }
        },
    }
}
```

- [ ] **Step 4: Write the read-json-blob test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/read-json-blob.test.ts`:

```typescript
import { makeReadJsonBlobTool } from '../read-json-blob'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [],
    jsonLdBlobs: [
        { '@type': 'WebPage', name: 'X' },
        { '@type': 'LocalBusiness', telephone: '+7' },
    ],
    nextDataBlob: { props: { pageProps: { contacts: { phone: '+78121001010' } } } },
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('read_json_blob', () => {
    const tool = makeReadJsonBlobTool()

    it('returns the parsed __NEXT_DATA__ blob when name="next-data"', async () => {
        const r: any = await tool.handler({ name: 'next-data' }, { input: INPUT })
        expect(r.blob).toBeDefined()
        expect((r.blob as any).props.pageProps.contacts.phone).toBe('+78121001010')
    })

    it('returns all jsonLdBlobs when name="json-ld"', async () => {
        const r: any = await tool.handler({ name: 'json-ld' }, { input: INPUT })
        expect(Array.isArray(r.blobs)).toBe(true)
        expect(r.blobs).toHaveLength(2)
    })

    it('returns null when name="next-data" but blob absent', async () => {
        const inputNoNext: ExtractorInput = { ...INPUT, nextDataBlob: undefined }
        const r: any = await tool.handler({ name: 'next-data' }, { input: inputNoNext })
        expect(r.blob).toBeNull()
    })

    it('returns error for unknown blob name', async () => {
        const r: any = await tool.handler({ name: 'unknown' }, { input: INPUT })
        expect(r.error).toBeDefined()
    })

    it('terminal flag is false', () => {
        expect(tool.terminal).toBe(false)
    })
})
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/extractor/tools/__tests__/read-json-blob.test.ts
```
Expected: FAIL.

- [ ] **Step 6: Implement read_json_blob**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/read-json-blob.ts`:

```typescript
import type { ExtractorTool } from '../types'

export function makeReadJsonBlobTool(): ExtractorTool {
    return {
        name: 'read_json_blob',
        description: 'Read a parsed JSON blob from the page. name="next-data" returns the __NEXT_DATA__ blob (or null). name="json-ld" returns all JSON-LD blobs as an array.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', enum: ['next-data', 'json-ld'] },
            },
            required: ['name'],
        },
        terminal: false,
        async handler(args, ctx) {
            const name = String(args?.name ?? '')
            if (name === 'next-data') {
                return { blob: ctx.input.nextDataBlob ?? null }
            }
            if (name === 'json-ld') {
                return { blobs: ctx.input.jsonLdBlobs }
            }
            return { error: `unknown blob name: ${name}` }
        },
    }
}
```

- [ ] **Step 7: Verify both pass**

```bash
npx jest src/sources/ai-agent/extractor/tools/__tests__
```
Expected: 10 tests passing (5 + 5).

- [ ] **Step 8: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/extractor/tools/read-blocks.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/tools/read-json-blob.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/read-blocks.test.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/read-json-blob.test.ts
git commit -m "feat(ai-agent): add extractor read_blocks + read_json_blob tools"
```

---

## Task 5: Extractor terminal tools — report_extraction, report_incomplete

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/tools/report-extraction.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/tools/report-incomplete.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/report-extraction.test.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/report-incomplete.test.ts`

- [ ] **Step 1: Write report-extraction test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/report-extraction.test.ts`:

```typescript
import { makeReportExtractionTool } from '../report-extraction'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [],
    jsonLdBlobs: [],
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('report_extraction', () => {
    const tool = makeReportExtractionTool()

    it('terminal flag is true', () => {
        expect(tool.terminal).toBe(true)
    })

    it('accepts valid extraction with arrays + name + confidence', async () => {
        const r: any = await tool.handler({
            phones: ['+78121001010'],
            emails: ['a@b.ru'],
            addresses: ['ул. Ленина, 1'],
            candidateName: 'X',
            confidence: 0.85,
            notes: ['phone reassembled'],
        }, { input: INPUT })
        expect(r.outcome).toBe('extraction')
        expect(r.phones).toEqual(['+78121001010'])
        expect(r.confidence).toBe(0.85)
    })

    it('coerces missing arrays to empty', async () => {
        const r: any = await tool.handler({ candidateName: 'X', confidence: 0.5 }, { input: INPUT })
        expect(r.phones).toEqual([])
        expect(r.emails).toEqual([])
        expect(r.addresses).toEqual([])
    })

    it('clamps confidence to [0, 1]', async () => {
        const r1: any = await tool.handler({ candidateName: 'X', confidence: 1.5 }, { input: INPUT })
        expect(r1.confidence).toBe(1)
        const r2: any = await tool.handler({ candidateName: 'X', confidence: -0.3 }, { input: INPUT })
        expect(r2.confidence).toBe(0)
    })

    it('drops non-string entries from phones/emails/addresses', async () => {
        const r: any = await tool.handler({
            phones: ['+7', 42, null, '+78121001010'],
            candidateName: 'X',
            confidence: 0.5,
        }, { input: INPUT })
        expect(r.phones).toEqual(['+7', '+78121001010'])
    })

    it('passes notes through when provided', async () => {
        const r: any = await tool.handler({
            candidateName: 'X', confidence: 0.5, notes: ['a', 'b'],
        }, { input: INPUT })
        expect(r.notes).toEqual(['a', 'b'])
    })
})
```

- [ ] **Step 2: Verify failing**

```bash
npx jest src/sources/ai-agent/extractor/tools/__tests__/report-extraction.test.ts
```

- [ ] **Step 3: Implement report_extraction**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/report-extraction.ts`:

```typescript
import type { ExtractorTool, ExtractorReport } from '../types'

function clamp01(n: unknown): number {
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 1) return 1
    return n
}

function stringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
}

export function makeReportExtractionTool(): ExtractorTool {
    return {
        name: 'report_extraction',
        description: 'Terminal tool. Submit the extracted contacts. Use only values you actually found on the page; do not invent.',
        parameters: {
            type: 'object',
            properties: {
                phones: { type: 'array', items: { type: 'string' } },
                emails: { type: 'array', items: { type: 'string' } },
                addresses: { type: 'array', items: { type: 'string' } },
                candidateName: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                notes: { type: 'array', items: { type: 'string' } },
            },
            required: ['candidateName', 'confidence'],
        },
        terminal: true,
        async handler(args): Promise<ExtractorReport> {
            const a = (args ?? {}) as Record<string, unknown>
            const result: ExtractorReport = {
                outcome: 'extraction',
                phones: stringArray(a.phones),
                emails: stringArray(a.emails),
                addresses: stringArray(a.addresses),
                candidateName: typeof a.candidateName === 'string' ? a.candidateName : '',
                confidence: clamp01(a.confidence),
            }
            const notes = stringArray(a.notes)
            if (notes.length) result.notes = notes
            return result
        },
    }
}
```

- [ ] **Step 4: Write report-incomplete test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/report-incomplete.test.ts`:

```typescript
import { makeReportIncompleteTool } from '../report-incomplete'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [],
    jsonLdBlobs: [],
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('report_incomplete', () => {
    const tool = makeReportIncompleteTool()

    it('terminal flag is true', () => {
        expect(tool.terminal).toBe(true)
    })

    it('returns incomplete with reason and hints', async () => {
        const r: any = await tool.handler({
            reason: 'no contacts on this page',
            hints: ['try /contacts'],
        }, { input: INPUT })
        expect(r.outcome).toBe('incomplete')
        expect(r.reason).toBe('no contacts on this page')
        expect(r.hints).toEqual(['try /contacts'])
    })

    it('coerces missing reason to a default', async () => {
        const r: any = await tool.handler({}, { input: INPUT })
        expect(r.outcome).toBe('incomplete')
        expect(r.reason).toBeTruthy()
    })

    it('drops non-string hints', async () => {
        const r: any = await tool.handler({
            reason: 'r', hints: ['a', 42, null, 'b'],
        }, { input: INPUT })
        expect(r.hints).toEqual(['a', 'b'])
    })
})
```

- [ ] **Step 5: Verify failing**

```bash
npx jest src/sources/ai-agent/extractor/tools/__tests__/report-incomplete.test.ts
```

- [ ] **Step 6: Implement report_incomplete**

Create `examples/scraper-node/src/sources/ai-agent/extractor/tools/report-incomplete.ts`:

```typescript
import type { ExtractorTool, ExtractorReport } from '../types'

function stringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
}

export function makeReportIncompleteTool(): ExtractorTool {
    return {
        name: 'report_incomplete',
        description: 'Terminal tool. Hand back diagnostics when you cannot extract contacts from this page. The parent agent will use the reason to decide next steps.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Short explanation of why extraction failed.' },
                hints: { type: 'array', items: { type: 'string' }, description: 'Optional hints for the parent (e.g. "fetch /contacts").' },
            },
            required: ['reason'],
        },
        terminal: true,
        async handler(args): Promise<ExtractorReport> {
            const a = (args ?? {}) as Record<string, unknown>
            const result: ExtractorReport = {
                outcome: 'incomplete',
                reason: typeof a.reason === 'string' && a.reason.trim()
                    ? a.reason.trim()
                    : 'extractor returned no result',
            }
            const hints = stringArray(a.hints)
            if (hints.length) result.hints = hints
            return result
        },
    }
}
```

- [ ] **Step 7: Verify both pass**

```bash
npx jest src/sources/ai-agent/extractor/tools/__tests__
```
Expected: 4 test files, ~17 tests, all passing.

- [ ] **Step 8: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/extractor/tools/report-extraction.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/tools/report-incomplete.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/report-extraction.test.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/tools/__tests__/report-incomplete.test.ts
git commit -m "feat(ai-agent): add extractor terminal tools (report_extraction, report_incomplete)"
```

---

## Task 6: Extractor prompts

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/prompts.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/prompts.test.ts`:

```typescript
import { buildExtractorSystemPrompt, buildExtractorUserPrompt } from '../prompts'
import type { ExtractorInput } from '../types'

const INPUT: ExtractorInput = {
    url: 'https://acme-clinic.ru/',
    pageType: 'org-site',
    cleanedText: 'About us. Call +7 (812) ...',
    candidateBlocks: [
        { selector: 'header', text: 'header text', tels: [], mails: [] },
        { selector: 'footer', text: 'footer text', tels: ['+78121001010'], mails: [] },
    ],
    jsonLdBlobs: [{ '@type': 'WebPage' }],
    knownGoals: ['phone', 'address'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('buildExtractorSystemPrompt', () => {
    it('mentions the role and the four tools', () => {
        const p = buildExtractorSystemPrompt()
        expect(p).toMatch(/extract/i)
        expect(p).toMatch(/read_blocks/)
        expect(p).toMatch(/read_json_blob/)
        expect(p).toMatch(/report_extraction/)
        expect(p).toMatch(/report_incomplete/)
    })

    it('forbids inventing values', () => {
        const p = buildExtractorSystemPrompt()
        expect(p.toLowerCase()).toMatch(/do not invent|don't invent|never invent/)
    })

    it('explains the terminal-tool requirement', () => {
        const p = buildExtractorSystemPrompt()
        expect(p.toLowerCase()).toMatch(/(must|always).*(report_extraction|report_incomplete|terminal)/)
    })
})

describe('buildExtractorUserPrompt', () => {
    it('includes URL, pageType, knownGoals, cleanedText preview', () => {
        const p = buildExtractorUserPrompt(INPUT)
        expect(p).toMatch(/acme-clinic\.ru/)
        expect(p).toMatch(/org-site/)
        expect(p).toMatch(/phone/)
        expect(p).toMatch(/address/)
        expect(p).toMatch(/About us/)
    })

    it('lists candidateBlocks selectors', () => {
        const p = buildExtractorUserPrompt(INPUT)
        expect(p).toMatch(/header/)
        expect(p).toMatch(/footer/)
    })

    it('truncates cleanedText to 8000 chars', () => {
        const big: ExtractorInput = { ...INPUT, cleanedText: 'A'.repeat(20000) }
        const p = buildExtractorUserPrompt(big)
        expect(p.length).toBeLessThan(20000) // far less than the 20K cleanedText
    })
})
```

- [ ] **Step 2: Run failing**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/prompts.test.ts
```

- [ ] **Step 3: Implement prompts**

Create `examples/scraper-node/src/sources/ai-agent/extractor/prompts.ts`:

```typescript
import type { ExtractorInput } from './types'

const CLEANED_TEXT_MAX_CHARS = 8000

export function buildExtractorSystemPrompt(): string {
    return [
        'You are a focused web-page contact extractor. The deterministic extractor failed to find structured contacts on a page that looks substantive. Your job is to read the pre-extracted page material and return phone numbers, emails, and addresses that are actually present.',
        '',
        'Tools available:',
        '- `read_blocks(selector)` — fetch additional pre-extracted DOM blocks by selector keyword (e.g. "footer", "contact", "header", "*" for all).',
        '- `read_json_blob(name)` — fetch parsed JSON blobs (`name`: "next-data" for `__NEXT_DATA__`, "json-ld" for all JSON-LD entries).',
        '- `report_extraction(...)` — TERMINAL. Submit your final extracted contacts.',
        '- `report_incomplete(reason, hints?)` — TERMINAL. Hand back diagnostics when extraction is impossible.',
        '',
        'Rules:',
        '1. You must always end with a terminal tool call (`report_extraction` or `report_incomplete`). The loop forces termination on budget exhaustion.',
        '2. Do not invent values. Only return phone numbers, emails, and addresses you actually saw in the provided material.',
        '3. Phone numbers should be in international format (+7XXXXXXXXXX). Reassemble fragments split across spans/elements when you are confident they form one number.',
        '4. Be conservative on `confidence`: 0.9+ for explicit structured data (microdata, JSON-LD), 0.7 for clearly-formatted footer/contacts blocks, 0.5 or below for ambiguous text.',
        '5. Use `notes` to flag anything unusual (e.g. "phone split across spans, reassembled" or "address inferred from city + street name").',
    ].join('\n')
}

export function buildExtractorUserPrompt(input: ExtractorInput): string {
    const truncated = input.cleanedText.length > CLEANED_TEXT_MAX_CHARS
    const text = truncated
        ? input.cleanedText.slice(0, CLEANED_TEXT_MAX_CHARS) + '...[truncated]'
        : input.cleanedText

    const blockSummary = input.candidateBlocks.length
        ? input.candidateBlocks.map(b => `- selector="${b.selector}" tels=${b.tels?.length ?? 0} mails=${b.mails?.length ?? 0}`).join('\n')
        : '(no candidate blocks pre-extracted)'

    const jsonLdCount = input.jsonLdBlobs.length
    const hasNextData = input.nextDataBlob !== undefined

    const partialSummary = [
        input.partialResult.phones.length ? `phones=${input.partialResult.phones.length}` : null,
        input.partialResult.emails.length ? `emails=${input.partialResult.emails.length}` : null,
        input.partialResult.addresses.length ? `addresses=${input.partialResult.addresses.length}` : null,
        input.partialResult.candidateName ? `name="${input.partialResult.candidateName.slice(0, 60)}"` : null,
    ].filter(Boolean).join(', ') || '(empty)'

    return [
        `URL: ${input.url}`,
        `Page type: ${input.pageType}`,
        `Goals: ${input.knownGoals.join(', ')}`,
        `Deterministic partial result: ${partialSummary}`,
        '',
        `Candidate blocks (${input.candidateBlocks.length}):`,
        blockSummary,
        '',
        `JSON-LD blobs available: ${jsonLdCount} (call read_json_blob({"name":"json-ld"}) to inspect)`,
        `__NEXT_DATA__ blob available: ${hasNextData} (call read_json_blob({"name":"next-data"}) to inspect)`,
        '',
        '--- BEGIN cleaned page text ---',
        text,
        '--- END cleaned page text ---',
        '',
        'Extract any contacts you can find. Always finish with report_extraction or report_incomplete.',
    ].join('\n')
}
```

- [ ] **Step 4: Verify pass**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/prompts.test.ts
```
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/extractor/prompts.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/__tests__/prompts.test.ts
git commit -m "feat(ai-agent): add extractor prompts (system + user)"
```

---

## Task 7: Extractor loop

**Files:**
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/loop.ts`
- Create: `examples/scraper-node/src/sources/ai-agent/extractor/index.ts`
- Test: `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/loop.test.ts`

This is the largest task in PR2. The loop calls OpenAI's chat completions, dispatches tool calls to extractor tools (which see `ctx.input`), and terminates on terminal tool call OR budget OR timeout.

- [ ] **Step 1: Write the failing test**

Create `examples/scraper-node/src/sources/ai-agent/extractor/__tests__/loop.test.ts`:

```typescript
import { runExtractor } from '../loop'
import type { ExtractorInput } from '../types'
import type { ResolvedExtractorConfig } from '../config'
import type { OpenAI } from 'openai'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: 'About us...',
    candidateBlocks: [
        { selector: 'footer', text: 'footer text +7 (812) 100-10-10', tels: ['+78121001010'], mails: [] },
    ],
    jsonLdBlobs: [],
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

const CFG: ResolvedExtractorConfig = {
    enabled: true,
    baseUrl: 'http://x/v1',
    apiKey: undefined,
    model: 'qwen-test',
    temperature: 0.1,
    maxToolCallsPerPage: 8,
    timeoutMs: 45000,
}

function mockClient(responses: Array<{ tool_calls?: any[], content?: string | null }>): OpenAI {
    let idx = 0
    return {
        chat: {
            completions: {
                async create() {
                    const r = responses[idx++] ?? { content: '' }
                    return {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: r.content ?? null,
                                tool_calls: r.tool_calls,
                            },
                            finish_reason: r.tool_calls ? 'tool_calls' : 'stop',
                        }],
                    } as any
                },
            },
        },
    } as any
}

describe('runExtractor', () => {
    it('terminates on report_extraction', async () => {
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: {
                        name: 'report_extraction',
                        arguments: JSON.stringify({
                            phones: ['+78121001010'], emails: [], addresses: [],
                            candidateName: 'X', confidence: 0.85,
                        }),
                    },
                }],
            },
        ])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('extraction')
        if (r.outcome === 'extraction') {
            expect(r.phones).toContain('+78121001010')
            expect(r.confidence).toBe(0.85)
        }
        expect(r.toolCallsUsed).toBe(1)
    })

    it('terminates on report_incomplete', async () => {
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: {
                        name: 'report_incomplete',
                        arguments: JSON.stringify({ reason: 'no contacts visible' }),
                    },
                }],
            },
        ])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('incomplete')
        if (r.outcome === 'incomplete') expect(r.reason).toMatch(/no contacts/)
    })

    it('handles non-terminal tool then terminal', async () => {
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: { name: 'read_blocks', arguments: JSON.stringify({ selector: 'footer' }) },
                }],
            },
            {
                tool_calls: [{
                    id: 't2', type: 'function',
                    function: {
                        name: 'report_extraction',
                        arguments: JSON.stringify({
                            phones: ['+78121001010'], candidateName: 'X', confidence: 0.7,
                        }),
                    },
                }],
            },
        ])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('extraction')
        expect(r.toolCallsUsed).toBe(2)
    })

    it('terminates with incomplete on budget exhaustion', async () => {
        const responses: any[] = []
        // 9 non-terminal tool calls — exceeds maxToolCallsPerPage=8
        for (let i = 0; i < 9; i++) {
            responses.push({
                tool_calls: [{
                    id: `t${i}`, type: 'function',
                    function: { name: 'read_blocks', arguments: JSON.stringify({ selector: '*' }) },
                }],
            })
        }
        const client = mockClient(responses)
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('incomplete')
        if (r.outcome === 'incomplete') expect(r.reason).toMatch(/budget|exhaust/i)
        expect(r.toolCallsUsed).toBe(8)
    })

    it('terminates with incomplete when model returns no tool call', async () => {
        const client = mockClient([{ content: 'I cannot extract anything' }])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('incomplete')
    })

    it('respects abort signal', async () => {
        const ac = new AbortController()
        ac.abort()
        const client = mockClient([])
        const r = await runExtractor(INPUT, CFG, ac.signal, { client })
        expect(r.outcome).toBe('incomplete')
        if (r.outcome === 'incomplete') expect(r.reason).toMatch(/abort/i)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/loop.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loop**

Create `examples/scraper-node/src/sources/ai-agent/extractor/loop.ts`:

```typescript
import { OpenAI } from 'openai'
import { log } from '@cmd-hub/common'
import type { ResolvedExtractorConfig } from './config'
import type { ExtractorInput, ExtractionResult, ExtractorTool, ExtractorReport } from './types'
import { buildExtractorSystemPrompt, buildExtractorUserPrompt } from './prompts'
import { makeReadBlocksTool } from './tools/read-blocks'
import { makeReadJsonBlobTool } from './tools/read-json-blob'
import { makeReportExtractionTool } from './tools/report-extraction'
import { makeReportIncompleteTool } from './tools/report-incomplete'

interface RunOptions {
    client?: OpenAI  // Injected for tests; production creates from cfg.
}

function buildToolset(): ExtractorTool[] {
    return [
        makeReadBlocksTool(),
        makeReadJsonBlobTool(),
        makeReportExtractionTool(),
        makeReportIncompleteTool(),
    ]
}

function toOpenAISchema(t: ExtractorTool) {
    return {
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }
}

function defaultClient(cfg: ResolvedExtractorConfig): OpenAI {
    return new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey ?? 'local-no-key' })
}

export async function runExtractor(
    input: ExtractorInput,
    cfg: ResolvedExtractorConfig,
    signal?: AbortSignal,
    opts: RunOptions = {},
): Promise<ExtractionResult> {
    if (signal?.aborted) {
        log.debug('extractor.loop: aborted before start')
        return { outcome: 'incomplete', reason: 'aborted before start', toolCallsUsed: 0 }
    }

    const client = opts.client ?? defaultClient(cfg)
    const tools = buildToolset()
    const toolByName = new Map(tools.map(t => [t.name, t]))
    const ctx = { input }

    const messages: any[] = [
        { role: 'system', content: buildExtractorSystemPrompt() },
        { role: 'user', content: buildExtractorUserPrompt(input) },
    ]

    const startedAt = Date.now()
    let toolCallsUsed = 0

    while (true) {
        if (signal?.aborted) {
            return { outcome: 'incomplete', reason: 'aborted mid-loop', toolCallsUsed }
        }
        if (Date.now() - startedAt > cfg.timeoutMs) {
            return { outcome: 'incomplete', reason: `timeout (${cfg.timeoutMs}ms)`, toolCallsUsed }
        }
        if (toolCallsUsed >= cfg.maxToolCallsPerPage) {
            return { outcome: 'incomplete', reason: `tool budget exhausted (${cfg.maxToolCallsPerPage})`, toolCallsUsed }
        }

        let resp: any
        try {
            resp = await client.chat.completions.create({
                model: cfg.model,
                temperature: cfg.temperature,
                messages,
                tools: tools.map(toOpenAISchema),
                tool_choice: 'auto',
            })
        } catch (e: any) {
            log.warn(`extractor.loop: chat error: ${e?.message ?? e}`)
            return { outcome: 'incomplete', reason: `chat error: ${e?.message ?? e}`, toolCallsUsed }
        }

        const choice = resp.choices?.[0]
        const msg = choice?.message
        if (!msg) {
            return { outcome: 'incomplete', reason: 'no message in response', toolCallsUsed }
        }
        messages.push(msg)

        const calls = msg.tool_calls ?? []
        if (!calls.length) {
            // Model decided to stop without a terminal tool call.
            return { outcome: 'incomplete', reason: 'no tool call in response', toolCallsUsed }
        }

        for (const call of calls) {
            if (call.type !== 'function') continue
            toolCallsUsed += 1
            const tool = toolByName.get(call.function.name)
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `unknown tool: ${call.function.name}` }),
                })
                continue
            }
            let parsed: unknown
            try {
                parsed = JSON.parse(call.function.arguments || '{}')
            } catch {
                parsed = {}
            }
            const result = await tool.handler(parsed, ctx)
            if (tool.terminal) {
                const report = result as ExtractorReport
                log.debug(`extractor.loop: terminated via ${tool.name} after ${toolCallsUsed} calls`)
                return { ...report, toolCallsUsed } as ExtractionResult
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            })
            if (toolCallsUsed >= cfg.maxToolCallsPerPage) {
                return { outcome: 'incomplete', reason: `tool budget exhausted (${cfg.maxToolCallsPerPage})`, toolCallsUsed }
            }
        }
    }
}
```

- [ ] **Step 4: Run the test to verify all pass**

```bash
npx jest src/sources/ai-agent/extractor/__tests__/loop.test.ts
```
Expected: 6 tests passing.

- [ ] **Step 5: Add the index re-export**

Create `examples/scraper-node/src/sources/ai-agent/extractor/index.ts`:

```typescript
export { runExtractor } from './loop'
export { resolveExtractorConfig } from './config'
export type { ResolvedExtractorConfig } from './config'
export type { ExtractorInput, ExtractionResult, ExtractorReport } from './types'
```

- [ ] **Step 6: Verify full ai-agent suite green + build clean**

```bash
npx jest src/sources/ai-agent
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/extractor/loop.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/index.ts \
        examples/scraper-node/src/sources/ai-agent/extractor/__tests__/loop.test.ts
git commit -m "feat(ai-agent): add extractor loop (one-shot, no refetch)"
```

---

## Task 8: Wire escalation into extract-contacts

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts:48-98`
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts` (append tests)

The tool gains an optional escalation step. When deterministic extraction yields zero contacts AND the page is "substantive" AND extractor config is present AND enabled, call `runExtractor`.

- [ ] **Step 1: Append escalation tests**

Append to `examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts`:

```typescript
describe('extract_contacts — extractor escalation', () => {
    // To exercise escalation, we need a way to inject a mock extractor.
    // The tool factory accepts an optional injection point: makeExtractContactsTool({ extractorRunner })
    // Tests pass a stub runner; production passes the real one bound to resolved config.

    function fakeRunner(report: any) {
        return jest.fn().mockResolvedValue({
            outcome: report.outcome,
            phones: report.phones ?? [],
            emails: report.emails ?? [],
            addresses: report.addresses ?? [],
            candidateName: report.candidateName ?? '',
            confidence: report.confidence ?? 0.5,
            toolCallsUsed: 1,
        })
    }

    it('does not escalate when deterministic extraction succeeds', async () => {
        const runner = jest.fn()
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const html = `<html><body><a href="tel:+78121001010">x</a></body></html>`
        const r = await tool.handler({ html })
        expect(runner).not.toHaveBeenCalled()
        expect(r.phones).toContain('+78121001010')
    })

    it('escalates when zero contacts on substantive page', async () => {
        const runner = fakeRunner({
            outcome: 'extraction', phones: ['+78122002020'], candidateName: 'X', confidence: 0.7,
        })
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const longText = 'About us, our story, '.repeat(60)  // >500 chars
        const html = `<html><body><div>${longText}</div></body></html>`
        const r = await tool.handler({ html })
        expect(runner).toHaveBeenCalledTimes(1)
        expect(r.phones).toContain('+78122002020')
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['extractor-llm']))
    })

    it('does not escalate on thin pages (text < 500 chars)', async () => {
        const runner = jest.fn()
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const html = `<html><body><p>tiny page</p></body></html>`
        await tool.handler({ html })
        expect(runner).not.toHaveBeenCalled()
    })

    it('does not escalate when no runner provided (escalation disabled)', async () => {
        const tool = makeExtractContactsTool()
        const longText = 'About us, our story, '.repeat(60)
        const html = `<html><body><div>${longText}</div></body></html>`
        const r = await tool.handler({ html })
        expect(r.phones).toEqual([])  // no contacts; no escalation
    })

    it('extractor incomplete result does not pollute output', async () => {
        const runner = fakeRunner({ outcome: 'incomplete', reason: 'no markers' })
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const longText = 'A'.repeat(600)
        const html = `<html><body><div>${longText}</div></body></html>`
        const r = await tool.handler({ html })
        expect(r.phones).toEqual([])
        expect(r.strategiesFired).not.toEqual(expect.arrayContaining(['extractor-llm']))
    })
})
```

- [ ] **Step 2: Run failing**

```bash
npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
```
Expected: FAIL — `makeExtractContactsTool` doesn't accept options.

- [ ] **Step 3: Modify extract-contacts.ts to accept an extractor runner**

Replace `examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts`:

```typescript
import * as cheerio from "cheerio"
import { Tool } from "./types"
import { log } from "@cmd-hub/common"
import {
    parseJsonLdBlobs,
    extractFromJsonLd,
    extractFromMicrodata,
    extractFromSemanticHtml,
    extractFromRegex,
    type PartialExtraction,
} from "./extraction-strategies"
import type { ExtractorInput, ExtractionResult } from "../extractor/types"

interface ExtractResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    strategiesFired?: string[]
    error?: string
    hint?: string
}

export type ExtractorRunner = (input: ExtractorInput, signal?: AbortSignal) => Promise<ExtractionResult>

export interface MakeExtractContactsOptions {
    extractorRunner?: ExtractorRunner
    /** URL of the page being extracted, if known. Forwarded to the extractor. */
    pageUrl?: string
}

const MAX_PER_FIELD = 10
const SUBSTANTIVE_TEXT_THRESHOLD = 500

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

function buildCandidateBlocks($: cheerio.CheerioAPI) {
    const blocks: { selector: string, text: string, tels: string[], mails: string[] }[] = []
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

function tryParseNextData($: cheerio.CheerioAPI): unknown | undefined {
    const raw = $('script#__NEXT_DATA__').contents().text().trim()
    if (!raw) return undefined
    try { return JSON.parse(raw) } catch { return undefined }
}

export function makeExtractContactsTool(opts: MakeExtractContactsOptions = {}): Tool {
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
        async handler(args, signal): Promise<ExtractResult> {
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

                const detTotal = acc.phones.size + acc.emails.size + acc.addresses.size

                // Escalate if zero contacts AND substantive page AND runner provided.
                if (detTotal === 0 && cleanedText.length >= SUBSTANTIVE_TEXT_THRESHOLD && opts.extractorRunner) {
                    const input: ExtractorInput = {
                        url: opts.pageUrl ?? '',
                        pageType: 'org-site',  // Caller may override via PR4 wiring; default for now.
                        cleanedText,
                        candidateBlocks: buildCandidateBlocks($),
                        jsonLdBlobs: jsonLd,
                        nextDataBlob: tryParseNextData($),
                        knownGoals: ['phone', 'email', 'address', 'name'],
                        partialResult: { phones: [], emails: [], addresses: [], candidateName: acc.name },
                    }
                    log.debug(`ai-agent.extract_contacts: escalating to extractor (text=${cleanedText.length}ch)`)
                    try {
                        const result = await opts.extractorRunner(input, signal)
                        if (result.outcome === 'extraction') {
                            const contributed = mergeInto(acc, {
                                phones: result.phones,
                                emails: result.emails,
                                addresses: result.addresses,
                                candidateName: result.candidateName,
                            })
                            if (contributed) fired.push('extractor-llm')
                            log.debug(`ai-agent.extract_contacts: extractor returned phones=${result.phones.length} emails=${result.emails.length} addresses=${result.addresses.length} confidence=${result.confidence}`)
                        } else {
                            log.debug(`ai-agent.extract_contacts: extractor incomplete: ${result.reason}`)
                        }
                    } catch (e: any) {
                        log.warn(`ai-agent.extract_contacts: extractor threw: ${e?.message ?? e}`)
                    }
                }

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

- [ ] **Step 4: Run all extract-contacts tests**

```bash
npx jest src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
```
Expected: pre-existing tests + 5 new escalation tests, all passing.

- [ ] **Step 5: Run full ai-agent suite + build**

```bash
npx jest src/sources/ai-agent
npx tsc --noEmit -p tsconfig.json
```
Expected: all green, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts \
        examples/scraper-node/src/sources/ai-agent/tools/__tests__/extract-contacts.test.ts
git commit -m "feat(ai-agent): wire extractor escalation into extract_contacts"
```

---

## Task 9: Wire factory in tools/index.ts

The escalation runner has to be threaded through `buildTools` so the production tool gets the real extractor when configured.

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/tools/index.ts:18-45`

- [ ] **Step 1: Read current `buildTools`**

```bash
cat examples/scraper-node/src/sources/ai-agent/tools/index.ts
```

Confirm signature: `buildTools(query, queue, state, phase)`.

- [ ] **Step 2: Modify buildTools to accept and thread an extractor runner**

Replace the `buildTools` function in `examples/scraper-node/src/sources/ai-agent/tools/index.ts`:

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
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import type { ReportState } from "./emit"
import { log } from "@cmd-hub/common"

export type { ReportState } from "./emit"
export type AgentPhase = 'recon' | 'plan' | 'execute'

export interface BuildToolsOptions {
    extractorRunner?: ExtractorRunner
}

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    phase: AgentPhase,
    opts: BuildToolsOptions = {},
): Promise<Tool[]> {
    log.trace(`ai-agent.tools.buildTools: phase=${phase} extractor=${opts.extractorRunner ? 'on' : 'off'}`)
    if (phase === 'plan') {
        log.debug('ai-agent.tools.buildTools: plan phase → no tools exposed')
        return []
    }
    if (phase === 'recon') {
        const tools = [makeWebSearchTool(query), makeEndReconTool()]
        log.debug(`ai-agent.tools.buildTools: recon phase → ${tools.map(t => t.name).join(', ')}`)
        return tools
    }
    const tools = [
        makeWebSearchTool(query),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        makeExtractContactsTool({ extractorRunner: opts.extractorRunner }),
        await makeDelegateSourceTool(query, queue, state),
        makeReportResultsTool(queue, query, state),
        makeRevisePlanTool(),
    ]
    log.debug(`ai-agent.tools.buildTools: execute phase → ${tools.map(t => t.name).join(', ')}`)
    return tools
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
```

- [ ] **Step 3: Run loop tests to ensure backward compat**

The existing loop callers don't pass `opts`, and the parameter is optional. Verify:

```bash
npx jest src/sources/ai-agent
```
Expected: 144 baseline + new tests, all passing.

- [ ] **Step 4: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/tools/index.ts
git commit -m "feat(ai-agent): thread optional extractor runner through buildTools"
```

---

## Task 10: Wire extractor in loop.ts (optional, low-risk)

The agent's main `loop.ts` constructs the resolved config via `resolveAIAgentConfig`. With Task 3 done, `resolved.extractor` is now populated when the user configures it. This task threads the runner from there through `buildTools`.

**Files:**
- Modify: `examples/scraper-node/src/sources/ai-agent/loop.ts` (the call site of `buildTools`)

- [ ] **Step 1: Find the buildTools call site**

```bash
grep -n "buildTools(" examples/scraper-node/src/sources/ai-agent/loop.ts
```

There should be 1-3 call sites depending on phase transitions.

- [ ] **Step 2: Read enough surrounding context to understand the binding**

Read ~30 lines around the buildTools calls. The function `runAgentLoop` will have access to `cfg` (the `ResolvedAIAgentConfig`) somewhere — `cfg.extractor` is what feeds the runner.

- [ ] **Step 3: Bind the runner**

At the top of the loop function (where `cfg` is in scope), build a runner if extractor config is present:

```typescript
import { runExtractor } from './extractor'
import type { ExtractorRunner } from './tools/extract-contacts'

// inside runAgentLoop, after cfg is resolved:
const extractorRunner: ExtractorRunner | undefined = cfg.extractor
    ? (input, signal) => runExtractor(input, cfg.extractor!, signal)
    : undefined
```

Then pass `{ extractorRunner }` to every `buildTools` call:

```typescript
const tools = await buildTools(query, queue, state, phase, { extractorRunner })
```

- [ ] **Step 4: Run all tests**

```bash
npx jest src/sources/ai-agent
npx tsc --noEmit -p tsconfig.json
```
Expected: all green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add examples/scraper-node/src/sources/ai-agent/loop.ts
git commit -m "feat(ai-agent): bind extractor runner from resolved config in agent loop"
```

---

## Task 11: Full-package + repo-wide verification

**Files:**
- (none modified)

- [ ] **Step 1: Build the whole repo**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-extractor
npm run build 2>&1 | tail -10
```
Expected: clean, exit 0.

- [ ] **Step 2: Run full scraper-node test suite**

```bash
cd examples/scraper-node && bash scripts/test.sh
```
Expected: full suite green; test count ~250+ (PR1's 207 + ~50 new in PR2).

- [ ] **Step 3: Run repo-wide tests**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-extractor
npm test --workspaces --if-present 2>&1 | grep -E "^(Tests:|Test Suites:)" | head
```
Expected: every workspace green.

- [ ] **Step 4: No commit needed**

---

## Task 12: Wire-up sanity check

**Files:**
- (read-only)

- [ ] **Step 1: Verify extractor module is reachable from loop**

```bash
cd /home/data/projects/bots/scrap-hub/.worktrees/ai-agent-extractor
grep -n "runExtractor\|extractor" examples/scraper-node/src/sources/ai-agent/loop.ts
```
Expected: imports + binding visible.

- [ ] **Step 2: Verify extract-contacts has the escalation guard**

```bash
grep -n "extractorRunner\|SUBSTANTIVE_TEXT_THRESHOLD" examples/scraper-node/src/sources/ai-agent/tools/extract-contacts.ts
```
Expected: both visible.

- [ ] **Step 3: Verify no extractor module is imported from outside ai-agent/**

```bash
grep -rn "from ['\"].*extractor" examples/scraper-node/src --include='*.ts' | grep -v 'ai-agent'
```
Expected: empty.

- [ ] **Step 4: No commit needed**

---

## Task 13: Push branch + open PR

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline main..HEAD
```
Expected: ~10 commits in the order of Tasks 1-10.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/ai-agent-extractor
```

- [ ] **Step 3: Open the PR**

If `gh` CLI is available:

```bash
gh pr create --title "feat(ai-agent): PR2 — extractor sub-agent (one-shot, no refetch)" --body "$(cat <<'EOF'
## Summary
- Adds the extractor sub-agent layer of the AI-agent overhaul (`docs/superpowers/specs/2026-04-29-ai-agent-overhaul-design.md`, PR2).
- New module: `examples/scraper-node/src/sources/ai-agent/extractor/` with config, prompts, loop, and four tools (`read_blocks`, `read_json_blob`, `report_extraction`, `report_incomplete`).
- New args slice: `args/aiAgent/extractor/*` with parent-inheriting model/baseUrl/apiKey defaults.
- `extract_contacts` gains an optional escalation path: when zero contacts found on a substantive page, runs the extractor sub-agent and merges its result.
- Refetch is intentionally NOT in this PR — lands in PR3.
- Extractor model defaults inherit from parent; users SHOULD set a different (smaller/faster) model for cost/latency.

## Test plan
- [x] Full ai-agent suite green (~144 baseline + ~50 new = ~194).
- [x] `bash scripts/test.sh` clean for scraper-node.
- [x] Repo-wide `npm test --workspaces --if-present` clean.
- [x] `npm run build` clean.
- [x] Mock-OpenAI tests verify terminal-tool termination, budget exhaustion, abort signal.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` is not installed, push and use the URL printed by `git push` to open the PR via the web UI.

- [ ] **Step 4: No commit needed**

---

## Self-Review

**Spec coverage** (per spec sections referenced):

- §3.5 (extractor sub-agent, one-shot variant) → Tasks 1, 4-7.
- §4 (config: `args/aiAgent/extractor/*` with inheriting defaults) → Tasks 2, 3.
- Escalation triggers → Task 8 (substantive-text threshold; phone-fragment trigger and JSON-LD-empty trigger are deferred — see open question Q1 below).
- "Extractor input is pre-extracted server-side" → Task 8 builds the input, Task 1 types it.
- Refetch deferred to PR3 → confirmed: no `refetch` tool in Task 4 toolset.

**Placeholder scan:** searched for "TBD", "TODO", "implement later", "fill in details", "add appropriate". One reference to "PR3" in Task 6 prompts (mentioning the loop forces termination) — that's a description of behavior, not a placeholder. None of the standard placeholder patterns present.

**Type consistency:**
- `ExtractorInput` defined in Task 1, consumed identically in Tasks 4-8.
- `ExtractorTool.handler(args, ctx)` signature consistent across Tasks 4 and 5.
- `ExtractorReport` discriminated union — `outcome: 'extraction' | 'incomplete'` — used identically by Task 5 (terminal tools) and Task 7 (loop's terminal handling).
- `ExtractionResult = ExtractorReport & { toolCallsUsed: number }` — consistent in Tasks 1, 7, 8.
- `ExtractorRunner` type from Task 8 imported by Task 9 (`tools/index.ts`).

**Open questions for plan-time** (intentionally deferred — narrow enough that they can be resolved at implementation time without rewriting tasks):

- **Q1**: The spec lists three escalation triggers (zero-contacts-substantive, phone-fragment-no-complete, substantive-script-empty-jsonld). Task 8 implements only the first (simplest, lowest false-positive). The other two require additional regex/heuristic work. Defer to a follow-up PR if PR2 evaluation shows them needed.

- **Q2**: Task 10 wires the runner into `loop.ts` — but `loop.ts` currently has 472 lines of phase-machine code. The wiring point depends on where `cfg` is in scope and where `buildTools` is called. The task says "find the call site, bind the runner, pass it through" — that's deliberately permissive. The implementer should match the existing patterns rather than impose new structure.

- **Q3**: `pageUrl` is forwarded to the extractor as `input.url`, but `extract_contacts` doesn't currently receive a URL through its tool args. Today this is fine (extractor doesn't refetch in PR2), but PR3's `refetch` will need URL knowledge. Plan: extend the tool's parameters with optional `url` in PR3, not now.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-29-ai-agent-pr2-extractor-subagent.md`.
