/**
 * HubGlobalServiceArgs re-decorates `sessionId` and `s` on top of the
 * common base class with a session-id validator. Verify both the child's
 * leaf metadata (validator) and the base class's leaves
 * (`noDashboard`, `noCache`) survive the prototype-chain walk.
 */
import 'reflect-metadata'
import { buildArgTreeFromClass, walkArgLeaves, type ArgLeaf } from '@cmd-hub/common'
import { HubGlobalServiceArgs } from '../hub-service-data'
import { sessionIdValidator } from '../utils/session-id-generator'

function leafMap(): Map<string, ArgLeaf> {
    const tree = buildArgTreeFromClass(HubGlobalServiceArgs)
    const out = new Map<string, ArgLeaf>()
    for (const { pathKey, leaf } of walkArgLeaves(tree)) {
        out.set(pathKey, leaf)
    }
    return out
}

describe('HubGlobalServiceArgs', () => {
    it('attaches sessionIdValidator to sessionId and s', () => {
        const leaves = leafMap()
        expect(leaves.get('sessionId')?.validator).toBe(sessionIdValidator)
        expect(leaves.get('s')?.validator).toBe(sessionIdValidator)
    })

    it('preserves the base class decoration for noDashboard', () => {
        const leaves = leafMap()
        const noDashboard = leaves.get('noDashboard')
        expect(noDashboard).toBeDefined()
        expect(noDashboard!.standalone).toBe(true)
        expect(noDashboard!.required).toBe(false)
    })
})
