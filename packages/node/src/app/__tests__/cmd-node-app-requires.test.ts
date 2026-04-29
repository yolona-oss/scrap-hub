import 'reflect-metadata'
import { EventEmitter } from 'events'
import { z } from 'zod'
import {
    CmdArg,
    CmdService,
    CapabilityValidationError,
    defineCapability,
} from '@cmd-hub/common'
import { CmdNodeApp } from '../cmd-node-app'

const CAP_FAKE = defineCapability<string>('test.cmdNode.fake')

class Cfg {
    @CmdArg({ required: true, position: 1, description: 'Query' })
    query!: string
}
class Intercom {}

@CmdService({
    name: 'needs-cap',
    description: 'Service that requires a capability',
    compatibilityId: 'com.example.needs-cap',
    version: '1.0.0',
    args: Cfg, intercom: Intercom,
    requires: [CAP_FAKE],
})
class ServiceThatNeedsCap extends EventEmitter {
    constructor(_userId: string, _defaultData: unknown, _input: unknown) {
        super()
    }
    async receiveMsg(_id: string, _args: string[]): Promise<void> {}
    async run(): Promise<void> { this.emit('done') }
}

function mkApp(name: string) {
    return new CmdNodeApp({
        configPath: '',
        nodeId: 'n-req',
        nodeName: 'node-req',
        version: '0.0.1',
        inlineConfig: {},
        baseSchema: z.object({}).passthrough(),
        name,
    })
}

describe('CmdNodeApp + @CmdService.requires', () => {
    it('fails Initialize with CapabilityValidationError when a required cap is missing', async () => {
        const app = mkApp(`requires-miss-${Math.random().toString(36).slice(2)}`)
        app.useCommand(ServiceThatNeedsCap)

        let caught: unknown
        try {
            await app.Initialize()
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(CapabilityValidationError)
        const err = caught as CapabilityValidationError
        expect(err.failures.map(f => f.commandName)).toEqual(['needs-cap'])
        expect(err.failures[0].missing).toEqual([CAP_FAKE])
    })

    it('passes Initialize when a satisfying middleware publishes the cap', async () => {
        const app = mkApp(`requires-pass-${Math.random().toString(36).slice(2)}`)
        app.useCommand(ServiceThatNeedsCap)
        app.use({
            phase: 10,
            install: (a) => { a.provide(CAP_FAKE, 'fake-value', 'TestMiddleware') },
        })

        await app.Initialize()
        const snap = app.manifestSnapshot()
        expect(snap.commands.find(c => c.name === 'needs-cap')?.requires).toEqual([CAP_FAKE])
        expect(snap.capabilities.find(c => c.key === CAP_FAKE)?.providedBy).toBe('TestMiddleware')
        await app.terminate()
    })
})
