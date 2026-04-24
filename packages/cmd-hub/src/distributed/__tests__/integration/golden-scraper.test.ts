import * as grpc from '@grpc/grpc-js'
import * as fs from 'fs'
import * as path from 'path'
import express from 'express'
import { Server as HttpServer } from 'http'
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
import { makeUploadEndpoint } from '../../files/upload-endpoint'
import { runGoldenScraper } from '../fixtures/golden-harness'

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures')
const FP = 'golden-fp'

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

function metaWithFingerprint(fp: string): grpc.Metadata {
    const md = new grpc.Metadata()
    md.set('x-cmdhub-node-fingerprint', fp)
    return md
}

function callRegister(
    client: CmdHubServiceClient, req: RegisterRequest, md: grpc.Metadata,
): Promise<RegisterResponse> {
    return new Promise((resolve, reject) => {
        client.register(req, md, (err, res) => {
            if (err) reject(err); else resolve(res)
        })
    })
}

async function uploadViaEndpoint(
    uploadUrl: string,
    token: string,
    bytes: Buffer,
): Promise<void> {
    const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(bytes),
    })
    if (!res.ok) {
        throw new Error(`upload failed: ${res.status} ${await res.text()}`)
    }
}

describe('Golden scraper on loopback-gRPC stack', () => {
    let rs: MongoMemoryReplSet
    let hubServer: HubGrpcServerHandle
    let httpServer: HttpServer
    let httpPort: number
    let registry: CmdNodeRegistry
    let aggregator: ManifestAggregator
    let resolver: InMemoryChannelResolver
    let dispatcher: HubDispatcher
    let fileService: FileService
    let backend: GridFSBackend

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('golden-e2e'))
        await NodeRecordModel.init()

        // Boot upload endpoint first so we can point hubPublicBaseUrl at it.
        const app = express()
        await new Promise<void>((resolve) => {
            httpServer = app.listen(0, () => {
                const addr = httpServer.address()
                if (typeof addr === 'object' && addr) httpPort = addr.port
                resolve()
            })
        })

        backend = new GridFSBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: `http://127.0.0.1:${httpPort}`,
        })
        fileService = new FileService(backend)
        app.use(makeUploadEndpoint({
            fileService,
            grantAccess: { peek: (id) => backend.peekGrant(id) },
            conn: mongoose.connection,
        }))

        registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) })
        aggregator = new ManifestAggregator()
        resolver = new InMemoryChannelResolver((addr) =>
            new CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
        )
        dispatcher = new HubDispatcher({
            aggregator,
            client: new GrpcCmdNodeClient(resolver),
        })

        hubServer = await startHubGrpcServer({
            bindAddress: '127.0.0.1:0',
            credentials: grpc.ServerCredentials.createInsecure(),
            registry, aggregator, fileService,
            metrics: new MetricStore(),
            onNodeRegistered: (nodeId, addr) => resolver.attach(nodeId, addr),
            onNodeDisconnected: (nodeId) => resolver.detach(nodeId),
        })
    }, 300_000)

    afterAll(async () => {
        resolver.clear()
        await hubServer.shutdown()
        await new Promise<void>((resolve) => httpServer.close(() => resolve()))
        await mongoose.disconnect()
        await rs.stop()
    })

    it('produces the same event sequence and CSV bytes over real gRPC as the captured fixture', async () => {
        const expectedEvents = JSON.parse(
            fs.readFileSync(path.join(FIXTURE_DIR, 'expected-events.json'), 'utf8'),
        ) as Array<{ seq: number; kind: string; payload: Record<string, unknown> }>
        const expectedCsv = fs.readFileSync(path.join(FIXTURE_DIR, 'expected.csv'))

        // Stand up a mini node that runs the fixture harness in-process and writes
        // its events onto the gRPC stream, mirroring the flat-oneof InvokeServer shape.
        const nodeServer = new grpc.Server()
        const nodeImpl: CmdNodeServiceServer = {
            invoke(call) {
                call.on('data', (msg: InvokeClient) => {
                    if (msg.start === undefined) return
                    void (async () => {
                        const { events, csvBytes } = await runGoldenScraper({ count: 50 })

                        // Upload the CSV bytes via the real FileService capability flow.
                        const grant = await backend.issueWriteGrant({
                            sessionId: msg.start!.sessionId, nodeId: 'golden-node',
                            name: 'golden.csv', mime: 'text/csv',
                            ttlSeconds: 60, permanent: false, maxBytes: 1_000_000,
                        })
                        await uploadViaEndpoint(grant.uploadUrl, grant.token, csvBytes)
                        // completeWrite was invoked by the upload endpoint when the body ended.

                        let seq = 0
                        for (const ev of events) {
                            seq++
                            if (ev.kind === 'message') {
                                call.write({ seq, message: { text: ev.payload.text as string } })
                            } else if (ev.kind === 'progress') {
                                call.write({
                                    seq,
                                    progress: {
                                        name: ev.payload.name as string,
                                        current: ev.payload.current as number,
                                        total: ev.payload.total as number,
                                    },
                                })
                            } else if (ev.kind === 'progressStatus') {
                                call.write({
                                    seq,
                                    progressStatus: {
                                        name: ev.payload.name as string,
                                        status: ev.payload.status as string,
                                    },
                                })
                            } else if (ev.kind === 'done') {
                                call.write({
                                    seq,
                                    file: {
                                        handle: {
                                            fileId: grant.prospective.fileId,
                                            backend: grant.prospective.backend,
                                            size: csvBytes.length,
                                            name: grant.prospective.name,
                                            mime: grant.prospective.mime,
                                            permanent: grant.prospective.permanent,
                                        },
                                    },
                                })
                                seq++
                                call.write({
                                    seq,
                                    done: { finalMessage: ev.payload.finalMessage as string },
                                })
                            }
                        }
                        call.end()
                    })()
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
        nodeServer.addService(CmdNodeServiceService, nodeImpl)
        const nodePort = await new Promise<number>((resolve, reject) => {
            nodeServer.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => {
                if (err) reject(err); else resolve(p)
            })
        })
        const nodeAddr = `127.0.0.1:${nodePort}`

        try {
            const { nodeId, token } = await registry.provision({
                nodeName: 'golden', certFingerprint: FP,
                createdVia: 'manual', autoActivate: true,
            })
            const hubClientStub = new CmdHubServiceClient(
                hubServer.boundAddress, grpc.credentials.createInsecure(),
            )
            try {
                await callRegister(hubClientStub, {
                    nodeId, token,
                    listenAddress: nodeAddr,
                    manifest: blankManifest(nodeId, 'scraper'),
                }, metaWithFingerprint(FP))
            } finally {
                hubClientStub.close()
            }

            const seen: InvokeServer[] = []
            await dispatcher.handle({
                command: 'scraper', args: {}, userId: 'u', uiHandle: null,
                onEvent: (e) => seen.push(e),
            })

            // Rebuild CapturedEvent shape for comparison. The stream carries a
            // trailing 'file' event before 'done' that has no fixture counterpart,
            // so we verify the file handle round-trips via FileService then drop
            // the file entry before comparing the event sequence.
            let fileHandle: { fileId: string; backend: string; name: string; mime: string; size: number; permanent: boolean } | null = null
            const reconstructed: Array<{ seq: number; kind: string; payload: Record<string, unknown> }> = []
            for (const e of seen) {
                if (e.message !== undefined) {
                    reconstructed.push({ seq: reconstructed.length + 1, kind: 'message', payload: { text: e.message.text } })
                } else if (e.progress !== undefined) {
                    reconstructed.push({
                        seq: reconstructed.length + 1,
                        kind: 'progress',
                        payload: { name: e.progress.name, current: e.progress.current, total: e.progress.total },
                    })
                } else if (e.progressStatus !== undefined) {
                    reconstructed.push({
                        seq: reconstructed.length + 1,
                        kind: 'progressStatus',
                        payload: { name: e.progressStatus.name, status: e.progressStatus.status },
                    })
                } else if (e.file !== undefined && e.file.handle) {
                    fileHandle = {
                        fileId: e.file.handle.fileId,
                        backend: e.file.handle.backend,
                        name: e.file.handle.name,
                        mime: e.file.handle.mime,
                        size: e.file.handle.size,
                        permanent: e.file.handle.permanent,
                    }
                } else if (e.done !== undefined) {
                    reconstructed.push({
                        seq: reconstructed.length + 1,
                        kind: 'done',
                        payload: { finalMessage: e.done.finalMessage },
                    })
                }
            }
            expect(reconstructed).toEqual(expectedEvents)

            // The CSV handle should have been stored in GridFS by the upload
            // endpoint; fetch it and compare bytes.
            expect(fileHandle).not.toBeNull()
            const chunks: Buffer[] = []
            for await (const c of fileService.read(fileHandle!)) chunks.push(c)
            const actualCsv = Buffer.concat(chunks)
            expect(actualCsv.equals(expectedCsv)).toBe(true)
        } finally {
            await new Promise<void>((resolve) => nodeServer.tryShutdown(() => resolve()))
        }
    }, 60_000)
})
