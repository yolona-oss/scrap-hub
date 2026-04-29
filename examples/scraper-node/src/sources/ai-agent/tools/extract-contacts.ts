import * as cheerio from "cheerio"
import { Tool } from "./types"
import { log } from "@cmd-hub/common"
import {
    parseJsonLdBlobs,
    extractFromJsonLd,
    extractFromMicrodata,
    extractFromSemanticHtml,
    extractFromRegex,
    type PartialExtraction,
} from "./extraction-strategies"

interface ExtractResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    strategiesFired?: string[]
    error?: string
    hint?: string
}

const MAX_PER_FIELD = 10

function mergeInto(
    acc: { phones: Set<string>, emails: Set<string>, addresses: Set<string>, name: string },
    p: PartialExtraction,
): boolean {
    let contributed = false
    for (const x of p.phones ?? []) if (!acc.phones.has(x)) { acc.phones.add(x); contributed = true }
    for (const x of p.emails ?? []) if (!acc.emails.has(x)) { acc.emails.add(x); contributed = true }
    for (const x of p.addresses ?? []) if (!acc.addresses.has(x)) { acc.addresses.add(x); contributed = true }
    if (!acc.name && p.candidateName) { acc.name = p.candidateName; contributed = true }
    return contributed
}

function pickCandidateName($: cheerio.CheerioAPI, current: string): string {
    if (current) return current
    const title = $('title').first().text().trim()
    if (title) return title
    const og = $('meta[property="og:title"]').attr('content')?.trim() ?? ''
    if (og) return og
    const h1 = $('h1').first().text().trim()
    if (h1) return h1
    return ''
}

export function makeExtractContactsTool(): Tool {
    return {
        name: 'extract_contacts',
        description: "Extract phone numbers, emails, and addresses from HTML in one call. Use this instead of multiple parse_html calls. Pass HTML returned by fetch_url(mode='html'). Returns {phones, emails, addresses, candidateName} arrays plus a hint on what to do next.",
        parameters: {
            type: 'object',
            properties: {
                html: { type: 'string', description: 'HTML body returned by fetch_url(mode=html)' },
            },
            required: ['html'],
        },
        async handler(args): Promise<ExtractResult> {
            const html = String(args?.html ?? '')
            if (!html) return { phones: [], emails: [], addresses: [], candidateName: '', error: 'empty html' }

            try {
                const $ = cheerio.load(html)
                const acc = { phones: new Set<string>(), emails: new Set<string>(), addresses: new Set<string>(), name: '' }
                const fired: string[] = []

                const jsonLd = parseJsonLdBlobs($)
                if (mergeInto(acc, extractFromJsonLd(jsonLd))) fired.push('jsonld')
                if (mergeInto(acc, extractFromMicrodata($))) fired.push('microdata')
                if (mergeInto(acc, extractFromSemanticHtml($))) fired.push('semantic-html')

                const cleanedText = (() => {
                    const $clone = cheerio.load(html)
                    $clone('script, style, noscript').remove()
                    return $clone('body').text().replace(/\s+/g, ' ').trim()
                })()
                if (mergeInto(acc, extractFromRegex(cleanedText))) fired.push('regex')

                const phones = Array.from(acc.phones).slice(0, MAX_PER_FIELD)
                const emails = Array.from(acc.emails).slice(0, MAX_PER_FIELD)
                const addresses = Array.from(acc.addresses).slice(0, MAX_PER_FIELD)
                const candidateName = pickCandidateName($, acc.name)

                const totalContacts = phones.length + emails.length + addresses.length
                const hint = totalContacts === 0
                    ? "no structured contacts found — try parse_html with a custom selector, or check the page's footer/contacts subpath"
                    : `found ${totalContacts} contacts — call report_results with the org details`

                log.debug(`ai-agent.extract_contacts: phones=${phones.length} emails=${emails.length} addresses=${addresses.length} fired=[${fired.join(',')}] name="${candidateName.slice(0, 40)}"`)
                return { phones, emails, addresses, candidateName, strategiesFired: fired, hint }
            } catch (e: any) {
                log.warn(`ai-agent.extract_contacts: ${e.message ?? e}`)
                return { phones: [], emails: [], addresses: [], candidateName: '', error: String(e.message ?? e) }
            }
        },
    }
}
