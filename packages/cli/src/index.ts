#!/usr/bin/env node
/* eslint-disable no-console */
import 'reflect-metadata'
import { Command, Option } from 'commander'
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
import type {
    StorageBootstrap,
    StorageDriverConfig,
    StorageDriverModule,
} from '@cmd-hub/common'

/**
 * cmd-hub operator CLI. Handles CA setup and node provisioning. Booting
 * an actual `CmdHubApp` is left to deployable apps — that needs to know
 * which middlewares and UIs to install, which is app-specific.
 *
 * The CLI itself depends only on framework interfaces. Concrete storage
 * drivers (`@cmd-hub/storage-mongo`, future `…-postgres`, …) are loaded
 * by package name via `await import()` and must export a
 * `StorageDriverModule` (default export OR a named `*Driver` export).
 */

interface StorageOptions {
    storage: string
    storageConfig?: string
    storageConfigFile?: string
}

const storageOptions = (): Option[] => [
    new Option(
        '--storage <pkg>',
        'storage driver package name; required (or set CMDHUB_STORAGE)',
    ).env('CMDHUB_STORAGE'),
    new Option(
        '--storage-config <json>',
        'driver-specific config as inline JSON',
    ),
    new Option(
        '--storage-config-file <path>',
        'driver-specific config loaded from a JSON file (overrides --storage-config)',
    ),
]

function readStorageConfig(opts: StorageOptions): StorageDriverConfig {
    // File takes precedence so the inline default doesn't shadow an
    // explicit --storage-config-file invocation.
    if (opts.storageConfigFile) {
        const raw = fs.readFileSync(path.resolve(opts.storageConfigFile), 'utf8')
        return parseJson(raw, `--storage-config-file ${opts.storageConfigFile}`)
    }
    if (opts.storageConfig) {
        return parseJson(opts.storageConfig, '--storage-config')
    }
    return {}
}

function parseJson(raw: string, source: string): StorageDriverConfig {
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('expected a JSON object')
        }
        return parsed as StorageDriverConfig
    } catch (e) {
        throw new Error(`cmd-hub cli: ${source} is not valid JSON: ${(e as Error).message}`)
    }
}

async function loadDriver(driverPkg: string): Promise<StorageDriverModule> {
    if (!driverPkg) {
        throw new Error(
            'cmd-hub cli: no storage driver specified. Pass --storage <pkg> or set CMDHUB_STORAGE ' +
            '(e.g. --storage @cmd-hub/storage-mongo).',
        )
    }
    let mod: Record<string, unknown>
    try {
        mod = await import(driverPkg) as Record<string, unknown>
    } catch (e) {
        throw new Error(
            `cmd-hub cli: failed to load storage driver "${driverPkg}". ` +
            `Install it (npm i ${driverPkg}) or pass a different --storage. ` +
            `Underlying error: ${(e as Error).message}`,
        )
    }
    const candidate = (mod.default ?? findDriverExport(mod)) as StorageDriverModule | undefined
    if (!candidate || typeof candidate.bootstrap !== 'function') {
        throw new Error(
            `cmd-hub cli: package "${driverPkg}" does not export a StorageDriverModule. ` +
            'Expected either a default export or a named export with `bootstrap(config)`.',
        )
    }
    return candidate
}

function findDriverExport(mod: Record<string, unknown>): StorageDriverModule | undefined {
    for (const value of Object.values(mod)) {
        if (
            value
            && typeof value === 'object'
            && typeof (value as StorageDriverModule).bootstrap === 'function'
            && typeof (value as StorageDriverModule).driverName === 'string'
        ) {
            return value as StorageDriverModule
        }
    }
    return undefined
}

async function withStorage<T>(
    opts: StorageOptions,
    fn: (boot: StorageBootstrap, registry: CmdNodeRegistry) => Promise<T>,
): Promise<T> {
    const driver = await loadDriver(opts.storage)
    const config = readStorageConfig(opts)
    const boot = await driver.bootstrap(config)
    try {
        const registry = new CmdNodeRegistry({
            tokens: new InternalTokenVerifier(),
            repo: boot.nodeRecord,
        })
        return await fn(boot, registry)
    } finally {
        await boot.connection.disconnect()
    }
}

const program = new Command()
    .name('cmd-hub')
    .description('Operator CLI for the cmd-hub federation')
    .version('0.1.0')

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

const nodeAdd = program
    .command('node-add <name>')
    .description('Provision a new node: signs a cert + issues a token.')
    .requiredOption('--ca-key <path>', 'path to CA private key')
    .requiredOption('--ca-cert <path>', 'path to CA certificate')
    .requiredOption('--out-dir <dir>', 'directory to write the node cert + token')
    .option('--auto-activate', 'mark the node ACTIVE immediately (skip manual approve)', false)
storageOptions().forEach(opt => nodeAdd.addOption(opt))
nodeAdd.action(async (name: string, opts: StorageOptions & {
    caKey: string, caCert: string, outDir: string, autoActivate?: boolean,
}) => {
    const ca = loadCA(opts.caKey, opts.caCert)
    const material = signNodeCert(ca, name)
    await withStorage(opts, async (_boot, registry) => {
        const { nodeId, token } = await registry.provision({
            nodeName: name,
            certFingerprint: material.fingerprint,
            createdVia: 'cli',
            autoActivate: Boolean(opts.autoActivate),
        })
        const outDir = path.resolve(opts.outDir)
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'node.key'), material.keyPem, { mode: 0o600 })
        fs.writeFileSync(path.join(outDir, 'node.crt'), material.certPem)
        fs.writeFileSync(path.join(outDir, 'node.token'), token, { mode: 0o600 })
        fs.writeFileSync(path.join(outDir, 'node.id'), nodeId)
        console.log(JSON.stringify({ nodeId, fingerprint: material.fingerprint }, null, 2))
    })
})

/* ---- node-list ---- */

const nodeList = program
    .command('node-list')
    .description('List all provisioned nodes.')
storageOptions().forEach(opt => nodeList.addOption(opt))
nodeList.action(async (opts: StorageOptions) => {
    await withStorage(opts, async (_boot, registry) => {
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

const nodeApprove = program
    .command('node-approve <nodeId>')
    .description('Approve a PENDING node (moves it to ACTIVE).')
storageOptions().forEach(opt => nodeApprove.addOption(opt))
nodeApprove.action(async (nodeId: string, opts: StorageOptions) => {
    await withStorage(opts, async (_boot, registry) => {
        await registry.approve(nodeId)
        console.log(`approved ${nodeId}`)
    })
})

/* ---- node-remove ---- */

const nodeRemove = program
    .command('node-remove <nodeId>')
    .description('Forget a node (hard delete from the registry).')
storageOptions().forEach(opt => nodeRemove.addOption(opt))
nodeRemove.action(async (nodeId: string, opts: StorageOptions) => {
    await withStorage(opts, async (_boot, registry) => {
        await registry.forget(nodeId)
        console.log(`removed ${nodeId}`)
    })
})

program.parseAsync(process.argv).catch((e: unknown) => {
    console.error('cmd-hub cli: fatal:', (e as Error).message ?? e)
    process.exit(1)
})
