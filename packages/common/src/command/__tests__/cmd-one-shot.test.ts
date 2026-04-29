import 'reflect-metadata'
import {
    CmdOneShot,
    type CmdOneShotContext,
    getCmdOneShotMeta,
    bindArgsForSpec,
} from '../cmd-one-shot'
import { CmdArg } from '../arg-decorator'
import { defineCapability } from '../../application/capability'

const CAP_TEST = defineCapability<string>('test.cmdOneShot')

class HealthArgs {
    @CmdArg({ required: false, position: 1, description: 'verbose flag', default: 'no' })
    verbose?: string

    @CmdArg({ required: false, description: 'target host', default: 'localhost' })
    target?: string
}

describe('CmdOneShot', () => {
    describe('inline factory', () => {
        it('builds a spec with required fields and exposes meta', () => {
            const spec = CmdOneShot({
                name: 'health',
                description: 'health probe',
                compatibilityId: 'com.example.health',
                version: '1.0.0',
                argsClass: HealthArgs,
                requires: [CAP_TEST],
                invokable: async (_ctx) => { /* no-op */ },
            })
            expect(spec.name).toBe('health')
            expect(spec.description).toBe('health probe')
            expect(spec.compatibilityId).toBe('com.example.health')
            expect(spec.version).toBe('1.0.0')
            expect(spec.argsClass).toBe(HealthArgs)
            expect(spec.requires).toEqual([CAP_TEST])
            expect(typeof spec.invokable).toBe('function')

            const recovered = getCmdOneShotMeta(spec)
            expect(recovered).toBe(spec)
        })

        it('rejects bad meta (missing required fields)', () => {
            expect(() => CmdOneShot({
                name: '', description: 'd', compatibilityId: 'c', version: '1.0.0',
                invokable: async () => {},
            })).toThrow(/name is required/)
            expect(() => CmdOneShot({
                name: 'n', description: '', compatibilityId: 'c', version: '1.0.0',
                invokable: async () => {},
            })).toThrow(/description is required/)
            expect(() => CmdOneShot({
                name: 'n', description: 'd', compatibilityId: '', version: '1.0.0',
                invokable: async () => {},
            })).toThrow(/compatibilityId is required/)
            expect(() => CmdOneShot({
                name: 'n', description: 'd', compatibilityId: 'c', version: 'not-semver',
                invokable: async () => {},
            })).toThrow(/version must be semver/)
        })
    })

    describe('class decorator', () => {
        it('stamps meta on the class and pulls it back via getCmdOneShotMeta', () => {
            const decorate = CmdOneShot({
                name: 'classy',
                description: 'class form',
                compatibilityId: 'com.example.classy',
                version: '1.0.0',
            })
            class Classy {
                static invokable: (ctx: CmdOneShotContext) => Promise<void> = async () => {}
            }
            decorate(Classy)
            const meta = getCmdOneShotMeta(Classy)
            expect(meta).toBeTruthy()
            expect(meta!.name).toBe('classy')
        })
    })

    describe('argument binding', () => {
        it('bindArgsForSpec returns a populated nested object with declared types', () => {
            const spec = CmdOneShot({
                name: 'health',
                description: 'health probe',
                compatibilityId: 'com.example.health',
                version: '1.0.0',
                argsClass: HealthArgs,
                invokable: async (_ctx) => {},
            })
            // Wire-args use dot-path keys (no positional encoding); a positional
            // arg's dot-path key is just its property name.
            const bound = bindArgsForSpec(spec, { verbose: 'yes' }) as HealthArgs
            expect(bound.verbose).toBe('yes')
            // `target` was not provided; unflatten leaves it undefined. Callers
            // that want defaults applied at this layer should run a second
            // pass — bindArgsForSpec doesn't pre-populate defaults.
            expect(bound.target).toBeUndefined()
        })

        it('bindArgsForSpec returns the raw map when argsClass is omitted', () => {
            const spec = CmdOneShot({
                name: 'noargs',
                description: 'no args class',
                compatibilityId: 'com.example.noargs',
                version: '1.0.0',
                invokable: async (_ctx) => {},
            })
            const bound = bindArgsForSpec(spec, { foo: 'bar', baz: 'qux' })
            expect(bound).toEqual({ foo: 'bar', baz: 'qux' })
        })
    })

    describe('typed ctx.args', () => {
        it('user-annotated TArgs flows from argsClass through ctx.args', async () => {
            const seen: { verbose?: string; target?: string } = {}
            const spec = CmdOneShot({
                name: 'health',
                description: 'health probe',
                compatibilityId: 'com.example.health',
                version: '1.0.0',
                argsClass: HealthArgs,
                invokable: async (ctx: CmdOneShotContext<HealthArgs>) => {
                    seen.verbose = ctx.args.verbose
                    seen.target = ctx.args.target
                },
            })
            const bound = bindArgsForSpec(spec, { verbose: 'yes' }) as HealthArgs
            await spec.invokable({
                args: bound,
                userId: 'u', sessionId: 's',
                require: <V>() => { throw new Error('not needed') as never as V },
                emit: () => {},
            })
            expect(seen.verbose).toBe('yes')
            expect(seen.target).toBeUndefined()
        })
    })
})
