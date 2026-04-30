import type { Tool } from './types'
import type { WorkQueue } from '../work-queue'
import { orgRecordToOrgData } from '../work-queue'
import type { AsyncQueue } from '../async-queue'
import type { OrgData } from '../../../types'
import { log } from '@cmd-hub/common'

export function makeFreezeOrgTool(
    workQueue: WorkQueue,
    emitQueue: AsyncQueue<OrgData>,
): Tool {
    return {
        name: 'freeze_org',
        description: 'Force-finalize an org record. If it has at least one contact (phone/email/address), transition to verified; otherwise to rejected. Used at run end when budget runs out.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
            },
            required: ['orgId'],
        },
        async handler(args) {
            const orgId = String(args?.orgId ?? '')
            const record = workQueue.get(orgId)
            if (!record) return { error: `org id ${orgId} not found` }
            if (record.status === 'verified' || record.status === 'rejected') {
                return { error: `org ${orgId} is already terminal (${record.status})` }
            }
            const hasContact = record.phones.length || record.emails.length || record.addresses.length
            const finalStatus = hasContact ? 'verified' : 'rejected'

            // saturated → verified is allowed; partial → rejected is allowed.
            // partial → verified is NOT a direct transition: route via saturated first.
            if (record.status === 'partial' && finalStatus === 'verified') {
                workQueue.transition(orgId, 'saturated')
            }
            workQueue.transition(orgId, finalStatus)

            if (finalStatus === 'verified') {
                const final = workQueue.get(orgId)!
                emitQueue.push(orgRecordToOrgData(final))
                log.debug(`ai-agent.freeze_org: id=${orgId} → verified, emitted`)
            } else {
                log.debug(`ai-agent.freeze_org: id=${orgId} → rejected`)
            }
            return { orgId, finalStatus }
        },
    }
}
