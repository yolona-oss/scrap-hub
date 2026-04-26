import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios"
import { log, retrier, SingleThrottler } from "@cmd-hub/common"
import { DEFAULT_USER_AGENT, getScraperConfig, IScraperConfig } from "../scraper-config"
import { SCRAPER_ACCEPT_LANGUAGE } from "../scraper-defaults"

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 3
/** System-config memo TTL. The scraper reads userAgent on every HTTP call;
 *  without this each /scrape paginated run would hit Mongo N times for a
 *  value that changes once per node restart in practice. */
const CONFIG_MEMO_TTL_MS = 10_000

export interface HttpRequestOpts {
    /** Per-request timeout in ms. Default 15s. */
    timeoutMs?: number
    /** Extra headers to merge over the defaults (User-Agent + Accept-Language). */
    headers?: Record<string, string>
    /** Throttle group; calls in the same group serialize through `SingleThrottler`.
     *  Default: NO throttling (sources self-pace via `randSleep` between pages).
     *  Set this to opt into shared rate-limiting (e.g. when a paid API has a
     *  global QPS cap). */
    throttleGroup?: string
    /** Number of retry attempts for retriable errors (429, 5xx, network/timeout). Default 3. */
    retries?: number
    /** Custom validateStatus; defaults to `s => s < 600` so 4xx/5xx don't throw on the axios layer. */
    validateStatus?: (status: number) => boolean
    /** Disable proxy. */
    proxy?: false
    /** Response type; default leaves axios's auto-detection alone. */
    responseType?: AxiosRequestConfig['responseType']
}

let _configMemo: { value: IScraperConfig; expiresAt: number } | null = null

async function getConfigMemo(): Promise<IScraperConfig> {
    const now = Date.now()
    if (_configMemo && _configMemo.expiresAt > now) return _configMemo.value
    const value = await getScraperConfig()
    _configMemo = { value, expiresAt: now + CONFIG_MEMO_TTL_MS }
    return value
}

/** Reset the in-memory system-config memo. Call after a /sconfig change
 *  that should take effect immediately rather than waiting up to TTL. */
export function clearHttpConfigMemo(): void {
    _configMemo = null
}

/** Network-level error (no response) and 429 / 5xx are worth retrying;
 *  4xx other than 429 mean "you asked wrong, retrying won't help". */
export function isRetriableHttpError(err: unknown): boolean {
    if (axios.isAxiosError(err)) {
        const e = err as AxiosError
        if (!e.response) return true
        const s = e.response.status
        return s === 429 || (s >= 500 && s < 600)
    }
    return false
}

/** Typed predicate so callers don't need to import axios for status checks. */
export function isHttpError(err: unknown, status?: number): boolean {
    if (!axios.isAxiosError(err)) return false
    if (status === undefined) return true
    return err.response?.status === status
}

async function buildDefaultHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const cfg = await getConfigMemo()
    return {
        'User-Agent': cfg.userAgent || DEFAULT_USER_AGENT,
        'Accept-Language': SCRAPER_ACCEPT_LANGUAGE,
        ...extra,
    }
}

async function executeOnce(
    method: 'GET' | 'POST' | 'HEAD',
    url: string,
    body: unknown,
    opts: HttpRequestOpts | undefined,
    extraConfig?: Partial<AxiosRequestConfig>,
): Promise<AxiosResponse> {
    const config: AxiosRequestConfig = {
        method,
        url,
        timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: await buildDefaultHeaders(opts?.headers),
        validateStatus: opts?.validateStatus ?? (s => s < 600),
        ...(opts?.proxy === false && { proxy: false }),
        ...(opts?.responseType && { responseType: opts.responseType }),
        ...(body !== undefined && { data: body }),
        ...extraConfig,
    }
    return axios.request(config)
}

async function execute(
    method: 'GET' | 'POST' | 'HEAD',
    url: string,
    body: unknown,
    opts: HttpRequestOpts | undefined,
    extraConfig?: Partial<AxiosRequestConfig>,
): Promise<AxiosResponse> {
    const retries = opts?.retries ?? DEFAULT_RETRIES
    const run = () => retrier(
        () => executeOnce(method, url, body, opts, extraConfig),
        { retries, retryIf: isRetriableHttpError },
    )
    return opts?.throttleGroup
        ? SingleThrottler.Instance.throttle(opts.throttleGroup, run)
        : run()
}

export async function httpGet(url: string, opts?: HttpRequestOpts): Promise<AxiosResponse> {
    log.trace(`http.GET ${url}`)
    return execute('GET', url, undefined, opts)
}

export async function httpHead(url: string, opts?: HttpRequestOpts): Promise<AxiosResponse> {
    log.trace(`http.HEAD ${url}`)
    return execute('HEAD', url, undefined, opts)
}

export async function httpPostForm(
    url: string,
    body: Record<string, string>,
    opts?: HttpRequestOpts,
): Promise<AxiosResponse> {
    log.trace(`http.POST(form) ${url}`)
    const form = new URLSearchParams(body).toString()
    return execute('POST', url, form, opts, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(opts?.headers ?? {}),
        },
    })
}
