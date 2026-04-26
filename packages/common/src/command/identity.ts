import type { CapabilityKey } from '../application/capability'

/** The four fields every commandable thing carries: a name to call it by,
 *  a one-line UI hint, and a compatibility/version pair for pool routing.
 *  `@CmdService`, `@CmdOneShot`, the proto wire format, and the hub
 *  aggregator all extend this so identity drift is impossible. */
export interface BaseCommandIdentity {
    name: string
    description: string
    compatibilityId: string
    version: string
}

export interface BaseCommandIdentityWithRequires extends BaseCommandIdentity {
    /** Capability keys validated at boot. */
    requires?: ReadonlyArray<CapabilityKey<unknown>>
}

const SEMVER_RE = /^\d+\.\d+\.\d+/

/** Throws on missing/malformed identity fields. The `decoratorName`
 *  prefix is used in the error message ("@CmdService: name is required")
 *  so each caller's diagnostics stay specific. */
export function assertCommandIdentity(meta: BaseCommandIdentity, decoratorName: string): void {
    if (!meta.name) throw new Error(`${decoratorName}: name is required`)
    if (!meta.description) throw new Error(`${decoratorName}: description is required`)
    if (!meta.compatibilityId) throw new Error(`${decoratorName}: compatibilityId is required`)
    if (!meta.version) throw new Error(`${decoratorName}: version is required`)
    if (!SEMVER_RE.test(meta.version)) {
        throw new Error(`${decoratorName}: version must be semver, got "${meta.version}"`)
    }
}

export function assertRequires(requires: unknown, decoratorName: string): void {
    if (requires !== undefined && !Array.isArray(requires)) {
        throw new Error(`${decoratorName}: \`requires\` must be an array of capability keys`)
    }
}
