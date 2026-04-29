import {
    BaseCommandIdentityWithRequires,
    assertCommandIdentity,
    assertRequires,
} from './identity'
import { defineDecoratorMeta, readDecoratorMeta, makeMetaKey } from './metadata'
import { buildArgTreeFromClass } from './arg-decorator'

const META_KEY = makeMetaKey('CmdService')

/** Zero-arg data-class constructor for the args/intercom buckets declared
 *  on `@CmdService`. Walked by `buildArgTreeFromClass` to produce the
 *  leaf/branch tree that rides over the wire. */
export type CmdDataClass = new () => object

export interface CmdServiceMeta extends BaseCommandIdentityWithRequires {
    args: CmdDataClass
    intercom: CmdDataClass
}

function assertServiceMeta(meta: CmdServiceMeta): void {
    assertCommandIdentity(meta, '@CmdService')
    assertRequires(meta.requires, '@CmdService')
    if (!meta.args) throw new Error('@CmdService: args class is required')
    if (!meta.intercom) throw new Error('@CmdService: intercom class is required')
}

/** The intercom tree models a flat vocabulary of in-band actions; nested
 *  branches are not meaningful for receiveMsg(msg, args) routing. Reject
 *  any intercom class whose root contains a non-leaf child. */
function assertIntercomFlat(intercomCls: CmdDataClass): void {
    const tree = buildArgTreeFromClass(intercomCls)
    if (tree.node !== 'branch') {
        throw new Error('@CmdService.intercom: class must produce a branch root')
    }
    for (const [name, child] of tree.children) {
        if (child.node !== 'leaf') {
            throw new Error(
                `@CmdService.intercom: nested branch "${name}" is not allowed — intercom is flat by construction`,
            )
        }
    }
}

export function CmdService(meta: CmdServiceMeta): ClassDecorator {
    return (target) => {
        assertServiceMeta(meta)
        assertIntercomFlat(meta.intercom)
        defineDecoratorMeta(META_KEY, target, meta)
    }
}

export function getCmdServiceMeta(cls: object): CmdServiceMeta | null {
    return readDecoratorMeta<CmdServiceMeta>(META_KEY, cls)
}
