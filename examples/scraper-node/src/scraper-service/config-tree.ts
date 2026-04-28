import {
    GlobalServiceConfig,
    GlobalServiceMessages,
    CmdServiceData,
    HubGlobalServiceParam,
    CmdArgument,
} from '@cmd-hub/core'
import { OrgData } from '../types'

/**
 * Source / exporter names listed for builder autocomplete.
 *
 * The live registries (`SourceRegistry`, `ExporterRegistry`) are still
 * the runtime source-of-truth for what's actually available; these
 * literals only seed the builder's pick list. Adding a new plugin means
 * a registration call AND adding the name here — the manifest's static
 * `options[]` can't be resolved at runtime under the new tree model.
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
 * its own `type`, `default`, optional `options[]`, and validator —
 * `unflattenValue` produces a typed `ScraperConfig` instance directly,
 * so the runtime side never sees raw strings or has to re-merge defaults.
 *
 * Source/exporter names come from the live registries so adding a new
 * source plugin is a registration call, not a tree-edit.
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

/** AI-agent settings as a nested branch class. Defaults preserved from
 *  the old `AI_AGENT_DEFAULTS` constants — the leaves carry them directly. */
class AIAgentSettings {
    @CmdArgument({
        required: false,
        description: 'Backing model id',
        options: ['qwen2.5:7b', 'qwen3:8b', 'qwen3.5:9b', 'gpt-4o', 'gpt-4o-mini'],
        default: 'qwen2.5:7b',
    })
    model?: string

    @CmdArgument({
        required: false,
        description: 'Sampling temperature (0..1)',
        type: 'number',
        options: ['0.0', '0.2', '0.5', '0.7', '1.0'],
        default: '0.2',
        validator: zeroToOne,
    })
    temperature?: number

    @CmdArgument({
        required: false,
        description: 'Max tool calls per task',
        type: 'number',
        options: ['10', '25', '50', '100'],
        default: '25',
        validator: positiveInt,
    })
    maxToolCalls?: number

    @CmdArgument({
        required: false,
        description: 'Per-tool timeout (ms)',
        type: 'number',
        options: ['30000', '60000', '120000'],
        default: '60000',
        validator: positiveInt,
    })
    toolTimeoutMs?: number

    @CmdArgument({
        required: false,
        description: 'Whole-task timeout (ms)',
        type: 'number',
        options: ['60000', '300000', '600000', '1800000', '3600000'],
        default: '3600000',
        validator: positiveInt,
    })
    totalTimeoutMs?: number

    @CmdArgument({
        required: false,
        description: 'Override LLM base URL',
        default: 'http://127.0.0.1:11434/v1',
    })
    baseUrl?: string

    @CmdArgument({
        required: false,
        description: 'API key (free-form; empty = none)',
        default: '',
    })
    apiKey?: string
}

/** Google Sheets exporter config. Both fields are free-form; empty
 *  values mean "feature unavailable" — the exporter checks. */
class GoogleSheetsSettings {
    @CmdArgument({
        required: false,
        description: 'Service-account credentials JSON',
        default: '',
    })
    credentials?: string

    @CmdArgument({
        required: false,
        description: 'Target spreadsheet id',
        default: '',
    })
    spreadsheetId?: string
}

export class ScraperConfigData extends GlobalServiceConfig {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Search query (e.g. 'стоматологии Москва')",
        validator: nonEmptyString,
    })
    query?: string

    @CmdArgument({
        required: false,
        description: 'City/region filter',
    })
    city?: string

    @CmdArgument({
        required: false,
        description: 'Max organizations to collect',
        type: 'number',
        options: ['100', '1000', '10000', '100000', '1000000'],
        default: '10000',
        validator: positiveInt,
    })
    limit?: number

    @CmdArgument({
        required: false,
        description: 'Export format',
        options: [...EXPORTER_OPTIONS],
        default: 'json',
    })
    format?: string

    @CmdArgument({
        required: false,
        description: "Sources to scrape (comma-separated, or 'all')",
        // Multi-select: pass 'all' or a comma-separated list of source
        // names. The static `options[]` only helps the builder pick a
        // single source — the runtime parser splits the comma form.
        options: [...SOURCE_OPTIONS],
        default: 'all',
    })
    sources?: string

    @CmdArgument({
        required: false,
        description: 'AI agent settings',
        childClass: AIAgentSettings,
    })
    aiAgent?: AIAgentSettings

    @CmdArgument({
        required: false,
        description: 'Google Sheets export config',
        childClass: GoogleSheetsSettings,
    })
    googleSheets?: GoogleSheetsSettings

    @CmdArgument({
        required: false,
        description: 'Per-request delay in milliseconds',
        type: 'number',
        options: ['250', '500', '1000', '2000', '5000'],
        default: '1000',
        validator: positiveInt,
    })
    requestDelayMs?: number
}

export class ScraperParamsData extends HubGlobalServiceParam {}

export class ScraperMessagesData extends GlobalServiceMessages {
    @CmdArgument({ required: false, standalone: true, description: 'Pause scraping' })
    pause?: boolean

    @CmdArgument({ required: false, standalone: true, description: 'Resume scraping' })
    resume?: boolean

    @CmdArgument({ required: false, standalone: true, description: 'Stop and export current results' })
    stop?: boolean

    @CmdArgument({ required: false, standalone: true, description: 'Export current results now' })
    export?: boolean
}

/** Resumable per-session state — distinct from config. Capped + persisted
 *  every N orgs so a node restart can pick up where the run left off
 *  without re-yielding duplicates. */
export interface ScraperRuntimeState {
    results: OrgData[]
    processedUrls: string[]
    lastQuery?: string
}

export type ScraperServiceDataType = CmdServiceData<
    ScraperConfigData,
    ScraperParamsData,
    ScraperMessagesData,
    ScraperRuntimeState
>

export const scraperDefaultData: ScraperServiceDataType = new CmdServiceData(
    new ScraperConfigData(),
    new ScraperParamsData(),
    new ScraperMessagesData(),
)

/** Public type aliases callers (sources, exporters, plugins) can import
 *  to type the `context.config` they receive. The shapes are derived
 *  from the data classes so renames stay in sync automatically. */
export type AIAgentConfig = AIAgentSettings
export type GoogleSheetsConfig = GoogleSheetsSettings
export type ScraperConfig = ScraperConfigData
