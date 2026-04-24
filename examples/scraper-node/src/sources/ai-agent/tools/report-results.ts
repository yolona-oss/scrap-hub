import { Tool } from "./types"
import { OrgData, SearchQuery } from "../../../types"
import { AsyncQueue } from "../async-queue"

interface ReportResult {
    accepted: number
    rejected: number
    totalYielded: number
}

interface ReportState {
    yielded: number
}

export function makeReportResultsTool(
    queue: AsyncQueue<OrgData>,
    query: SearchQuery,
    state: ReportState,
): Tool {
    return {
        name: 'report_results',
        description: 'Emit found organizations immediately. Call this as soon as you have valid results — do not batch everything until the end. Returns totalYielded so you know when to stop.',
        parameters: {
            type: 'object',
            properties: {
                orgs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            source: { type: 'string' },
                            phone: { type: ['string', 'null'] },
                            email: { type: ['string', 'null'] },
                            address: { type: ['string', 'null'] },
                            url: { type: 'string' },
                        },
                        required: ['name', 'source'],
                    },
                },
            },
            required: ['orgs'],
        },
        async handler(args): Promise<ReportResult> {
            const orgs = Array.isArray(args?.orgs) ? args.orgs : []
            let accepted = 0
            let rejected = 0

            for (const raw of orgs) {
                const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
                const phone = raw?.phone ? String(raw.phone) : null
                const email = raw?.email ? String(raw.email) : null
                const address = raw?.address ? String(raw.address) : null
                const source = typeof raw?.source === 'string' && raw.source.trim() ? raw.source.trim() : 'ai-agent'
                const url = typeof raw?.url === 'string' ? raw.url : undefined

                if (!name || (!phone && !email && !address)) {
                    rejected++
                    continue
                }

                queue.push({ name, source, phone, email, address, url })
                accepted++
                state.yielded++

                if (state.yielded >= query.maxResults) break
            }

            return { accepted, rejected, totalYielded: state.yielded }
        },
    }
}
