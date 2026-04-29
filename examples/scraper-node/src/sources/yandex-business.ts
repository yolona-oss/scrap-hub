import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import type { ServiceContext } from "../exporters/types"
import { SCRAPER_LANGUAGE, SCRAPER_COUNTRY } from "../scraper-service/system-config"
import { httpGet, httpHead } from "./http"
import { normalizeSearchQuery } from "./city-query"
import { log } from "@cmd-hub/common"

const YANDEX_MAPS_BASE = 'https://yandex.ru/maps'
const YANDEX_MAPS_API = `${YANDEX_MAPS_BASE}/api/search`

/** Conservative TTL for the cached CSRF token. Yandex's tokens typically
 *  outlast this, but burning 10 minutes worth of requests on a stale
 *  token would still hurt the scrape. Re-acquiring is one extra GET. */
const TOKEN_TTL_MS = 10 * 60 * 1000

interface SessionState {
    csrfToken: string
    sessionId?: string
    cookieHeader: string
    expiresAt: number
}

/** Module-level cache: one in-flight search shares the token across all
 *  calls in the process. Reset on a 4xx/5xx step-2 response or when the
 *  step-2 body still looks like a token-only response. */
let _session: SessionState | null = null

/** Strip `Set-Cookie` response headers down to a `name=value` pairs string
 *  suitable for replay in a single `Cookie:` request header. axios returns
 *  `set-cookie` as `string[]`; some frameworks fold it into one comma-joined
 *  string — handle both. */
function buildCookieHeader(setCookie: string | string[] | undefined): string {
    if (!setCookie) return ''
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
    const pairs: string[] = []
    for (const raw of arr) {
        // Each Set-Cookie entry is `name=value; Path=/; Expires=...`. We only
        // want the first segment.
        const head = raw.split(';', 1)[0].trim()
        if (head) pairs.push(head)
    }
    return pairs.join('; ')
}

/** Heuristic: a response is the "token-only" placeholder Yandex returns
 *  when you hit /api/search without auth. Has `csrfToken` and (usually)
 *  no `features`/`data` keys. */
function looksLikeTokenResponse(body: unknown): body is { csrfToken: string; sessionId?: string } {
    if (!body || typeof body !== 'object') return false
    const obj = body as Record<string, unknown>
    if (typeof obj.csrfToken !== 'string' || obj.csrfToken.length === 0) return false
    // Real search responses have `features` (array) or `data.features`.
    const hasFeatures = Array.isArray(obj.features)
        || (typeof obj.data === 'object' && obj.data !== null && Array.isArray((obj.data as any).features))
    return !hasFeatures
}

/** Step 1 of the CSRF flow: hit /api/search with no auth, get back
 *  `{csrfToken, sessionId?}` and a Set-Cookie. Pure function — does not
 *  mutate the module cache; the caller decides whether to commit. */
async function acquireSession(referer: string, signal?: AbortSignal): Promise<SessionState> {
    // Use a probe query that the endpoint will accept — empty `text` returns
    // the same token shape but is more likely to be flagged as bot traffic.
    // A simple keyword keeps us in the "looks like a real search" lane.
    const probeParams = new URLSearchParams({
        text: 'кафе',
        type: 'biz',
        lang: `${SCRAPER_LANGUAGE}_${SCRAPER_COUNTRY}`,
        results: '1',
    })
    const res = await httpGet(`${YANDEX_MAPS_API}?${probeParams}`, {
        headers: {
            'Accept': 'application/json',
            'Referer': referer,
        },
        signal,
        retries: 1,
    })
    if (res.status >= 400 || !looksLikeTokenResponse(res.data)) {
        throw new Error(
            `yandex-business CSRF acquire: unexpected response ` +
            `(HTTP ${res.status}, body keys=${Object.keys(res.data ?? {}).join(',')})`,
        )
    }
    const cookieHeader = buildCookieHeader(res.headers?.['set-cookie'] as string | string[] | undefined)
    return {
        csrfToken: res.data.csrfToken,
        sessionId: res.data.sessionId,
        cookieHeader,
        expiresAt: Date.now() + TOKEN_TTL_MS,
    }
}

async function getSession(referer: string, force: boolean, signal?: AbortSignal): Promise<SessionState> {
    if (!force && _session && _session.expiresAt > Date.now()) return _session
    _session = await acquireSession(referer, signal)
    log.debug(`yandex-business: acquired CSRF token (sessionId=${_session.sessionId ?? '-'}, cookies=${_session.cookieHeader ? 'yes' : 'no'})`)
    return _session
}

