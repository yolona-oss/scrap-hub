import { log } from "@cmd-hub/common"

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
        if (this.closed) {
            log.warn(`async-queue.push: ignored — queue is closed (would-be buffer=${this.buffer.length})`)
            return
        }
        const waiter = this.waiters.shift()
        if (waiter) {
            log.trace(`async-queue.push: handed directly to waiter (waiters left=${this.waiters.length})`)
            waiter({ value, done: false })
        } else {
            this.buffer.push(value)
            log.trace(`async-queue.push: buffered (depth=${this.buffer.length})`)
        }
    }

    close(): void {
        if (this.closed) {
            log.trace('async-queue.close: already closed, no-op')
            return
        }
        log.debug(`async-queue.close: closing (waiters=${this.waiters.length}, buffer=${this.buffer.length})`)
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
                    const value = this.buffer.shift()!
                    log.trace(`async-queue.next: served from buffer (depth=${this.buffer.length})`)
                    return Promise.resolve({ value, done: false })
                }
                if (this.closed) {
                    log.trace('async-queue.next: closed and drained, signalling done')
                    return Promise.resolve({ value: undefined as any, done: true })
                }
                log.trace(`async-queue.next: parking waiter (waiters=${this.waiters.length + 1})`)
                return new Promise(resolve => this.waiters.push(resolve))
            },
        }
    }
}
