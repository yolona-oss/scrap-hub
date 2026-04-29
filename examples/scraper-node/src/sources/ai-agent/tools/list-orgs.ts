import type { Tool } from './types'
import type { WorkQueue } from '../work-queue'
import type { OrgRecordStatus } from '../work-queue'
import { log } from '@cmd-hub/common'

const VALID_STATUSES: OrgRecordStatus[] = ['partial', 'saturated', 'verified', 'rejected']
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

interface OrgSummary {
    id: string
    status: OrgRecordStatus
    name: string
    gaps: string[]
    sourceCount: number
    confidence: number
}

export function makeListOrgsTool(workQueue: WorkQueue): Tool {
    return {
        name: 'list_orgs',
        description: 'List orgs in the work queue. Filter by status (partial/saturated/verified/rejected) and limit (default 20, max 100). Returns id, status, name, gaps, sourceCount per record.',
        parameters: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['partial', 'saturated', 'verified', 'rejected'],
                    description: 'Filter by status. Omit for all.',
                },
                limit: {
                    type: 'number',
                    description: `Max records to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
                },
            },
        },
        async handler(args) {
            const requestedStatus = typeof args?.status === 'string' ? args.status : undefined
            const status = requestedStatus && VALID_STATUSES.includes(requestedStatus as OrgRecordStatus)
                ? (requestedStatus as OrgRecordStatus)
                : undefined
            const limit = Math.min(
                typeof args?.limit === 'number' && args.limit > 0 ? args.limit : DEFAULT_LIMIT,
                MAX_LIMIT,
            )

            const records = workQueue.list({ status, limit })
            const orgs: OrgSummary[] = records.map(r => ({
                id: r.id,
                status: r.status,
                name: r.name,
                gaps: r.gaps,
                sourceCount: r.sources.length,
                confidence: r.confidence,
            }))
            log.trace(`ai-agent.list_orgs: status=${status ?? 'any'} limit=${limit} returned=${orgs.length}`)
            return { orgs, total: workQueue.size() }
        },
    }
}
