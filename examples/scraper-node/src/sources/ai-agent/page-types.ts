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
    /** Raw HTML body when available. Populated by network classifyPage; left
     *  undefined by callers that classify pre-loaded fragments. Consumers that
     *  need full deterministic extraction (microdata, semantic-html) re-cheerio-load
     *  this string. Pure-classifier consumers ignore it. */
    html?: string
}
