import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../../../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { CmdDispatcher } from '../dispatcher'
import type { ServiceDashboard } from '../dashboard'

function fakeDashboard(): ServiceDashboard<any> {
    return { isAttached: false } as unknown as ServiceDashboard<any>
}

describe('CmdDispatcher dashboard registry', () => {
    test('listUserDashboards returns only the requested user\'s entries', () => {
        const d = new CmdDispatcher()
        const a1 = fakeDashboard()
        const a2 = fakeDashboard()
        const b1 = fakeDashboard()
        d.setDashboard('userA', 'svc1', a1)
        d.setDashboard('userA', 'svc2', a2)
        d.setDashboard('userB', 'svc1', b1)

        const list = d.listUserDashboards('userA')
        expect(list).toHaveLength(2)
        expect(list.map(e => e.serviceName).sort()).toEqual(['svc1', 'svc2'])
        expect(list.find(e => e.serviceName === 'svc1')!.dashboard).toBe(a1)
        expect(list.find(e => e.serviceName === 'svc2')!.dashboard).toBe(a2)
    })

    test('listUserDashboards returns [] when the user has no entries', () => {
        const d = new CmdDispatcher()
        expect(d.listUserDashboards('ghost')).toEqual([])
    })

    test('removeDashboard drops only the matching entry', () => {
        const d = new CmdDispatcher()
        d.setDashboard('u', 'svc1', fakeDashboard())
        d.setDashboard('u', 'svc2', fakeDashboard())
        d.removeDashboard('u', 'svc1')
        const list = d.listUserDashboards('u')
        expect(list.map(e => e.serviceName)).toEqual(['svc2'])
    })

    test('userId prefix matches exactly — "u" does not match "user1"', () => {
        const d = new CmdDispatcher()
        d.setDashboard('user1', 'svc', fakeDashboard())
        expect(d.listUserDashboards('u')).toEqual([])
    })
})
