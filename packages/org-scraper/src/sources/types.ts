import { OrgData, SearchQuery } from "../types"

export interface IScraperSource {
    readonly name: string
    readonly requiresApiKey: boolean

    search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData>
}

export type ScraperSourceFactory = () => IScraperSource
