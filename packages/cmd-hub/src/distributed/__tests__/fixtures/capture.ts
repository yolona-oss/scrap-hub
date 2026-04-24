/* eslint-disable no-console */
import * as fs from 'fs'
import * as path from 'path'
import { runGoldenScraper } from './golden-harness'

async function main() {
    const result = await runGoldenScraper({ count: 50 })
    const dir = __dirname
    fs.writeFileSync(
        path.join(dir, 'expected-events.json'),
        JSON.stringify(result.events, null, 2),
    )
    fs.writeFileSync(path.join(dir, 'expected.csv'), result.csvBytes)
    console.log(`captured ${result.events.length} events, ${result.csvBytes.length} csv bytes`)
}

main().catch((e) => { console.error(e); process.exit(1) })
