import type { Tool } from './types'
import type { WorkQueue, LLMJudgeContext, JudgeMessage, OrgRecord } from '../work-queue'
import { orgRecordToOrgData } from '../work-queue'
import type { AsyncQueue } from '../async-queue'
import type { OrgData } from '../../../types'
import { log } from '@cmd-hub/common'

const RESOLUTION_FIELDS = ['name', 'phone', 'email', 'address'] as const
type ResolutionField = typeof RESOLUTION_FIELDS[number]

type Decision = 'verify' | 'reject' | 'still-partial'

interface ReviewDecision {
    decision: Decision
    confidence: number
    rejectReason?: string
    resolutions: { field: ResolutionField, chosenIndex: number }[]
    notes: string[]
}

type ParseResult =
    | { ok: true, decision: ReviewDecision }
    | { ok: false, error: string }

function parseDecision(content: string | null, record: OrgRecord): ParseResult {
    if (!content) return { ok: false, error: 'empty review response' }
    let parsed: any
    try {
        parsed = JSON.parse(content)
    } catch (e: any) {
        return { ok: false, error: `failed to parse review response: ${e?.message ?? e}` }
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'review response is not an object' }
    }

    const decision = parsed.decision
    if (decision !== 'verify' && decision !== 'reject' && decision !== 'still-partial') {
        return { ok: false, error: `decision must be verify|reject|still-partial, got ${JSON.stringify(decision)}` }
    }

    if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)) {
        return { ok: false, error: 'confidence must be a finite number' }
    }
    const confidence = parsed.confidence < 0 ? 0 : parsed.confidence > 1 ? 1 : parsed.confidence

    let rejectReason: string | undefined
    if (decision === 'reject') {
        if (typeof parsed.rejectReason !== 'string' || parsed.rejectReason.trim().length === 0) {
            return { ok: false, error: 'reject decision requires non-empty rejectReason' }
        }
        rejectReason = parsed.rejectReason
    }

    const resolutions: ReviewDecision['resolutions'] = []
    if (parsed.resolutions !== undefined) {
        if (!Array.isArray(parsed.resolutions)) {
            return { ok: false, error: 'resolutions must be an array' }
        }
        for (const r of parsed.resolutions) {
            if (!r || typeof r !== 'object') {
                return { ok: false, error: 'each resolution must be an object' }
            }
            if (typeof r.field !== 'string' || !RESOLUTION_FIELDS.includes(r.field as ResolutionField)) {
                return { ok: false, error: `resolution.field must be one of ${RESOLUTION_FIELDS.join(',')}` }
            }
            if (typeof r.chosenIndex !== 'number' || !Number.isInteger(r.chosenIndex) || r.chosenIndex < 0) {
                return { ok: false, error: 'resolution.chosenIndex must be a non-negative integer' }
            }
            const conflict = record.conflicts?.find(c => c.field === r.field)
            if (!conflict) {
                return { ok: false, error: `resolution.field=${r.field} has no matching conflict on record` }
            }
            if (r.chosenIndex >= conflict.values.length) {
                return { ok: false, error: `resolution chosenIndex ${r.chosenIndex} out of range for field=${r.field} (have ${conflict.values.length} values)` }
            }
            resolutions.push({ field: r.field as ResolutionField, chosenIndex: r.chosenIndex })
        }
    }

    const notes: string[] = []
    if (parsed.notes !== undefined) {
        if (!Array.isArray(parsed.notes)) {
            return { ok: false, error: 'notes must be an array of strings' }
        }
        for (const n of parsed.notes) {
            if (typeof n !== 'string') return { ok: false, error: 'notes must be an array of strings' }
            notes.push(n)
        }
    }

    return {
        ok: true,
        decision: { decision, confidence, rejectReason, resolutions, notes },
    }
}

function buildSystemPrompt(): string {
    return [
        'You are reviewing an organization record built by a research pipeline. Decide whether the record is trustworthy enough to verify, should be rejected, or needs more deepening.',
        '',
        'Output a single JSON object with this shape:',
        '{',
        '  "decision": "verify" | "reject" | "still-partial",',
        '  "confidence": number between 0 and 1,',
        '  "resolutions": [{"field": "phone"|"email"|"address"|"name", "chosenIndex": <integer>}],',
        '  "rejectReason": "string" (REQUIRED when decision = reject),',
        '  "notes": ["short notes"]',
        '}',
        '',
        'Rules:',
        '1. NEVER invent values. Each resolution.chosenIndex must be a valid index into the matching conflict.values array. Omit a resolution if no value is good.',
        '2. Resolution priority: org\'s own website > aggregator-detail > web-search. Address with a building number beats one without.',
        '3. Reject when the record describes a different org than the query, contacts look fabricated, or address is outside the target city.',
        '4. still-partial: gaps remain that more deepening could fill.',
        '5. confidence: 0.9+ for explicit structured data with no conflicts; 0.7 for clearly-formatted contacts; 0.5 or below for ambiguous text.',
        '',
        'Output ONLY the JSON object. No prose.',
    ].join('\n')
}

