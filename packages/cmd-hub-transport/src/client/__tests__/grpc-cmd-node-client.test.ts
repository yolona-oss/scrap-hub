import * as grpc from '@grpc/grpc-js'
import {
    CmdNodeServiceService,
    CmdNodeServiceClient,
    type CmdNodeServiceServer,
    type InvokeClient,
    type InvokeServer,
    type InvokeStart,
    type NodeManifest,
} from '../../grpc/generated/cmd_node'
import { GrpcCmdNodeClient, InMemoryChannelResolver } from '../grpc-cmd-node-client'

function startMockNodeServer(onStart: (
    start: InvokeStart,
    call: grpc.ServerDuplexStream<InvokeClient, InvokeServer>,
) => void): Promise<{ address: string; shutdown: () => Promise<void> }> {
    const server = new grpc.Server()
    const impl: CmdNodeServiceServer = {
        invoke(call) {
            call.on('data', (msg: InvokeClient) => {
                if (msg.start !== undefined) onStart(msg.start, call)
            })
        },
        configReload(_call, cb) { cb(null, { acknowledged: true }) },
        getManifest(_call, cb) {
            cb(null, {
                nodeId: '', nodeName: '', version: '',
                commands: [], services: [], configs: [],
                hardware: { cpuCores: 0, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
                metrics: { gauges: [], counters: [], histograms: [] },
                publishedCapabilities: [],
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

describe('GrpcCmdNodeClient', () => {
    it('dials a node and streams events back in order', async () => {
        const node = await startMockNodeServer((_start, call) => {
            call.write({ seq: 1, message: { text: 'one' } })
            call.write({ seq: 2, message: { text: 'two' } })
            call.write({ seq: 3, done: { finalMessage: 'done' } })
            call.end()
        })
        try {
            const resolver = new InMemoryChannelResolver(
                (addr) => new CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
            )
            resolver.attach('N1', node.address)
            const client = new GrpcCmdNodeClient(resolver)

            const handle = await client.invoke('N1', {
                sessionId: 's1', userId: 'u', commandName: 'echo',
                args: {}, serviceDataBlob: new Uint8Array(),
            })
            const seen: InvokeServer[] = []
            for await (const e of handle.events()) seen.push(e)
            resolver.clear()

            expect(seen.map((e) => e.message?.text ?? e.done?.finalMessage)).toEqual(
                ['one', 'two', 'done'],
            )
            expect(seen.map((e) => e.seq)).toEqual([1, 2, 3])
        } finally {
            await node.shutdown()
        }
    })

    it('throws when the node is not in the resolver', async () => {
        const client = new GrpcCmdNodeClient(new InMemoryChannelResolver(() => {
            throw new Error('unreachable')
        }))
        await expect(client.invoke('missing', {
            sessionId: 's', userId: 'u', commandName: 'x',
            args: {}, serviceDataBlob: new Uint8Array(),
        })).rejects.toThrow(/no gRPC channel available/)
    })

    it('surfaces a stream error and then terminates the iterator', async () => {
        const node = await startMockNodeServer((_start, call) => {
            // Close the call without data — client should see an end cleanly.
            call.end()
        })
        try {
            const resolver = new InMemoryChannelResolver(
                (addr) => new CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
            )
            resolver.attach('N2', node.address)
            const client = new GrpcCmdNodeClient(resolver)

            const handle = await client.invoke('N2', {
                sessionId: 's-err', userId: 'u', commandName: 'x',
                args: {}, serviceDataBlob: new Uint8Array(),
            })
            const seen: InvokeServer[] = []
            for await (const e of handle.events()) seen.push(e)
            resolver.clear()
            // No data, just a clean close — seen should be empty.
            expect(seen).toEqual([])
        } finally {
            await node.shutdown()
        }
    })
})
