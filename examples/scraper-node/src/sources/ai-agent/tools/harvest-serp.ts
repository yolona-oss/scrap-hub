import type { Tool } from './types'
import type { WorkQueue, OrgGap } from '../work-queue'
import type { WorkQueueContext } from '../work-queue'
import type { OrgSourceRef, SearchQuery } from '../../../types'
import { validateAndNormalizeAddress } from './emit'
import { log } from '@cmd-hub/common'

const LOCAL_BUSINESS_TYPE_RE = /LocalBusiness|Organization|MedicalBusiness|Dentist/i

function isLocalBusiness(blob: unknown): boolean {
    if (!blob || typeof blob !== 'object') return false
    const t = (blob as any)['@type']
    if (typeof t === 'string') return LOCAL_BUSINESS_TYPE_RE.test(t)
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && LOCAL_BUSINESS_TYPE_RE.test(x))
    return false
}

function flattenAddress(a: unknown): string | null {
    if (!a) return null
    if (typeof a === 'string') return a
    if (typeof a === 'object') {
        const obj = a as Record<string, unknown>
        const parts = [obj.streetAddress, obj.addressLocality, obj.postalCode]
            .filter(p => typeof p === 'string') as string[]
        if (parts.length) return parts.join(', ')
    }
    return null
}

function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1)
    if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
    if (digits.length === 10) return '+7' + digits
    return raw.trim()
}

function computeGaps(phones: string[], emails: string[], addresses: string[]): OrgGap[] {
    const gaps: OrgGap[] = []
    if (phones.length === 0) gaps.push('phone')
    if (emails.length === 0) gaps.push('email')
    if (addresses.length === 0) gaps.push('address')
    return gaps
}

export function makeHarvestSerpTool(workQueue: WorkQueue, ctx: WorkQueueContext, query: SearchQuery): Tool {
    return {
        name: 'harvest_serp',
        description: 'Classify the URL and extract all LocalBusiness JSON-LD entries from an aggregator search-results page. Creates one partial org record per card. Returns the count of records created. Does NOT create records for non-aggregator-serp pages.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL of the aggregator SERP page.' },
            },
            required: ['url'],
        },
        async handler(args, signal) {
            const url = String(args?.url ?? '').trim()
            if (!url) return { error: 'empty url' }

            log.trace(`ai-agent.harvest_serp: ${url}`)
            let page
            try {
                page = await ctx.classifyPage(url, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.harvest_serp: classifyPage failed: ${e?.message ?? e}`)
                return { error: `fetch failed: ${e?.message ?? e}` }
            }

            if (page.pageType !== 'aggregator-serp') {
                return { error: `page is ${page.pageType}, not aggregator-serp — wrong page type for harvest` }
            }

            const created: string[] = []
            for (const blob of page.jsonLdBlobs) {
                if (!isLocalBusiness(blob)) continue
                const b = blob as Record<string, unknown>
                const name = typeof b.name === 'string' ? b.name : ''
                if (!name) continue

                const phones: string[] = typeof b.telephone === 'string' ? [normalizePhone(b.telephone)] : []
                const emails: string[] = typeof b.email === 'string' ? [b.email.toLowerCase()] : []
                const rawAddr = flattenAddress(b.address)
                const normalizedAddr = rawAddr ? validateAndNormalizeAddress(rawAddr, query.city) : null
                const addresses: string[] = normalizedAddr ? [normalizedAddr] : []

                const sourceRef: OrgSourceRef = {
                    url: page.url,
                    kind: 'aggregator-serp',
                    extractedAt: new Date().toISOString(),
                    extractionMethod: 'deterministic',
                }

                const rec = workQueue.insert({
                    status: 'partial',
                    name,
                    phones,
                    emails,
                    addresses,
                    sources: [sourceRef],
                    gaps: computeGaps(phones, emails, addresses),
                    frontier: [],
                    confidence: 0.85,
                    extractionMethod: 'deterministic',
                    notes: [],
                })
                created.push(rec.id)
            }

            log.debug(`ai-agent.harvest_serp: ${url} → created ${created.length} records`)
            return {
                url: page.url,
                pageType: page.pageType,
                created: created.length,
                createdIds: created,
            }
        },
    }
}
