import { MetricsCollector } from '../metrics-collector'

describe('MetricsCollector', () => {
    it('snapshot always includes memory.rss and event_loop_lag_ms', () => {
        const c = new MetricsCollector()
        const s = c.snapshot()
        const names = s.map((x) => x.name).sort()
        expect(names).toEqual(['process.event_loop_lag_ms', 'process.memory.rss'])
        for (const sample of s) {
            expect(typeof sample.value).toBe('number')
            expect(sample.atMs).toBeGreaterThan(0)
        }
    })

    it('start()/stop() are safe to call multiple times', () => {
        const c = new MetricsCollector({ lagSampleEveryMs: 10 })
        c.start()
        c.start()
        c.stop()
        c.stop()
    })

    it('memory.rss value is a positive number', () => {
        const c = new MetricsCollector()
        const s = c.snapshot()
        const rss = s.find((x) => x.name === 'process.memory.rss')!
        expect(rss.value).toBeGreaterThan(0)
    })

    it('event_loop_lag_ms starts at zero before any sampleLag ticks', () => {
        const c = new MetricsCollector({ lagSampleEveryMs: 1_000_000 })
        const s = c.snapshot()
        const lag = s.find((x) => x.name === 'process.event_loop_lag_ms')!
        expect(lag.value).toBe(0)
    })

    it('snapshot atMs fields are close to Date.now() at capture time', () => {
        const before = Date.now()
        const c = new MetricsCollector()
        const s = c.snapshot()
        const after = Date.now()
        for (const sample of s) {
            expect(sample.atMs).toBeGreaterThanOrEqual(before)
            expect(sample.atMs).toBeLessThanOrEqual(after)
        }
    })
})
