import { z } from 'zod'

const Schema = z.object({
    nodeId: z.string().min(1),
    nodeName: z.string().min(1),
    nodeToken: z.string().min(1),
    hubAddress: z.string().min(1),
    mongoUrl: z.string().min(1),
    listenBindAddress: z.string().default('0.0.0.0:50052'),
    /**
     * Fingerprint the node announces via metadata so the hub (without mTLS
     * in insecure dev deployments) can correlate its identity with the
     * record in CmdNodeRegistry. In production (Phase 2.4 mTLS enabled on
     * the hub) this value is ignored — the resolver reads the peer cert
     * fingerprint directly from the TLS session.
     */
    certFingerprint: z.string().default(''),
})

export type NodeConfig = z.infer<typeof Schema>

export function loadNodeConfig(): NodeConfig {
    return Schema.parse({
        nodeId: process.env.NODE_ID ?? '',
        nodeName: process.env.NODE_NAME ?? 'scraper-node',
        nodeToken: process.env.NODE_TOKEN ?? '',
        hubAddress: process.env.HUB_ADDRESS ?? '',
        mongoUrl: process.env.MONGO_URL ?? '',
        listenBindAddress: process.env.NODE_LISTEN_BIND_ADDRESS ?? '0.0.0.0:50052',
        certFingerprint: process.env.NODE_CERT_FINGERPRINT ?? '',
    })
}
