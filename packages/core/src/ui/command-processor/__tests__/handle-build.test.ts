import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { HandleCmdBuilder } from '../handlers/build'
import { CmdDispatcher } from '../dispatcher'
import { branch, leaf, type OptionsTree } from '@cmd-hub/common'
import { treeToProto } from '@cmd-hub/transport'

function makeDispatcher(opts: {
    commandTree: OptionsTree
    isService?: boolean
    savedSources?: Map<string, { value: string; source: 'module' | 'session' }>
    invokeMock?: jest.Mock
}) {
    const dispatcher = new CmdDispatcher() as any
    const command = 'svc'
    // The descriptor compiler decodes a remote command's `options`
    // through `protoToTree`, so the manifest-side tree must be in the
    // proto shape. Encode our raw tree once and reuse it.
    const protoOptions = treeToProto(opts.commandTree)
    // Pretend the command is remote: install a minimal aggregator.
    dispatcher.attachManifestAggregator({
        listManifests: () => [{
            nodeId: 'n1', nodeName: 'n', version: '1.0.0',
            commands: [{ name: command, options: protoOptions, description: '' }],
            services: opts.isService === false ? [] : [{ command: { name: command }, intercomActions: [], caps: {} }],
            configs: [], hardware: {}, metrics: {},
        }],
        findCommand: (n: string) => n === command
            ? { name: command, options: protoOptions, description: '' }
            : undefined,
        configModuleOwners: () => [],
    })

    // Stub `getCommandTree` to return our raw OptionsTree (skip the proto round-trip).
    dispatcher.getCommandTree = () => opts.commandTree

    // Stub repos so loadSavedSources works without a real DB.
    const moduleHandle = {
        record: { data: { config: {} } },
        getSessions: jest.fn().mockResolvedValue([]),
    }
    const account = { getModuleByNameOrCreate: jest.fn().mockResolvedValue({ module: moduleHandle, isNew: false }) }
    dispatcher.attachRepos({
        manager: { findByUserId: jest.fn().mockResolvedValue({ id: 'o', accountId: 'a', userId: 'u' }) },
        account: { handleById: jest.fn().mockResolvedValue(account) },
        invitationLink: {} as any, cmdAlias: {} as any, pendingDelete: {} as any,
    })

    // Hook `loadSavedSources` by patching the module — simpler than threading repos shape.
    // Instead, we override the test helper by injecting saved sources at the parser layer
    // through a custom dispatch wrapper. For coverage tests below we drive the path via
    // a faked `loadSavedSources` import; see jest.mock at the test top.

    const invokeMock = opts.invokeMock ?? jest.fn().mockResolvedValue({
        success: true, markup: { text: 'ok' }, messageType: 'dashboard' as const,
    })
    dispatcher.attachRemoteInvoker({ invoke: invokeMock, invokeLegacy: jest.fn() } as any)

    return { dispatcher, invokeMock, moduleHandle }
}

// We mock loadSavedSources directly to control the saved map per test.
let mockSavedSources = new Map<string, { value: string; source: 'module' | 'session' }>()
jest.mock('../saved-sources', () => ({
    loadSavedSources: jest.fn(async () => mockSavedSources),
}))

describe('HandleCmdBuilder', () => {
    beforeEach(() => { mockSavedSources = new Map() })

    test('opens builder with saved sources for service when -now absent', async () => {
        const tree = branch({ city: leaf({ description: 'city', required: true }) })
        const { dispatcher } = makeDispatcher({ commandTree: tree })
        mockSavedSources = new Map([['city', { value: 'Moscow', source: 'module' }]])

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc',
            userId: 'u',
            ownerId: 'm',
            words: [],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(res.messageType).toBe('builder')
        expect(res.success).toBe(true)
    })

    test('-now with full saved coverage skips builder and calls invoke directly', async () => {
        const tree = branch({ city: leaf({ description: 'city', required: true }) })
        const invokeMock = jest.fn().mockResolvedValue({
            success: true, markup: { text: 'done' }, messageType: 'dashboard',
        })
        const { dispatcher } = makeDispatcher({ commandTree: tree, invokeMock })
        mockSavedSources = new Map([['city', { value: 'Moscow', source: 'module' }]])

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc -now',
            userId: 'u',
            ownerId: 'm',
            words: ['-now'],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(invokeMock).toHaveBeenCalledTimes(1)
        const callArg = invokeMock.mock.calls[0][0]
        expect(callArg.command).toBe('svc')
        expect(callArg.args).toMatchObject({ city: 'Moscow' })
        expect(res.messageType).toBe('dashboard')
    })

    test('-now without coverage falls through to builder with missing-required info', async () => {
        const tree = branch({ city: leaf({ description: 'city', required: true }) })
        const invokeMock = jest.fn()
        const { dispatcher } = makeDispatcher({ commandTree: tree, invokeMock })
        mockSavedSources = new Map() // empty saved data

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc -now',
            userId: 'u',
            ownerId: 'm',
            words: ['-now'],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(invokeMock).not.toHaveBeenCalled()
        expect(res.messageType).toBe('builder')
        expect(res.markup.text).toMatch(/missing required/i)
        expect(res.markup.text).toContain('city')
    })

    test('-now with typed args + saved partial covers required', async () => {
        const tree = branch({
            city: leaf({ description: 'city', required: true }),
            depth: leaf({ description: 'depth', required: true }),
        })
        const invokeMock = jest.fn().mockResolvedValue({
            success: true, markup: { text: 'ok' }, messageType: 'dashboard',
        })
        const { dispatcher } = makeDispatcher({ commandTree: tree, invokeMock })
        mockSavedSources = new Map([['city', { value: 'Moscow', source: 'session' }]])

        const handler = new HandleCmdBuilder<any>()
        const ctx: any = { manager: { userId: 'u', id: 'm' }, reply: jest.fn() }
        const res = await handler.handle({
            dispatcher,
            command: 'svc',
            text: 'svc -now --depth 5',
            userId: 'u',
            ownerId: 'm',
            words: ['-now', '--depth', '5'],
            uiCtx: ctx,
            uiImpl: { ContextType: () => 'cli' } as any,
        })

        expect(invokeMock).toHaveBeenCalledTimes(1)
        const callArg = invokeMock.mock.calls[0][0]
        expect(callArg.args).toMatchObject({ city: 'Moscow', depth: '5' })
        expect(res.messageType).toBe('dashboard')
    })
})
