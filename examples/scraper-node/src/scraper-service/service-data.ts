import { GlobalServiceConfig, GlobalServiceMessages, CmdServiceData, HubGlobalServiceParam } from "@cmd-hub/core"
import { CmdArgument } from "@cmd-hub/core"
import { SourceRegistry } from "../sources/registry"
import { ExporterRegistry } from "../exporters/registry"
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
            // Generate useful combos: each individual + "all" + common pairs
            const options = ['all', ...sources]
            if (sources.length > 2) {
                // Add some 2-source combos
                for (let i = 0; i < Math.min(sources.length, 3); i++) {
                    for (let j = i + 1; j < Math.min(sources.length, 4); j++) {
                        options.push(`${sources[i]},${sources[j]}`)
                    }
                }
            }
            return options
        },
        defaultValue: "all"
    })
    sources?: string
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

export interface IScraperSessionData {
    results: OrgData[]
    processedUrls: string[]
    lastQuery?: string
}

export type ScraperServiceDataType = CmdServiceData<
    ScraperConfigData,
    ScraperParamsData,
    ScraperMessagesData,
    IScraperSessionData
>

export const scraperDefaultData: ScraperServiceDataType = new CmdServiceData(
    new ScraperConfigData(),
    new ScraperParamsData(),
    new ScraperMessagesData()
)
