import { OrgData, SearchQuery } from "../types"
import type { ServiceContext } from "@core/ui/types/command/service"

export type { ServiceContext }

export interface ExportResult {
    type: 'file' | 'url'
    filePath?: string
    url?: string
    message: string
}

export interface IExporter {
    readonly name: string
    readonly fileExtension: string | null

    export(data: OrgData[], query: SearchQuery, context?: ServiceContext): Promise<ExportResult>
}

export type ExporterFactory = () => IExporter
