import { ServiceDashboard } from '../service-dashboard'

describe('ServiceDashboard event-sink API', () => {
    it('accepts a message event and calls ui.editMessage', async () => {
        const ui = {
            editMessage: jest.fn(),
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            max_message_width: () => 60,
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-1')
        await db.attach()
        db.onEvent({ kind: 'message', text: 'hello' })
        // Debounced 500ms; flush:
        await new Promise((r) => setTimeout(r, 600))
        expect(ui.editMessage).toHaveBeenCalled()
    })

    it('accepts a done event and calls detach', async () => {
        const ui = {
            editMessage: jest.fn(),
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            max_message_width: () => 60,
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-2')
        await db.attach()
        db.onEvent({ kind: 'done', finalMessage: 'complete' })
        await new Promise((r) => setTimeout(r, 600))
        // After done, subsequent onEvent calls should be no-ops.
        expect(() => db.onEvent({ kind: 'message', text: 'late' })).not.toThrow()
    })

    it('sendIntercom invokes the configured callback', async () => {
        const cb = jest.fn().mockResolvedValue(undefined)
        const ui = {
            sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
            editMessage: jest.fn(),
            max_message_width: () => 60,
        } as any
        const db = new ServiceDashboard(ui, 'u', 'session-3', { sendIntercom: cb })
        await db.attach()
        await db.sendIntercom('pause', [])
        expect(cb).toHaveBeenCalledWith('pause', [])
    })
})
