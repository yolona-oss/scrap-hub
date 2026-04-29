import * as cheerio from "cheerio"
import { Tool } from "./types"
import { log } from "@cmd-hub/common"

interface ExtractResult {
    phones: string[]
    emails: string[]
    addresses: string[]
    candidateName: string
    error?: string
}

const PHONE_REGEX = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const ADDRESS_REGEX = /(?:ул\.|улица|пр\.|проспект|пер\.|переулок|д\.|дом)\s+[А-ЯЁа-яё0-9\s,.-]{3,80}/g
const ADDRESS_SELECTORS = '[itemprop="address"], [itemprop="streetAddress"], .address, .adres, .contacts__address'

function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1)
    if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
    if (digits.length === 10) return '+7' + digits
    return raw.trim()
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

                const phoneSet = new Set<string>()
                $('a[href^="tel:"]').each((_, el) => {
                    const href = $(el).attr('href') ?? ''
                    const raw = href.replace(/^tel:/i, '').trim()
                    if (raw) phoneSet.add(normalizePhone(raw))
                })
                const bodyText = $('body').text()
                for (const m of bodyText.match(PHONE_REGEX) ?? []) phoneSet.add(normalizePhone(m))
                const phones = Array.from(phoneSet).slice(0, 10)

                const emailSet = new Set<string>()
                $('a[href^="mailto:"]').each((_, el) => {
                    const href = $(el).attr('href') ?? ''
                    const raw = href.replace(/^mailto:/i, '').trim().toLowerCase()
                    if (raw) emailSet.add(raw)
                })
                for (const m of bodyText.match(EMAIL_REGEX) ?? []) emailSet.add(m.toLowerCase())
                const emails = Array.from(emailSet).slice(0, 10)

                const addressSet = new Set<string>()
                $(ADDRESS_SELECTORS).each((_, el) => {
                    const text = $(el).text().replace(/\s+/g, ' ').trim()
                    if (text) addressSet.add(text)
                })
                for (const m of bodyText.match(ADDRESS_REGEX) ?? []) {
                    addressSet.add(m.replace(/\s+/g, ' ').trim())
                }
                const addresses = Array.from(addressSet).slice(0, 10)

                log.debug(`ai-agent.extract_contacts: phones=${phones.length} emails=${emails.length} addresses=${addresses.length}`)
                return { phones, emails, addresses, candidateName: '' }
            } catch (e: any) {
                log.warn(`ai-agent.extract_contacts: ${e.message ?? e}`)
                return { phones: [], emails: [], addresses: [], candidateName: '', error: String(e.message ?? e) }
            }
        },
    }
}
