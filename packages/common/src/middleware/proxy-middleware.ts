import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    AppLike,
    readConfigSlice,
} from '../application/middleware-types'
import { Phase } from '../application/phase'
import log from '../application/logger'
import { CAP_HttpAgent } from './capabilities'

/** Minimal shape of `require` usable without TS yelling about implicit `any`. */
type LocalRequire = (id: string) => unknown
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireLocal: LocalRequire = require

/** Peer shape: both socks-proxy-agent and https-proxy-agent ship a default
 *  export plus a named constructor. Using a structural minimum avoids pulling
 *  either package's types into @cmd-hub/common. */
interface AgentModule {
    SocksProxyAgent?: new (url: string) => unknown
    HttpsProxyAgent?: new (url: string) => unknown
}

/**
 * Publishes an HTTP(S)/SOCKS proxy agent at CAP_HttpAgent based on the
 * `proxy.socks` / `proxy.https` config fields. Production consumers need
 * to install the relevant agent package (socks-proxy-agent or
 * https-proxy-agent).
 *
 * When both `socks` and `https` are set, SOCKS wins and a warning is
 * logged — downstream code with fallback expectations should pick one.
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
        const cfg = readConfigSlice(app, this)

        if (cfg.socks && cfg.https) {
            log.warn('ProxyMiddleware: both proxy.socks and proxy.https set; using SOCKS')
        }

        if (cfg.socks) {
            const mod = requireLocal('socks-proxy-agent') as AgentModule
            if (!mod.SocksProxyAgent) {
                throw new Error(
                    'ProxyMiddleware: socks-proxy-agent does not export SocksProxyAgent',
                )
            }
            app.provide(CAP_HttpAgent, new mod.SocksProxyAgent(cfg.socks))
        } else if (cfg.https) {
            const mod = requireLocal('https-proxy-agent') as AgentModule
            if (!mod.HttpsProxyAgent) {
                throw new Error(
                    'ProxyMiddleware: https-proxy-agent does not export HttpsProxyAgent',
                )
            }
            app.provide(CAP_HttpAgent, new mod.HttpsProxyAgent(cfg.https))
        }
    }

    uninstall(app: AppLike): void {
        app.revoke(CAP_HttpAgent)
    }
}
