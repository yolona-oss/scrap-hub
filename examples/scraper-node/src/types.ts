export type OrgStatus = 'verified' | 'partial' | 'rejected'

export type OrgExtractionMethod = 'deterministic' | 'extractor-llm' | 'mixed'

export type OrgSourceKind =
    | 'aggregator-landing'
    | 'aggregator-serp'
    | 'aggregator-detail'
    | 'org-site'
    | 'web-search'

export interface OrgSourceRef {
    url: string
    kind: OrgSourceKind
    extractedAt: string  // ISO8601
    extractionMethod: 'deterministic' | 'extractor-llm'
}

export interface OrgBranch {
    name?: string
    address: string
    phones?: string[]
    emails?: string[]
}

export interface OrgConflictValue {
    value: string
    sourceUrl: string
}

export interface OrgConflict {
    field: 'name' | 'phone' | 'email' | 'address'
    values: OrgConflictValue[]
    resolution?: 'auto' | 'review' | 'unresolved'
    chosenIndex?: number
}

export interface FieldProvenance {
    name?: { value: string, sourceUrl: string }
    phones?: { value: string, sourceUrl: string }[]
    emails?: { value: string, sourceUrl: string }[]
    addresses?: { value: string, sourceUrl: string }[]
}

export interface OrgData {
    name: string
    phones: string[]
    emails: string[]
    addresses: string[]
    sources: OrgSourceRef[]
    status: OrgStatus
    confidence: number  // 0..1
    extractionMethod: OrgExtractionMethod
    branches?: OrgBranch[]
    fieldProvenance?: FieldProvenance
    conflicts?: OrgConflict[]
    notes?: string[]
}

export interface SearchQuery {
    query: string
    city?: string
    sources: string[]
    maxResults: number
}
