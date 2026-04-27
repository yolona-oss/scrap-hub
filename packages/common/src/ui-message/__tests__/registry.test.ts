import {
    UiMessageRendererRegistry,
    UiUiMessageKindPlugin,
    UiMessage,
} from '../index'

function plug<P>(kind: string, render: UiUiMessageKindPlugin<P, string>['render']): UiUiMessageKindPlugin<P, string> {
    return { kind, compatibilityId: `test.${kind}`, version: '1.0.0', render }
}

describe('UiMessageRendererRegistry', () => {
    it('registers and renders a kind', () => {
        const reg = new UiMessageRendererRegistry('cli')
        reg.register(plug<{ text: string }>('text', (p) => `T:${p.text}`))
        expect(reg.has('text')).toBe(true)
        expect(reg.render({ kind: 'text', text: 'hi' } as UiMessage, { ui: 'cli' })).toBe('T:hi')
    })

    it('replaces last-registered renderer (debug-logged but allowed)', () => {
        const reg = new UiMessageRendererRegistry('cli')
        reg.register(plug<{ text: string }>('text', () => 'first'))
        reg.register(plug<{ text: string }>('text', () => 'second'))
        expect(reg.render({ kind: 'text', text: 'hi' } as UiMessage, { ui: 'cli' })).toBe('second')
    })

    it('falls back to reference text renderer for unregistered kinds', () => {
        const reg = new UiMessageRendererRegistry('cli')
        const out = reg.render({ kind: 'text', text: 'fallback' } as UiMessage, { ui: 'cli' })
        // Reference renderer handles `text` kind directly even without registration.
        expect(out).toBe('fallback')
    })

    it('falls back to reference renderer for unknown plugin-augmented kinds', () => {
        const reg = new UiMessageRendererRegistry('cli')
        const out = reg.render(
            { kind: 'unknown-kind', anything: 1 } as unknown as UiMessage,
            { ui: 'cli' },
        )
        // Reference renderer's default branch surfaces JSON for visibility.
        expect(out).toMatch(/^\[unknown-kind\]/)
    })

    it('registeredKinds returns the set of registered names', () => {
        const reg = new UiMessageRendererRegistry('cli')
        reg.register(plug<{ text: string }>('text', () => ''))
        reg.register(plug<{ md: string }>('markdown', () => ''))
        expect(reg.registeredKinds().sort()).toEqual(['markdown', 'text'])
    })

    it('caps recursion depth at 5 levels', () => {
        const reg = new UiMessageRendererRegistry('cli')
        // A list that nests itself; each level dispatches recursively.
        reg.register(plug<{ items: UiMessage[] }>('list', (payload, ctx) =>
            payload.items.map((i) => String(ctx.render(i) ?? '')).join(','),
        ))
        const deep: UiMessage = { kind: 'list', items: [
            { kind: 'list', items: [
                { kind: 'list', items: [
                    { kind: 'list', items: [
                        { kind: 'list', items: [
                            { kind: 'list', items: [{ kind: 'text', text: 'leaf' } as UiMessage] } as UiMessage,
                        ] } as UiMessage,
                    ] } as UiMessage,
                ] } as UiMessage,
            ] } as UiMessage,
        ] } as UiMessage
        const out = String(reg.render(deep, { ui: 'cli' }))
        expect(out).toContain('[depth-cap]')
    })
})
