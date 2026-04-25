import {
    Phase,
    log,
    type IAppMiddleware,
    type AppLike,
    type CapabilityKey,
} from '@cmd-hub/common'
import {
    CAP_FederationRequires,
    type FederationRequiresPayload,
} from '../capabilities'

export interface FederationCapsMiddlewareOptions {
    /** Cap keys every routed-to cmd-node MUST publish. Validated at install
     *  time against `app.has(key)` — throws on any missing key, naming each. */
    essential: ReadonlyArray<CapabilityKey<unknown>>
    /** Optional explicit override for the supported list. Default behaviour
     *  is "every cap registered on the app at install time, minus essentials".
     *  Override when the auto-fill is too noisy or includes hub-only caps no
     *  cmd-node would ever publish. */
    supported?: ReadonlyArray<CapabilityKey<unknown>>
}

export type { FederationRequiresPayload } from '../capabilities'

/**
 * App-level federation-requirements declaration with cross-reference validation.
 *
 * Runs at `Phase.BeforeServices` (= 39) — after Storage and Transport phases
 * have published their caps but before Services-phase middlewares (e.g.
 * HubClient) start consuming them. Caps from Services phase or later are
 * NOT visible here; if they need to appear in `supported`, pass an explicit
 * `supported` list.
 *
 * Publishes `CAP_FederationRequires` for `CmdHubApp.run()` to consume and
 * merge with each UI's per-UI `federationRequires`.
 */
export class FederationCapsMiddleware implements IAppMiddleware {
    readonly name = 'FederationCapsMiddleware'
    readonly phase = Phase.BeforeServices

    constructor(private readonly opts: FederationCapsMiddlewareOptions) {
        if (!opts || !Array.isArray(opts.essential)) {
            throw new Error('FederationCapsMiddleware: opts.essential must be an array of CapabilityKey')
        }
    }

    async install(app: AppLike): Promise<void> {
        const essential = [...this.opts.essential]
        const missing = essential.filter(k => !app.has(k))
        if (missing.length > 0) {
            throw new Error(
                `FederationCapsMiddleware: essential capability(ies) not registered: ` +
                `[${missing.map(k => `"${k}"`).join(', ')}]. ` +
                `Verify the providing middleware is installed in an earlier phase ` +
                `(Infrastructure/Storage/Transport).`,
            )
        }

        const essentialSet = new Set<string>(essential.map(k => k as string))
        const supported: CapabilityKey<unknown>[] = this.opts.supported
            ? [...this.opts.supported]
            : (app.manifestSnapshot().capabilities
                .map(c => c.key)
                .filter(k => !essentialSet.has(k)) as CapabilityKey<unknown>[])

        const payload: FederationRequiresPayload = {
            essential: Object.freeze(essential),
            supported: Object.freeze(supported),
        }
        app.provide(CAP_FederationRequires, payload, this.name)
        log.info(
            `FederationCapsMiddleware: published CAP_FederationRequires ` +
            `(essential=${essential.length}, supported=${supported.length})`,
        )
    }

    async uninstall(app: AppLike): Promise<void> {
        app.revoke(CAP_FederationRequires)
    }
}
