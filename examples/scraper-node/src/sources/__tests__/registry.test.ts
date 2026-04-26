import { SourceRegistry } from '../registry'
import type { IScraperSource, SourceAvailability } from '../types'

interface StubSource extends IScraperSource {
    callCount: number
}

function makeStub(result: SourceAvailability): StubSource {
    const stub = {
        callCount: 0,
        async availability(): Promise<SourceAvailability> {
            stub.callCount++
            return result
        },
        async *search() { /* no-op */ },
    }
    return stub
}

describe('SourceRegistry', () => {
    beforeEach(() => {
        // Clear factories AND availability cache so each test starts clean.
        // SourceRegistry doesn't expose factory clear; emulate by registering
        // unique names per test instead.
        SourceRegistry.clearAvailabilityCache()
    })

    it('register + has + create round-trip', () => {
        const stub = makeStub({ ok: true })
        SourceRegistry.register('reg-rt', () => stub)
        expect(SourceRegistry.has('reg-rt')).toBe(true)
        expect(SourceRegistry.create('reg-rt')).toBe(stub)
    })

    it('has() returns false for unregistered name', () => {
        expect(SourceRegistry.has('reg-missing')).toBe(false)
    })

    it('availabilityOf returns ok=false with reason for unknown source', async () => {
        const got = await SourceRegistry.availabilityOf('reg-unknown')
        expect(got.ok).toBe(false)
        if (!got.ok) {
            expect(got.reason).toMatch(/unknown source/)
        }
    })

    it('availabilityOf caches result for 60s — second call does not re-invoke availability()', async () => {
        const stub = makeStub({ ok: true })
        SourceRegistry.register('reg-cache', () => stub)

        const first = await SourceRegistry.availabilityOf('reg-cache')
        expect(first.ok).toBe(true)
        expect(stub.callCount).toBe(1)

        const second = await SourceRegistry.availabilityOf('reg-cache')
        expect(second.ok).toBe(true)
        expect(stub.callCount).toBe(1)  // cache hit
    })

    it('clearAvailabilityCache forces a re-check', async () => {
        const stub = makeStub({ ok: true })
        SourceRegistry.register('reg-clear', () => stub)

        await SourceRegistry.availabilityOf('reg-clear')
        expect(stub.callCount).toBe(1)

        SourceRegistry.clearAvailabilityCache()

        await SourceRegistry.availabilityOf('reg-clear')
        expect(stub.callCount).toBe(2)
    })

    it('availabilityOf wraps thrown errors as ok=false with reason', async () => {
        SourceRegistry.register('reg-throws', () => ({
            async availability(): Promise<SourceAvailability> {
                throw new Error('boom')
            },
            async *search() {},
        }))

        const got = await SourceRegistry.availabilityOf('reg-throws')
        expect(got.ok).toBe(false)
        if (!got.ok) {
            expect(got.reason).toBe('boom')
        }
    })

    it('availabilityOf re-creates a source instance on cache miss', async () => {
        // Each factory call returns a fresh stub. With caching, we only call
        // the factory once per cache window.
        let factoryCalls = 0
        SourceRegistry.register('reg-factory', () => {
            factoryCalls++
            return makeStub({ ok: true })
        })

        await SourceRegistry.availabilityOf('reg-factory')
        await SourceRegistry.availabilityOf('reg-factory')
        expect(factoryCalls).toBe(1)

        SourceRegistry.clearAvailabilityCache()
        await SourceRegistry.availabilityOf('reg-factory')
        expect(factoryCalls).toBe(2)
    })

    it('availableFor filters out unavailable sources', async () => {
        SourceRegistry.register('reg-ok', () => makeStub({ ok: true }))
        SourceRegistry.register('reg-bad', () => makeStub({ ok: false, reason: 'nope' }))

        const got = await SourceRegistry.availableFor()
        expect(got).toContain('reg-ok')
        expect(got).not.toContain('reg-bad')
    })

    it('available() returns all registered names regardless of availability', () => {
        SourceRegistry.register('reg-all-1', () => makeStub({ ok: true }))
        SourceRegistry.register('reg-all-2', () => makeStub({ ok: false, reason: 'nope' }))

        const all = SourceRegistry.available()
        expect(all).toContain('reg-all-1')
        expect(all).toContain('reg-all-2')
    })
})
