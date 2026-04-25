import * as grpc from '@grpc/grpc-js'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import {
    startHubGrpcServer,
    type HubGrpcServerHandle,
    CmdNodeRegistry,
    ManifestAggregator,
    FileService,
    InternalTokenVerifier,
    MetricStore,
    CmdHubProto,
} from '@cmd-hub/transport'
import { GridFsBackend } from '../../files/gridfs-backend'
import { NodeRecordModel } from '../../models/node-record.model'
import { MongoNodeRecordRepo } from '../../repos/node-record.repo'

type CmdHubServiceClient = CmdHubProto.CmdHubServiceClient
const CmdHubServiceClient = CmdHubProto.CmdHubServiceClient
type RegisterRequest = CmdHubProto.RegisterRequest
type RegisterResponse = CmdHubProto.RegisterResponse
type WriteGrantRequest = CmdHubProto.WriteGrantRequest
type WriteGrant = CmdHubProto.WriteGrant
type HeartbeatClient = CmdHubProto.HeartbeatClient
type HeartbeatServer = CmdHubProto.HeartbeatServer
type NodeManifest = CmdHubProto.NodeManifest

const FP = 'abcd1234' // stand-in fingerprint for tests without real mTLS

function makeClient(address: string): CmdHubServiceClient {
    return new CmdHubServiceClient(address, grpc.credentials.createInsecure())
}

function callUnary<Req, Res>(
    fn: (req: Req, md: grpc.Metadata, cb: (e: grpc.ServiceError | null, r: Res) => void) => grpc.ClientUnaryCall,
    req: Req,
    md: grpc.Metadata,
): Promise<Res> {
    return new Promise((resolve, reject) => {
        fn(req, md, (err, res) => {
            if (err) reject(err); else resolve(res)
        })
    })
}

function metaWithFingerprint(fp: string, nodeId?: string): grpc.Metadata {
    const md = new grpc.Metadata()
    md.set('x-cmdhub-node-fingerprint', fp)
    if (nodeId) md.set('x-cmdhub-node-id', nodeId)
    return md
}

