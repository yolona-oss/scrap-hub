import 'reflect-metadata'
import {
    defineDecoratorMeta,
    readDecoratorMeta,
    makeMetaKey,
} from '../metadata'

describe('makeMetaKey', () => {
    it('returns the global registry symbol for the cmd-hub namespace', () => {
        const k = makeMetaKey('Foo')
        expect(k).toBe(Symbol.for('cmd-hub.Foo'))
    })

    it('returns the same symbol on repeat calls (so cross-bundle reads work)', () => {
        expect(makeMetaKey('Bar')).toBe(makeMetaKey('Bar'))
    })
})

describe('defineDecoratorMeta + readDecoratorMeta', () => {
    it('round-trips a value on a class target', () => {
        const k = makeMetaKey('Roundtrip-Class')
        class Target {}
        const meta = { greeting: 'hello' }
        defineDecoratorMeta(k, Target, meta)
        expect(readDecoratorMeta(k, Target)).toBe(meta)
    })

    it('round-trips a value on a function target', () => {
        const k = makeMetaKey('Roundtrip-Func')
        const target = () => {}
        const meta = { tag: 'one-shot' }
        defineDecoratorMeta(k, target, meta)
        expect(readDecoratorMeta(k, target)).toBe(meta)
    })

    it('returns null (not undefined) for unstamped targets', () => {
        const k = makeMetaKey('Empty')
        class Untouched {}
        expect(readDecoratorMeta(k, Untouched)).toBeNull()
    })

    it('different keys do not collide on the same target', () => {
        const k1 = makeMetaKey('Coll-1')
        const k2 = makeMetaKey('Coll-2')
        class Target {}
        defineDecoratorMeta(k1, Target, 'one')
        defineDecoratorMeta(k2, Target, 'two')
        expect(readDecoratorMeta(k1, Target)).toBe('one')
        expect(readDecoratorMeta(k2, Target)).toBe('two')
    })
})
