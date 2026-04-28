import { branch, leaf } from '@cmd-hub/common'
import { runLeafValidators, ValidationFailedError } from '../validate-args'

describe('runLeafValidators', () => {
    it('passes when no leaf has a validator', () => {
        const tree = branch({ name: leaf({}) })
        expect(() => runLeafValidators(tree, { name: 'anything' })).not.toThrow()
    })

    it('passes when validator returns true', () => {
        const tree = branch({
            limit: leaf({ validator: (v) => /^\d+$/.test(v) }),
        })
        expect(() => runLeafValidators(tree, { limit: '42' })).not.toThrow()
    })

    it('throws ValidationFailedError with the failing leaf path', () => {
        const tree = branch({
            limit: leaf({ validator: (v) => /^\d+$/.test(v) }),
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
        const tree = branch({
            limit: leaf({ validator: (v) => v === 'ok' ? true : `expected "ok", got "${v}"` }),
        })
        let caught: unknown
        try { runLeafValidators(tree, { limit: 'nope' }) } catch (e) { caught = e }
        expect((caught as ValidationFailedError).reason).toBe('expected "ok", got "nope"')
    })

    it('prefixes the failure path with the slice prefix', () => {
        const tree = branch({
            aiAgent: branch({
                model: leaf({ validator: (v) => v.length > 0 || 'must be non-empty' }),
            }),
        })
        let caught: unknown
        try {
            runLeafValidators(tree, { 'config/aiAgent/model': '' }, 'config/')
        } catch (e) { caught = e }
        expect((caught as ValidationFailedError).argPath).toBe('config/aiAgent/model')
    })

    it('skips leaves whose value is missing from the wire map', () => {
        const tree = branch({
            optional: leaf({ validator: () => 'should not run' }),
        })
        expect(() => runLeafValidators(tree, {})).not.toThrow()
    })

    it('stops at the first failure (subsequent validators are not called)', () => {
        let secondCalled = false
        const tree = branch({
            a: leaf({ validator: () => 'first failure' }),
            b: leaf({
                validator: () => { secondCalled = true; return true },
            }),
        })
        expect(() => runLeafValidators(tree, { a: 'x', b: 'y' })).toThrow(ValidationFailedError)
        expect(secondCalled).toBe(false)
    })
})
