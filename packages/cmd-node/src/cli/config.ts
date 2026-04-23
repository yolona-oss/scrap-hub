import * as fs from 'fs'
import { z } from 'zod'

export const NodeConfigSchema = z.object({
    node: z.object({
        id: z.string().min(1, 'node.id is required'),
        token: z.string().min(1, 'node.token is required'),
        certPath: z.string().min(1, 'node.certPath is required'),
        keyPath: z.string().min(1, 'node.keyPath is required'),
    }),
    hub: z.object({
        address: z.string().min(1, 'hub.address is required'),
        caCertPath: z.string().min(1, 'hub.caCertPath is required'),
    }),
    mongo: z.object({
        url: z.string().min(1, 'mongo.url is required'),
    }),
})

export type NodeConfig = z.infer<typeof NodeConfigSchema>

export type LoadResult =
    | { ok: true;  config: NodeConfig }
    | { ok: false; error: string }

export function loadNodeConfig(pathToJson: string): LoadResult {
    let raw: string
    try {
        raw = fs.readFileSync(pathToJson, 'utf8')
    } catch (e) {
        return { ok: false, error: `cannot read config: ${(e as Error).message}` }
    }
    let json: unknown
    try {
        json = JSON.parse(raw)
    } catch (e) {
        return { ok: false, error: `invalid JSON in config: ${(e as Error).message}` }
    }
    const parsed = NodeConfigSchema.safeParse(json)
    if (!parsed.success) {
        const first = parsed.error.issues[0]
        const path = first.path.join('.')
        return { ok: false, error: `config validation failed: ${path}: ${first.message}` }
    }
    // Check cert files exist and are readable.
    for (const p of [parsed.data.node.certPath, parsed.data.node.keyPath, parsed.data.hub.caCertPath]) {
        if (!fs.existsSync(p)) {
            return { ok: false, error: `cert file not found: ${p}` }
        }
    }
    return { ok: true, config: parsed.data }
}
