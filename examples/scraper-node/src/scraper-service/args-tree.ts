import {
    GlobalServiceIntercom,
    CmdServiceData,
    CmdArg,
} from '@cmd-hub/common'
import { HubGlobalServiceArgs } from '@cmd-hub/core'
import { OrgData } from '../types'

/**
 * Source / exporter names listed for builder autocomplete.
 *
 * The live registries (`SourceRegistry`, `ExporterRegistry`) are still
 * the runtime source-of-truth for what's actually available; these
 * literals only seed the builder's pick list. Adding a new plugin means
 * a registration call AND adding the name here — the manifest's static
 * `choices[]` can't be resolved at runtime under the new tree model.
 */
const SOURCE_OPTIONS = [
    'all',
    'yandex-business',
    'ai-agent',
    'yandex-html',
    'zoon',
    'flamp',
] as const
const EXPORTER_OPTIONS = ['json', 'csv', 'google-sheets'] as const

/**
 * Per-service argument tree for `OrgScraperService`. Each leaf carries
 * its own `type`, `default`, optional `choices[]`, and validator —
 * `unflattenArgs` produces a typed `ScraperArgs` instance directly,
 * so the runtime side never sees raw strings or has to re-merge defaults.
 *
 * Source/exporter names come from the live registries so adding a new
 * source plugin is a registration call, not a tree-edit.
 *
 * Persistent leaves (`persistent: true`) ride the layered account/session
 * store via /sargs; ephemeral leaves (the four flags inherited from
 * HubGlobalServiceArgs — sessionId, noDashboard, noCache, now) are
 * per-invocation only.
 */

const positiveInt = (raw: string): true | string => {
    if (!/^\d+$/.test(raw)) return 'must be a positive integer'
    if (Number.parseInt(raw, 10) <= 0) return 'must be > 0'
    return true
}

const zeroToOne = (raw: string): true | string => {
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) return 'must be a number'
    if (n < 0 || n > 1) return 'must be between 0 and 1'
    return true
}

const nonEmptyString = (raw: string): true | string =>
    raw.trim().length > 0 ? true : 'must not be empty'

/** Extractor sub-agent settings (one-shot LLM extraction on hostile pages).
 *  Lives nested under `aiAgent.extractor` so users see one cohesive AI block. */
class ExtractorSettings {
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Enable extractor sub-agent escalation when deterministic extraction misses',
        type: 'bool',
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

/** AI-agent settings as a nested branch class. Defaults preserved from
 *  the old `AI_AGENT_DEFAULTS` constants — the leaves carry them directly. */
class AIAgentSettings {
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Backing model id',
        choices: ['qwen2.5:7b', 'qwen3:8b', 'qwen3.5:9b', 'gpt-4o', 'gpt-4o-mini'],
        default: 'qwen2.5:7b',
    })
    model?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Sampling temperature (0..1)',
        type: 'number',
        choices: ['0.0', '0.2', '0.5', '0.7', '1.0'],
        default: '0.2',
        validator: zeroToOne,
    })
    temperature?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Max tool calls per task',
        type: 'number',
        choices: ['10', '25', '50', '100'],
        default: '25',
        validator: positiveInt,
    })
    maxToolCalls?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Per-tool timeout (ms)',
        type: 'number',
        choices: ['30000', '60000', '120000'],
        default: '60000',
        validator: positiveInt,
    })
    toolTimeoutMs?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Whole-task timeout (ms)',
        type: 'number',
        choices: ['60000', '300000', '600000', '1800000', '3600000'],
        default: '3600000',
        validator: positiveInt,
    })
    totalTimeoutMs?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Override LLM base URL',
        default: 'http://127.0.0.1:11434/v1',
    })
    baseUrl?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'API key (free-form; empty = none)',
        default: '',
    })
    apiKey?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Extractor sub-agent settings (one-shot LLM extraction on hostile pages)',
        childClass: ExtractorSettings,
    })
    extractor?: ExtractorSettings
}

/** Google Sheets exporter config. Both fields are free-form; empty
 *  values mean "feature unavailable" — the exporter checks. */
class GoogleSheetsSettings {
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Service-account credentials JSON',
        default: '',
    })
    credentials?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Target spreadsheet id',
        default: '',
    })
    spreadsheetId?: string
}

export class ScraperArgs extends HubGlobalServiceArgs {
    @CmdArg({
        required: true,
        persistent: true,
        position: 1,
        description: "Search query (e.g. 'стоматологии Москва')",
        validator: nonEmptyString,
    })
    query?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'City/region filter',
    })
    city?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Max organizations to collect',
        type: 'number',
        choices: ['100', '1000', '10000', '100000', '1000000'],
        default: '10000',
        validator: positiveInt,
    })
    limit?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Export format',
        choices: [...EXPORTER_OPTIONS],
        default: 'json',
    })
    format?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: "Sources to scrape (comma-separated, or 'all')",
        // Multi-select: pass 'all' or a comma-separated list of source
        // names. The static `choices[]` only helps the builder pick a
        // single source — the runtime parser splits the comma form.
        choices: [...SOURCE_OPTIONS],
        default: 'all',
    })
    sources?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'AI agent settings',
        childClass: AIAgentSettings,
    })
    aiAgent?: AIAgentSettings

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Google Sheets export config',
        childClass: GoogleSheetsSettings,
    })
    googleSheets?: GoogleSheetsSettings

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Per-request delay in milliseconds',
        type: 'number',
        choices: ['250', '500', '1000', '2000', '5000'],
        default: '1000',
        validator: positiveInt,
    })
    requestDelayMs?: number
}

export class ScraperIntercom extends GlobalServiceIntercom {
    @CmdArg({ required: false, standalone: true, description: 'Pause scraping' })
    pause?: boolean

    @CmdArg({ required: false, standalone: true, description: 'Resume scraping' })
    resume?: boolean

    @CmdArg({ required: false, standalone: true, description: 'Stop and export current results' })
    stop?: boolean

    @CmdArg({ required: false, standalone: true, description: 'Export current results now' })
    export?: boolean
}

/** Resumable per-session state — distinct from args. Capped + persisted
 *  every N orgs so a node restart can pick up where the run left off
 *  without re-yielding duplicates. */
export interface ScraperState {
    results: OrgData[]
    processedUrls: string[]
    lastQuery?: string
}

export type ScraperServiceDataType = CmdServiceData<
    ScraperArgs,
    ScraperIntercom,
    ScraperState
>

export const scraperDefaultData: ScraperServiceDataType = new CmdServiceData(
    new ScraperArgs(),
    new ScraperIntercom(),
)

/** Public type aliases callers (sources, exporters, plugins) can import
 *  to type the `context.args` they receive. The shapes are derived
 *  from the data classes so renames stay in sync automatically. */
export type AIAgentConfig = AIAgentSettings
export type GoogleSheetsConfig = GoogleSheetsSettings
