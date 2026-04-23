#!/usr/bin/env node
/* eslint-disable no-console */
import { Command } from 'commander'
import * as fs from 'fs'
import { randomBytes } from 'crypto'
import mongoose from 'mongoose'
import { CmdNodeRegistry } from '../distributed/registry/cmd-node-registry'
import { NodeRecordModel } from '../distributed/db/node-record.model'
import { InternalTokenVerifier } from '../distributed/auth/internal-token-verifier'
import { createCA, loadCA, signNodeCert, writeCA } from './ca'

const program = new Command()
program
    .name('cmd-hub')
    .description('cmd-hub CLI — gateway operations')
    .version('0.0.1')

function readEnv(name: string): string {
    const v = process.env[name]
    if (!v) {
        console.error(`missing required env var: ${name}`)
        process.exit(2)
    }
    return v
}

async function withRegistry<T>(fn: (reg: CmdNodeRegistry) => Promise<T>): Promise<T> {
    const mongoUrl = readEnv('MONGO_URL')
    await mongoose.connect(mongoUrl)
    try {
        const tokens = new InternalTokenVerifier()
        const reg = new CmdNodeRegistry({ tokens })
        return await fn(reg)
    } finally {
        await mongoose.disconnect()
    }
}

program
    .command('start')
    .description('start the gateway runtime (Phase 2 wires full gRPC; v1 exits with a notice)')
    .action(() => {
        console.error('cmd-hub start: gRPC server is attached in Phase 2. See CmdHubApp for programmatic use today.')
        process.exit(1)
    })

program
    .command('ca-init')
    .description('generate a fresh CA at $HUB_CA_KEY / $HUB_CA_CERT')
    .option('--cn <name>', 'Common Name for the CA subject', 'cmd-hub-ca')
    .option('--force', 'overwrite existing CA files', false)
    .action((opts: { cn: string; force: boolean }) => {
        const keyPath = readEnv('HUB_CA_KEY')
        const certPath = readEnv('HUB_CA_CERT')
        if (!opts.force && (fs.existsSync(keyPath) || fs.existsSync(certPath))) {
            console.error(`CA files already exist. Pass --force to overwrite.`)
            process.exit(1)
        }
        const ca = createCA(opts.cn)
        writeCA(ca, keyPath, certPath)
        console.log(`wrote CA key to ${keyPath}`)
        console.log(`wrote CA cert to ${certPath}`)
    })

program
    .command('ca-export-cert')
    .description('print the CA cert (for node trust stores)')
    .action(() => {
        const certPath = readEnv('HUB_CA_CERT')
        process.stdout.write(fs.readFileSync(certPath, 'utf8'))
    })

program
    .command('node-add <name>')
    .description('provision a new node; prints {nodeId, token, cert, key, hubCaCert} as JSON')
    .option('--auto-activate', 'mark the node ACTIVE immediately (skip /node approve)', false)
    .action(async (name: string, opts: { autoActivate: boolean }) => {
        const caKey = readEnv('HUB_CA_KEY')
        const caCert = readEnv('HUB_CA_CERT')
        const ca = loadCA(caKey, caCert)

        await withRegistry(async (reg) => {
            // Generate key+cert first — we need the fingerprint before provisioning.
            // Provisioning happens with a placeholder nodeId for CN, then rewrite
            // after we know the actual id. Simpler: provision first with a temp
            // fingerprint, then sign, then update. To avoid the two-step, we flip
            // the order: pick the nodeId ourselves by delegating to provision, then
            // sign using that id as CN, then patch the fingerprint.
            //
            // Registry exposes no patch. Simplest correct flow: provision with an
            // empty fingerprint placeholder, sign using the returned nodeId, then
            // update the record via a direct Mongo updateOne before returning.
            const provisioned = await reg.provision({
                nodeName: name,
                certFingerprint: 'PENDING',
                createdVia: 'cli',
                autoActivate: opts.autoActivate,
            })
            const node = signNodeCert(ca, provisioned.nodeId)

            // Patch the real fingerprint in. We go through the mongoose model
            // directly rather than widening the registry's public surface.
            await NodeRecordModel.updateOne(
                { nodeId: provisioned.nodeId },
                { $set: { certFingerprint: node.fingerprint } },
            )

            const out = {
                nodeId: provisioned.nodeId,
                token:  provisioned.token,
                cert:   node.certPem,
                key:    node.keyPem,
                hubCaCert: ca.certPem,
            }
            console.log(JSON.stringify(out, null, 2))
        })
    })

program
    .command('node-rotate-token <id>')
    .description('rotate a node\'s token; prints the new raw token')
    .action(async (id: string) => {
        await withRegistry(async (reg) => {
            const existing = await reg.get(id)
            if (!existing) {
                console.error(`no such node: ${id}`)
                process.exit(1)
            }
            const tokens = new InternalTokenVerifier()
            const newToken = randomBytes(32).toString('hex')
            const newHash = await tokens.hash(newToken)
            await NodeRecordModel.updateOne({ nodeId: id }, { $set: { tokenHash: newHash } })
            console.log(newToken)
        })
    })

program
    .command('node-list')
    .description('list every registered node')
    .action(async () => {
        await withRegistry(async (reg) => {
            const rows = await reg.list()
            if (rows.length === 0) {
                console.log('(no nodes registered)')
                return
            }
            for (const r of rows) {
                console.log([
                    r.nodeId, r.state, r.nodeName,
                    `last-seen=${r.lastSeen ?? 'never'}`,
                    `via=${r.createdVia}`,
                ].join('\t'))
            }
        })
    })

program
    .command('node-remove <id>')
    .description('permanently delete a node record from the allowlist')
    .action(async (id: string) => {
        await withRegistry(async (reg) => {
            await reg.forget(id)
            console.log(`forgot ${id}`)
        })
    })

program.parseAsync(process.argv).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
})
