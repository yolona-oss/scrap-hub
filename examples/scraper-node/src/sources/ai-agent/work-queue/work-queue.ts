import { randomUUID } from 'crypto'
import { log } from '@cmd-hub/common'
import type { OrgRecord, OrgRecordStatus } from './types'

const ALLOWED_TRANSITIONS: Record<OrgRecordStatus, OrgRecordStatus[]> = {
    partial: ['saturated', 'rejected'],
    saturated: ['verified', 'rejected'],
    verified: [],
    rejected: [],
}

const TERMINAL: OrgRecordStatus[] = ['verified', 'rejected']

export interface WorkQueueListFilter {
    status?: OrgRecordStatus
    limit?: number
}

export class WorkQueue {
    private records = new Map<string, OrgRecord>()
    private insertionOrder: string[] = []

    insert(seed: Omit<OrgRecord, 'id' | 'perOrgToolCallsUsed'>): OrgRecord {
        const id = randomUUID()
        const record: OrgRecord = { ...seed, id, perOrgToolCallsUsed: 0 }
        this.records.set(id, record)
        this.insertionOrder.push(id)
        log.trace(`work-queue.insert: id=${id} name="${record.name.slice(0, 40)}"`)
        return this.cloneRecord(record)
    }

    get(id: string): OrgRecord | undefined {
        const r = this.records.get(id)
        return r ? this.cloneRecord(r) : undefined
    }

    list(filter: WorkQueueListFilter = {}): OrgRecord[] {
        let results: OrgRecord[] = []
        for (const id of this.insertionOrder) {
            const r = this.records.get(id)
            if (!r) continue
            if (filter.status && r.status !== filter.status) continue
            results.push(this.cloneRecord(r))
            if (filter.limit && results.length >= filter.limit) break
        }
        return results
    }

    pickNextPartial(): OrgRecord | undefined {
        let best: { id: string, priority: number } | null = null
        for (const id of this.insertionOrder) {
            const r = this.records.get(id)
            if (!r || r.status !== 'partial') continue
            const priority = 1 - (r.gaps.length / 3)
            if (!best || priority > best.priority) {
                best = { id, priority }
            }
        }
        return best ? this.cloneRecord(this.records.get(best.id)!) : undefined
    }

    transition(id: string, target: OrgRecordStatus): void {
        const r = this.records.get(id)
        if (!r) throw new Error(`work-queue.transition: id ${id} not found`)
        if (TERMINAL.includes(r.status)) {
            throw new Error(`work-queue.transition: ${r.status} is terminal — cannot transition to ${target}`)
        }
        const allowed = ALLOWED_TRANSITIONS[r.status]
        if (!allowed.includes(target)) {
            throw new Error(`work-queue.transition: ${r.status} → ${target} is not an allowed transition`)
        }
        r.status = target
        log.debug(`work-queue.transition: id=${id} → ${target}`)
    }

    mutate(id: string, mutator: (draft: OrgRecord) => void): void {
        const r = this.records.get(id)
        if (!r) throw new Error(`work-queue.mutate: id ${id} not found`)
        const originalId = r.id
        mutator(r)
        // Defend the id invariant — mutators can't change it.
        r.id = originalId
    }

    private cloneRecord(r: OrgRecord): OrgRecord {
        return {
            ...r,
            phones: [...r.phones],
            emails: [...r.emails],
            addresses: [...r.addresses],
            sources: r.sources.map(s => ({ ...s })),
            gaps: [...r.gaps],
            frontier: r.frontier.map(f => ({ ...f })),
            notes: [...r.notes],
            conflicts: r.conflicts
                ? r.conflicts.map(c => ({ ...c, values: c.values.map(v => ({ ...v })) }))
                : undefined,
        }
    }

    /** For tests + telemetry: total record count. */
    size(): number {
        return this.records.size
    }
}
