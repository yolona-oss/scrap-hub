/**
 * Minimal async queue that can be iterated with `for await`.
 * Producers call push(v) to enqueue and close() when done.
 * The async iterator yields values in order and terminates after close()
 * once the buffer is drained.
 */
export class AsyncQueue<T> {
    private buffer: T[] = []
    private waiters: Array<(v: IteratorResult<T>) => void> = []
    private closed = false

    push(value: T): void {
        if (this.closed) return
        const waiter = this.waiters.shift()
        if (waiter) {
            waiter({ value, done: false })
        } else {
            this.buffer.push(value)
        }
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        while (this.waiters.length > 0) {
            const w = this.waiters.shift()!
            w({ value: undefined as any, done: true })
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: (): Promise<IteratorResult<T>> => {
                if (this.buffer.length > 0) {
                    return Promise.resolve({ value: this.buffer.shift()!, done: false })
                }
                if (this.closed) {
                    return Promise.resolve({ value: undefined as any, done: true })
                }
                return new Promise(resolve => this.waiters.push(resolve))
            },
        }
    }
}
