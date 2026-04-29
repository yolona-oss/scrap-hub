import type { ClassifiedPage } from '../page-types'
import type { OrgSourceRef } from '../../../types'

export type OrgRecordStatus = 'partial' | 'saturated' | 'verified' | 'rejected'

export type OrgGap = 'phone' | 'email' | 'address'

export interface OrgFrontierEntry {
    url: string
    reason: string
    score: number
}

export interface OrgRecord {
    id: string
    status: OrgRecordStatus
    name: string
    phones: string[]
    emails: string[]
    addresses: string[]
    sources: OrgSourceRef[]
    gaps: OrgGap[]
    frontier: OrgFrontierEntry[]
    confidence: number
    extractionMethod: 'deterministic' | 'extractor-llm' | 'mixed'
    notes: string[]
    perOrgToolCallsUsed: number
}

/** Extraction result the queue tools consume — shaped like extract_contacts return. */
export interface ExtractContactsResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
}

export interface WorkQueueContext {
    classifyPage: (url: string, opts?: { signal?: AbortSignal }) => Promise<ClassifiedPage>
    /** Deterministic + extractor-escalation extraction over an HTML string. */
    extractContacts: (html: string, opts?: { signal?: AbortSignal, pageUrl?: string }) => Promise<ExtractContactsResult>
}
