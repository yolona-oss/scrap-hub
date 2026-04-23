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
})
