/**
 * Golden-scraper fixture harness.
 *
 * Phase 2.7 regression gate: a deterministic, self-contained "scraper" that
 * lives entirely in cmd-hub's test folder. It exists to prove the distributed
 * stack (hub + node + real gRPC + event adapter + dispatcher) reproduces an
 * event sequence byte-identically across the rewrite.
 *
 * Originally the plan captured fixtures from packages/org-scraper, but that
 * would invert the package dependency (cmd-hub -> org-scraper) for test code
 * only. Instead this harness reimplements the tiny subset of scraper behavior
 * we care about — deterministic OrgData, progress events, CSV rendering — so
 * the fixture is isolated to cmd-hub's own tree. The scraper-node example in
 * Phase 3 will run the real OrgScraperService on a real node, which is where
 * end-to-end scraper behavior is exercised against live integrations.
 */

export interface OrgData {
    name: string
    source: string
    email: string | null
    phone: string | null
    address: string | null
    url: string | null
}

export interface CapturedEvent {
    seq: number
    kind: 'message' | 'progress' | 'progressStatus' | 'done'
    payload: Record<string, unknown>
}

function deterministicOrg(i: number): OrgData {
    const n = String(i).padStart(3, '0')
    return {
        name: `Fake Org ${n}`,
        source: 'fake',
        email: `org${n}@example.test`,
        phone: `+1${String(i).padStart(10, '0')}`,
        address: `${i} Fake Street`,
        url: `https://fake.test/${n}`,
    }
}

function escapeCsv(value: string | null | undefined): string {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
    }
    return str
}

export function orgsToCsvBytes(data: OrgData[]): Buffer {
    const headers = ['Наименование организации', 'Источник', 'E-mail', 'Телефон', 'Адрес', 'URL']
    const rows = data.map((org) => [
        escapeCsv(org.name),
        escapeCsv(org.source),
        escapeCsv(org.email),
        escapeCsv(org.phone),
        escapeCsv(org.address),
        escapeCsv(org.url),
    ].join(','))
    return Buffer.from([headers.join(','), ...rows].join('\n'), 'utf8')
}

/**
 * Runs the fake scraper and returns its event sequence + CSV bytes. The shape
 * of emitted events intentionally matches OrgScraperService's event contract:
 *   message          - human-readable status lines
 *   progress         - (name, current, total) triples per source
 *   progressStatus   - (name, status) transitions per source
 *   done             - terminal marker with a final message
 */
export async function runGoldenScraper(opts: { count: number }): Promise<{
    events: CapturedEvent[]
    csvBytes: Buffer
}> {
    const events: CapturedEvent[] = []
    let seq = 0
    const push = (kind: CapturedEvent['kind'], payload: Record<string, unknown>) => {
        events.push({ seq: ++seq, kind, payload })
    }

    const total = opts.count
    const sourceName = 'fake'
    const collected: OrgData[] = []

    push('message', { text: `Starting search: "coffee" | sources: ${sourceName} | limit: ${total}` })
    push('progressStatus', { name: `scraping.${sourceName}`, status: 'active' })

    for (let i = 1; i <= total; i++) {
        const org = deterministicOrg(i)
        collected.push(org)
        push('progress', { name: `scraping.${sourceName}`, current: i, total })
    }

    push('progressStatus', { name: `scraping.${sourceName}`, status: 'done' })
    push('message', { text: `Collection complete: ${collected.length} organizations` })
    push('done', { finalMessage: `${collected.length} organizations captured` })

    return { events, csvBytes: orgsToCsvBytes(collected) }
}
