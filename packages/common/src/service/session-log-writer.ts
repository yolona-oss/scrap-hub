import log from '../application/logger'
import type {
    ISessionLogRepo,
    SessionLogEntry,
} from '../storage/session-log'
import type { UiMessage } from '../ui-message/types'

const FLUSH_BATCH_SIZE = 20
const FLUSH_INTERVAL_MS = 500

/** Per-emit metadata the writer needs to persist alongside the UiMessage —
 *  the kind plugin's stable identity. Captured at the wire boundary
 *  (where the envelope already carries it) so the writer doesn't have to
 *  consult a registry. */
export interface RecordOptions {
    compatibilityId: string
    version: string
}

/** Append-only writer for one session's UiMessage history. Buffers up to
 *  `FLUSH_BATCH_SIZE` events or `FLUSH_INTERVAL_MS` of wall-clock time
 *  (whichever first) and flushes as one `repo.append` call. The owner
 *  MUST call `close()` when the session ends so the final batch lands. */
export class SessionLogWriter {
    private buffer: SessionLogEntry[] = []
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    /** Next seq to assign. Initialised to 0 for new sessions; bumped past
     *  the highest persisted seq via `seedSeqFromExisting()` for resumes. */
    private nextSeq = 0
    private closed = false
    private inFlight: Promise<void> | null = null

    constructor(
        private readonly repo: ISessionLogRepo,
        private readonly sessionId: string,
    ) {}

    /** Read the highest existing seq for this session and continue past it.
     *  Idempotent; safe to call before the first `record()`. */
    async seedSeqFromExisting(): Promise<void> {
        const last = await this.repo.latestSeq(this.sessionId)
        this.nextSeq = last + 1
    }

    /** Append one UiMessage to the in-memory buffer. Schedules a flush
     *  when the buffer reaches the size threshold OR when the time
     *  threshold elapses. After `close()` the call drops silently. */
    record(msg: UiMessage, opts: RecordOptions): void {
        if (this.closed) return
        const m = msg as unknown as { kind: string, severity?: string } & Record<string, unknown>
        const { kind, severity, ...payload } = m
        this.buffer.push({
            sessionId: this.sessionId,
            seq: this.nextSeq++,
            ts: Date.now(),
            kind,
            severity,
            payload,
            compatibilityId: opts.compatibilityId,
            version: opts.version,
        })
        if (this.buffer.length >= FLUSH_BATCH_SIZE) {
            void this.flush()
            return
        }
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => { void this.flush() }, FLUSH_INTERVAL_MS)
        }
    }

    /** Flush the buffer immediately. Concurrent calls coalesce: while one
     *  flush is in flight, others await its completion (don't double-write). */
    async flush(): Promise<void> {
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
        if (this.inFlight) { await this.inFlight; return }
        if (this.buffer.length === 0) return

        const batch = this.buffer
        this.buffer = []
        this.inFlight = (async () => {
            try {
                await this.repo.append(batch)
            } catch (e) {
                // Persistence failure is operator-visible but non-fatal —
                // dropping the batch avoids cascading failures during DB
                // outages. The in-memory dashboard log still reflects what
                // the user saw; the on-disk log just has a gap.
                log.warn(`SessionLogWriter[${this.sessionId}]: append failed (${batch.length} entries): ${(e as Error).message}`)
            } finally {
                this.inFlight = null
            }
        })()
        await this.inFlight
    }

    /** Final flush + close. Subsequent `record()` calls drop silently;
     *  subsequent `close()` calls are no-ops. */
    async close(): Promise<void> {
        if (this.closed) return
        this.closed = true
        await this.flush()
    }

    /** Read-only accessor for tests + diagnostics. */
    get bufferedCount(): number {
        return this.buffer.length
    }
}
