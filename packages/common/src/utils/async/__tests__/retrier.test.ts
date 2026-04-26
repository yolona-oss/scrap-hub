import { retrier } from '../retrier'

describe('retrier', () => {
    it('returns the value on first success', async () => {
        const fn = jest.fn(async () => 'ok')
        const got = await retrier(fn, { retries: 3, wait: 1, gain: 0 })
        expect(got).toBe('ok')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries on throw and eventually succeeds (default retryIf=true)', async () => {
        let calls = 0
        const fn = jest.fn(async () => {
            calls++
            if (calls < 3) throw new Error(`attempt ${calls}`)
            return 'recovered'
        })
        const got = await retrier(fn, { retries: 5, wait: 1, gain: 0 })
        expect(got).toBe('recovered')
        expect(fn).toHaveBeenCalledTimes(3)
    })

    it('preserves the original error on exhaustion (no generic wrapper)', async () => {
        const original = new Error('original failure')
        const fn = jest.fn(async () => { throw original })
        await expect(retrier(fn, { retries: 2, wait: 1, gain: 0 })).rejects.toBe(original)
        // retries: 2 → 1 initial + 2 retries = 3 attempts
        expect(fn).toHaveBeenCalledTimes(3)
    })

    it('does NOT retry when retryIf returns false (short-circuit)', async () => {
        const err = Object.assign(new Error('not retriable'), { kind: 'fatal' })
        const fn = jest.fn(async () => { throw err })
        const retryIf = (e: unknown) => (e as any)?.kind === 'transient'

        await expect(retrier(fn, { retries: 3, wait: 1, gain: 0, retryIf })).rejects.toBe(err)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries when retryIf returns true', async () => {
        let calls = 0
        const fn = jest.fn(async () => {
            calls++
            if (calls < 2) {
                throw Object.assign(new Error('transient'), { kind: 'transient' })
            }
            return 'ok'
        })
        const retryIf = (e: unknown) => (e as any)?.kind === 'transient'

        const got = await retrier(fn, { retries: 3, wait: 1, gain: 0, retryIf })
        expect(got).toBe('ok')
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('retries: 0 means single attempt', async () => {
        const err = new Error('once')
        const fn = jest.fn(async () => { throw err })
        await expect(retrier(fn, { retries: 0, wait: 1, gain: 0 })).rejects.toBe(err)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('default options retry 3 times (4 total attempts)', async () => {
        const err = new Error('always')
        const fn = jest.fn(async () => { throw err })
        await expect(retrier(fn, { wait: 1, gain: 0 })).rejects.toBe(err)
        expect(fn).toHaveBeenCalledTimes(4)
    })
})
