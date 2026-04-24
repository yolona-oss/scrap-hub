import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, AppLike } from '../application/middleware-types'
import { Phase } from '../application/phase'
import log from '../application/logger'

// Lazy-require to avoid loading agent modules unless a proxy is configured.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireLocal = require as (id: string) => unknown

/**
 * Populates `app.context.httpAgent` with a SOCKS/HTTPS proxy agent based on
 * the `proxy.socks` / `proxy.https` config fields. Production consumers need
 * to install the relevant agent package (socks-proxy-agent or https-proxy-agent).
 *
 * When both `socks` and `https` are set, SOCKS wins and a warning is logged —
 * downstream code with fallback expectations should pick one.
 */
export class ProxyMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'ProxyMiddleware'
    readonly phase = Phase.Infrastructure
    readonly namespace = 'proxy'
    readonly schema = z.object({
        socks: z.string().nullable().default(null),
        https: z.string().nullable().default(null),
    })

    install(app: AppLike): void {
        const cfg = (app.config as { proxy: { socks: string | null; https: string | null } }).proxy

        if (cfg.socks && cfg.https) {
            log.warn('ProxyMiddleware: both proxy.socks and proxy.https set; using SOCKS')
        }

        if (cfg.socks) {
            const { SocksProxyAgent } = requireLocal('socks-proxy-agent') as {
                SocksProxyAgent: new (url: string) => unknown
            }
            app.context.httpAgent = new SocksProxyAgent(cfg.socks)
        } else if (cfg.https) {
            const { HttpsProxyAgent } = requireLocal('https-proxy-agent') as {
                HttpsProxyAgent: new (url: string) => unknown
            }
            app.context.httpAgent = new HttpsProxyAgent(cfg.https)
        }
    }
}
