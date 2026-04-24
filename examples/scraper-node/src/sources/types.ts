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
