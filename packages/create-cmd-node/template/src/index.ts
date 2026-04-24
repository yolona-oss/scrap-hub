/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import pkg from '../package.json'
import { CmdNodeApp } from 'cmd-node'
import { MetricsCollector } from 'cmd-node/build/src/manifest/metrics-collector'
import { HubClient } from 'cmd-node/build/src/runtime/hub-client'
import {
    startNodeGrpcServer,
    makeInvokeServerImpl,
    type InvokeExecutor,
} from 'cmd-node/build/src/runtime/invoke-server'

/**
 * Minimum-viable cmd-node: one echo command that replies with its argument.
 * Swap out the InvokeExecutor below with your own logic; everything else
 * (registration, heartbeat, manifest, graceful shutdown) is boilerplate you
 * can typically leave alone.
 */

const ConfigSchema = z.object({
    nodeId: z.string().min(1, 'NODE_ID is required'),
    nodeToken: z.string().min(1, 'NODE_TOKEN is required'),
    hubAddress: z.string().min(1, 'HUB_ADDRESS is required'),
    listenBindAddress: z.string().default('0.0.0.0:50052'),
    certFingerprint: z.string().default(''),
})

function loadConfig() {
    return ConfigSchema.parse({
        nodeId: process.env.NODE_ID ?? '',
        nodeToken: process.env.NODE_TOKEN ?? '',
        hubAddress: process.env.HUB_ADDRESS ?? '',
        listenBindAddress: process.env.NODE_LISTEN_BIND_ADDRESS ?? '0.0.0.0:50052',
        certFingerprint: process.env.NODE_CERT_FINGERPRINT ?? '',
    })
}

const echoExecutor: InvokeExecutor = async (start, writer) => {
    // Reverse-channel receiver — for pause/stop/custom intercom actions.
    const receiver = {
        async receiveMsg(_id: string, _args: string[]) { /* no-op */ },
    }

    const done = (async () => {
        const text = start.args.text ?? '(no text)'
        writer({ seq: 1, message: { text: `echo: ${text}` } })
        writer({ seq: 2, done: { finalMessage: 'done' } })
    })()

    return { receiver, stopAdapter: () => undefined, done }
}

async function main() {
    const cfg = loadConfig()
    const version = typeof pkg.version === 'string' ? pkg.version : '0.1.0'
    const nodeName = typeof pkg.name === 'string' ? pkg.name : 'my-node'

    const nodeApp = new CmdNodeApp({
        nodeId: cfg.nodeId,
        nodeName,
        version,
    })

    nodeApp.useCommand({
        name: 'echo',
        compatibilityId: 'com.example.echo',
        version,
        description: 'Echo the "text" argument back to the caller.',
        args: [
            { name: 'text', position: 1, required: true, type: 'string', description: 'Text to echo', enumValues: [], defaultValue: '' },
        ],
        aliases: [],
    })

    const nodeServer = await startNodeGrpcServer({
        bindAddress: cfg.listenBindAddress,
        credentials: grpc.ServerCredentials.createInsecure(),
        impl: makeInvokeServerImpl({ executor: echoExecutor }),
    })
    console.log(`node listening on ${nodeServer.boundAddress}`)

    const hub = new HubClient({
        hubAddress: cfg.hubAddress,
        nodeId: cfg.nodeId,
        token: cfg.nodeToken,
        listenAddress: nodeServer.boundAddress,
        certFingerprint: cfg.certFingerprint,
        credentials: grpc.credentials.createInsecure(),
    })
    await hub.register(nodeApp.buildManifest())
    const metrics = new MetricsCollector()
    metrics.start()
    hub.startHeartbeat(metrics)

    await nodeApp.start()
    console.log('registered with hub; ready')

    const shutdown = async (sig: string) => {
        console.log(`${sig} received, shutting down`)
        metrics.stop()
        try { hub.stop() } catch { /* ignore */ }
        try { await nodeServer.shutdown() } catch { /* ignore */ }
        try { await nodeApp.stop() } catch { /* ignore */ }
        process.exit(0)
    }
    process.on('SIGINT', () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((e) => {
    console.error('fatal:', e)
    process.exit(1)
})
