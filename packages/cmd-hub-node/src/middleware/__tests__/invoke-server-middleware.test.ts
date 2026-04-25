import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { Application, Phase } from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { InvokeServerMiddleware } from '../invoke-server-middleware'
import type { IExecutor } from '../../runtime/invoke-server'
import {
    CAP_NodeExecutor,
    CAP_NodeInvokeServer,
    CAP_NodeInvokeBoundAddress,
} from '../../capabilities'

function stubExecutor(): IExecutor {
    return {
        async createService() { throw new Error('unreachable in this test') },
        getManifest() {
            return {
                nodeId: 'n', nodeName: 'n', version: '1.0.0',
                commands: [], services: [], configs: [],
                hardware: { cpuCores: 1, totalMemoryBytes: 1, os: 'x', arch: 'x', hostname: 'h' },
                metrics: { gauges: [], counters: [], histograms: [] },
                publishedCapabilities: [],
            }
        },
    }
}

class TestApp extends Application<any> {
    constructor(inline: any, private readonly executor: IExecutor) {
        super({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: inline,
            name: `invoke-srv-mw-${Math.random().toString(36).slice(2)}`,
        })
    }
    async run(): Promise<void> {}

    async Initialize(): Promise<void> {
        this.provide(CAP_NodeExecutor, this.executor)
        await super.Initialize()
    }
}

describe('InvokeServerMiddleware', () => {
    it('contributes a zod schema under "invokeServer"', () => {
        const mw = new InvokeServerMiddleware()
        expect(mw.namespace).toBe('invokeServer')
        expect(mw.schema.parse({ bindAddress: '127.0.0.1:0' })).toEqual({ bindAddress: '127.0.0.1:0' })
    })

    it('installs in the Transport phase', () => {
        const mw = new InvokeServerMiddleware()
        expect(mw.phase).toBe(Phase.Transport)
    })

    it('starts a gRPC server and publishes _invokeServer + _invokeBoundAddress', async () => {
        const app = new TestApp({
            invokeServer: { bindAddress: '127.0.0.1:0' },
        }, stubExecutor())
            .use(new InvokeServerMiddleware())

        await app.Initialize()
        const handle = app.get(CAP_NodeInvokeServer)
        const bound = app.get(CAP_NodeInvokeBoundAddress)!
        expect(handle).toBeTruthy()
        expect(typeof bound).toBe('string')
        expect(bound).toMatch(/^127\.0\.0\.1:\d+$/)

        // Dial into it and call GetManifest to prove wiring.
        const client = new CmdHubProto.CmdNodeServiceClient(bound, grpc.credentials.createInsecure())
        const manifest = await new Promise<CmdHubProto.NodeManifest>((resolve, reject) => {
            client.getManifest({ nodeId: 'n' }, (err, resp) => {
                if (err) reject(err); else resolve(resp)
            })
        })
        expect(manifest.nodeId).toBe('n')
        client.close()

        await app.terminate()
        expect(app.get(CAP_NodeInvokeServer)).toBeUndefined()
        expect(app.get(CAP_NodeInvokeBoundAddress)).toBeUndefined()
    }, 20_000)

    it('throws during install when CAP_NodeExecutor is missing', async () => {
        class NakedApp extends Application<any> {
            constructor() {
                super({
                    configPath: '', baseSchema: z.object({}),
                    inlineConfig: { invokeServer: { bindAddress: '127.0.0.1:0' } },
                    name: `naked-${Math.random().toString(36).slice(2)}`,
                })
            }
            async run(): Promise<void> {}
        }
        const app = new NakedApp().use(new InvokeServerMiddleware())
        await expect(app.Initialize()).rejects.toThrow(/CAP_NodeExecutor/)
    })
})
