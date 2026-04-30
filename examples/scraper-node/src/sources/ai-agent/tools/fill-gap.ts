import type { Tool } from './types'
import type { WorkQueue, OrgGap, ExtractContactsResult } from '../work-queue'
import type { ClassifiedPage } from '../page-types'
import type { OrgSourceRef, SearchQuery } from '../../../types'
import { log } from '@cmd-hub/common'

const VALID_FIELDS: OrgGap[] = ['phone', 'email', 'address']

const FIELD_KEYWORDS: Record<OrgGap, string> = {
    phone: 'телефон phone',
    email: 'email',
    address: 'адрес address',
}

const FIELD_TO_VALUES_KEY: Record<OrgGap, 'phones' | 'emails' | 'addresses'> = {
    phone: 'phones',
    email: 'emails',
    address: 'addresses',
}

export interface FillGapContext {
    /** Adapter over the existing web_search tool. Accepts a query string and
     *  returns a results array; error/hint surface from the underlying tool
     *  is collapsed (no results = empty array). */
    webSearch: (
        args: { query: string, limit?: number },
        opts?: { signal?: AbortSignal },
    ) => Promise<{ results: Array<{ url: string, title?: string, snippet?: string }> }>
    classifyPage: (url: string, opts?: { signal?: AbortSignal }) => Promise<ClassifiedPage>
    extractContacts: (
        html: string,
        opts?: { signal?: AbortSignal, pageUrl?: string },
    ) => Promise<ExtractContactsResult>
}

export function makeFillGapTool(
    workQueue: WorkQueue,
    ctx: FillGapContext,
    query: SearchQuery,
): Tool {
    /** Per-(orgId, field) attempt budget = 1. Re-running the same field on
     *  the same record is a no-op even if the first attempt failed — gap
     *  filling is best-effort, not retry-friendly. */
    const attempted = new Set<string>()
    const keyOf = (orgId: string, field: OrgGap) => `${orgId}::${field}`

    return {
        name: 'fill_gap',
        description: 'Run a targeted web search for a single missing field on an org record. Per-(org, field) budget of 1; second call for the same gap is a no-op. Use only on partial records that have already been deepened.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
                field: { type: 'string', enum: ['phone', 'email', 'address'] },
            },
            required: ['orgId', 'field'],
        },
        async handler(args, signal) {
            const orgId = String(args?.orgId ?? '')
            const fieldRaw = String(args?.field ?? '')

            if (!VALID_FIELDS.includes(fieldRaw as OrgGap)) {
                return { error: `field must be one of: ${VALID_FIELDS.join(', ')}` }
            }
            const field = fieldRaw as OrgGap

            const record = workQueue.get(orgId)
            if (!record) return { error: `org id ${orgId} not found` }

            if (!record.gaps.includes(field)) {
                return { orgId, field, alreadyFilled: true }
            }

            const attemptKey = keyOf(orgId, field)
            if (attempted.has(attemptKey)) {
                return { orgId, field, alreadyAttempted: true }
            }
            attempted.add(attemptKey)

            const cityClause = query.city ? ` ${query.city}` : ''
            const searchQuery = `"${record.name}" ${FIELD_KEYWORDS[field]}${cityClause}`

            log.trace(`ai-agent.fill_gap: orgId=${orgId} field=${field} query=${JSON.stringify(searchQuery)}`)

            let searchResults
            try {
                searchResults = await ctx.webSearch({ query: searchQuery, limit: 3 }, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.fill_gap: web_search failed: ${e?.message ?? e}`)
                return { orgId, field, error: `web_search failed: ${e?.message ?? e}` }
            }

            const topResult = searchResults.results?.[0]
            if (!topResult?.url) {
                log.debug(`ai-agent.fill_gap: ${searchQuery} → no results`)
                return { orgId, field, attempted: true }
            }

            let page: ClassifiedPage
            try {
                page = await ctx.classifyPage(topResult.url, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.fill_gap: classify ${topResult.url} failed: ${e?.message ?? e}`)
                return { orgId, field, error: `classify failed: ${e?.message ?? e}` }
            }

            let extracted: ExtractContactsResult
            try {
                extracted = await ctx.extractContacts(page.html ?? '', { signal, pageUrl: topResult.url })
            } catch (e: any) {
                log.warn(`ai-agent.fill_gap: extract ${topResult.url} failed: ${e?.message ?? e}`)
                return { orgId, field, error: `extract failed: ${e?.message ?? e}` }
            }

            const valuesKey = FIELD_TO_VALUES_KEY[field]
            const candidates = extracted[valuesKey] ?? []

            if (candidates.length === 0) {
                return { orgId, field, attempted: true }
            }

            const sourceRef: OrgSourceRef = {
                url: topResult.url,
                kind: 'web-search',
                extractedAt: new Date().toISOString(),
                extractionMethod: 'deterministic',
            }

            workQueue.mutate(orgId, draft => {
                const existing = draft[valuesKey]
                for (const v of candidates) {
                    if (existing.includes(v)) continue
                    if (existing.length > 0) {
                        if (!draft.conflicts) draft.conflicts = []
                        let conflict = draft.conflicts.find(c => c.field === field)
                        if (!conflict) {
                            conflict = {
                                field: field as 'phone' | 'email' | 'address',
                                values: existing.map(old => ({ value: old, sourceUrl: '' })),
                                resolution: 'unresolved',
                            }
                            draft.conflicts.push(conflict)
                        } else {
                            for (const old of existing) {
                                if (!conflict.values.some(cv => cv.value === old)) {
                                    conflict.values.push({ value: old, sourceUrl: '' })
                                }
                            }
                        }
                        conflict.values.push({ value: v, sourceUrl: topResult.url })
                    }
                    existing.push(v)
                }

                if (existing.length > 0) {
                    draft.gaps = draft.gaps.filter(g => g !== field)
                }

                if (!draft.sources.some(s => s.url === sourceRef.url && s.kind === sourceRef.kind)) {
                    draft.sources.push(sourceRef)
                }
            })

            const updated = workQueue.get(orgId)!
            log.debug(`ai-agent.fill_gap: orgId=${orgId} field=${field} → ${candidates.length} candidate(s); gapsRemaining=${updated.gaps.length}`)

            return {
                orgId,
                field,
                foundValue: candidates[0],
                addedCount: candidates.length,
                gapsRemaining: updated.gaps,
                attempted: true,
            }
        },
    }
}
