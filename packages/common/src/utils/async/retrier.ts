import { sleep } from './time'

export interface RetrierOpts {
    /** Number of retries after the initial attempt. Total attempts = retries + 1. */
    retries: number
    /** Base wait between attempts (ms). Actual wait = `wait + attempt * gain`. */
    wait: number
    /** Per-attempt timeout (ms). 0 disables. */
    timeout: number
    /** Retry only when this returns true. Default: every throw retries. */
    retryIf?: (err: unknown) => boolean
    /** Linear backoff gain per attempt (ms). Default 200. */
    gain?: number
}

const retrierOptsDefaults: Required<RetrierOpts> = {
    retries: 3,
    wait: 700,
    timeout: 0,
    retryIf: () => true,
    gain: 200,
}

export async function timeouted<T>(task: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Operation timed out'))
        }, timeout)

        task()
            .then((result) => {
                clearTimeout(timer)
                resolve(result)
            })
            .catch((error) => {
                clearTimeout(timer)
                reject(error)
            })
    })
}

/**
 * Retry an async fn with linear backoff. The original error from the last
 * attempt is preserved and re-thrown — callers can inspect status codes,
 * response bodies, etc. Pass `retryIf` to opt into conditional retry
 * (e.g. retry only on 429/5xx, short-circuit on 4xx).
 *
 * Total attempts = `retries + 1` (one initial + N retries). Default retries=3
 * yields 4 attempts.
 */
export async function retrier<T>(fn: () => Promise<T>, opts: Partial<RetrierOpts> = {}): Promise<T> {
    const { retries, wait, timeout, retryIf, gain } = { ...retrierOptsDefaults, ...opts }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await (timeout > 0 ? timeouted(fn, timeout) : fn())
        } catch (e) {
            if (!retryIf(e) || attempt === retries) throw e
            await sleep(wait + attempt * gain)
        }
    }
    // Unreachable: the loop returns on success or throws on the last attempt.
    throw new Error('retrier: unreachable')
}
