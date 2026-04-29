import 'reflect-metadata'
import { z } from 'zod'
import { EventEmitter } from 'events'
import {
    CmdArg,
    CmdOneShot,
    CmdService,
    type CmdOneShotContext,
    defineCapability,
} from '@cmd-hub/common'
import { CmdNodeApp } from '../cmd-node-app'

const CAP_DB = defineCapability<string>('phase-c.db')
const CAP_GREETER = defineCapability<string>('phase-c.greeter')

class CfgArgs {
    @CmdArg({ required: true, position: 1, description: 'q' })
    query!: string
}
class IntercomArgs {}

@CmdService({
    name: 'serviceful',
    description: 'a service that needs db',
    compatibilityId: 'com.example.serviceful',
    version: '1.0.0',
    args: CfgArgs, intercom: IntercomArgs,
    requires: [CAP_DB],
})
class ServicefulService extends EventEmitter {
    constructor(_userId: string, _ctx: unknown, _input: unknown) { super() }
    async receiveMsg(_id: string, _args: string[]): Promise<void> {}
    async run(): Promise<void> { this.emit('done') }
}

const Greet = CmdOneShot({
    name: 'greet',
    description: 'one-shot',
    compatibilityId: 'com.example.greet',
    version: '1.2.0',
    requires: [CAP_GREETER],
    invokable: async (ctx: CmdOneShotContext) => {
        ctx.emit({ kind: 'message', text: 'hi' })
    },
})

function mkApp(name: string) {
    return new CmdNodeApp({
        configPath: '',
        nodeId: 'phase-c-node',
        nodeName: 'pcn',
        version: '1.0.0',
        inlineConfig: {},
        baseSchema: z.object({}).passthrough(),
        name,
    })
}

describe('CmdNodeApp manifest carries Phase C fields', () => {
    it('Command.requires lists the capability key strings declared on the service', async () => {
        const app = mkApp(`pc-svc-requires-${Math.random().toString(36).slice(2)}`)
        app.useCommand(ServicefulService)
        const manifest = await app.buildManifest()
        const cmd = manifest.commands.find(c => c.name === 'serviceful')!
        expect(cmd.requires).toEqual([CAP_DB])
    })

    it('Command.requires lists the capability key strings declared on a one-shot', async () => {
        const app = mkApp(`pc-cmd-requires-${Math.random().toString(36).slice(2)}`)
        app.useCommand(Greet)
        const manifest = await app.buildManifest()
        const cmd = manifest.commands.find(c => c.name === 'greet')!
        expect(cmd.requires).toEqual([CAP_GREETER])
    })

    it('publishedCapabilities is a snapshot of the node\'s currently-provided caps', async () => {
        const app = mkApp(`pc-published-${Math.random().toString(36).slice(2)}`)
        app.use({
            phase: 10,
            install: (a) => {
                a.provide(CAP_DB, 'value', 'TestMW')
                a.provide(CAP_GREETER, 'hello', 'TestMW')
            },
        })
        app.useCommand(ServicefulService)
        app.useCommand(Greet)
        await app.Initialize()

        const manifest = await app.buildManifest()
        // publishedCapabilities mirrors the manifestSnapshot's keys.
        expect(manifest.publishedCapabilities).toContain(CAP_DB)
        expect(manifest.publishedCapabilities).toContain(CAP_GREETER)

        await app.terminate()
    })

    it('publishedCapabilities is empty when no middleware has run', async () => {
        const app = mkApp(`pc-empty-${Math.random().toString(36).slice(2)}`)
        const manifest = await app.buildManifest()
        expect(manifest.publishedCapabilities).toEqual([])
    })
})
