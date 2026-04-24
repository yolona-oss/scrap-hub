import * as grpc from '@grpc/grpc-js'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import {
    CmdHubServiceClient,
    CmdNodeServiceClient,
    CmdNodeServiceService,
    type CmdNodeServiceServer,
    type InvokeClient,
    type InvokeServer,
    type NodeManifest,
    type RegisterRequest,
    type RegisterResponse,
} from '../../../grpc/generated/cmd_node'
import { CmdNodeRegistry } from '../../registry/cmd-node-registry'
import { ManifestAggregator } from '../../pool/manifest-aggregator'
import { FileService } from '../../files/file-service'
import { GridFSBackend } from '../../files/gridfs-backend'
import { InternalTokenVerifier } from '../../auth/internal-token-verifier'
import { MetricStore } from '../../metrics/metric-store'
import { NodeRecordModel } from '../../db/node-record.model'
import { startHubGrpcServer, type HubGrpcServerHandle } from '../../grpc-server/server'
import {
    GrpcCmdNodeClient,
    InMemoryChannelResolver,
} from '../../client/grpc-cmd-node-client'
import { HubDispatcher } from '../../dispatcher/hub-dispatcher'

const FP = 'loopback-fp'

function blankManifest(nodeId: string, cmd: string, cid = `com.ex.${cmd}`, version = '1.0.0'): NodeManifest {
    return {
        nodeId, nodeName: nodeId, version: '1.0.0',
        commands: [{ name: cmd, compatibilityId: cid, version, description: '', args: [], aliases: [] }],
        services: [], configs: [],
        hardware: { cpuCores: 1, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
        metrics: { gauges: [], counters: [], histograms: [] },
    }
}

function metaWithFingerprint(fp: string): grpc.Metadata {
    const md = new grpc.Metadata()
    md.set('x-cmdhub-node-fingerprint', fp)
    return md
}

function callRegister(
    client: CmdHubServiceClient,
    req: RegisterRequest,
    md: grpc.Metadata,
): Promise<RegisterResponse> {
    return new Promise((resolve, reject) => {
        client.register(req, md, (err, res) => {
            if (err) reject(err); else resolve(res)
        })
    })
}

/**
 * Mini in-process "node" — hosts CmdNodeService.Invoke with a provided
 * executor. Returns the bound address and a shutdown fn.
 */
async function startMiniNode(executor: (
    start: CmdHubProtoInvokeStart,
    call: grpc.ServerDuplexStream<InvokeClient, InvokeServer>,
) => void): Promise<{ address: string; shutdown: () => Promise<void> }> {
    const server = new grpc.Server()
    const impl: CmdNodeServiceServer = {
        invoke(call) {
            call.on('data', (msg: InvokeClient) => {
                if (msg.start !== undefined) executor(msg.start, call)
                // cancel/intercom handled inside the executor when it sets up a listener
            })
        },
        configReload(_c, cb) { cb(null, { acknowledged: true }) },
        getManifest(_c, cb) {
            cb(null, {
                nodeId: '', nodeName: '', version: '',
                commands: [], services: [], configs: [],
                hardware: { cpuCores: 0, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
                metrics: { gauges: [], counters: [], histograms: [] },
            } as NodeManifest)
        },
    }
    server.addService(CmdNodeServiceService, impl)
    return new Promise((resolve, reject) => {
        server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => {
            if (err) return reject(err)
            resolve({
                address: `127.0.0.1:${port}`,
                shutdown: () => new Promise((r) => server.tryShutdown(() => r())),
            })
        })
    })
}

type CmdHubProtoInvokeStart = Exclude<InvokeClient['start'], undefined>

describe('End-to-end loopback integration (hub + nodes + real gRPC + Mongo)', () => {
    let rs: MongoMemoryReplSet
    let hubServer: HubGrpcServerHandle
    let registry: CmdNodeRegistry
    let aggregator: ManifestAggregator
    let resolver: InMemoryChannelResolver
    let dispatcher: HubDispatcher

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('loopback-e2e'))
        await NodeRecordModel.init()

        registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) })
        aggregator = new ManifestAggregator()
        resolver = new InMemoryChannelResolver((addr) =>
            new CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
        )
        const hubClient = new GrpcCmdNodeClient(resolver)
        dispatcher = new HubDispatcher({ aggregator, client: hubClient })

        hubServer = await startHubGrpcServer({
            bindAddress: '127.0.0.1:0',
            credentials: grpc.ServerCredentials.createInsecure(),
            registry,
            aggregator,
            fileService: new FileService(new GridFSBackend({
                conn: mongoose.connection, hubPublicBaseUrl: 'http://hub.test',
            })),
            metrics: new MetricStore(),
            onNodeRegistered: (nodeId, addr) => resolver.attach(nodeId, addr),
            onNodeDisconnected: (nodeId) => resolver.detach(nodeId),
        })
    }, 300_000)

    afterAll(async () => {
        resolver.clear()
        await hubServer.shutdown()
        await mongoose.disconnect()
        await rs.stop()
    })

    /** Helper: provision a node, spin up its gRPC server, register it with the hub. */
    async function spawnAndRegister(
        nodeName: string,
        cmd: string,
        executor: Parameters<typeof startMiniNode>[0],
        opts: { compatibilityId?: string; version?: string } = {},
    ): Promise<{ nodeId: string; shutdown: () => Promise<void> }> {
        const { nodeId, token } = await registry.provision({
            nodeName, certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })
        const node = await startMiniNode(executor)
        const hubClient = new CmdHubServiceClient(
            hubServer.boundAddress, grpc.credentials.createInsecure(),
        )
        try {
            await callRegister(hubClient, {
                nodeId, token,
                listenAddress: node.address,
                manifest: blankManifest(nodeId, cmd, opts.compatibilityId, opts.version),
            }, metaWithFingerprint(FP))
        } finally {
            hubClient.close()
        }
        return {
            nodeId,
            shutdown: async () => {
                resolver.detach(nodeId)
                await node.shutdown()
            },
        }
    }

    it('dispatches a command to the registered node and streams events back', async () => {
        const node = await spawnAndRegister('alpha', 'echo', (_start, call) => {
            call.write({ seq: 1, message: { text: 'hello' } })
            call.write({ seq: 2, done: { finalMessage: 'done' } })
            call.end()
        })
        try {
            const events: InvokeServer[] = []
            const res = await dispatcher.handle({
                command: 'echo', args: {}, userId: 'u', uiHandle: null,
                onEvent: (e) => events.push(e),
            })
            expect(res.success).toBe(true)
            expect(events.map((e) => e.message?.text ?? e.done?.finalMessage)).toEqual(['hello', 'done'])
        } finally {
            await node.shutdown()
        }
    })

    it('round-robins invocations across two peer nodes sharing a command', async () => {
        const seen: string[] = []
        const makeExecutor = (label: string) => (
            _start: CmdHubProtoInvokeStart,
            call: grpc.ServerDuplexStream<InvokeClient, InvokeServer>,
        ) => {
            seen.push(label)
            call.write({ seq: 1, done: { finalMessage: label } })
            call.end()
        }
        const a = await spawnAndRegister('peer-a', 'rr-cmd', makeExecutor('A'), { compatibilityId: 'com.ex.rr' })
        const b = await spawnAndRegister('peer-b', 'rr-cmd', makeExecutor('B'), { compatibilityId: 'com.ex.rr' })
        try {
            for (let i = 0; i < 4; i++) {
                await dispatcher.handle({ command: 'rr-cmd', args: {}, userId: 'u', uiHandle: null })
            }
            // Two peers, four invocations -> each should see exactly two.
            const counts = { A: 0, B: 0 } as Record<string, number>
            for (const l of seen) counts[l]++
            expect(counts.A).toBe(2)
            expect(counts.B).toBe(2)
        } finally {
            await a.shutdown()
            await b.shutdown()
        }
    })

    it('surfaces a stream error when the node dies mid-invocation', async () => {
        const node = await spawnAndRegister('dies', 'crash', (_start, call) => {
            call.write({ seq: 1, message: { text: 'about to die' } })
            // Abort the stream abruptly — grpc-js surfaces this as an error on the client side.
            call.emit('error', { code: grpc.status.UNAVAILABLE, name: 'u', message: 'node crashed' })
        })
        try {
            const events: InvokeServer[] = []
            const res = await dispatcher.handle({
                command: 'crash', args: {}, userId: 'u', uiHandle: null,
                onEvent: (e) => events.push(e),
            })
            // First we got 'about to die', then a synthetic stream error, then the loop ended.
            expect(events.some((e) => e.message?.text === 'about to die')).toBe(true)
            expect(events.some((e) => e.error !== undefined)).toBe(true)
            expect(res.success).toBe(false)
        } finally {
            await node.shutdown()
        }
    })

    it('rejects a second node whose manifest conflicts with an existing pool', async () => {
        // First node claims /dup at compatibility_id=A
        const first = await spawnAndRegister('dup1', 'dup', () => undefined, {
            compatibilityId: 'com.ex.dup-A',
        })
        try {
            // Second node tries /dup at compatibility_id=B — should fail at Register.
            const second = await registry.provision({
                nodeName: 'dup2', certFingerprint: FP,
                createdVia: 'manual', autoActivate: true,
            })
            const badNode = await startMiniNode(() => undefined)
            const hubClient = new CmdHubServiceClient(
                hubServer.boundAddress, grpc.credentials.createInsecure(),
            )
            try {
                await expect(callRegister(hubClient, {
                    nodeId: second.nodeId,
                    token: second.token,
                    listenAddress: badNode.address,
                    manifest: blankManifest(second.nodeId, 'dup', 'com.ex.dup-B'),
                }, metaWithFingerprint(FP))).rejects.toThrow(/manifest rejected/)
            } finally {
                hubClient.close()
                await badNode.shutdown()
            }
            // Aggregator should still only have the first node for /dup.
            expect(aggregator.getPool().members('dup').map((m) => m.nodeId)).toEqual([first.nodeId])
        } finally {
            await first.shutdown()
        }
    })

    // Intercom reverse-channel routing from hub to node is covered by the
    // /service-ctrl built-in tests (packages/cmd-hub/.../service-ctrl.test.ts)
    // and the hub-client + invoke-server integration test in cmd-node. The
    // dispatcher's handle() doesn't currently surface the InvocationHandle
    // (the SessionIndex owns that wiring) so exercising intercom end-to-end
    // here would duplicate coverage via an awkward construction.
})