export class YandexBusinessSource implements IScraperSource {
    async availability(): Promise<SourceAvailability> {
        // HEAD the homepage, NOT the API endpoint — probing /api/search would
        // burn quota with each /scrape (the AI-agent calls availability before
        // every search_source).
        try {
            const res = await httpHead(`${YANDEX_MAPS_BASE}/`, { timeoutMs: 5000, retries: 1 })
            if (res.status >= 400) {
                return { ok: false, reason: `yandex maps HEAD: HTTP ${res.status}` }
            }
            return { ok: true }
        } catch (e: any) {
            return { ok: false, reason: `yandex maps HEAD: ${e?.message ?? e}` }
        }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void, _context?: ServiceContext, signal?: AbortSignal): AsyncGenerator<OrgData> {
        // See city-query.ts — strips any other-city the caller wrote into
        // `query.query` and appends the target `query.city`.
        const searchQuery = normalizeSearchQuery(query.query, query.city)

        log.info(`yandex-business.search: query="${searchQuery}" maxResults=${query.maxResults}`)
        let found = 0

        try {
            const features = await this._fetchFeatures(searchQuery, query.maxResults, signal)
            log.trace(`yandex-business.search: ${features.length} features in response`)

            for (const feature of features) {
                const props = feature?.properties?.CompanyMetaData || feature?.properties || {}
                const name = props.name || props.Names?.find((n: any) => n.type === 'main')?.value || ''
                if (!name) continue

                const phones = props.Phones || []
                const phone = phones.length > 0
                    ? phones[0].formatted || phones[0].number || null
                    : null

                const address = props.address || props.Address?.formatted || null
                const url = props.url || null

                let email: string | null = null
                const links = props.Links || []
                for (const link of links) {
                    if (link.type === 'email' || (link.href && link.href.includes('@'))) {
                        email = link.href?.replace('mailto:', '') || null
                        break
                    }
                }

                const org: OrgData = {
                    name,
                    source: 'Yandex Business',
                    email,
                    phone,
                    address,
                    url,
                }

                found++
                onProgress(found)
                yield org

                if (found >= query.maxResults) break
            }
        } catch (e: any) {
            log.error(`yandex-business.search: ${e.message ?? e}`)
        }
        log.info(`yandex-business.search: done found=${found}`)
    }

    /** Two-step CSRF flow with one retry on stale token. Returns the raw
     *  features array (or empty when the endpoint refuses to give us one). */
    private async _fetchFeatures(searchQuery: string, maxResults: number, signal?: AbortSignal): Promise<any[]> {
        const referer = `${YANDEX_MAPS_BASE}/`
        for (let attempt = 0; attempt < 2; attempt++) {
            const force = attempt > 0
            const session = await getSession(referer, force, signal)

            const params = new URLSearchParams({
                text: searchQuery,
                type: 'biz',
                lang: `${SCRAPER_LANGUAGE}_${SCRAPER_COUNTRY}`,
                results: String(Math.min(maxResults, 50)),
                csrfToken: session.csrfToken,
            })
            if (session.sessionId) params.set('sessionId', session.sessionId)

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'Referer': referer,
            }
            if (session.cookieHeader) headers['Cookie'] = session.cookieHeader

            const res = await httpGet(`${YANDEX_MAPS_API}?${params}`, { headers, signal })

            // Stale token / re-challenge: server replies with another
            // `{csrfToken: ...}` instead of features. Invalidate cache and
            // retry once with a fresh acquisition.
            if (looksLikeTokenResponse(res.data)) {
                log.debug(`yandex-business: step-2 returned token-only response, invalidating cache (attempt ${attempt + 1})`)
                _session = null
                continue
            }
            if (res.status >= 400) {
                log.error(`yandex-business: step-2 HTTP ${res.status}`)
                _session = null
                return []
            }
            const features = res.data?.features ?? res.data?.data?.features ?? []
            return Array.isArray(features) ? features : []
        }
        log.error('yandex-business: gave up after one retry — token kept being rejected')
        return []
    }
}

/** Test-only helper to clear the cached session between tests. Not part of
 *  the public source API. */
export function _resetYandexBusinessSession(): void {
    _session = null
}
