import {
    argBranch,
    argLeaf,
    flattenArgs,
    unflattenArgs,
    argNodeAtPath,
    walkArgLeaves,
    type ParsedFromArgTree,
    type ArgLeaf,
    type ArgBranch,
} from '../tree'

const aiAgent = argBranch({
    model: argLeaf({ type: 'string', choices: ['gpt-4o', 'qwen2.5:7b'] }),
    temperature: argLeaf({ type: 'number', default: '0.5' }),
})

const root = argBranch({
    query: argLeaf({ type: 'string', required: true, position: 1 }),
    aiAgent,
    enabled: argLeaf({ type: 'bool' }),
})

describe('tree primitive', () => {
    test('argLeaf() and argBranch() set sane defaults', () => {
        const l = argLeaf()
        expect(l.node).toBe('leaf')
        expect(l.type).toBe('string')
        expect(l.required).toBe(false)
        expect(l.position).toBe(0)
        expect(l.choices).toEqual([])
        expect(l.persistent).toBe(false)

        const b = argBranch({ x: argLeaf() })
        expect(b.node).toBe('branch')
        expect(b.children.size).toBe(1)
        expect(b.children.get('x')?.node).toBe('leaf')
    })

    test('walkArgLeaves yields a [path, leaf] entry per leaf, no entries for branches', () => {
        const got = [...walkArgLeaves(root)]
        expect(got.map(g => g.pathKey).sort()).toEqual([
            'aiAgent/model',
            'aiAgent/temperature',
            'enabled',
            'query',
        ])
    })

    test('flattenArgs → unflattenArgs round-trips with type coercion', () => {
        const original = {
            query: 'dentists moscow',
            aiAgent: { model: 'gpt-4o', temperature: 0.7 },
            enabled: true,
        }
        const flat = flattenArgs(root, original)
        expect(flat.get('query')).toBe('dentists moscow')
        expect(flat.get('aiAgent/model')).toBe('gpt-4o')
        expect(flat.get('aiAgent/temperature')).toBe('0.7')
        expect(flat.get('enabled')).toBe('true')

        const restored = unflattenArgs(root, flat) as typeof original
        expect(restored).toEqual(original)
        // Type coercion is per-leaf — number stays number, bool stays bool.
        expect(typeof restored.aiAgent.temperature).toBe('number')
        expect(typeof restored.enabled).toBe('boolean')
    })

    test('flattenArgs skips undefined leaves; unflattenArgs omits absent keys', () => {
        const flat = flattenArgs(root, { query: 'q' })
        expect([...flat.keys()]).toEqual(['query'])
        const restored = unflattenArgs(root, flat) as { query: string; aiAgent?: object }
        expect(restored.query).toBe('q')
        expect(restored.aiAgent).toBeUndefined()
    })

    test('unflattenArgs throws TypeError on non-coercible numbers', () => {
        const flat = new Map([['aiAgent/temperature', 'not-a-number']])
        expect(() => unflattenArgs(root, flat)).toThrow(TypeError)
    })

    test('unflattenArgs throws TypeError on non-coercible booleans', () => {
        const flat = new Map([['enabled', 'maybe']])
        expect(() => unflattenArgs(root, flat)).toThrow(TypeError)
    })

    test('argNodeAtPath walks branches, returns undefined for unknown segments', () => {
        expect(argNodeAtPath(root, [])).toBe(root)
        expect(argNodeAtPath(root, ['query'])?.node).toBe('leaf')
        expect(argNodeAtPath(root, ['aiAgent'])?.node).toBe('branch')
        expect(argNodeAtPath(root, ['aiAgent', 'model'])?.node).toBe('leaf')
        expect(argNodeAtPath(root, ['aiAgent', 'nonexistent'])).toBeUndefined()
        expect(argNodeAtPath(root, ['query', 'cantDrillIntoLeaf'])).toBeUndefined()
    })

    test('children iteration preserves declaration order', () => {
        const ordered = argBranch({ first: argLeaf(), second: argLeaf(), third: argLeaf() })
        expect([...ordered.children.keys()]).toEqual(['first', 'second', 'third'])
    })

    test('ParsedFromArgTree infers nested object shape', () => {
        // Compile-only check: this would not type-check if the inference broke.
        type Parsed = ParsedFromArgTree<typeof root>
        const sample: Parsed = {
            query: 'q',
            aiAgent: { model: 'gpt-4o', temperature: 0.7 },
            enabled: true,
        }
        // Use it so TS doesn't complain about an unused binding.
        expect(sample.query).toBe('q')
    })

    test('ArgLeaf and ArgBranch discriminator narrows correctly', () => {
        const node: ArgLeaf | ArgBranch = argLeaf()
        if (node.node === 'leaf') {
            // Should narrow to ArgLeaf — accessing leaf-only fields here.
            expect(node.type).toBe('string')
        }
    })

    test('argLeaf persistent defaults to false', () => {
        expect(argLeaf().persistent).toBe(false)
        expect(argLeaf({ persistent: true }).persistent).toBe(true)
    })
})
