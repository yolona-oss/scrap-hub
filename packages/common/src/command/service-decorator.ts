import 'reflect-metadata'
import type { CapabilityKey } from '../application/capability'

const META_KEY = Symbol.for('cmd-hub.CmdService')

/** Zero-arg data-class constructor for the config/params/messages buckets
 *  declared on `@CmdService`. Instances are mutated by CommandArgumentHolder. */
export type CmdDataClass = new () => object

export interface CmdServiceMeta {
    name: string
    description: string
    compatibilityId: string
    version: string
    config: CmdDataClass
    params: CmdDataClass
    messages: CmdDataClass
    /** Capability keys the service must have available at run time.
     *  Validated at `Application.Initialize()` after middleware install:
     *  if any required cap isn't published, boot fails with a
     *  `CapabilityValidationError` that aggregates every gap across every
     *  registered service. */
    requires?: ReadonlyArray<CapabilityKey<unknown>>
}

function assertMeta(meta: CmdServiceMeta): void {
    if (!meta.name) throw new Error('@CmdService: name is required')
    if (!meta.description) throw new Error('@CmdService: description is required')
    if (!meta.compatibilityId) throw new Error('@CmdService: compatibilityId is required')
    if (!meta.version) throw new Error('@CmdService: version is required')
    if (!meta.config) throw new Error('@CmdService: config class is required')
    if (!meta.params) throw new Error('@CmdService: params class is required')
    if (!meta.messages) throw new Error('@CmdService: messages class is required')
    if (!/^\d+\.\d+\.\d+/.test(meta.version)) {
        throw new Error(`@CmdService: version must be semver, got "${meta.version}"`)
    }
    if (meta.requires !== undefined && !Array.isArray(meta.requires)) {
        throw new Error('@CmdService: `requires` must be an array of capability keys')
    }
}

export function CmdService(meta: CmdServiceMeta): ClassDecorator {
    return (target) => {
        assertMeta(meta)
        Reflect.defineMetadata(META_KEY, meta, target)
    }
}

export function getCmdServiceMeta(cls: object): CmdServiceMeta | null {
    return Reflect.getMetadata(META_KEY, cls) ?? null
}
