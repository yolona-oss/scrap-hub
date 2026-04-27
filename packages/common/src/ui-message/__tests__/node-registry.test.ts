import { NodeUiMessageRegistry, registerBuiltinBuilders } from '../index'

describe('NodeUiMessageRegistry', () => {
    it('register + lookup round-trip', () => {
        const reg = new NodeUiMessageRegistry()
        const plugin = {
            kind: 'foo',
            compatibilityId: 'test.foo',
            version: '1.0.0',
            build: (p: unknown) => ({ kind: 'foo' as const, ...(p as object) }) as never,
        }
        reg.register(plugin)
        expect(reg.lookup('foo')).toBe(plugin)
        expect(reg.lookup('absent')).toBeNull()
    })

    it('build dispatches through the registered plugin', () => {
        const reg = new NodeUiMessageRegistry()
        registerBuiltinBuilders(reg)
        const msg = reg.build('text', { text: 'hi' })
        expect(msg.kind).toBe('text')
        expect((msg as { text: string }).text).toBe('hi')
    })

    it('build throws when the kind is not registered', () => {
        const reg = new NodeUiMessageRegistry()
        expect(() => reg.build('text', { text: 'hi' })).toThrow(/not registered/)
    })

    it('registeredKinds lists every registered kind', () => {
        const reg = new NodeUiMessageRegistry()
        registerBuiltinBuilders(reg)
        const kinds = reg.registeredKinds().sort()
        expect(kinds).toEqual(['code', 'kv', 'link', 'list', 'markdown', 'text'])
    })
})
