import { GlobalServiceConfig, GlobalServiceMessages, CmdServiceData, HubGlobalServiceParam } from "@cmd-hub/core"
import { CmdArgument } from "@cmd-hub/core"
import { SourceRegistry } from "../sources/registry"
import { ExporterRegistry } from "../exporters/registry"
import { aiAgentTreeResolver, googleSheetsTreeResolver } from "../sources/ai-agent/config-tree"
import { OrgData } from "../types"

export class ScraperConfigData extends GlobalServiceConfig {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Search query (e.g. 'стоматологии Москва')"
    })
    query!: string

    @CmdArgument({
        required: false,
        description: "City/region filter"
    })
    city?: string

    @CmdArgument({
        required: false,
        description: "Max organizations to collect",
        pairOptions: ["1000", "10000", "100000", "1000000", "5000000", "1000000000"],
        defaultValue: "100000"
    })
    limit?: string

    @CmdArgument({
        required: false,
        description: "Export format",
        pairOptions: async () => ExporterRegistry.available(),
        defaultValue: "csv"
    })
    format?: string

    @CmdArgument({
        required: false,
        description: "Sources to scrape (comma-separated, or 'all')",
        pairOptions: async () => {
            const sources = SourceRegistry.available()
            return ['all', ...sources]
        },
        defaultValue: "all"
    })
    sources?: string

    @CmdArgument({
        required: false,
        description: "AI agent settings (drill into key, then pick a value)",
        pairOptions: aiAgentTreeResolver,
    })
    aiAgent?: string

    @CmdArgument({
        required: false,
        description: "Google Sheets export config (credentials, spreadsheetId)",
        pairOptions: googleSheetsTreeResolver,
    })
    googleSheets?: string

    @CmdArgument({
        required: false,
        description: "Per-request delay in milliseconds",
        pairOptions: ['250', '500', '1000', '2000', '5000'],
        defaultValue: "1000",
    })
    requestDelayMs?: string
}

export class ScraperParamsData extends HubGlobalServiceParam {
}

export class ScraperMessagesData extends GlobalServiceMessages {
    @CmdArgument({
        required: false,
        standalone: true,
        description: "Pause scraping"
    })
    pause?: void

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Resume scraping"
    })
    resume?: void

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Stop and export current results"
    })
    stop?: void

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Export current results now"
    })
    export?: void
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
    new ScraperMessagesData()
)
