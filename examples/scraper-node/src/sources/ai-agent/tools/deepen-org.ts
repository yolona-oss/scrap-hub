import type { Tool } from './types'
import type { WorkQueue, WorkQueueContext, OrgFrontierEntry, OrgGap } from '../work-queue'
import { orgRecordToOrgData } from '../work-queue'
import type { AsyncQueue } from '../async-queue'
import type { OrgData, OrgSourceRef, SearchQuery } from '../../../types'
import { validateAndNormalizeAddress } from './emit'
import { log } from '@cmd-hub/common'

const FRONTIER_MAX_ADD = 3

function recomputeGaps(phones: string[], emails: string[], addresses: string[]): OrgGap[] {
    const gaps: OrgGap[] = []
    if (phones.length === 0) gaps.push('phone')
    if (emails.length === 0) gaps.push('email')
    if (addresses.length === 0) gaps.push('address')
    return gaps
}

export function makeDeepenOrgTool(
    workQueue: WorkQueue,
    ctx: WorkQueueContext,
    maxToolCallsPerOrg: number,
    emitQueue: AsyncQueue<OrgData>,
    query: SearchQuery,
): Tool {
    return {
        name: 'deepen_org',
        description: 'Walk the frontier of a partial org record, classifying + extracting each URL until gaps fill, frontier empties, or per-org budget runs out. Server-side state machine; the LLM just calls this and inspects the diff.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
            },
            required: ['orgId'],
        },
        async handler(args, signal) {
            const orgId = String(args?.orgId ?? '')
            const initial = workQueue.get(orgId)
            if (!initial) return { error: `org id ${orgId} not found` }
            if (initial.status !== 'partial') {
                return { error: `org ${orgId} is not partial (status=${initial.status}); cannot deepen` }
            }

            const visitedUrls = new Set<string>()
            let frontierEmpty = false
            let budgetExhausted = false

            log.trace(`ai-agent.deepen_org: id=${orgId} initial frontier=${initial.frontier.length} budget=${maxToolCallsPerOrg}`)

            // Snapshot of frontier URLs to process in this call.
            // Newly discovered candidates are appended to the live frontier for
            // subsequent deepen_org calls but are NOT processed in the current run.
            const initialFrontierUrls = new Set(initial.frontier.map(f => f.url))

            while (true) {
                const cur = workQueue.get(orgId)!
                if (cur.status !== 'partial') break

                // Only consider entries that were part of the initial frontier snapshot.
                const eligible = cur.frontier.filter(f => initialFrontierUrls.has(f.url) && !visitedUrls.has(f.url))
                if (eligible.length === 0) {
                    // Check if there are truly no more entries at all.
                    const anyLeft = cur.frontier.some(f => !visitedUrls.has(f.url))
                    if (!anyLeft) frontierEmpty = true
                    break
                }

                if (cur.perOrgToolCallsUsed >= maxToolCallsPerOrg) {
                    budgetExhausted = true
                    break
                }

                // Pop highest-scored eligible frontier entry.
                let best = eligible[0]
                for (let i = 1; i < eligible.length; i++) {
                    if (eligible[i].score > best.score) best = eligible[i]
                }
                const next = best
                // Remove it from the live frontier.
                workQueue.mutate(orgId, draft => {
                    const idx = draft.frontier.findIndex(f => f.url === next.url)
                    if (idx !== -1) draft.frontier.splice(idx, 1)
                })
                if (visitedUrls.has(next.url)) continue
                visitedUrls.add(next.url)

                // Classify (1 budget call).
                let page
                try {
                    page = await ctx.classifyPage(next.url, { signal })
                } catch (e: any) {
                    log.warn(`deepen_org: classify ${next.url} failed: ${e?.message ?? e}`)
                    workQueue.mutate(orgId, d => { d.perOrgToolCallsUsed += 1 })
                    continue
                }
                workQueue.mutate(orgId, d => { d.perOrgToolCallsUsed += 1 })

                if (page.pageType === 'other') continue

                // Re-check budget after classify.
                if (workQueue.get(orgId)!.perOrgToolCallsUsed >= maxToolCallsPerOrg) {
                    budgetExhausted = true
                    break
                }

                // Extract (1 budget call).
                let extracted
                try {
                    extracted = await ctx.extractContacts(page.html ?? '', { signal, pageUrl: next.url })
                } catch (e: any) {
                    log.warn(`deepen_org: extract ${next.url} failed: ${e?.message ?? e}`)
                    workQueue.mutate(orgId, d => { d.perOrgToolCallsUsed += 1 })
                    continue
                }

                workQueue.mutate(orgId, draft => {
                    draft.perOrgToolCallsUsed += 1
                    for (const x of extracted.phones) {
                        if (!draft.phones.includes(x)) draft.phones.push(x)
                    }
                    for (const x of extracted.emails) {
                        if (!draft.emails.includes(x)) draft.emails.push(x)
                    }
                    for (const raw of extracted.addresses) {
                        const normalized = validateAndNormalizeAddress(raw, query.city)
                        if (!normalized) continue
                        if (!draft.addresses.includes(normalized)) draft.addresses.push(normalized)
                    }
                    if (!draft.name && extracted.candidateName) draft.name = extracted.candidateName

                    const sourceKind = page.pageType === 'aggregator-detail' ? 'aggregator-detail'
                        : page.pageType === 'aggregator-serp' ? 'aggregator-serp'
                        : page.pageType === 'aggregator-landing' ? 'aggregator-landing'
                        : 'org-site'
                    const sourceRef: OrgSourceRef = {
                        url: next.url,
                        kind: sourceKind,
                        extractedAt: new Date().toISOString(),
                        extractionMethod: 'deterministic',
                    }
                    if (!draft.sources.some(s => s.url === sourceRef.url && s.kind === sourceRef.kind)) {
                        draft.sources.push(sourceRef)
                    }

                    draft.gaps = recomputeGaps(draft.phones, draft.emails, draft.addresses)

                    // Append contactCandidates to frontier (top FRONTIER_MAX_ADD).
                    const newFrontier: OrgFrontierEntry[] = page.contactCandidates
                        .slice(0, FRONTIER_MAX_ADD)
                        .map(c => ({ url: c.url, reason: c.reason, score: c.score }))
                        .filter(f => !visitedUrls.has(f.url) && !draft.frontier.some(e => e.url === f.url))
                    draft.frontier.push(...newFrontier)
                })

                // If gaps cleared, transition saturated and emit.
                const after = workQueue.get(orgId)!
                if (after.gaps.length === 0) {
                    workQueue.transition(orgId, 'saturated')
                    const saturated = workQueue.get(orgId)!
                    emitQueue.push(orgRecordToOrgData(saturated))
                    log.debug(`ai-agent.deepen_org: id=${orgId} saturated → emitted`)
                    break
                }
            }

            const final = workQueue.get(orgId)!
            return {
                orgId,
                status: final.status,
                gapsRemaining: final.gaps,
                phones: final.phones,
                emails: final.emails,
                addresses: final.addresses,
                sourcesAdded: final.sources.length - initial.sources.length,
                budgetUsed: final.perOrgToolCallsUsed - initial.perOrgToolCallsUsed,
                budgetExhausted,
                frontierEmpty,
            }
        },
    }
}
