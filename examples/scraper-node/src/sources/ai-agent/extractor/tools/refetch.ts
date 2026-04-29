import * as cheerio from 'cheerio'
import { log } from '@cmd-hub/common'
import type { ExtractorTool } from '../types'
import type { ClassifiedPage } from '../../page-types'
import {
    extractFromJsonLd,
    extractFromMicrodata,
    extractFromSemanticHtml,
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
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()
    let candidateName = ''

    function merge(p: { phones?: string[], emails?: string[], addresses?: string[], candidateName?: string }) {
        for (const x of p.phones ?? []) phones.add(x)
        for (const x of p.emails ?? []) emails.add(x)
        for (const x of p.addresses ?? []) addresses.add(x)
        if (!candidateName && p.candidateName) candidateName = p.candidateName
    }

    merge(extractFromJsonLd(page.jsonLdBlobs))
    if (page.html) {
        const $ = cheerio.load(page.html)
        merge(extractFromMicrodata($))
        merge(extractFromSemanticHtml($))
    }
    merge(extractFromRegex(page.cleanedText))

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
        candidateName,
    }
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
