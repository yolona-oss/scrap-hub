import * as grpc from '@grpc/grpc-js'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { startHubGrpcServer, type HubGrpcServerHandle } from '../server'
import { mTlsFingerprintResolver } from '../tls'
import {
    CmdHubServiceClient,
    type RegisterRequest,
    type RegisterResponse,
    type NodeManifest,
} from '../../../grpc/generated/cmd_node'
import { CmdNodeRegistry } from '../../registry/cmd-node-registry'
import { ManifestAggregator } from '../../pool/manifest-aggregator'
import { FileService } from '../../files/file-service'
import { GridFSBackend } from '../../files/gridfs-backend'
import { InternalTokenVerifier } from '../../auth/internal-token-verifier'
import { MetricStore } from '../../metrics/metric-store'
import { NodeRecordModel } from '../../db/node-record.model'
import { createCA, signNodeCert } from '../../../cli/ca'

function blankManifest(nodeId: string, cmd: string): NodeManifest {
    return {
        nodeId, nodeName: nodeId, version: '1.0.0',
        commands: [{
            name: cmd, compatibilityId: `com.ex.${cmd}`, version: '1.0.0',
            description: '', args: [], aliases: [],
        }],
        services: [], configs: [],
        hardware: { cpuCores: 1, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
        metrics: { gauges: [], counters: [], histograms: [] },
    }
}

function callUnary<Req, Res>(
    fn: (req: Req, cb: (e: grpc.ServiceError | null, r: Res) => void) => grpc.ClientUnaryCall,
    req: Req,
): Promise<Res> {
    return new Promise((resolve, reject) => {
        fn(req, (err, res) => { if (err) reject(err); else resolve(res) })
    })
}

describe('CmdHubService over real mTLS', () => {
    let rs: MongoMemoryReplSet
    let server: HubGrpcServerHandle
    let registry: CmdNodeRegistry
    let aggregator: ManifestAggregator
    let ca: ReturnType<typeof createCA>
    let hubCert: ReturnType<typeof signNodeCert>

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('mtls-test'))
        await NodeRecordModel.init()

        registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) })
        aggregator = new ManifestAggregator()

        ca = createCA('test-ca')
        hubCert = signNodeCert(ca, 'localhost')

        const serverCreds = grpc.ServerCredentials.createSsl(
            Buffer.from(ca.certPem),
            [{ cert_chain: Buffer.from(hubCert.certPem), private_key: Buffer.from(hubCert.keyPem) }],
            true, // require client cert
        )

        server = await startHubGrpcServer({
            bindAddress: '127.0.0.1:0',
            credentials: serverCreds,
            registry, aggregator,
            fileService: new FileService(new GridFSBackend({
                conn: mongoose.connection, hubPublicBaseUrl: 'http://hub.test',
            })),
            metrics: new MetricStore(),
            resolveFingerprint: mTlsFingerprintResolver(),
        })
    }, 180_000)

    afterAll(async () => {
        await server.shutdown()
        await mongoose.disconnect()
        await rs.stop()
    })

    it('accepts Register when the client cert fingerprint matches what was provisioned', async () => {
        // Provision with the real node-cert fingerprint.
        const nodeMaterial = signNodeCert(ca, 'good-node')
        const { nodeId, token } = await registry.provision({
            nodeName: 'good', certFingerprint: nodeMaterial.fingerprint,
            createdVia: 'cli', autoActivate: true,
        })

        const creds = grpc.credentials.createSsl(
            Buffer.from(ca.certPem),
            Buffer.from(nodeMaterial.keyPem),
            Buffer.from(nodeMaterial.certPem),
        )
        // Override the default TLS hostname check — our cert CN is "good-node".
        const channelOpts = { 'grpc.ssl_target_name_override': 'localhost' }
        const client = new CmdHubServiceClient(server.boundAddress, creds, channelOpts)
        try {
            const req: RegisterRequest = {
                nodeId, token, listenAddress: '',
                manifest: blankManifest(nodeId, 'good-cmd'),
            }
            const res: RegisterResponse = await callUnary(
                client.register.bind(client),
                req,
            )
            expect(res.pollIntervalMs).toBeGreaterThan(0)
            expect(aggregator.getManifest(nodeId)?.commands[0].name).toBe('good-cmd')
        } finally {
            client.close()
        }
    })

    it('rejects Register when the client cert fingerprint does not match the allowlist', async () => {
        // Provision under fingerprint A, but present a cert with fingerprint B.
        const registeredMaterial = signNodeCert(ca, 'registered')
        const { nodeId, token } = await registry.provision({
            nodeName: 'imposter-target',
            certFingerprint: registeredMaterial.fingerprint,
            createdVia: 'cli', autoActivate: true,
        })
        const imposterMaterial = signNodeCert(ca, 'imposter')

        const creds = grpc.credentials.createSsl(
            Buffer.from(ca.certPem),
            Buffer.from(imposterMaterial.keyPem),
            Buffer.from(imposterMaterial.certPem),
        )
        const client = new CmdHubServiceClient(
            server.boundAddress,
            creds,
            { 'grpc.ssl_target_name_override': 'localhost' },
        )
        try {
            await expect(callUnary(client.register.bind(client), {
                nodeId, token, listenAddress: '',
                manifest: blankManifest(nodeId, 'impostered-cmd'),
            })).rejects.toThrow(/fingerprint/)
        } finally {
            client.close()
        }
    })

    it('rejects TLS handshake when client presents a cert signed by a different CA', async () => {
        const foreignCa = createCA('foreign-ca')
        const foreignMaterial = signNodeCert(foreignCa, 'foreign-node')

        const creds = grpc.credentials.createSsl(
            Buffer.from(ca.certPem),
            Buffer.from(foreignMaterial.keyPem),
            Buffer.from(foreignMaterial.certPem),
        )
        const client = new CmdHubServiceClient(
            server.boundAddress,
            creds,
            { 'grpc.ssl_target_name_override': 'localhost' },
        )
        try {
            await expect(callUnary(client.register.bind(client), {
                nodeId: 'x', token: 'x', listenAddress: '',
                manifest: blankManifest('x', 'x'),
            })).rejects.toThrow()
        } finally {
            client.close()
        }
    })
})
