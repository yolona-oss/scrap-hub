import axios from 'axios'

jest.mock('axios')
jest.mock('../../scraper-config', () => ({
    DEFAULT_USER_AGENT: 'test-ua',
    getScraperConfig: jest.fn(async () => ({
        chromePath: '',
        requestDelayMs: 0,
        userAgent: 'test-ua',
    })),
    IScraperConfig: undefined,
}))

import { httpGet, httpHead, httpPostForm, isHttpError, clearHttpConfigMemo } from '../http'
import { getScraperConfig } from '../../scraper-config'

const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedConfig = getScraperConfig as jest.MockedFunction<typeof getScraperConfig>

beforeEach(() => {
    jest.clearAllMocks()
    clearHttpConfigMemo()
    // axios.isAxiosError is a static; jest.Mocked treats it as a mock fn.
    // Restore real behavior by wiring through the actual axios module.
    ;(mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
        (e: unknown) => Boolean(e && typeof e === 'object' && (e as any).isAxiosError === true),
    )
})

function makeAxiosError(status: number | undefined, message = 'fail'): any {
    const err: any = new Error(message)
    err.isAxiosError = true
    if (status !== undefined) {
        err.response = { status, data: '', headers: {} }
    }
    return err
}

describe('httpGet', () => {
    it('returns the response on 200 with one attempt', async () => {
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: 'ok' } as any)
        const res = await httpGet('https://example.com/')
        expect(res.status).toBe(200)
        expect(res.data).toBe('ok')
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
    })

    it('retries on 503 then throws preserving original error', async () => {
        const err503 = makeAxiosError(503)
        mockedAxios.request.mockRejectedValue(err503)
        await expect(httpGet('https://example.com/', { retries: 2 })).rejects.toBe(err503)
        // retries: 2 → 1 initial + 2 retries = 3 attempts
        expect(mockedAxios.request).toHaveBeenCalledTimes(3)
    })

    it('does NOT retry on 404 (short-circuits after 1 attempt)', async () => {
        const err404 = makeAxiosError(404)
        mockedAxios.request.mockRejectedValueOnce(err404)
        await expect(httpGet('https://example.com/', { retries: 3 })).rejects.toBe(err404)
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
    })

    it('retries on network error (no response)', async () => {
        const errNet = makeAxiosError(undefined, 'ECONNRESET')
        mockedAxios.request
            .mockRejectedValueOnce(errNet)
            .mockResolvedValueOnce({ status: 200, data: 'recovered' } as any)
        const res = await httpGet('https://example.com/', { retries: 2 })
        expect(res.data).toBe('recovered')
        expect(mockedAxios.request).toHaveBeenCalledTimes(2)
    })

    it('honors retries: 0 (single attempt, no retry)', async () => {
        const err503 = makeAxiosError(503)
        mockedAxios.request.mockRejectedValueOnce(err503)
        await expect(httpGet('https://example.com/', { retries: 0 })).rejects.toBe(err503)
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
    })

    it('retries on 429 (rate limit)', async () => {
        const err429 = makeAxiosError(429)
        mockedAxios.request
            .mockRejectedValueOnce(err429)
            .mockResolvedValueOnce({ status: 200, data: 'ok' } as any)
        const res = await httpGet('https://example.com/', { retries: 1 })
        expect(res.status).toBe(200)
        expect(mockedAxios.request).toHaveBeenCalledTimes(2)
    })
})

describe('httpHead', () => {
    it('issues method=HEAD', async () => {
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: '' } as any)
        await httpHead('https://example.com/')
        expect(mockedAxios.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'HEAD' }))
    })
})

describe('httpPostForm', () => {
    it('sends application/x-www-form-urlencoded body', async () => {
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: 'ok' } as any)
        await httpPostForm('https://example.com/', { q: 'hello world', n: '42' })
        const call = mockedAxios.request.mock.calls[0][0] as any
        expect(call.method).toBe('POST')
        expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
        // URLSearchParams encodes spaces as '+' and ampersand-joins pairs.
        expect(call.data).toBe('q=hello+world&n=42')
    })
})

describe('isHttpError', () => {
    it('returns true for an axios error matching the requested status', () => {
        expect(isHttpError(makeAxiosError(403), 403)).toBe(true)
    })

    it('returns false for an axios error with a different status', () => {
        expect(isHttpError(makeAxiosError(403), 500)).toBe(false)
    })

    it('returns true for any axios error when no status filter is given', () => {
        expect(isHttpError(makeAxiosError(403))).toBe(true)
    })

    it('returns false for non-axios throws', () => {
        expect(isHttpError(new Error('normal'))).toBe(false)
        expect(isHttpError(null)).toBe(false)
        expect(isHttpError(undefined)).toBe(false)
    })
})

describe('clearHttpConfigMemo', () => {
    it('forces a re-read of getScraperConfig on next request', async () => {
        mockedAxios.request.mockResolvedValue({ status: 200, data: '' } as any)

        await httpGet('https://example.com/a')
        await httpGet('https://example.com/b')
        // Memoized — only one config read.
        expect(mockedConfig).toHaveBeenCalledTimes(1)

        clearHttpConfigMemo()
        await httpGet('https://example.com/c')
        // Cache cleared — another read.
        expect(mockedConfig).toHaveBeenCalledTimes(2)
    })
})
