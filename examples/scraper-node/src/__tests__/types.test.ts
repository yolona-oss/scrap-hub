import type { OrgData, OrgSourceRef, OrgBranch, OrgConflict, FieldProvenance, SearchQuery } from '../types'

describe('v2 types', () => {
    it('OrgData requires multi-valued contact fields and metadata', () => {
        const r: OrgData = {
            name: 'Acme Clinic',
            phones: ['+78121001010'],
            emails: ['info@acme.ru'],
            addresses: ['ул. Ленина, 1'],
            sources: [{
                url: 'https://acme.ru/',
                kind: 'org-site',
                extractedAt: '2026-04-30T00:00:00Z',
                extractionMethod: 'deterministic',
            }],
            status: 'partial',
            confidence: 0.5,
            extractionMethod: 'deterministic',
        }
        expect(r.phones).toEqual(['+78121001010'])
        expect(r.status).toBe('partial')
        expect(r.confidence).toBe(0.5)
    })

    it('OrgData allows empty arrays', () => {
        const r: OrgData = {
            name: 'X',
            phones: [],
            emails: [],
            addresses: [],
            sources: [],
            status: 'partial',
            confidence: 0,
            extractionMethod: 'deterministic',
        }
        expect(r.phones).toEqual([])
    })

    it('OrgData accepts optional branches, fieldProvenance, conflicts, notes', () => {
        const branch: OrgBranch = { address: 'ул. Пушкина, 5', phones: ['+78122002020'] }
        const conflict: OrgConflict = {
            field: 'phone',
            values: [{ value: '+78121001010', sourceUrl: 'a' }, { value: '+78121001011', sourceUrl: 'b' }],
        }
        const provenance: FieldProvenance = {
            phones: [{ value: '+78121001010', sourceUrl: 'a' }],
        }
        const r: OrgData = {
            name: 'X',
            phones: ['+78121001010'],
            emails: [],
            addresses: [],
            sources: [],
            branches: [branch],
            conflicts: [conflict],
            fieldProvenance: provenance,
            notes: ['multi-branch'],
            status: 'verified',
            confidence: 0.9,
            extractionMethod: 'mixed',
        }
        expect(r.branches?.[0].address).toMatch(/Пушкина/)
        expect(r.conflicts?.[0].field).toBe('phone')
    })

    it('OrgSourceRef has the five canonical kinds', () => {
        const kinds: OrgSourceRef['kind'][] = [
            'aggregator-landing', 'aggregator-serp', 'aggregator-detail', 'org-site', 'web-search',
        ]
        for (const k of kinds) {
            const ref: OrgSourceRef = {
                url: 'https://x',
                kind: k,
                extractedAt: '2026-04-30T00:00:00Z',
                extractionMethod: 'deterministic',
            }
            expect(ref.kind).toBe(k)
        }
    })

    it('SearchQuery still carries sources[] (PR5 removes; PR4a leaves)', () => {
        const q: SearchQuery = { query: 'q', sources: ['ai-agent'], maxResults: 100 }
        expect(q.maxResults).toBe(100)
    })
})
