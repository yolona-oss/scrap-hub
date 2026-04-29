import type { Tool } from './types'
import type { WorkQueueContext } from '../work-queue'
import { log } from '@cmd-hub/common'

export function makeDiscoverOrgCandidatesTool(ctx: WorkQueueContext): Tool {
    return {
        name: 'discover_org_candidates',
        description: 'Classify a URL without committing to harvest. Returns page type, signals, and counts so you can decide whether to call harvest_serp on this URL.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to classify.' },
            },
            required: ['url'],
        },
        async handler(args, signal) {
            const url = String(args?.url ?? '').trim()
            if (!url) return { error: 'empty url' }

            log.trace(`ai-agent.discover_org_candidates: ${url}`)
            try {
                const page = await ctx.classifyPage(url, { signal })
                return {
                    url: page.url,
                    pageType: page.pageType,
                    confidence: page.confidence,
                    signals: page.signals,
                    jsonLdCount: page.jsonLdBlobs.length,
                    candidateBlockCount: page.candidateBlocks.length,
                    contactCandidateCount: page.contactCandidates.length,
                    aggregatorCandidateCount: page.aggregatorCandidates.length,
                }
            } catch (e: any) {
                log.warn(`ai-agent.discover_org_candidates: ${url}: ${e?.message ?? e}`)
                return { error: `fetch failed: ${e?.message ?? e}` }
            }
        },
    }
}
