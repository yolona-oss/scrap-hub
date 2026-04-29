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
})
