import { ServiceDashboard } from '../service-dashboard'

describe('ServiceDashboard event-sink API', () => {
    it('accepts a uiMessage event and calls ui.editMessage', async () => {
        const ui = {
            editMessage: jest.fn(),
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            max_message_width: () => 60,
            ContextType: () => 'test',
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-1')
        await db.attach()
        db.onEvent({
            kind: 'uiMessage',
            message: { kind: 'text', text: 'hello' },
            compatibilityId: 'cmd-hub.builtin.text',
            version: '1.0.0',
        })
        // Debounced 500ms; flush:
        await new Promise((r) => setTimeout(r, 600))
        expect(ui.editMessage).toHaveBeenCalled()
    })

    it('accepts a done event and calls detach', async () => {
        const ui = {
            editMessage: jest.fn(),
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            max_message_width: () => 60,
            ContextType: () => 'test',
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-2')
        await db.attach()
        db.onEvent({ kind: 'done', finalMessage: 'complete' })
        await new Promise((r) => setTimeout(r, 600))
        // After done, subsequent onEvent calls should be no-ops.
        expect(() => db.onEvent({
            kind: 'uiMessage',
            message: { kind: 'text', text: 'late' },
            compatibilityId: 'cmd-hub.builtin.text',
            version: '1.0.0',
        })).not.toThrow()
    })

    it('sendIntercom invokes the configured callback', async () => {
        const cb = jest.fn().mockResolvedValue(undefined)
        const ui = {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessage: jest.fn(),
            max_message_width: () => 60,
            ContextType: () => 'test',
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-3', { sendIntercom: cb })
        await db.attach()
        await db.sendIntercom('pause', [])
        expect(cb).toHaveBeenCalledWith('pause', [])
    })

    it('retains the full UiMessage history (no per-channel cap)', async () => {
        const ui = {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessage: jest.fn(),
            max_message_width: () => 60,
            ContextType: () => 'test',
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-history')
        await db.attach()
        for (let i = 0; i < 500; i++) {
            db.onEvent({
                kind: 'uiMessage',
                message: { kind: 'text', text: `msg-${i}` },
                compatibilityId: 'cmd-hub.builtin.text',
                version: '1.0.0',
            })
        }
        // Full log retained even though display will truncate.
        expect(db.log.length).toBe(500)
        // Most recent entries land at the tail.
        const last = db.log[499] as { kind: string, text: string }
        expect(last.kind).toBe('text')
        expect(last.text).toBe('msg-499')
    })

    it('rendered output truncates from the head and notes dropped lines', async () => {
        const ui = {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessage: jest.fn(),
            max_message_width: () => 80,
            ContextType: () => 'test',
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-trunc')
        await db.attach()
        // Push enough mid-size entries to overflow the 4KB cap but leave
        // headroom for the dropNote hint (~70 chars).
        for (let i = 0; i < 200; i++) {
            db.onEvent({
                kind: 'uiMessage',
                message: { kind: 'text', text: 'X'.repeat(30) + ` #${i}` },
                compatibilityId: 'cmd-hub.builtin.text',
                version: '1.0.0',
            })
        }
        await new Promise((r) => setTimeout(r, 600))
        expect(ui.editMessage).toHaveBeenCalled()
        const lastCall = ui.editMessage.mock.calls.at(-1) as unknown[]
        const renderedText = lastCall[2] as string
        expect(renderedText).toMatch(/older lines.*use \/log/)
        // Underlying log retains all 200 entries even though the rendered
        // body shows fewer.
        expect(db.log.length).toBe(200)
    })
})
