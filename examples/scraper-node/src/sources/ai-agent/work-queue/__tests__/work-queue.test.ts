import { WorkQueue } from '../work-queue'
import type { OrgRecord } from '../types'

function newRec(overrides: Partial<OrgRecord> = {}): Omit<OrgRecord, 'id' | 'perOrgToolCallsUsed'> {
    return {
        status: 'partial',
        name: 'X',
        phones: [],
        emails: [],
        addresses: [],
        sources: [],
        gaps: ['phone', 'email', 'address'],
        frontier: [],
        confidence: 0.5,
        extractionMethod: 'deterministic',
        notes: [],
        ...overrides,
    }
}

describe('WorkQueue', () => {
    it('insert assigns a UUID and starts perOrgToolCallsUsed at 0', () => {
        const q = new WorkQueue()
        const rec = q.insert(newRec())
        expect(rec.id).toBeTruthy()
        expect(rec.id).not.toBe('')
        expect(rec.perOrgToolCallsUsed).toBe(0)
    })

    it('get returns the record by id', () => {
        const q = new WorkQueue()
        const rec = q.insert(newRec({ name: 'Acme' }))
        const got = q.get(rec.id)
        expect(got?.name).toBe('Acme')
    })

    it('get returns undefined for unknown id', () => {
        const q = new WorkQueue()
        expect(q.get('nope')).toBeUndefined()
    })

    it('list returns all records when no filter', () => {
        const q = new WorkQueue()
        q.insert(newRec({ name: 'A' }))
        q.insert(newRec({ name: 'B' }))
        expect(q.list().length).toBe(2)
    })

    it('list filters by status', () => {
        const q = new WorkQueue()
        const a = q.insert(newRec({ name: 'A' }))
        q.insert(newRec({ name: 'B' }))
        q.transition(a.id, 'saturated')
        q.transition(a.id, 'verified')
        expect(q.list({ status: 'partial' }).length).toBe(1)
        expect(q.list({ status: 'verified' }).length).toBe(1)
    })

    it('transition partial → saturated allowed', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        expect(q.get(r.id)?.status).toBe('saturated')
    })

    it('transition saturated → verified allowed', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        q.transition(r.id, 'verified')
        expect(q.get(r.id)?.status).toBe('verified')
    })

    it('transition partial → rejected allowed', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'rejected')
        expect(q.get(r.id)?.status).toBe('rejected')
    })

    it('transition saturated → partial NOT allowed (throws)', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        expect(() => q.transition(r.id, 'partial')).toThrow(/transition/i)
    })

    it('transition verified → anything NOT allowed (terminal)', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        q.transition(r.id, 'verified')
        expect(() => q.transition(r.id, 'partial')).toThrow(/terminal/i)
        expect(() => q.transition(r.id, 'rejected')).toThrow(/terminal/i)
    })

    it('pickNextPartial returns highest-priority partial (fewest gaps wins)', () => {
        const q = new WorkQueue()
        const a = q.insert(newRec({ name: 'A', gaps: ['phone', 'email', 'address'] }))
        const b = q.insert(newRec({ name: 'B', gaps: ['phone'] }))
        const c = q.insert(newRec({ name: 'C', gaps: ['phone', 'email'] }))
        const picked = q.pickNextPartial()
        expect(picked?.id).toBe(b.id)
    })

    it('pickNextPartial returns undefined when no partials remain', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.transition(r.id, 'saturated')
        q.transition(r.id, 'verified')
        expect(q.pickNextPartial()).toBeUndefined()
    })

    it('pickNextPartial breaks ties by insertion order (older first)', () => {
        const q = new WorkQueue()
        const a = q.insert(newRec({ name: 'A', gaps: ['phone'] }))
        const b = q.insert(newRec({ name: 'B', gaps: ['phone'] }))
        expect(q.pickNextPartial()?.id).toBe(a.id)
    })

    it('mutate returns a mutable handle for in-place updates', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.mutate(r.id, draft => {
            draft.phones.push('+78121001010')
            draft.gaps = draft.gaps.filter(g => g !== 'phone')
        })
        const after = q.get(r.id)
        expect(after?.phones).toEqual(['+78121001010'])
        expect(after?.gaps).toEqual(['email', 'address'])
    })

    it('mutate throws for unknown id', () => {
        const q = new WorkQueue()
        expect(() => q.mutate('nope', () => {})).toThrow(/not found/i)
    })

    it('mutate refuses to change id', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec())
        q.mutate(r.id, draft => { (draft as any).id = 'CHANGED' })
        expect(q.get(r.id)).toBeDefined()
        expect(q.get('CHANGED')).toBeUndefined()
    })

    it('list result is a defensive copy (mutations do not bleed back)', () => {
        const q = new WorkQueue()
        const r = q.insert(newRec({ name: 'A' }))
        const list = q.list()
        list[0].name = 'MUTATED'
        expect(q.get(r.id)?.name).toBe('A')
    })
})
