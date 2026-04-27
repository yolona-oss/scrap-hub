import {
    SessionLogWriter,
    type ISessionLogRepo,
    type SessionLogEntry,
    type UiMessage,
} from '../../index'

class FakeRepo implements ISessionLogRepo {
    public appended: SessionLogEntry[] = []
    public latestSeqOverride = -1
    public failNext = 0

    async append(entries: SessionLogEntry[]): Promise<void> {
        if (this.failNext > 0) {
            this.failNext--
            throw new Error('forced failure')
        }
        this.appended.push(...entries)
    }
    async read(): Promise<SessionLogEntry[]> { return [] }
    async latestSeq(): Promise<number> { return this.latestSeqOverride }
    async deleteBySession(): Promise<number> { return 0 }
    async listSessions(): Promise<{ sessionId: string, lastTs: number, count: number }[]> { return [] }
}

const RECORD_OPTS = { compatibilityId: 'cmd-hub.builtin.text', version: '1.0.0' }

describe('SessionLogWriter', () => {
    it('flushes immediately when buffer reaches batch size (20)', async () => {
        const repo = new FakeRepo()
        const w = new SessionLogWriter(repo, 'sess-1')
        for (let i = 0; i < 20; i++) {
            w.record({ kind: 'text', text: `msg-${i}` } as UiMessage, RECORD_OPTS)
        }
        // Allow microtasks: the 20th record triggers an async flush.
        await new Promise(resolve => setImmediate(resolve))
        expect(repo.appended.length).toBe(20)
        expect(w.bufferedCount).toBe(0)
    })

    it('flushes after the timer interval even below batch size', async () => {
        jest.useFakeTimers()
        const repo = new FakeRepo()
        const w = new SessionLogWriter(repo, 'sess-2')
        w.record({ kind: 'text', text: 'a' } as UiMessage, RECORD_OPTS)
        w.record({ kind: 'text', text: 'b' } as UiMessage, RECORD_OPTS)
        expect(repo.appended.length).toBe(0)
        jest.advanceTimersByTime(500)
        await Promise.resolve(); await Promise.resolve()
        expect(repo.appended.length).toBe(2)
        jest.useRealTimers()
    })

    it('close() flushes remaining buffer', async () => {
        const repo = new FakeRepo()
        const w = new SessionLogWriter(repo, 'sess-3')
        w.record({ kind: 'text', text: 'one' } as UiMessage, RECORD_OPTS)
        w.record({ kind: 'text', text: 'two' } as UiMessage, RECORD_OPTS)
        await w.close()
        expect(repo.appended.length).toBe(2)
        expect(repo.appended[0].seq).toBe(0)
        expect(repo.appended[1].seq).toBe(1)
    })

    it('seqs are monotonic across record calls and resume past existing', async () => {
        const repo = new FakeRepo()
        repo.latestSeqOverride = 5  // session has entries 0..5 already
        const w = new SessionLogWriter(repo, 'sess-resume')
        await w.seedSeqFromExisting()
        w.record({ kind: 'text', text: 'after' } as UiMessage, RECORD_OPTS)
        await w.close()
        expect(repo.appended[0].seq).toBe(6)
    })

    it('drops record() calls after close()', async () => {
        const repo = new FakeRepo()
        const w = new SessionLogWriter(repo, 'sess-4')
        w.record({ kind: 'text', text: 'before' } as UiMessage, RECORD_OPTS)
        await w.close()
        w.record({ kind: 'text', text: 'after-close' } as UiMessage, RECORD_OPTS)
        await w.close()  // idempotent
        expect(repo.appended.length).toBe(1)
    })

    it('append failure does NOT requeue; batch is dropped (logged)', async () => {
        const repo = new FakeRepo()
        repo.failNext = 1
        const w = new SessionLogWriter(repo, 'sess-fail')
        w.record({ kind: 'text', text: 'lost' } as UiMessage, RECORD_OPTS)
        await w.flush()
        expect(repo.appended.length).toBe(0)
        expect(w.bufferedCount).toBe(0)  // dropped, not re-buffered
    })

    it('strips kind/severity from payload, preserves the rest', async () => {
        const repo = new FakeRepo()
        const w = new SessionLogWriter(repo, 'sess-payload')
        w.record(
            { kind: 'org', name: 'Acme', phone: '+123', severity: 'info' } as unknown as UiMessage,
            RECORD_OPTS,
        )
        await w.close()
        const entry = repo.appended[0]
        expect(entry.kind).toBe('org')
        expect(entry.severity).toBe('info')
        expect(entry.payload).toEqual({ name: 'Acme', phone: '+123' })
        expect(entry.compatibilityId).toBe('cmd-hub.builtin.text')
        expect(entry.version).toBe('1.0.0')
    })
})
