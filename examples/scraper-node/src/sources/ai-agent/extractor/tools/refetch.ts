import { log } from '@cmd-hub/common'
import type { ExtractorTool } from '../types'
import type { ClassifiedPage } from '../../page-types'
import {
    extractFromJsonLd,
    extractFromRegex,
} from '../../tools/extraction-strategies'

type RefetchReason = 'contact-page' | 'branch-detail' | 'iframe-content' | 'alternate-format' | 'other'

export interface MakeRefetchToolOptions {
    /** Origin reference for same-origin enforcement. Empty string allows the first refetch
     *  to set the origin (fallback mode). */
    originalUrl: string
    /** Max distinct attempts per URL. Total fetch volume bounded by extractor's tool budget. */
    maxRefetches: number
    /** Injected for testing. In production this is `classifyPage` from the classifier module. */
    classifyPage: (url: string, opts?: { signal?: AbortSignal }) => Promise<ClassifiedPage>
}

interface UrlState {
    attempts: number
}

function isSameOrigin(a: string, b: string): boolean {
    try {
        return new URL(a).origin === new URL(b).origin
    } catch {
        return false
    }
}

function originOf(url: string): string | null {
    try {
        return new URL(url).origin
    } catch {
        return null
    }
}

function buildPartialResult(page: ClassifiedPage): {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
} {
    // ClassifiedPage doesn't expose a CheerioAPI root, so microdata + semantic-html strategies
    // can't run here — they need DOM access. JSON-LD (already-parsed blobs) and regex (over
    // cleanedText) cover the common cases. The extractor LLM can call read_blocks to see
    // pre-extracted DOM regions if richer extraction is needed. Threading the cheerio root
    // through ClassifiedPage is a follow-up to PR1.
    const fromJsonLd = extractFromJsonLd(page.jsonLdBlobs)
    const fromRegex = extractFromRegex(page.cleanedText)

    const phones = Array.from(new Set([...(fromJsonLd.phones ?? []), ...(fromRegex.phones ?? [])]))
    const emails = Array.from(new Set([...(fromJsonLd.emails ?? []), ...(fromRegex.emails ?? [])]))
    const addresses = Array.from(new Set([...(fromJsonLd.addresses ?? []), ...(fromRegex.addresses ?? [])]))
    const candidateName = fromJsonLd.candidateName ?? ''
    return { phones, emails, addresses, candidateName }
}

export function makeRefetchTool(opts: MakeRefetchToolOptions): ExtractorTool {
    let lockedOrigin: string | null = opts.originalUrl ? originOf(opts.originalUrl) : null
    const seenUrls = new Map<string, UrlState>()

    return {
        name: 'refetch',
        description: 'Fetch another page on the same origin to inspect (e.g. /contacts, branch detail). Returns a structured payload with the new page type, cleaned text, blocks, and any contacts deterministic extraction found. Use this when the current page hints at a more useful URL nearby.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Absolute URL to fetch. Must be same-origin as the original page.' },
                reason: {
                    type: 'string',
                    enum: ['contact-page', 'branch-detail', 'iframe-content', 'alternate-format', 'other'],
                    description: 'Why this URL is worth fetching. For telemetry; does not affect outcome.',
                },
                mode: { type: 'string', enum: ['auto'], description: 'Reserved for future use.' },
            },
            required: ['url', 'reason'],
        },
        terminal: false,
        async handler(args, _ctx) {
            const url = String(args?.url ?? '').trim()
            const reason = String(args?.reason ?? 'other') as RefetchReason

            if (!url) return { error: 'empty url' }

            const newOrigin = originOf(url)
            if (!newOrigin) return { error: `malformed url: ${url}` }

            // Same-origin check (with first-fetch fallback).
            if (lockedOrigin === null) {
                lockedOrigin = newOrigin
                log.info(`extractor.refetch: adopting origin ${newOrigin} (originalUrl was empty)`)
            } else if (!isSameOrigin(url, lockedOrigin + '/')) {
                return { error: `cross-origin refetch rejected: origin=${newOrigin} expected=${lockedOrigin}` }
            }

            // Per-URL budget.
            const st = seenUrls.get(url) ?? { attempts: 0 }
            if (st.attempts >= opts.maxRefetches) {
                return { error: `per-url refetch budget exhausted (${opts.maxRefetches}) for ${url}` }
            }
            st.attempts += 1
            seenUrls.set(url, st)

            log.debug(`extractor.refetch: ${url} reason=${reason} attempt=${st.attempts}/${opts.maxRefetches}`)

            // Fetch + classify. retrier inside classifyPage's httpGet handles transient errors.
            let page: ClassifiedPage
            try {
                page = await opts.classifyPage(url)
            } catch (e: any) {
                log.warn(`extractor.refetch: classifyPage threw for ${url}: ${e?.message ?? e}`)
                return { error: `fetch failed: ${e?.message ?? e}` }
            }

            // Run deterministic extraction over the classified page so the LLM sees a
            // partialResult, not raw HTML.
            const partialResult = buildPartialResult(page)

            return {
                url,
                newPageType: page.pageType,
                cleanedText: page.cleanedText,
                candidateBlocks: page.candidateBlocks,
                jsonLdBlobs: page.jsonLdBlobs,
                nextDataBlob: page.nextDataBlob,
                partialResult,
            }
        },
    }
}
