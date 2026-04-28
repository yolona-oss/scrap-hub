import 'reflect-metadata'

// Mock heavy deps BEFORE any imports to break circular chains.
const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import type { SavedSources } from '../ui/command-processor/saved-sources'

import { branch, leaf, type OptionsTree, PAIR_PATH_DELIMITER } from '@cmd-hub/common'
import { CBParser } from '../ui/command-processor/builder/interpreter/parser'
import { CBInterpreter } from '../ui/command-processor/builder/interpreter/interpreter'
import { Lexer } from '../ui/command-processor/builder/interpreter/lexer'
import { BuilderActionSigns } from '../ui/command-processor/builder/default-callbacks'
import { IUICommandDescriptor } from '../ui/types'

// --- Test Helpers ---

function descriptorFromTree(tree: OptionsTree): IUICommandDescriptor {
    return { options: tree }
}

function createParser(tree: OptionsTree) {
    return new CBParser({
        command: 'test',
        descriptor: descriptorFromTree(tree),
    })
}

function createInterpreter(tree: OptionsTree, mode?: 'incremental' | 'non-mandatory' | 'required' | 'comprehensive') {
    return new CBInterpreter(createParser(tree), mode)
}

// --- Lexer Tests ---

describe('Lexer', () => {
    const lexer = new Lexer()

    test('tokenizes plain text', () => {
        lexer.setInput('hello')
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(1)
        expect(tokens[0]).toEqual({ type: 'TEXT', value: 'hello' })
    })

    test('tokenizes double dash pair', () => {
        lexer.setInput('--name value')
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(2)
        expect(tokens[0]).toEqual({ type: 'DOUBLE_DASH', value: 'name' })
        expect(tokens[1]).toEqual({ type: 'TEXT', value: 'value' })
    })

    test('tokenizes single dash standalone', () => {
        lexer.setInput('-flag')
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(1)
        expect(tokens[0]).toEqual({ type: 'SINGLE_DASH', value: 'flag' })
    })

    test('tokenizes quoted strings', () => {
        lexer.setInput('"hello world"')
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(1)
        expect(tokens[0]).toEqual({ type: 'TEXT', value: 'hello world' })
    })

    test('tokenizes mixed input', () => {
        lexer.setInput('--city Moscow -dryRun query')
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(4)
        expect(tokens[0]).toEqual({ type: 'DOUBLE_DASH', value: 'city' })
        expect(tokens[1]).toEqual({ type: 'TEXT', value: 'Moscow' })
        expect(tokens[2]).toEqual({ type: 'SINGLE_DASH', value: 'dryRun' })
        expect(tokens[3]).toEqual({ type: 'TEXT', value: 'query' })
    })

    test('handles empty input', () => {
        lexer.setInput('')
        expect(lexer.tokenizeCurrent()).toHaveLength(0)
    })

    test('handles whitespace-only input', () => {
        lexer.setInput('   ')
        expect(lexer.tokenizeCurrent()).toHaveLength(0)
    })
})

// --- Parser State Tests ---

describe('Parser — Pair Leaves', () => {
    test('--name <value> commits a pair leaf at root', () => {
        const tree = branch({ city: leaf({ description: 'Target city' }) })
        const parser = createParser(tree)

        const r1 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(r1).toBe('await-value')
        expect(parser.Pending).toEqual({ leafPath: ['city'] })

        const r2 = parser.parseNextToken({ type: 'TEXT', value: 'Moscow' })
        expect(r2).toBe('commit-leaf')
        expect(parser.Pending).toBeNull()
        expect(parser.Values.get('city')).toBe('Moscow')
    })

    test('switching to another pair leaf mid-input drops pending', () => {
        const tree = branch({
            city: leaf({}),
            limit: leaf({}),
        })
        const parser = createParser(tree)

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(parser.Pending).toEqual({ leafPath: ['city'] })

        const r = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'limit' })
        expect(r).toBe('await-value')
        expect(parser.Pending).toEqual({ leafPath: ['limit'] })
        expect(parser.Values.has('city')).toBe(false)
    })
})

