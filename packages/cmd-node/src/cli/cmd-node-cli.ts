#!/usr/bin/env node
/* eslint-disable no-console */
import { Command } from 'commander'
import { loadNodeConfig } from './config'
import { CMD_NODE_VERSION } from '../index'

const program = new Command()
program
    .name('cmd-node')
    .description('cmd-node CLI — node runtime')
    .version(CMD_NODE_VERSION)

program
    .command('start')
    .description('start the node (reads node.json)')
    .requiredOption('--config <path>', 'path to node.json')
    .action((opts: { config: string }) => {
        const result = loadNodeConfig(opts.config)
        if (!result.ok) {
            console.error(result.error)
            process.exit(1)
        }
        console.log('config ok; gRPC client is attached in Phase 2')
        process.exit(0)
    })

program.parseAsync(process.argv).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
})
