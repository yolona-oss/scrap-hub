import type {
    OrgRecord, OrgRecordStatus, OrgGap, OrgFrontierEntry, WorkQueueContext,
} from '../types'
import type { ClassifiedPage } from '../../page-types'

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
