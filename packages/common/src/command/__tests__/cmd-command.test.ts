import 'reflect-metadata'
import {
    CmdCommand,
    type CmdCommandContext,
    type CmdCommandInvokable,
    getCmdCommandMeta,
    bindArgsForSpec,
    decodeArgsMap,
} from '../cmd-command'
import { CmdArgument } from '../argument-decorator'
import { defineCapability } from '../../application/capability'

const CAP_TEST = defineCapability<string>('test.cmdCommand')

class HealthArgs {
    @CmdArgument({ required: false, position: 1, description: 'verbose flag', defaultValue: 'no' })
    verbose?: string

    @CmdArgument({ required: false, description: 'target host', defaultValue: 'localhost' })
    target?: string
}

describe('CmdCommand', () => {
    describe('inline factory', () => {
        it('builds a spec with required fields and exposes meta', () => {
            const spec = CmdCommand({
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

            const recovered = getCmdCommandMeta(spec)
            expect(recovered).toBe(spec)
        })

        it('rejects bad meta (missing required fields)', () => {
            expect(() => CmdCommand({
                name: '', description: 'd', compatibilityId: 'c', version: '1.0.0',
                invokable: async () => {},
            })).toThrow(/name is required/)
            expect(() => CmdCommand({
                name: 'n', description: '', compatibilityId: 'c', version: '1.0.0',
                invokable: async () => {},
            })).toThrow(/description is required/)
            expect(() => CmdCommand({
                name: 'n', description: 'd', compatibilityId: '', version: '1.0.0',
                invokable: async () => {},
            })).toThrow(/compatibilityId is required/)
            expect(() => CmdCommand({
                name: 'n', description: 'd', compatibilityId: 'c', version: 'not-semver',
                invokable: async () => {},
            })).toThrow(/version must be semver/)
        })
    })

    describe('class decorator', () => {
        it('stamps meta on the class and pulls it back via getCmdCommandMeta', () => {
            const decorate = CmdCommand({
                name: 'classy',
                description: 'class form',
                compatibilityId: 'com.example.classy',
                version: '2.0.0',
                requires: [CAP_TEST],
            })

            class ClassyCommand {
                static invokable: CmdCommandInvokable = async (_ctx) => { /* no-op */ }
            }
            decorate(ClassyCommand)

            const meta = getCmdCommandMeta(ClassyCommand)
            expect(meta).not.toBeNull()
            expect(meta!.name).toBe('classy')
            expect(meta!.compatibilityId).toBe('com.example.classy')
            expect(meta!.version).toBe('2.0.0')
            expect(meta!.requires).toEqual([CAP_TEST])
            expect(typeof meta!.invokable).toBe('function')
        })

        it('throws when the decorated class lacks a static invokable', () => {
            const decorate = CmdCommand({
                name: 'broken',
                description: 'no invokable',
                compatibilityId: 'com.example.broken',
                version: '1.0.0',
            })
            class Broken {}
            expect(() => decorate(Broken)).toThrow(/must declare a static `invokable`/)
        })
    })

    describe('argument binding', () => {
        it('decodeArgsMap collapses positional-N-name keys', () => {
            const decoded = decodeArgsMap({
                'positional-1-verbose': 'yes',
                'positional-2-target': 'example.com',
                'something-else': 'kept',
            })
            expect(decoded).toEqual({
                verbose: 'yes',
                target: 'example.com',
                'something-else': 'kept',
            })
        })

        it('bindArgsForSpec returns a populated argsClass instance with positional decoding', () => {
            const spec = CmdCommand({
                name: 'health',
                description: 'health probe',
                compatibilityId: 'com.example.health',
                version: '1.0.0',
                argsClass: HealthArgs,
                invokable: async (_ctx) => {},
            })
            const bound = bindArgsForSpec(spec, { 'positional-1-verbose': 'yes' })
            expect(bound).toBeInstanceOf(HealthArgs)
            const typed = bound as HealthArgs
            expect(typed.verbose).toBe('yes')
            expect(typed.target).toBe('localhost')  // default
        })

        it('bindArgsForSpec returns the raw decoded map when argsClass is omitted', () => {
            const spec = CmdCommand({
                name: 'noargs',
                description: 'no args class',
                compatibilityId: 'com.example.noargs',
                version: '1.0.0',
                invokable: async (_ctx) => {},
            })
            const bound = bindArgsForSpec(spec, { 'positional-1-foo': 'bar', baz: 'qux' })
            expect(bound).toEqual({ foo: 'bar', baz: 'qux' })
        })
    })

    describe('typed ctx.args', () => {
        it('user-annotated TArgs flows from argsClass through ctx.args', async () => {
            const seen: { verbose?: string; target?: string } = {}
            const spec = CmdCommand({
                name: 'health',
                description: 'health probe',
                compatibilityId: 'com.example.health',
                version: '1.0.0',
                argsClass: HealthArgs,
                invokable: async (ctx: CmdCommandContext<HealthArgs>) => {
                    seen.verbose = ctx.args.verbose
                    seen.target = ctx.args.target
                },
            })
            // Drive the invokable directly with a populated args instance.
            const bound = bindArgsForSpec(spec, { 'positional-1-verbose': 'yes' }) as HealthArgs
            await spec.invokable({
                args: bound,
                userId: 'u', sessionId: 's',
                require: <V>() => { throw new Error('not needed') as never as V },
                emit: () => {},
            })
            expect(seen.verbose).toBe('yes')
            expect(seen.target).toBe('localhost')
        })
    })
})
