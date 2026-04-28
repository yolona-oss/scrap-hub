import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { CmdDispatcher } from '../dispatcher'
import { branch } from '@cmd-hub/common'

function makeAggregatorWithRemoteService(name: string, isService: boolean) {
    const command = {
        name,
        description: '',
        compatibilityId: 'cmd-hub.test',
        version: '1.0.0',
        // The aggregator decodes proto on attach; the dispatcher receives
        // OptionsTree, not the proto shape.
        options: branch({}),
        aliases: [],
    }
    const services = isService
        ? [{ command, intercomActions: [], caps: { supportsPause: false, supportsStop: true } }]
        : []
    return {
        listManifests: () => [{
            nodeId: 'n1', nodeName: 'n', version: '1.0.0',
            commands: [command],
            services,
            configs: [], hardware: {}, metrics: {},
        }],
        findCommand: (n: string) => (n === name ? command : undefined),
        configModuleOwners: (_: string) => [],
    }
}

describe('CmdDispatcher.isService — remote awareness', () => {
    test('remote service is recognized as a service', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('scraper', true) as any)
        expect(dispatcher.isService('scraper')).toBe(true)
    })

    test('remote one-shot is NOT a service', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('echo', false) as any)
        expect(dispatcher.isService('echo')).toBe(false)
    })

    test('unknown command is not a service', () => {
        const dispatcher = new CmdDispatcher()
        expect(dispatcher.isService('mystery')).toBe(false)
    })
})

describe('CmdDispatcher.isAllArgsPassed — service awareness', () => {
    test('remote SERVICE always returns false regardless of arg count', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('scraper', true) as any)

        expect(dispatcher.isAllArgsPassed('scraper', [])).toBe(false)
        expect(dispatcher.isAllArgsPassed('scraper', ['--city', 'Moscow'])).toBe(false)
    })

    test('remote ONE-SHOT keeps count-based check', () => {
        const dispatcher = new CmdDispatcher()
        dispatcher.attachManifestAggregator(makeAggregatorWithRemoteService('echo', false) as any)

        // No required leaves on the empty tree → 0 args satisfies 0 required.
        expect(dispatcher.isAllArgsPassed('echo', [])).toBe(true)
    })

    test('unknown command returns true (caller surfaces a not-found error downstream)', () => {
        const dispatcher = new CmdDispatcher()
        // No aggregator attached.
        expect(dispatcher.isAllArgsPassed('mystery', [])).toBe(true)
    })
})
