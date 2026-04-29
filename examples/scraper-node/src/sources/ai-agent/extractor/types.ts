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
