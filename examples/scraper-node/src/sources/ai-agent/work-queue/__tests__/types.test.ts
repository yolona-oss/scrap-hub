import type {
    OrgRecord, OrgRecordStatus, OrgGap, OrgFrontierEntry, WorkQueueContext,
} from '../types'
import { orgRecordToOrgData } from '../types'
import type { ClassifiedPage } from '../../page-types'

function makeRecord(overrides: Partial<OrgRecord> = {}): OrgRecord {
    return {
        id: 'rec-1',
        status: 'partial',
        name: 'Acme',
        phones: ['+78121001010'],
        emails: ['info@acme.ru'],
        addresses: ['г. СПб, ул. Ленина, 1'],
        sources: [{
            url: 'https://acme.ru',
            kind: 'org-site',
            extractedAt: '2026-04-30T00:00:00Z',
            extractionMethod: 'deterministic',
        }],
        gaps: [],
        frontier: [{ url: 'https://acme.ru/contacts', reason: 'r', score: 0.8 }],
        confidence: 0.85,
        extractionMethod: 'deterministic',
        notes: [],
        perOrgToolCallsUsed: 2,
        ...overrides,
    }
}

describe('work-queue types', () => {
    it('OrgRecordStatus has the four expected variants', () => {
        const exhaustive: Record<OrgRecordStatus, true> = {
            partial: true, saturated: true, verified: true, rejected: true,
        }
        expect(Object.keys(exhaustive).length).toBe(4)
    })

    it('OrgGap has the three expected fields', () => {
        const gaps: OrgGap[] = ['phone', 'email', 'address']
        expect(gaps.length).toBe(3)
    })

    it('OrgFrontierEntry shape', () => {
        const entry: OrgFrontierEntry = { url: 'https://x', reason: 'hint', score: 0.8 }
        expect(entry.score).toBe(0.8)
    })

    it('OrgRecord required fields', () => {
        const r: OrgRecord = {
            id: 'uuid-1',
            status: 'partial',
            name: 'Acme',
            phones: [],
            emails: [],
            addresses: [],
            sources: [],
            gaps: ['phone'],
            frontier: [],
            confidence: 0.5,
            extractionMethod: 'deterministic',
            notes: [],
            perOrgToolCallsUsed: 0,
        }
        expect(r.id).toBe('uuid-1')
        expect(r.status).toBe('partial')
    })

    it('orgRecordToOrgData drops queue-internal fields', () => {
        const record = makeRecord()
        const data = orgRecordToOrgData(record)
        expect(data).toEqual(expect.objectContaining({
            name: 'Acme',
            phones: ['+78121001010'],
            emails: ['info@acme.ru'],
            addresses: ['г. СПб, ул. Ленина, 1'],
            confidence: 0.85,
            extractionMethod: 'deterministic',
        }))
        expect((data as any).id).toBeUndefined()
        expect((data as any).frontier).toBeUndefined()
        expect((data as any).gaps).toBeUndefined()
        expect((data as any).perOrgToolCallsUsed).toBeUndefined()
        expect(data.sources[0].url).toBe('https://acme.ru')
    })

    it('orgRecordToOrgData maps saturated → partial OrgStatus', () => {
        const data = orgRecordToOrgData(makeRecord({ status: 'saturated' }))
        expect(data.status).toBe('partial')
    })

    it('orgRecordToOrgData maps verified and rejected through directly', () => {
        expect(orgRecordToOrgData(makeRecord({ status: 'verified' })).status).toBe('verified')
        expect(orgRecordToOrgData(makeRecord({ status: 'rejected' })).status).toBe('rejected')
    })

    it('orgRecordToOrgData omits notes when empty', () => {
        const data = orgRecordToOrgData(makeRecord({ notes: [] }))
        expect(data.notes).toBeUndefined()
    })

    it('orgRecordToOrgData clones arrays so mutations do not leak', () => {
        const r = makeRecord()
        const data = orgRecordToOrgData(r)
        data.phones.push('mutated')
        expect(r.phones).toEqual(['+78121001010'])
    })

    it('WorkQueueContext provides classifyPage and extractContacts callbacks', () => {
        const fakeClassify = async (_url: string): Promise<ClassifiedPage> => ({
            url: _url, pageType: 'org-site', confidence: 0.5, signals: [],
            cleanedText: '', candidateBlocks: [], jsonLdBlobs: [],
            contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        })
        const fakeExtract = async (_html: string) => ({
            phones: [], emails: [], addresses: [], candidateName: '',
        })
        const ctx: WorkQueueContext = {
            classifyPage: fakeClassify,
            extractContacts: fakeExtract,
        }
        expect(typeof ctx.classifyPage).toBe('function')
    })
})