function buildUserPrompt(record: OrgRecord): string {
    return [
        'Record:',
        `  name: ${record.name}`,
        `  phones: ${JSON.stringify(record.phones)}`,
        `  emails: ${JSON.stringify(record.emails)}`,
        `  addresses: ${JSON.stringify(record.addresses)}`,
        `  sources: ${JSON.stringify(record.sources.map(s => ({ url: s.url, kind: s.kind })))}`,
        `  conflicts: ${JSON.stringify(record.conflicts ?? [])}`,
        `  gaps: ${JSON.stringify(record.gaps)}`,
        `  status: ${record.status}`,
        '',
        'Decide.',
    ].join('\n')
}

export function makeReviewOrgTool(
    workQueue: WorkQueue,
    ctx: LLMJudgeContext,
    emitQueue: AsyncQueue<OrgData>,
): Tool {
    return {
        name: 'review_org',
        description: 'Run an LLM review on an org record: verify | reject | still-partial. On verify, the record transitions to verified and is emitted to the user queue. On reject, the record transitions to rejected and is dropped. still-partial leaves status unchanged so the record can be deepened further. Per-record cap: at most one terminal review (verify or reject); still-partial can be re-attempted.',
        parameters: {
            type: 'object',
            properties: {
                orgId: { type: 'string', description: 'Org record id from list_orgs / pick_next_partial.' },
            },
            required: ['orgId'],
        },
        async handler(args, signal) {
            const orgId = String(args?.orgId ?? '')
            const record = workQueue.get(orgId)
            if (!record) return { error: `org id ${orgId} not found` }
            if (record.status === 'verified' || record.status === 'rejected') {
                return { error: `org ${orgId} is already terminal (${record.status})` }
            }

            const messages: JudgeMessage[] = [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: buildUserPrompt(record) },
            ]

            log.trace(`ai-agent.review_org: orgId=${orgId} status=${record.status}`)
            let response
            try {
                response = await ctx.callJudge(messages, { signal })
            } catch (e: any) {
                log.warn(`ai-agent.review_org: callJudge failed: ${e?.message ?? e}`)
                return { error: `judge failed: ${e?.message ?? e}` }
            }

            const parsed = parseDecision(response.content, record)
            if (!parsed.ok) {
                log.warn(`ai-agent.review_org: ${parsed.error}; raw=${response.content?.slice(0, 200) ?? '(empty)'}`)
                return { error: parsed.error }
            }
            const decision = parsed.decision

            workQueue.mutate(orgId, draft => {
                draft.confidence = decision.confidence
                if (decision.decision === 'verify' || decision.decision === 'reject') {
                    draft.notes.push(`reviewed:${new Date().toISOString()}`)
                }
                for (const n of decision.notes) draft.notes.push(n)
                if (decision.decision === 'reject' && decision.rejectReason) {
                    draft.notes.push(`rejected: ${decision.rejectReason}`)
                }
                if (draft.conflicts && decision.resolutions.length > 0) {
                    for (const res of decision.resolutions) {
                        const conflict = draft.conflicts.find(c => c.field === res.field)
                        if (conflict) {
                            conflict.chosenIndex = res.chosenIndex
                            conflict.resolution = 'review'
                        }
                    }
                }
            })

            if (decision.decision === 'verify') {
                if (workQueue.get(orgId)!.status === 'partial') {
                    workQueue.transition(orgId, 'saturated')
                }
                workQueue.transition(orgId, 'verified')
                const verified = workQueue.get(orgId)!
                emitQueue.push(orgRecordToOrgData(verified))
                log.debug(`ai-agent.review_org: orgId=${orgId} → verified, emitted (confidence=${decision.confidence})`)
            } else if (decision.decision === 'reject') {
                workQueue.transition(orgId, 'rejected')
                log.debug(`ai-agent.review_org: orgId=${orgId} → rejected (${decision.rejectReason ?? 'no reason'})`)
            } else {
                log.debug(`ai-agent.review_org: orgId=${orgId} → still-partial (confidence=${decision.confidence})`)
            }

            const final = workQueue.get(orgId)!
            return {
                orgId,
                decision: decision.decision,
                confidence: decision.confidence,
                status: final.status,
                rejectReason: decision.rejectReason,
                resolutionsApplied: decision.resolutions.length,
            }
        },
    }
}
