import 'reflect-metadata'
import {
    assertCommandIdentity,
    assertRequires,
    BaseCommandIdentity,
} from '../identity'
import { defineCapability } from '../../application/capability'

const CAP_A = defineCapability<string>('test.identityA')

function makeIdentity(over: Partial<BaseCommandIdentity> = {}): BaseCommandIdentity {
    return {
        name: 'foo',
        description: 'foo bar',
        compatibilityId: 'com.example.foo',
        version: '1.0.0',
        ...over,
    }
}

describe('assertCommandIdentity', () => {
    it('accepts a fully-populated identity', () => {
        expect(() => assertCommandIdentity(makeIdentity(), '@T')).not.toThrow()
    })

    it.each([
        ['name', { name: '' }],
        ['description', { description: '' }],
        ['compatibilityId', { compatibilityId: '' }],
        ['version', { version: '' }],
    ] as const)('rejects empty %s with the decorator-name prefix', (field, override) => {
        expect(() => assertCommandIdentity(makeIdentity(override), '@TestDecorator'))
            .toThrow(new RegExp(`^@TestDecorator: ${field} is required$`))
    })

    it('rejects non-semver versions', () => {
        expect(() => assertCommandIdentity(makeIdentity({ version: 'banana' }), '@T'))
            .toThrow(/version must be semver, got "banana"/)
    })
})

describe('assertRequires', () => {
    it('accepts undefined', () => {
        expect(() => assertRequires(undefined, '@T')).not.toThrow()
    })

    it('accepts an empty array', () => {
        expect(() => assertRequires([], '@T')).not.toThrow()
    })

    it('accepts an array of capability keys', () => {
        expect(() => assertRequires([CAP_A], '@T')).not.toThrow()
    })

    it('rejects a non-array value with the decorator-name prefix', () => {
        expect(() => assertRequires('not-an-array' as unknown, '@TestDecorator'))
            .toThrow(/^@TestDecorator: `requires` must be an array of capability keys$/)
    })
})
