import type { ClassifiedPage } from '../page-types'
import type { OrgConflict, OrgData, OrgSourceRef, OrgStatus } from '../../../types'

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
    /** Cross-source disagreements on a field. Populated by fill_gap when its
     *  extraction differs from an existing value, and resolved by review_org. */
    conflicts?: OrgConflict[]
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

export interface JudgeMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
}

/** Single-shot completion that forces JSON output. Used by review_org so the
 *  parent OpenAI client can be swapped for a fake in tests without dragging
 *  in the full SDK surface. */
export interface LLMJudgeContext {
    callJudge(messages: JudgeMessage[], opts?: { signal?: AbortSignal }): Promise<{ content: string | null }>
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
        conflicts: record.conflicts?.length
            ? record.conflicts.map(c => ({ ...c, values: c.values.map(v => ({ ...v })) }))
            : undefined,
    }
}
