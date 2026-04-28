import {
    GlobalServiceConfig,
    GlobalServiceMessages,
    CmdServiceData,
    HubGlobalServiceParam,
    CmdArgument,
} from '@cmd-hub/core'
import { OrgData } from '../types'

/**
 * AI agent settings as a nested branch class. The decorator's
 * design-time class type lifts each property into a sub-branch when
 * `childClass` is supplied (or when reflect-metadata sees a class
 * type). Leaves declare their static `options[]` directly — runtime
 * resolvers are gone.
 */
class AIAgentSettings {
    @CmdArgument({
        required: false,
        description: 'Backing model id',
        options: ['qwen2.5:7b', 'qwen3:8b'],
    })
    model?: string

    @CmdArgument({
        required: false,
        description: 'Sampling temperature',
        options: ['0.0', '0.2', '0.5', '0.7', '1.0'],
    })
    temperature?: string

    @CmdArgument({
        required: false,
        description: 'Max tool calls per task',
        options: ['10', '25', '50', '100'],
    })
    maxToolCalls?: string

    @CmdArgument({
        required: false,
        description: 'Per-tool timeout (ms)',
        options: ['30000', '60000', '120000'],
    })
    toolTimeoutMs?: string

    @CmdArgument({
        required: false,
        description: 'Whole-task timeout (ms)',
        options: ['60000', '300000', '600000', '1800000', '3600000'],
    })
    totalTimeoutMs?: string

    @CmdArgument({ required: false, description: 'Override LLM base URL' })
    baseUrl?: string

    @CmdArgument({ required: false, description: 'API key (free-form)' })
    apiKey?: string
}

/** Google Sheets exporter config — both fields are free-form. */
class GoogleSheetsSettings {
    @CmdArgument({ required: false, description: 'Service-account credentials JSON' })
    credentials?: string

    @CmdArgument({ required: false, description: 'Target spreadsheet id' })
    spreadsheetId?: string
}

export class ScraperConfigData extends GlobalServiceConfig {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Search query (e.g. 'стоматологии Москва')",
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
        options: ['1000', '10000', '100000', '1000000', '5000000', '1000000000'],
        default: '100000',
    })
    limit?: string

    @CmdArgument({
        required: false,
        description: 'Export format (csv, gsheets, ...)',
        default: 'csv',
    })
    format?: string

    @CmdArgument({
        required: false,
        description: "Sources to scrape (comma-separated, or 'all')",
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
        options: ['250', '500', '1000', '2000', '5000'],
        default: '1000',
    })
    requestDelayMs?: string
}

export class ScraperParamsData extends HubGlobalServiceParam {
}

export class ScraperMessagesData extends GlobalServiceMessages {
    @CmdArgument({ required: false, standalone: true, description: 'Pause scraping' })
    pause?: string

    @CmdArgument({ required: false, standalone: true, description: 'Resume scraping' })
    resume?: string

    @CmdArgument({ required: false, standalone: true, description: 'Stop and export current results' })
    stop?: string

    @CmdArgument({ required: false, standalone: true, description: 'Export current results now' })
    export?: string
}

export interface IScraperRuntimeState {
    results: OrgData[]
    processedUrls: string[]
    lastQuery?: string
}

export type ScraperServiceDataType = CmdServiceData<
    ScraperConfigData,
    ScraperParamsData,
    ScraperMessagesData,
    IScraperRuntimeState
>

export const scraperDefaultData: ScraperServiceDataType = new CmdServiceData(
    new ScraperConfigData(),
    new ScraperParamsData(),
    new ScraperMessagesData(),
)
