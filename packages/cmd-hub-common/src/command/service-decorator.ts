import 'reflect-metadata'

const META_KEY = Symbol.for('cmd-hub.CmdService')

export interface CmdServiceMeta {
    name: string
    description: string
    compatibilityId: string
    version: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: new (...args: any[]) => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: new (...args: any[]) => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: new (...args: any[]) => any
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
}

export function CmdService(meta: CmdServiceMeta): ClassDecorator {
    return (target) => {
        assertMeta(meta)
        Reflect.defineMetadata(META_KEY, meta, target)
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCmdServiceMeta(cls: any): CmdServiceMeta | null {
    return Reflect.getMetadata(META_KEY, cls) ?? null
}
