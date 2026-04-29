export type PageType =
    | 'aggregator-landing'
    | 'aggregator-serp'
    | 'aggregator-detail'
    | 'org-site'
    | 'other'

export type LinkKind =
    | 'contact-page'
    | 'aggregator'
    | 'branch'

export interface ScoredLink {
    url: string
    score: number
    reason: string
    kind: LinkKind
}

export interface Block {
    selector: string
    text: string
    tels?: string[]
    mails?: string[]
}

export interface ClassifiedPage {
    url: string
    pageType: PageType
    confidence: number
    signals: string[]
    cleanedText: string
    candidateBlocks: Block[]
    jsonLdBlobs: unknown[]
    nextDataBlob?: unknown
    contactCandidates: ScoredLink[]
    aggregatorCandidates: ScoredLink[]
    branchCandidates: ScoredLink[]
}
