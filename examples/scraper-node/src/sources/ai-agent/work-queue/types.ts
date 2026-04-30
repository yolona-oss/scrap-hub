import type { ClassifiedPage } from '../page-types'
import type { OrgData, OrgSourceRef, OrgStatus } from '../../../types'

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

/** Convert a queue record into the user-facing OrgData yielded by the source.
 *  Drops queue-internal fields (id, frontier, gaps, perOrgToolCallsUsed) and
 *  maps OrgRecordStatus to OrgStatus — 'saturated' surfaces as 'partial' for
 *  records emitted before final verification. */
export function orgRecordToOrgData(record: OrgRecord): OrgData {
    const status: OrgStatus = record.status === 'verified' ? 'verified'
        : record.status === 'rejected' ? 'rejected'
        : 'partial'
    return {
        name: record.name,
        phones: [...record.phones],
        emails: [...record.emails],
        addresses: [...record.addresses],
        sources: record.sources.map(s => ({ ...s })),
        status,
        confidence: record.confidence,
        extractionMethod: record.extractionMethod,
        notes: record.notes.length ? [...record.notes] : undefined,
    }
}
