import {
    BaseCommandIdentityWithRequires,
    assertCommandIdentity,
    assertRequires,
} from './identity'
import { defineDecoratorMeta, readDecoratorMeta, makeMetaKey } from './metadata'

const META_KEY = makeMetaKey('CmdService')

/** Zero-arg data-class constructor for the config/params/messages buckets
 *  declared on `@CmdService`. Walked by `buildArgTreeFromClass` to produce
 *  the leaf/branch tree that rides over the wire. */
export type CmdDataClass = new () => object

export interface CmdServiceMeta extends BaseCommandIdentityWithRequires {
    config: CmdDataClass
    params: CmdDataClass
    messages: CmdDataClass
}

function assertServiceMeta(meta: CmdServiceMeta): void {
    assertCommandIdentity(meta, '@CmdService')
    assertRequires(meta.requires, '@CmdService')
    if (!meta.config) throw new Error('@CmdService: config class is required')
    if (!meta.params) throw new Error('@CmdService: params class is required')
    if (!meta.messages) throw new Error('@CmdService: messages class is required')
}

export function CmdService(meta: CmdServiceMeta): ClassDecorator {
    return (target) => {
        assertServiceMeta(meta)
        defineDecoratorMeta(META_KEY, target, meta)
    }
}

export function getCmdServiceMeta(cls: object): CmdServiceMeta | null {
    return readDecoratorMeta<CmdServiceMeta>(META_KEY, cls)
}