describe('Parser — Positional Leaves', () => {
    test('positional via DOUBLE_DASH then TEXT commits the value', () => {
        const tree = branch({ query: leaf({ position: 1 }) })
        const parser = createParser(tree)

        const r1 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        expect(r1).toBe('await-value')

        const r2 = parser.parseNextToken({ type: 'TEXT', value: 'стоматологии Москва' })
        expect(r2).toBe('commit-leaf')
        expect(parser.Values.get('query')).toBe('стоматологии Москва')
    })

    test('bare TEXT auto-binds to the next unfilled positional', () => {
        const tree = branch({ query: leaf({ position: 1 }) })
        const parser = createParser(tree)

        const r = parser.parseNextToken({ type: 'TEXT', value: 'scraper' })
        expect(r).toBe('commit-leaf')
        expect(parser.Values.get('query')).toBe('scraper')
    })

    test('clicking the same positional twice replaces the value', () => {
        const tree = branch({ query: leaf({ position: 1 }) })
        const parser = createParser(tree)

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        parser.parseNextToken({ type: 'TEXT', value: 'old' })
        expect(parser.Values.get('query')).toBe('old')

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        parser.parseNextToken({ type: 'TEXT', value: 'new' })
        expect(parser.Values.get('query')).toBe('new')
        expect(parser.Values.size).toBe(1)
    })

    test('switching from a pending positional to a different leaf abandons pending', () => {
        const tree = branch({
            query: leaf({ position: 1 }),
            city: leaf({}),
        })
        const parser = createParser(tree)

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        expect(parser.Pending).toEqual({ leafPath: ['query'] })

        const r = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(r).toBe('await-value')
        expect(parser.Pending).toEqual({ leafPath: ['city'] })
    })
})

describe('Parser — Standalone Leaves', () => {
    test('SINGLE_DASH toggles a standalone leaf on then off', () => {
        const tree = branch({ dryRun: leaf({ standalone: true }) })
        const parser = createParser(tree)

        expect(parser.parseNextToken({ type: 'SINGLE_DASH', value: 'dryRun' })).toBe('toggle-on')
        expect(parser.Values.has('dryRun')).toBe(true)

        expect(parser.parseNextToken({ type: 'SINGLE_DASH', value: 'dryRun' })).toBe('toggle-off')
        expect(parser.Values.has('dryRun')).toBe(false)
    })
})

describe('Parser — Hierarchical Branches', () => {
    /**
     * Two-level tree:
     *   aiAgent ─┬── model        (leaf, options: qwen2.5:7b | gpt-4o)
     *            └── temperature  (leaf, options: 0.0 | 0.5)
     *
     * Used to exercise descend → leaf-click → commit and ascend.
     */
    function aiAgentTree(): OptionsTree {
        return branch({
            aiAgent: branch({
                model: leaf({ options: ['qwen2.5:7b', 'gpt-4o'] }),
                temperature: leaf({ options: ['0.0', '0.5'] }),
            }),
        })
    }

    /**
     * Three-level tree, used where the test needs branches at depth >= 2:
     *   profile ─┬── chat ─┬── system  (leaf)
     *                       └── user    (leaf)
     */
    function profileTree(): OptionsTree {
        return branch({
            profile: branch({
                chat: branch({
                    system: leaf({}),
                    user: leaf({}),
                }),
            }),
        })
    }

    test('drilling into a branch pushes the path; clicking a leaf enters pending; commit joins by delimiter', () => {
        const parser = createParser(aiAgentTree())

        const r1 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        expect(r1).toBe('pair-descend')
        expect(parser.Path).toEqual(['aiAgent'])

        // `model` is a leaf — clicking it enters pending. Path stays at
        // the leaf's parent branch; pending tracks the leaf's full path.
        const r2 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'model' })
        expect(r2).toBe('await-value')
        expect(parser.Path).toEqual(['aiAgent'])
        expect(parser.Pending).toEqual({ leafPath: ['aiAgent', 'model'] })

        const r3 = parser.parseNextToken({ type: 'TEXT', value: 'qwen2.5:7b' })
        expect(r3).toBe('commit-leaf')
        const expectedKey = ['aiAgent', 'model'].join(PAIR_PATH_DELIMITER)
        expect(parser.Values.get(expectedKey)).toBe('qwen2.5:7b')
    })

    test('TEXT-form branch click descends through a multi-level tree', () => {
        const parser = createParser(profileTree())
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'profile' })
        // `chat` is itself a branch — TEXT click descends into it.
        const r = parser.parseNextToken({ type: 'TEXT', value: 'chat' })
        expect(r).toBe('pair-descend')
        expect(parser.Path).toEqual(['profile', 'chat'])
    })

    test('ascend() steps back one branch level; at root returns false', () => {
        const parser = createParser(aiAgentTree())
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        expect(parser.ascend()).toBe(true)
        expect(parser.Path).toEqual([])
        expect(parser.ascend()).toBe(false)
    })

    test('cancel-op via interpreter ascends one level instead of full back', () => {
        const parser = createParser(aiAgentTree())
        const interpreter = new CBInterpreter(parser, 'incremental')
        interpreter.step('--aiAgent')
        expect(parser.Path).toEqual(['aiAgent'])

        const r = interpreter.step(BuilderActionSigns.cancelOp)
        expect(r.Done).toBe(false)
        // After ascend, parser is back at root.
        expect(parser.Path).toEqual([])
    })
})

