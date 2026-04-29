import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { argBranch, argLeaf, type ArgTree } from '@cmd-hub/common'
import { CBDescriptorCompiler } from '../desc-compiler'
import { CmdDispatcher } from '../../dispatcher'

describe('CBDescriptorCompiler — remote command path', () => {
    test('compiles a remote command with the args tree from the aggregator', async () => {
        const remoteTree: ArgTree = argBranch({
            query: argLeaf({ required: true, position: 1, persistent: true, description: 'q' }),
            limit: argLeaf({ type: 'number', persistent: true, description: 'l' }),
        })
        const dispatcher = new CmdDispatcher() as any
        // The aggregator's structural shape MUST use `args`, not `options`.
        // Regression guard: this exact wiring used to fail silently because
        // the dispatcher's structural type declared `options?: ArgTree`
        // while the real AggregatedCommand exposes `.args`, so the descriptor
        // compiler received undefined and the builder refused to open.
        dispatcher.attachManifestAggregator({
            listManifests: () => [{
                nodeId: 'n1', nodeName: 'n', version: '1.0.0',
                commands: [{ name: 'scraper', description: 'd', args: remoteTree }],
                services: [{ command: { name: 'scraper' }, intercomActions: [], caps: {} }],
                configs: [], hardware: {}, metrics: {},
            }],
            findCommand: (n: string) =>
                n === 'scraper'
                    ? { name: 'scraper', description: 'd', args: remoteTree }
                    : undefined,
            configModuleOwners: () => [],
        })

        const compiler = new CBDescriptorCompiler()
        const desc = await compiler.compile('scraper', 'user-1', dispatcher, {} as any)

        expect(desc.tree).toBe(remoteTree)
        expect(desc.tree.node).toBe('branch')
        if (desc.tree.node === 'branch') {
            expect(Array.from(desc.tree.children.keys())).toEqual(['query', 'limit'])
        }
    })

    test('returns an empty branch when the aggregator has no args for the command', async () => {
        const dispatcher = new CmdDispatcher() as any
        dispatcher.attachManifestAggregator({
            listManifests: () => [],
            findCommand: () => undefined,
            configModuleOwners: () => [],
        })

        const compiler = new CBDescriptorCompiler()
        await expect(compiler.compile('unknown', 'user-1', dispatcher, {} as any)).rejects.toThrow(
            /not registered locally and not served by any attached node/,
        )
    })

    test('remote / one-shot descriptors carry no slice — values ride bare on the wire', async () => {
        const remoteTree: ArgTree = argBranch({ x: argLeaf() })
        const dispatcher = new CmdDispatcher() as any
        dispatcher.attachManifestAggregator({
            listManifests: () => [{
                nodeId: 'n1', nodeName: 'n', version: '1.0.0',
                commands: [{ name: 'foo', description: '', args: remoteTree }],
                services: [{ command: { name: 'foo' }, intercomActions: [], caps: {} }],
                configs: [], hardware: {}, metrics: {},
            }],
            findCommand: (n: string) => n === 'foo' ? { name: 'foo', description: '', args: remoteTree } : undefined,
            configModuleOwners: () => [],
        })
        const desc = await new CBDescriptorCompiler().compile('foo', 'u', dispatcher, {} as any)
        expect(desc.slice).toBeUndefined()
    })
})

describe('CBDescriptorCompiler — service descriptor (flat-tree model)', () => {
    /** Build a fake dispatcher whose `tryGetInvokable` returns a service
     *  with the given args/intercom trees, and whose `isServiceActive`
     *  returns the configured value. */
    function fakeServiceDispatcher(opts: {
        argsTree: ArgTree
        intercomTree: ArgTree
        active: boolean
    }) {
        const dispatcher = new CmdDispatcher() as any
        dispatcher.tryGetInvokable = (name: string) =>
            name === 'svc'
                ? {
                    invokable: {
                        name: 'svc',
                        argsTree: () => opts.argsTree,
                        intercomTree: () => opts.intercomTree,
                    },
                }
                : undefined
        dispatcher.isService = (name: string) => name === 'svc'
        dispatcher.isServiceActive = () => opts.active
        return dispatcher
    }

    test('inactive service: descriptor.tree === argsTree exactly, slice === args', async () => {
        const args = argBranch({ query: argLeaf({ position: 1 }) })
        const intercom = argBranch({ stop: argLeaf({ standalone: true }) })
        const dispatcher = fakeServiceDispatcher({ argsTree: args, intercomTree: intercom, active: false })
        const desc = await new CBDescriptorCompiler().compile('svc', 'u', dispatcher, {} as any)
        expect(desc.tree).toBe(args)
        expect(desc.slice).toBe('args')
    })

    test('active service: descriptor.tree === intercomTree exactly, slice === intercom', async () => {
        const args = argBranch({ query: argLeaf({ position: 1 }) })
        const intercom = argBranch({ stop: argLeaf({ standalone: true }) })
        const dispatcher = fakeServiceDispatcher({ argsTree: args, intercomTree: intercom, active: true })
        const desc = await new CBDescriptorCompiler().compile('svc', 'u', dispatcher, {} as any)
        expect(desc.tree).toBe(intercom)
        expect(desc.slice).toBe('intercom')
    })

    test('inactive service tree has no `args` or `intercom` wrapper at root', async () => {
        const args = argBranch({ query: argLeaf({ position: 1 }), city: argLeaf() })
        const intercom = argBranch({ stop: argLeaf({ standalone: true }) })
        const dispatcher = fakeServiceDispatcher({ argsTree: args, intercomTree: intercom, active: false })
        const desc = await new CBDescriptorCompiler().compile('svc', 'u', dispatcher, {} as any)
        expect(desc.tree.node).toBe('branch')
        if (desc.tree.node === 'branch') {
            // Root children are the actual args (no wrapper).
            expect(desc.tree.children.has('query')).toBe(true)
            expect(desc.tree.children.has('city')).toBe(true)
            expect(desc.tree.children.has('args')).toBe(false)
            expect(desc.tree.children.has('intercom')).toBe(false)
        }
    })
})
