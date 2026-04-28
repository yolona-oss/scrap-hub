/**
 * HubGlobalServiceParam re-decorates `sessionId` and `s` on top of the
 * common base class with a session-id validator. Verify both the child's
 * leaf metadata (validator) and the base class's leaves
 * (`noDashboard`, `noCache`) survive the prototype-chain walk.
 */
import 'reflect-metadata'
import { buildTreeFromClass, walkLeaves, type LeafSpec } from '@cmd-hub/common'
import { HubGlobalServiceParam } from '../hub-service-data'
import { sessionIdValidator } from '../utils/session-id-generator'

function leafMap(): Map<string, LeafSpec> {
    const tree = buildTreeFromClass(HubGlobalServiceParam)
    const out = new Map<string, LeafSpec>()
    for (const { pathKey, leaf } of walkLeaves(tree)) {
        out.set(pathKey, leaf)
    }
    return out
}

describe('HubGlobalServiceParam', () => {
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