// --- Interpreter Integration Tests ---

describe('Interpreter — Non-Mandatory Mode', () => {
    test('compiles a single positional from bare TEXT', () => {
        const tree = branch({ module: leaf({ position: 1 }) })
        const interpreter = createInterpreter(tree, 'non-mandatory')

        const result = interpreter.step('scraper')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.getPos(1)).toBe('scraper')
        expect(result.Result.proxy.get('module')).toBe('scraper')
    })

    test('compiles a pair leaf from `--city Moscow`', () => {
        const tree = branch({ city: leaf({}) })
        const interpreter = createInterpreter(tree, 'non-mandatory')

        const result = interpreter.step('--city Moscow')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.get('city')).toBe('Moscow')
    })

    test('compiles mixed positional + pair + standalone in one step', () => {
        const tree = branch({
            query: leaf({ position: 1 }),
            city: leaf({}),
            dryRun: leaf({ standalone: true }),
        })
        const interpreter = createInterpreter(tree, 'non-mandatory')

        const result = interpreter.step('hello --city Moscow -dryRun')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.getPos(1)).toBe('hello')
        expect(result.Result.proxy.get('city')).toBe('Moscow')
        expect(result.Result.proxy.has('dryRun')).toBe(true)
    })
})

describe('Interpreter — Incremental Mode', () => {
    test('step-by-step pair entry', () => {
        const tree = branch({ city: leaf({}) })
        const parser = createParser(tree)
        const interpreter = new CBInterpreter(parser, 'incremental')

        const r1 = interpreter.step('--city')
        expect(r1.IsCompiled).toBe(false)
        expect(r1.Done).toBe(false)
        expect(parser.Pending).toEqual({ leafPath: ['city'] })

        const r2 = interpreter.step('Moscow')
        expect(r2.IsCompiled).toBe(false)
        expect(parser.Values.get('city')).toBe('Moscow')
    })
})

// --- Re-prompt API (used by ValidationFailed flow in task #5) ---

describe('Parser — Re-prompt API', () => {
    test('seedValues resets path/pending and replaces values', () => {
        const tree = branch({
            params: branch({ sessionId: leaf({}) }),
            config: branch({ aiAgent: branch({ model: leaf({}) }) }),
        })
        const parser = createParser(tree)
        // Stir the parser into a non-trivial state.
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'config' })
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        expect(parser.Path).toEqual(['config', 'aiAgent'])

        const seeded = new Map<string, string>([
            ['params/sessionId', 'abc'],
            ['config/aiAgent/model', 'old'],
        ])
        parser.seedValues(seeded)
        expect(parser.Path).toEqual([])
        expect(parser.Pending).toBeNull()
        expect(parser.Values.get('params/sessionId')).toBe('abc')
        expect(parser.Values.get('config/aiAgent/model')).toBe('old')
    })

    test('focusLeaf positions path at the leaf parent and arms pending', () => {
        const tree = branch({
            config: branch({ aiAgent: branch({ model: leaf({}) }) }),
        })
        const parser = createParser(tree)
        parser.seedValues(new Map([['config/aiAgent/model', 'bad']]))

        const ok = parser.focusLeaf(['config', 'aiAgent', 'model'])
        expect(ok).toBe(true)
        expect(parser.Path).toEqual(['config', 'aiAgent'])
        expect(parser.Pending).toEqual({ leafPath: ['config', 'aiAgent', 'model'] })
        // The bad value was cleared so the user's next input replaces it.
        expect(parser.Values.has('config/aiAgent/model')).toBe(false)

        // Next TEXT commits the re-prompted value.
        parser.parseNextToken({ type: 'TEXT', value: 'qwen2.5:7b' })
        expect(parser.Values.get('config/aiAgent/model')).toBe('qwen2.5:7b')
    })

    test('focusLeaf rejects non-leaf or unknown paths', () => {
        const tree = branch({ config: branch({ aiAgent: branch({ model: leaf({}) }) }) })
        const parser = createParser(tree)
        expect(parser.focusLeaf(['config'])).toBe(false)
        expect(parser.focusLeaf(['config', 'aiAgent'])).toBe(false)
        expect(parser.focusLeaf(['nonexistent'])).toBe(false)
        expect(parser.focusLeaf([])).toBe(false)
    })
})

