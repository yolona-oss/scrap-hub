import 'reflect-metadata'
import { argBranch, argLeaf } from '@cmd-hub/common'
import { findPersistentLeafByDotPath, filterPersistentArgs } from '../sargs-cmd'

describe('sargs render filter', () => {
    const tree = argBranch({
        kept: argLeaf({ persistent: true, description: 'persistent' }),
        tmp: argLeaf({ description: 'ephemeral' }),
        nested: argBranch({
            inner: argLeaf({ persistent: true, description: 'nested persistent' }),
            innerTmp: argLeaf({ description: 'nested ephemeral' }),
        }),
    })

    it('finds a persistent leaf by dot-path', () => {
        expect(findPersistentLeafByDotPath(tree, 'kept')).toBeDefined()
        expect(findPersistentLeafByDotPath(tree, 'kept')!.persistent).toBe(true)
        expect(findPersistentLeafByDotPath(tree, 'nested.inner')).toBeDefined()
    })

    it('returns undefined for ephemeral or unknown leaves', () => {
        expect(findPersistentLeafByDotPath(tree, 'tmp')).toBeUndefined()
        expect(findPersistentLeafByDotPath(tree, 'nested.innerTmp')).toBeUndefined()
        expect(findPersistentLeafByDotPath(tree, 'nope')).toBeUndefined()
    })

    it('filterPersistentArgs drops ephemeral and unknown keys', () => {
        const persisted = {
            kept: 'k1',
            tmp: 'leaked',
            unknown: 'orphan',
            nested: {
                inner: 'i1',
                innerTmp: 'also leaked',
            },
        }
        const filtered = filterPersistentArgs(tree, persisted)
        expect(filtered).toEqual({
            kept: 'k1',
            nested: { inner: 'i1' },
        })
    })

    it('filterPersistentArgs handles missing nested objects gracefully', () => {
        expect(filterPersistentArgs(tree, {})).toEqual({})
        expect(filterPersistentArgs(tree, { nested: {} })).toEqual({})
        expect(filterPersistentArgs(tree, { kept: 'k' })).toEqual({ kept: 'k' })
    })
})
