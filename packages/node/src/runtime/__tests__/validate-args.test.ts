import { argBranch, argLeaf } from '@cmd-hub/common'
import { runLeafValidators, ValidationFailedError } from '../validate-args'

describe('runLeafValidators', () => {
    it('passes when no leaf has a validator', () => {
        const tree = argBranch({ name: argLeaf({}) })
        expect(() => runLeafValidators(tree, { name: 'anything' })).not.toThrow()
    })

    it('passes when validator returns true', () => {
        const tree = argBranch({
            limit: argLeaf({ validator: (v: string) => /^\d+$/.test(v) }),
        })
        expect(() => runLeafValidators(tree, { limit: '42' })).not.toThrow()
    })

    it('throws ValidationFailedError with the failing leaf path', () => {
        const tree = argBranch({
            limit: argLeaf({ validator: (v: string) => /^\d+$/.test(v) }),
        })
        let caught: unknown
        try { runLeafValidators(tree, { limit: 'oops' }) } catch (e) { caught = e }
        expect(caught).toBeInstanceOf(ValidationFailedError)
        const e = caught as ValidationFailedError
        expect(e.argPath).toBe('limit')
        expect(e.rawValue).toBe('oops')
        // `false` failures get the generic message.
        expect(e.reason).toBe('validation failed')
    })

    it('uses the validator-returned string as the human-readable reason', () => {
        const tree = argBranch({
            limit: argLeaf({ validator: (v: string) => v === 'ok' ? true : `expected "ok", got "${v}"` }),
        })
        let caught: unknown
        try { runLeafValidators(tree, { limit: 'nope' }) } catch (e) { caught = e }
        expect((caught as ValidationFailedError).reason).toBe('expected "ok", got "nope"')
    })

    it('prefixes the failure path with the slice prefix', () => {
        const tree = argBranch({
            aiAgent: argBranch({
                model: argLeaf({ validator: (v: string) => v.length > 0 || 'must be non-empty' }),
            }),
        })
        let caught: unknown
        try {
            runLeafValidators(tree, { 'args/aiAgent/model': '' }, 'args/')
        } catch (e) { caught = e }
        expect((caught as ValidationFailedError).argPath).toBe('args/aiAgent/model')
    })

    it('skips leaves whose value is missing from the wire map', () => {
        const tree = argBranch({
            optional: argLeaf({ validator: () => 'should not run' }),
        })
        expect(() => runLeafValidators(tree, {})).not.toThrow()
    })

    it('stops at the first failure (subsequent validators are not called)', () => {
        let secondCalled = false
        const tree = argBranch({
            a: argLeaf({ validator: () => 'first failure' }),
            b: argLeaf({
                validator: () => { secondCalled = true; return true },
            }),
        })
        expect(() => runLeafValidators(tree, { a: 'x', b: 'y' })).toThrow(ValidationFailedError)
        expect(secondCalled).toBe(false)
    })
})
