import {
    branch,
    leaf,
    flattenValue,
    unflattenValue,
    nodeAtPath,
    walkLeaves,
    type ParsedFromTree,
    type LeafSpec,
    type BranchSpec,
} from '../tree'

const aiAgent = branch({
    model: leaf({ type: 'string', options: ['gpt-4o', 'qwen2.5:7b'] }),
    temperature: leaf({ type: 'number', default: '0.5' }),
})

const root = branch({
    query: leaf({ type: 'string', required: true, position: 1 }),
    aiAgent,
    enabled: leaf({ type: 'bool' }),
})

describe('tree primitive', () => {
    test('leaf() and branch() set sane defaults', () => {
        const l = leaf()
        expect(l.node).toBe('leaf')
        expect(l.type).toBe('string')
        expect(l.required).toBe(false)
        expect(l.position).toBe(0)
        expect(l.options).toEqual([])

        const b = branch({ x: leaf() })
        expect(b.node).toBe('branch')
        expect(b.children.size).toBe(1)
        expect(b.children.get('x')?.node).toBe('leaf')
    })

    test('walkLeaves yields a [path, leaf] entry per leaf, no entries for branches', () => {
        const got = [...walkLeaves(root)]
        expect(got.map(g => g.pathKey).sort()).toEqual([
            'aiAgent/model',
            'aiAgent/temperature',
            'enabled',
            'query',
        ])
    })

    test('flattenValue → unflattenValue round-trips with type coercion', () => {
        const original = {
            query: 'dentists moscow',
            aiAgent: { model: 'gpt-4o', temperature: 0.7 },
            enabled: true,
        }
        const flat = flattenValue(root, original)
        expect(flat.get('query')).toBe('dentists moscow')
        expect(flat.get('aiAgent/model')).toBe('gpt-4o')
        expect(flat.get('aiAgent/temperature')).toBe('0.7')
        expect(flat.get('enabled')).toBe('true')

        const restored = unflattenValue(root, flat) as typeof original
        expect(restored).toEqual(original)
        // Type coercion is per-leaf — number stays number, bool stays bool.
        expect(typeof restored.aiAgent.temperature).toBe('number')
        expect(typeof restored.enabled).toBe('boolean')
    })

    test('flatten skips undefined leaves; unflatten omits absent keys', () => {
        const flat = flattenValue(root, { query: 'q' })
        expect([...flat.keys()]).toEqual(['query'])
        const restored = unflattenValue(root, flat) as { query: string; aiAgent?: object }
        expect(restored.query).toBe('q')
        expect(restored.aiAgent).toBeUndefined()
    })

    test('unflatten throws TypeError on non-coercible numbers', () => {
        const flat = new Map([['aiAgent/temperature', 'not-a-number']])
        expect(() => unflattenValue(root, flat)).toThrow(TypeError)
    })

    test('unflatten throws TypeError on non-coercible booleans', () => {
        const flat = new Map([['enabled', 'maybe']])
        expect(() => unflattenValue(root, flat)).toThrow(TypeError)
    })

    test('nodeAtPath walks branches, returns undefined for unknown segments', () => {
        expect(nodeAtPath(root, [])).toBe(root)
        expect(nodeAtPath(root, ['query'])?.node).toBe('leaf')
        expect(nodeAtPath(root, ['aiAgent'])?.node).toBe('branch')
        expect(nodeAtPath(root, ['aiAgent', 'model'])?.node).toBe('leaf')
        expect(nodeAtPath(root, ['aiAgent', 'nonexistent'])).toBeUndefined()
        expect(nodeAtPath(root, ['query', 'cantDrillIntoLeaf'])).toBeUndefined()
    })

    test('children iteration preserves declaration order', () => {
        const ordered = branch({ first: leaf(), second: leaf(), third: leaf() })
        expect([...ordered.children.keys()]).toEqual(['first', 'second', 'third'])
    })

    test('ParsedFromTree infers nested object shape', () => {
        // Compile-only check: this would not type-check if the inference broke.
        type Parsed = ParsedFromTree<typeof root>
        const sample: Parsed = {
            query: 'q',
            aiAgent: { model: 'gpt-4o', temperature: 0.7 },
            enabled: true,
        }
        // Use it so TS doesn't complain about an unused binding.
        expect(sample.query).toBe('q')
    })

    test('LeafSpec and BranchSpec discriminator narrows correctly', () => {
        const node: LeafSpec | BranchSpec = leaf()
        if (node.node === 'leaf') {
            // Should narrow to LeafSpec — accessing leaf-only fields here.
            expect(node.type).toBe('string')
        }
    })
})
