import registryJson from './aggregator-registry.json'

export interface AggregatorEntry {
    domain: string
    confidence: number
    notes?: string
}

const REGISTRY: ReadonlyArray<AggregatorEntry> = Object.freeze(
    (registryJson as AggregatorEntry[]).map(e => Object.freeze({ ...e })),
)

/** Strip leading `www.` from a host. */
function normalizeHost(host: string): string {
    return host.replace(/^www\./i, '').toLowerCase()
}

/**
 * Match a URL against the aggregator registry. Returns the first matching
 * entry by `domain` (which may include a path prefix like `yandex.ru/maps`),
 * or null if no entry matches.
 */
export function matchAggregator(url: string): Readonly<AggregatorEntry> | null {
    if (!url) return null
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    const host = normalizeHost(parsed.hostname)
    const pathname = parsed.pathname || '/'

    for (const entry of REGISTRY) {
        const slash = entry.domain.indexOf('/')
        if (slash === -1) {
            if (host === entry.domain) return entry
        } else {
            const entryHost = entry.domain.slice(0, slash)
            const entryPath = entry.domain.slice(slash) // includes leading '/'
            if (
                host === entryHost &&
                (pathname === entryPath || pathname.startsWith(entryPath + '/'))
            ) return entry
        }
    }
    return null
}

/** Return a defensive copy of all entries. */
export function listAggregators(): AggregatorEntry[] {
    return REGISTRY.map(e => ({ ...e }))
}
