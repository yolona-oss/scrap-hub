export interface MetricSample {
    name: string
    value: number
    atMs: number
}

/**
 * Lightweight metrics collector. v1 surfaces two gauges: resident memory
 * (bytes) and event-loop lag (ms). Nodes send snapshots on their Heartbeat
 * stream; the hub uses them for display only in v1, routing later.
 */
export class MetricsCollector {
    private lastLagCheck = process.hrtime.bigint()
    private lastLagMs = 0
    private lagTimer: NodeJS.Timeout | null = null

    constructor(private readonly opts: { lagSampleEveryMs?: number } = {}) {}

    start(): void {
        if (this.lagTimer !== null) return
        const interval = this.opts.lagSampleEveryMs ?? 1000
        this.lagTimer = setInterval(() => this.sampleLag(), interval)
        this.lagTimer.unref()
    }

    stop(): void {
        if (this.lagTimer !== null) {
            clearInterval(this.lagTimer)
            this.lagTimer = null
        }
    }

    /** Take a sample. The event-loop-lag value is the lag measured since the last sample. */
    snapshot(): MetricSample[] {
        const atMs = Date.now()
        return [
            { name: 'process.memory.rss', value: process.memoryUsage().rss, atMs },
            { name: 'process.event_loop_lag_ms', value: this.lastLagMs, atMs },
        ]
    }

    private sampleLag(): void {
        const now = process.hrtime.bigint()
        const expected = this.opts.lagSampleEveryMs ?? 1000
        const elapsedMs = Number((now - this.lastLagCheck) / 1_000_000n)
        this.lastLagMs = Math.max(0, elapsedMs - expected)
        this.lastLagCheck = now
    }
}
