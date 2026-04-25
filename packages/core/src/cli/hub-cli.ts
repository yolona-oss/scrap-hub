#!/usr/bin/env node
/* eslint-disable no-console */
import 'reflect-metadata'
import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import {
    createCA,
    loadCA,
    writeCA,
    signNodeCert,
    CmdNodeRegistry,
    InternalTokenVerifier,
} from '@cmd-hub/transport'
import {
    MongooseStorageConnection,
    MongoNodeRecordRepo,
    NodeRecordModel,
} from '@cmd-hub/storage-mongo'

/**
 * cmd-hub CLI. Offers operator-level subcommands for CA setup and node
 * provisioning. `start` is intentionally left for deployable apps to
 * implement themselves — booting a CmdHubApp requires knowing which
 * middlewares and UIs to install, which is app-specific.
 */

const program = new Command()
    .name('cmd-hub')
    .description('Operator CLI for the cmd-hub federation')
    .version('1.0.0')

/* ---- ca-init ---- */

program
    .command('ca-init')
    .description('Generate a self-signed CA (one-time per deployment).')
    .requiredOption('--key <path>', 'where to write the CA private key')
    .requiredOption('--cert <path>', 'where to write the CA certificate')
    .option('--cn <name>', 'Common Name for the CA', 'cmd-hub-ca')
    .option('--force', 'overwrite existing files', false)
    .action((opts) => {
        const keyPath = path.resolve(opts.key as string)
        const certPath = path.resolve(opts.cert as string)
        if (!opts.force && (fs.existsSync(keyPath) || fs.existsSync(certPath))) {
            console.error(`refusing to overwrite existing CA files at ${keyPath} / ${certPath} (pass --force)`)
            process.exit(1)
        }
        const ca = createCA(opts.cn as string)
        writeCA(ca, keyPath, certPath)
        console.log(`CA written: key=${keyPath} cert=${certPath}`)
    })

/* ---- node-add ---- */

async function withMongo<T>(mongoUrl: string, fn: (registry: CmdNodeRegistry) => Promise<T>): Promise<T> {
    const conn = new MongooseStorageConnection(mongoUrl)
    await conn.connect()
    await NodeRecordModel.init()
    try {
        const registry = new CmdNodeRegistry({
            tokens: new InternalTokenVerifier(),
            repo: new MongoNodeRecordRepo(),
        })
        return await fn(registry)
    } finally {
        await conn.disconnect()
    }
}

program
    .command('node-add <name>')
    .description('Provision a new node: signs a cert + issues a token.')
    .requiredOption('--mongo <url>', 'MongoDB connection string')
    .requiredOption('--ca-key <path>', 'path to CA private key')
    .requiredOption('--ca-cert <path>', 'path to CA certificate')
    .requiredOption('--out-dir <dir>', 'directory to write the node cert + token')
    .option('--auto-activate', 'mark the node ACTIVE immediately (skip manual approve)', false)
    .action(async (name: string, opts) => {
        const ca = loadCA(opts.caKey as string, opts.caCert as string)
        const material = signNodeCert(ca, name)
        await withMongo(opts.mongo as string, async (registry) => {
            const { nodeId, token } = await registry.provision({
                nodeName: name,
                certFingerprint: material.fingerprint,
                createdVia: 'cli',
                autoActivate: Boolean(opts.autoActivate),
            })
            const outDir = path.resolve(opts.outDir as string)
            fs.mkdirSync(outDir, { recursive: true })
            fs.writeFileSync(path.join(outDir, 'node.key'), material.keyPem, { mode: 0o600 })
            fs.writeFileSync(path.join(outDir, 'node.crt'), material.certPem)
            fs.writeFileSync(path.join(outDir, 'node.token'), token, { mode: 0o600 })
            fs.writeFileSync(path.join(outDir, 'node.id'), nodeId)
            console.log(JSON.stringify({ nodeId, fingerprint: material.fingerprint }, null, 2))
        })
    })

/* ---- node-list ---- */

program
    .command('node-list')
    .description('List all provisioned nodes.')
    .requiredOption('--mongo <url>', 'MongoDB connection string')
    .action(async (opts) => {
        await withMongo(opts.mongo as string, async (registry) => {
            const nodes = await registry.list()
            if (nodes.length === 0) {
                console.log('(no nodes)')
                return
            }
            for (const n of nodes) {
                console.log(`${n.nodeId}  ${n.state.padEnd(8)}  ${n.nodeName}`)
            }
        })
    })

/* ---- node-approve ---- */

program
    .command('node-approve <nodeId>')
    .description('Approve a PENDING node (moves it to ACTIVE).')
    .requiredOption('--mongo <url>', 'MongoDB connection string')
    .action(async (nodeId: string, opts) => {
        await withMongo(opts.mongo as string, async (registry) => {
            await registry.approve(nodeId)
            console.log(`approved ${nodeId}`)
        })
    })

/* ---- node-remove ---- */

program
    .command('node-remove <nodeId>')
    .description('Forget a node (hard delete from the registry).')
    .requiredOption('--mongo <url>', 'MongoDB connection string')
    .action(async (nodeId: string, opts) => {
        await withMongo(opts.mongo as string, async (registry) => {
            await registry.forget(nodeId)
            console.log(`removed ${nodeId}`)
        })
    })

program.parseAsync(process.argv).catch((e) => {
    console.error('cmd-hub cli: fatal:', e)
    process.exit(1)
})