function blankManifest(nodeId: string, name: string): NodeManifest {
    return {
        nodeId,
        nodeName: nodeId,
        version: '1.0.0',
        commands: [{
            name,
            compatibilityId: `com.ex.${name}`,
            version: '1.0.0',
            description: '',
            args: [],
            aliases: [],
            requires: [],
        }],
        services: [],
        configs: [],
        hardware: { cpuCores: 1, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
        metrics: { gauges: [], counters: [], histograms: [] },
        publishedCapabilities: [],
    }
}

describe('CmdHubService gRPC (loopback, insecure)', () => {
    let rs: MongoMemoryReplSet
    let server: HubGrpcServerHandle
    let client: CmdHubServiceClient
    let registry: CmdNodeRegistry
    let aggregator: ManifestAggregator
    let fileService: FileService
    let metrics: MetricStore
    let registrationCallbacks: Array<{ nodeId: string; addr: string }>

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('cmdhub-grpc-test'))
        await NodeRecordModel.init()

        registry = new CmdNodeRegistry({
            tokens: new InternalTokenVerifier(4),
            repo: new MongoNodeRecordRepo(),
        })
        aggregator = new ManifestAggregator()
        fileService = new FileService(new GridFsBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: 'http://hub.test',
        }))
        metrics = new MetricStore()
        registrationCallbacks = []

        server = await startHubGrpcServer({
            bindAddress: '127.0.0.1:0',
            credentials: grpc.ServerCredentials.createInsecure(),
            registry, aggregator, fileService, metrics,
            onNodeRegistered: (nodeId, addr) => registrationCallbacks.push({ nodeId, addr }),
        })
        client = makeClient(server.boundAddress)
    }, 180_000)

    afterAll(async () => {
        client.close()
        await server.shutdown()
        await mongoose.disconnect()
        await rs.stop()
    })

    it('accepts a valid Register and attaches the manifest', async () => {
        const { nodeId, token } = await registry.provision({
            nodeName: 'alpha', certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })

        const req: RegisterRequest = {
            nodeId, token, listenAddress: '127.0.0.1:50052',
            manifest: blankManifest(nodeId, 'cmd-alpha'),
        }
        const res: RegisterResponse = await callUnary(
            client.register.bind(client), req, metaWithFingerprint(FP),
        )
        expect(res.pollIntervalMs).toBeGreaterThan(0)
        expect(aggregator.getManifest(nodeId)?.commands[0].name).toBe('cmd-alpha')
        expect(registrationCallbacks).toContainEqual({ nodeId, addr: '127.0.0.1:50052' })
    })

    it('rejects Register with a bad fingerprint', async () => {
        const { nodeId, token } = await registry.provision({
            nodeName: 'beta', certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })
        const req: RegisterRequest = {
            nodeId, token, listenAddress: '',
            manifest: blankManifest(nodeId, 'cmd-beta'),
        }
        await expect(callUnary(
            client.register.bind(client), req, metaWithFingerprint('WRONG'),
        )).rejects.toThrow(/fingerprint/)
        // Must not have attached anything.
        expect(aggregator.getManifest(nodeId)).toBeUndefined()
    })

    it('rejects Register with a conflicting manifest (compatibility_id mismatch)', async () => {
        const first = await registry.provision({
            nodeName: 'ga', certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })
        await callUnary(client.register.bind(client), {
            nodeId: first.nodeId, token: first.token, listenAddress: '',
            manifest: blankManifest(first.nodeId, 'shared'),
        }, metaWithFingerprint(FP))

        const second = await registry.provision({
            nodeName: 'gb', certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })
        const bad = blankManifest(second.nodeId, 'shared')
        bad.commands[0].compatibilityId = 'com.other'

        await expect(callUnary(client.register.bind(client), {
            nodeId: second.nodeId, token: second.token, listenAddress: '',
            manifest: bad,
        }, metaWithFingerprint(FP))).rejects.toThrow(/manifest rejected/)

        // Second node should be rolled back to not-registered state so it can reconnect cleanly.
        expect(aggregator.getManifest(second.nodeId)).toBeUndefined()
    })

    it('CreateWriteGrant returns a usable grant pointing at the hub', async () => {
        const req: WriteGrantRequest = {
            sessionId: 's1', nodeId: 'n1', name: 'report.csv',
            mime: 'text/csv', ttlSeconds: 3600, permanent: false, maxBytes: 10_000,
        }
        const grant: WriteGrant = await callUnary(
            client.createWriteGrant.bind(client), req, new grpc.Metadata(),
        )
        expect(grant.uploadUrl).toContain('http://hub.test')
        expect(grant.prospectiveHandle?.backend).toBe('gridfs')
        expect(grant.prospectiveHandle?.name).toBe('report.csv')
    })

    it('Heartbeat records metric samples and updates lastSeen', async () => {
        const { nodeId, token } = await registry.provision({
            nodeName: 'hb', certFingerprint: FP,
            createdVia: 'manual', autoActivate: true,
        })
        await callUnary(client.register.bind(client), {
            nodeId, token, listenAddress: '',
            manifest: blankManifest(nodeId, 'cmd-hb'),
        }, metaWithFingerprint(FP))

        const md = new grpc.Metadata()
        md.set('x-cmdhub-node-id', nodeId)
        const hb = client.heartbeat(md)
        const replies: HeartbeatServer[] = []
        hb.on('data', (msg: HeartbeatServer) => replies.push(msg))
        const replyPromise = new Promise<void>((resolve) => {
            hb.on('data', () => { if (replies.length === 1) resolve() })
        })
        const msg: HeartbeatClient = {
            timestampMs: Date.now(),
            samples: [{ name: 'process.memory.rss', value: 12345, atMs: Date.now() }],
        }
        hb.write(msg)
        await replyPromise
        hb.end()

        expect(replies).toHaveLength(1)
        expect(metrics.recent(nodeId, 5).map((s) => s.name)).toEqual(['process.memory.rss'])
        const rec = await registry.get(nodeId)
        expect(rec?.lastSeen).not.toBeNull()
    })
})