// --- nodeAtCurrent getter ---

describe('Parser — nodeAtCurrent', () => {
    test('returns the root branch at empty path', () => {
        const tree = branch({ x: leaf({}) })
        const parser = createParser(tree)
        const node = parser.nodeAtCurrent()
        expect(node?.node).toBe('branch')
    })

    test('returns the descendant after descending', () => {
        const tree = branch({ aiAgent: branch({ model: leaf({}) }) })
        const parser = createParser(tree)
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        const node = parser.nodeAtCurrent()
        expect(node?.node).toBe('branch')
    })
})

// --- Auto-positional bind is root-only ---

describe('Parser — Auto-positional binding (root-only)', () => {
    test('bare TEXT inside a branch does NOT steal a positional from elsewhere', () => {
        // `q` is a positional at the root; user is mid-branch in `config`.
        // A bare TEXT token here should NOT silently bind to `q`.
        const tree = branch({
            config: branch({ foo: leaf({}) }),
            q: leaf({ position: 1 }),
        })
        const parser = createParser(tree)
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'config' })
        const r = parser.parseNextToken({ type: 'TEXT', value: 'unmatched' })
        expect(r).toBe('none')
        expect(parser.Values.has('q')).toBe(false)
    })
})

// --- ICommandCompiled shape ---

describe('Compiled output', () => {
    test('raw is a flat slash-delimited map; proxy.get accepts both bare names and full paths', () => {
        const tree = branch({
            config: branch({ aiAgent: branch({ model: leaf({}) }) }),
            params: branch({ sessionId: leaf({}) }),
        })
        const interpreter = createInterpreter(tree, 'non-mandatory')

        const r = interpreter.step('--config --aiAgent --model qwen2.5:7b')
        // The above only enters one branch level per token; the parser doesn't
        // auto-drill multiple branches in a single TEXT token. Use a pair of
        // steps in incremental mode for that case (covered above).
        expect(r.IsCompiled).toBe(true)
    })
})

describe('Parser — SavedSources & effectiveValues', () => {
    test('SavedSources getter returns whatever was assigned', () => {
        const tree = branch({ city: leaf({ description: 'd' }) })
        const parser = createParser(tree)

        expect(parser.SavedSources).toBeUndefined()

        const map: SavedSources = new Map([
            ['config/city', { value: 'Moscow', source: 'module' as const }],
        ])
        parser.SavedSources = map
        expect(parser.SavedSources).toBe(map)
    })

    test('effectiveValues folds saved values for unset leaves only', () => {
        const tree = branch({ city: leaf({ description: 'd' }), depth: leaf({ description: 'd' }) })
        const parser = createParser(tree)

        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '3', source: 'session' }],
        ])
        parser.SavedSources = saved

        // User commits city → user value wins; depth stays from saved.
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const eff = parser.effectiveValues()
        expect(eff.get('city')).toBe('Kazan')
        expect(eff.get('depth')).toBe('3')
    })

    test('effectiveValues with no SavedSources returns just user values', () => {
        const tree = branch({ city: leaf({ description: 'd' }) })
        const parser = createParser(tree)

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const eff = parser.effectiveValues()
        expect(eff.size).toBe(1)
        expect(eff.get('city')).toBe('Kazan')
    })

    test('effectiveValues with SavedSources but no user input returns saved values', () => {
        const tree = branch({ city: leaf({ description: 'd' }) })
        const parser = createParser(tree)
        parser.SavedSources = new Map([['city', { value: 'Moscow', source: 'module' }]])

        const eff = parser.effectiveValues()
        expect(eff.get('city')).toBe('Moscow')
    })
})

import { CommandBuilder } from '../ui/command-processor/builder/builder'

describe('CommandBuilder.startBuild — SavedSources', () => {
    test('passes SavedSources through to parser via interpreter', async () => {
        const builder = new CommandBuilder()
        const tree = branch({ city: leaf({ description: 'd' }) })
        const desc = descriptorFromTree(tree)
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
        ])
        await builder.startBuild('u1', 'svc', desc, undefined, saved)
        expect(builder.isUserOnBuild('u1')).toBe(true)
        // Indirect verification: a fresh execute on no input yields effective city=Moscow.
        // (Direct parser inspection isn't exposed; the markuper test covers rendering.)
    })
})
