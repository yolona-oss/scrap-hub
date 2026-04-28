import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { buildProtoArgsFromDataClass } from '@cmd-hub/common'
import { CmdArgument, type BranchedPairOptions } from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { CBDescriptorCompiler } from '../ui/command-processor/builder/desc-compiler'
import type { CmdDispatcher, RemoteCommandSpec } from '../ui/command-processor/dispatcher'
import type { BaseUIContext } from '../ui/types'

/**
 * Regression boundary: a function-form `pairOptions` resolver flows
 * through manifest-build → proto encode/decode → hub-side desc-compiler
 * and reaches the builder as an offline `pairOptionsResolver` that
 * answers each path the user drills.
 */

class TreeData {
    @CmdArgument({
        required: false,
        description: 'AI agent settings',
        pairOptions: async (_cmd, _disp, _mgr, path = []): Promise<string[] | BranchedPairOptions> => {
            if (path.length === 0) {
                return { branches: ['model', 'temperature'], leaves: [] }
            }
            switch (path[0]) {
                case 'model': return ['qwen2.5:7b', 'gpt-4o']
                case 'temperature': return ['0.0', '0.5']
                default: return []
            }
        },
    })
    aiAgent?: string

    @CmdArgument({
        required: false,
        description: 'Flat list',
        pairOptions: ['csv', 'json'],
    })
    format?: string
}

describe('branched-pair-options round-trip', () => {
    test('node manifest → proto encode/decode → hub desc-compiler → resolver answers each path', async () => {
        // 1. Node-side: walk the resolver eagerly and build a ProtoArgSpec.
        const args = await buildProtoArgsFromDataClass(TreeData, 'test-cmd')
        const aiArg = args.find(a => a.name === 'aiAgent')!
        expect(aiArg.branchedOptions).toBeDefined()
        expect(aiArg.branchedOptions!.leaves).toEqual([])
        expect(Object.keys(aiArg.branchedOptions!.branches).sort()).toEqual(['model', 'temperature'])
        expect(aiArg.branchedOptions!.branches.model.leaves).toEqual(['qwen2.5:7b', 'gpt-4o'])

        // 2. Wire-encode and decode to confirm proto serialization preserves the tree.
        const protoArg: CmdHubProto.ArgSpec = {
            name: aiArg.name,
            position: aiArg.position,
            required: aiArg.required,
            type: aiArg.type,
            description: aiArg.description,
            enumValues: aiArg.enumValues,
            defaultValue: aiArg.defaultValue,
            branchedOptions: {
                leaves: aiArg.branchedOptions!.leaves,
                branches: Object.fromEntries(
                    Object.entries(aiArg.branchedOptions!.branches).map(([k, v]) => [
                        k,
                        { leaves: v.leaves, branches: {} },
                    ]),
                ),
            },
        }
        const encoded = CmdHubProto.ArgSpec.encode(protoArg).finish()
        const decoded = CmdHubProto.ArgSpec.decode(encoded)
        expect(decoded.branchedOptions?.leaves).toEqual([])
        expect(decoded.branchedOptions?.branches.model.leaves).toEqual(['qwen2.5:7b', 'gpt-4o'])

        // 3. Hub-side: feed a synthetic RemoteCommandSpec carrying both args
        //    (aiAgent decoded from the wire, format with its flat literal).
        const compiler = new CBDescriptorCompiler<BaseUIContext>()
        const formatProtoArg: CmdHubProto.ArgSpec = {
            name: 'format',
            position: 0,
            required: false,
            type: 'string',
            description: 'Flat list',
            enumValues: ['csv', 'json'],
            defaultValue: '',
            branchedOptions: undefined,
        }
        const remote: RemoteCommandSpec = {
            name: 'test-cmd',
            description: 'test',
            args: [decoded, formatProtoArg],
        }
        // configureRemoteDesc is private — go through compile() with a stub
        // dispatcher whose `tryGetRemoteCommand` returns our remote spec.
        const dispatcher = {
            tryGetInvokable: () => undefined,
            tryGetRemoteCommand: () => remote,
        } as unknown as CmdDispatcher<BaseUIContext>
        const desc = await compiler.compile('test-cmd', 'user-1', dispatcher, {} as BaseUIContext)
        const aiDescriptor = desc.args.find(a => a.name === 'aiAgent')!

        // 4. The synthesized resolver answers each path.
        expect(aiDescriptor.pairOptionsResolver).toBeDefined()
        const root = await aiDescriptor.pairOptionsResolver!([])
        expect(root).toEqual({ branches: ['model', 'temperature'], leaves: [] })

        const modelLevel = await aiDescriptor.pairOptionsResolver!(['model'])
        // No grand-children → flat string[] convention.
        expect(modelLevel).toEqual(['qwen2.5:7b', 'gpt-4o'])

        const missing = await aiDescriptor.pairOptionsResolver!(['nonexistent'])
        expect(missing).toEqual({ branches: [], leaves: [] })

        // 5. Flat literal pairOptions still works without the tree path.
        const formatDescriptor = desc.args.find(a => a.name === 'format')!
        expect(formatDescriptor.pairOptions).toEqual(['csv', 'json'])
        // Snapshot-side: format has no function resolver, so no tree was built.
        const formatArg = args.find(a => a.name === 'format')!
        expect(formatArg.branchedOptions).toBeUndefined()
    })
})
