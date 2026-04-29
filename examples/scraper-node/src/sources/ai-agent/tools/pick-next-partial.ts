import type { Tool } from './types'
import type { WorkQueue } from '../work-queue'
import { log } from '@cmd-hub/common'

export function makePickNextPartialTool(workQueue: WorkQueue): Tool {
    return {
        name: 'pick_next_partial',
        description: 'Return the highest-priority partial org from the work queue (fewest gaps wins, ties by insertion order). Returns null if no partials remain. Full record returned, not just a summary.',
        parameters: {
            type: 'object',
            properties: {},
        },
        async handler(_args) {
            const org = workQueue.pickNextPartial()
            log.trace(`ai-agent.pick_next_partial: ${org ? `id=${org.id} name="${org.name.slice(0, 40)}" gaps=${org.gaps.length}` : 'none available'}`)
            return { org: org ?? null }
        },
    }
}
