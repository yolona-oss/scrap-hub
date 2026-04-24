import type { MetricSample } from '../../grpc/generated/cmd_node'

/**
 * In-memory ring buffer of recent metric samples per node. v1 concern —
 * persistence moves to a time-series collection or external system later.
 */
export class MetricStore {
    private readonly buffers = new Map<string, MetricSample[]>()

    constructor(private readonly maxPerNode = 100) {}

    push(nodeId: string, samples: MetricSample[]): void {
        let buf = this.buffers.get(nodeId)
        if (!buf) {
            buf = []
            this.buffers.set(nodeId, buf)
        }
        for (const s of samples) {
            buf.push(s)
            if (buf.length > this.maxPerNode) buf.shift()
        }
    }

    recent(nodeId: string, limit = 5): MetricSample[] {
        const buf = this.buffers.get(nodeId)
        if (!buf) return []
        return buf.slice(-limit)
    }

    forget(nodeId: string): void {
        this.buffers.delete(nodeId)
    }

    knownNodes(): string[] {
        return [...this.buffers.keys()]
    }
}
