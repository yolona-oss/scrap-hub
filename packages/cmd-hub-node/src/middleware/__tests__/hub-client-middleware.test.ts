import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { EventEmitter } from 'events'
import { Application, Phase } from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { HubClientMiddleware } from '../hub-client-middleware'
import type { IHubServiceClient } from '../../runtime/hub-client'

type RegisterRequest = CmdHubProto.RegisterRequest
type RegisterResponse = CmdHubProto.RegisterResponse
type HeartbeatClient = CmdHubProto.HeartbeatClient
type HeartbeatServer = CmdHubProto.HeartbeatServer

class FakeHubServiceClient implements IHubServiceClient {
    public lastRegister: RegisterRequest | null = null
    public registerCalls = 0
    public heartbeatCalls = 0
    public heartbeatWrites: HeartbeatClient[] = []
    public closed = false
    private hbStreams: EventEmitter[] = []

    register(
        req: RegisterRequest,
        _md: grpc.Metadata,
        cb: (err: grpc.ServiceError | null, resp: RegisterResponse) => void,
    ): grpc.ClientUnaryCall {
        this.registerCalls += 1
        this.lastRegister = req
        const resp: RegisterResponse = { sessionToken: 'tok', pollIntervalMs: 50, assignedState: 1 }
        setImmediate(() => cb(null, resp))
        return {} as grpc.ClientUnaryCall
    }

    heartbeat(
        _md: grpc.Metadata,
    ): grpc.ClientDuplexStream<HeartbeatClient, HeartbeatServer> {
        this.heartbeatCalls += 1
        const bus = new EventEmitter() as EventEmitter & {
            write: (msg: HeartbeatClient) => boolean
            end: () => void
        }
        bus.write = (msg: HeartbeatClient) => {
            this.heartbeatWrites.push(msg)
            return true
        }
        bus.end = () => { bus.emit('end') }
        this.hbStreams.push(bus)
        return bus as unknown as grpc.ClientDuplexStream<HeartbeatClient, HeartbeatServer>
    }

    close(): void { this.closed = true }
}

class TestNodeApp extends Application<any> {
    constructor(
        inline: any,
        private readonly manifest: CmdHubProto.NodeManifest,
        private readonly listenAddr: string,
    ) {
        super({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: inline,
            name: `hub-client-mw-${Math.random().toString(36).slice(2)}`,
        })
    }
    async run(): Promise<void> {}

    async Initialize(): Promise<void> {
        ;(this as any)._nodeManifest = this.manifest
        ;(this as any)._invokeBoundAddress = this.listenAddr
        await super.Initialize()
    }
}

const manifest: CmdHubProto.NodeManifest = {
    nodeId: 'n-1', nodeName: 'n1', version: '0.0.1',
    commands: [], services: [], configs: [],
    hardware: { cpuCores: 1, totalMemoryBytes: 1, os: 'x', arch: 'x', hostname: 'h' },
    metrics: { gauges: [], counters: [], histograms: [] },
}

describe('HubClientMiddleware', () => {
    it('contributes a zod schema under the "hub" namespace', () => {
        const mw = new HubClientMiddleware()
        expect(mw.namespace).toBe('hub')
        const parsed = mw.schema.parse({
            address: 'localhost:1', token: 't', nodeId: 'n', nodeName: 'n', version: '1.0.0',
        })
        expect((parsed as any).certFingerprint).toBe('')
    })

    it('installs in the Services phase', () => {
        const mw = new HubClientMiddleware()
        expect(mw.phase).toBe(Phase.Services)
    })

    it('registers with the hub and publishes _hubClient + _metrics', async () => {
        const fake = new FakeHubServiceClient()
        const app = new TestNodeApp({
            hub: {
                address: 'localhost:50051', token: 't', nodeId: 'n-1',
                nodeName: 'n1', version: '0.0.1', heartbeatIntervalMs: 1000,
            },
        }, manifest, '127.0.0.1:50052')
            .use(new HubClientMiddleware({ clientOverride: fake }))

        await app.Initialize()

        expect(fake.registerCalls).toBe(1)
        expect(fake.lastRegister?.nodeId).toBe('n-1')
        expect(fake.lastRegister?.manifest?.nodeId).toBe('n-1')
        expect(fake.lastRegister?.listenAddress).toBe('127.0.0.1:50052')
        expect(fake.heartbeatCalls).toBe(1)
        expect(fake.heartbeatWrites.length).toBeGreaterThan(0)
        expect((app as any)._hubClient).not.toBeNull()
        expect((app as any)._metrics).toBeTruthy()

        await app.terminate()
        expect((app as any)._hubClient).toBeNull()
        expect((app as any)._metrics).toBeNull()
    })

    it('throws during install when _nodeManifest is missing', async () => {
        class NakedApp extends Application<any> {
            constructor() {
                super({
                    configPath: '', baseSchema: z.object({}),
                    inlineConfig: {
                        hub: {
                            address: 'localhost:1', token: 't', nodeId: 'n',
                            nodeName: 'n', version: '1.0.0',
                        },
                    },
                    name: `naked-${Math.random().toString(36).slice(2)}`,
                })
            }
            async run(): Promise<void> {}
        }
        const app = new NakedApp().use(new HubClientMiddleware({ clientOverride: new FakeHubServiceClient() }))
        await expect(app.Initialize()).rejects.toThrow(/_nodeManifest/)
    })

    it('skipNetwork avoids Register + Heartbeat but still stashes capabilities', async () => {
        const fake = new FakeHubServiceClient()
        const app = new TestNodeApp({
            hub: {
                address: 'localhost:1', token: 't', nodeId: 'n-1',
                nodeName: 'n1', version: '0.0.1',
            },
        }, manifest, '')
            .use(new HubClientMiddleware({ clientOverride: fake, skipNetwork: true }))

        await app.Initialize()
        expect(fake.registerCalls).toBe(0)
        expect(fake.heartbeatCalls).toBe(0)
        expect((app as any)._hubClient).not.toBeNull()
        await app.terminate()
    })
})
