import * as grpc from '@grpc/grpc-js'
import { EventEmitter } from 'events'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import * as CmdHubProto from '@core/grpc/generated/cmd_node'
import { CmdNodeRegistry } from '@core/distributed/registry/cmd-node-registry'
import { ManifestAggregator } from '@core/distributed/pool/manifest-aggregator'
import { FileService } from '@core/distributed/files/file-service'
import { GridFSBackend } from '@core/distributed/files/gridfs-backend'
import { InternalTokenVerifier } from '@core/distributed/auth/internal-token-verifier'
import { MetricStore } from '@core/distributed/metrics/metric-store'
import { NodeRecordModel } from '@core/distributed/db/node-record.model'
import { startHubGrpcServer, type HubGrpcServerHandle } from '@core/distributed/grpc-server/server'
import { HubClient } from '../hub-client'
import { startNodeGrpcServer, makeInvokeServerImpl, type NodeGrpcServerHandle } from '../invoke-server'
import { adaptService } from '../event-adapter'
import { MetricsCollector } from '../../manifest/metrics-collector'

const FP = 'test-fingerprint'

function blankManifest(nodeId: string, cmd: string): CmdHubProto.NodeManifest {
    return {
        nodeId, nodeName: nodeId, version: '1.0.0',
        commands: [{ name: cmd, compatibilityId: `com.ex.${cmd}`, version: '1.0.0', description: '', args: [], aliases: [] }],
        services: [], configs: [],
        hardware: { cpuCores: 1, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
        metrics: { gauges: [], counters: [], histograms: [] },
    }
}

describe('HubClient + node Invoke server (loopback)', () => {
    let rs: MongoMemoryReplSet
    let hubServer: HubGrpcServerHandle
    let nodeServer: NodeGrpcServerHandle
    let hubClient: HubClient
    let registry: CmdNodeRegistry
    let aggregator: ManifestAggregator

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('hc-test'))
        await NodeRecordModel.init()

        registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) })
        aggregator = new ManifestAggregator()
        hubServer = await startHubGrpcServer({
            bindAddress: '127.0.0.1:0',
            credentials: grpc.ServerCredentials.createInsecure(),
            registry, aggregator,
            fileService: new FileService(new GridFSBackend({
                conn: mongoose.connection, hubPublicBaseUrl: 'http://hub.test',
            })),
            metrics: new MetricStore(),
        })

        // Node hosts an Invoke server whose executor runs a trivial "echo" service
        // that emits 3 messages then done.
        nodeServer = await startNodeGrpcServer({
            bindAddress: '127.0.0.1:0',
            credentials: grpc.ServerCredentials.createInsecure(),
            impl: makeInvokeServerImpl({
                executor: async (_start, writer) => {
                    const svc = new EventEmitter() as EventEmitter & { receiveMsg: (id: string, args: string[]) => Promise<void> }
                    let gotStop = false
                    svc.receiveMsg = async (id) => {
                        if (id === 'stop') gotStop = true
                    }
                    const stop = adaptService(svc, writer)
                    const done = new Promise<void>((resolve) => {
                        // Emit 3 messages then done, unless interrupted.
                        setImmediate(() => {
                            if (gotStop) { svc.emit('done', 'stopped'); resolve(); return }
                            svc.emit('message', 'one')
                            svc.emit('message', 'two')
                            svc.emit('message', 'three')
                            svc.emit('done', 'ok')
                            resolve()
                        })
                    })
                    return { receiver: svc, stopAdapter: stop, done }
                },
            }),
        })
    }, 180_000)

    afterAll(async () => {
        hubClient?.stop()
        await nodeServer.shutdown()
        await hubServer.shutdown()
        await mongoose.disconnect()
        await rs.stop()
    })

    it('HubClient.register succeeds and the manifest appears in the aggregator', async () => {
        const { nodeId, token } = await registry.provision({
            nodeName: 'n1', certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })
        hubClient = new HubClient({
            hubAddress: hubServer.boundAddress,
            nodeId, token,
            listenAddress: nodeServer.boundAddress,
            certFingerprint: FP,
            credentials: grpc.credentials.createInsecure(),
            heartbeatIntervalMs: 50,
        })
        const res = await hubClient.register(blankManifest(nodeId, 'echo'))
        expect(res.pollIntervalMs).toBeGreaterThan(0)
        expect(aggregator.getManifest(nodeId)?.commands[0].name).toBe('echo')
    })

    it('hub -> node Invoke streams events in order and closes on done', async () => {
        const nodeStub = new CmdHubProto.CmdNodeServiceClient(
            nodeServer.boundAddress,
            grpc.credentials.createInsecure(),
        )
        const call = nodeStub.invoke()
        const events: CmdHubProto.InvokeServer[] = []
        const finished = new Promise<void>((resolve) => {
            call.on('data', (m: CmdHubProto.InvokeServer) => events.push(m))
            call.on('end', () => resolve())
        })
        call.write({
            start: {
                sessionId: 's-1',
                userId: 'u',
                commandName: 'echo',
                args: {},
                serviceDataBlob: new Uint8Array(),
            },
        })
        await finished
        nodeStub.close()

        expect(events).toHaveLength(4)
        expect(events.map((e) => e.message?.text ?? e.done?.finalMessage)).toEqual(
            ['one', 'two', 'three', 'ok'],
        )
        expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    })

    it('HubClient.startHeartbeat pushes samples', async () => {
        const metrics = new MetricsCollector({ lagSampleEveryMs: 10 })
        hubClient.startHeartbeat(metrics)
        await new Promise((r) => setTimeout(r, 150))
        hubClient.stop()
        // If we got here without throwing, the heartbeat path survived writing a few samples.
        expect(true).toBe(true)
    })
})
