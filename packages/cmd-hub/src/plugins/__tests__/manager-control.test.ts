import 'reflect-metadata'

// Same mock pattern the other cmd-hub tests use — keeps logger/config out of tests.
const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { ManagerControlPlugin } from '../manager-control'
import { CmdDispatcher } from '../../ui/command-processor'
import type { BaseUIContext } from '@cmd-hub/common'

describe('ManagerControlPlugin', () => {
    function makeDispatcher() {
        return new CmdDispatcher<BaseUIContext>()
    }

    it('registers six commands on dispatcher.onDispatcherSetup', async () => {
        const dispatcher = makeDispatcher()
        const plugin = new ManagerControlPlugin<BaseUIContext>()

        await plugin.onDispatcherSetup!(dispatcher, {} as never)

        const names = dispatcher.collectRegisteredCommands().map(c => c.name).sort()
        expect(names).toEqual([
            'gooffline',
            'goonline',
            'setgreeting',
            'setname',
            'status',
            'wipe_chat',
        ])
    })

    it('every command declares CAP_ManagerRepo', async () => {
        const dispatcher = makeDispatcher()
        const plugin = new ManagerControlPlugin<BaseUIContext>()

        await plugin.onDispatcherSetup!(dispatcher, {} as never)

        for (const c of dispatcher.collectRegisteredCommands()) {
            expect(c.requires.length).toBe(1)
            expect(c.requires[0]).toBe('common.managerRepo')
        }
    })
})
