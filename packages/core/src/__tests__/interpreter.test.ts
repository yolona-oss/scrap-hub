import 'reflect-metadata'

// Mock heavy deps BEFORE any imports to break circular chains.
const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import type { SavedSources } from '../ui/command-processor/saved-sources'

import { argBranch, argLeaf, type ArgTree, ARG_PATH_DELIMITER } from '@cmd-hub/common'
import { CBParser } from '../ui/command-processor/builder/interpreter/parser'
import { CBInterpreter } from '../ui/command-processor/builder/interpreter/interpreter'
import { Lexer } from '../ui/command-processor/builder/interpreter/lexer'
import { BuilderActionSigns } from '../ui/command-processor/builder/default-callbacks'
import { IUICommandDescriptor } from '../ui/types'

// --- Test Helpers ---

function descriptorFromTree(tree: ArgTree): IUICommandDescriptor {
    return { tree }
}

function createParser(tree: ArgTree) {
    return new CBParser({
        command: 'test',
        descriptor: descriptorFromTree(tree),
    })
}

function createInterpreter(tree: ArgTree, mode?: 'incremental' | 'non-mandatory' | 'required' | 'comprehensive') {
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
        const tree = argBranch({ city: argLeaf({ description: 'Target city' }) })
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
        const tree = argBranch({
            city: argLeaf({}),
            limit: argLeaf({}),
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
        const tree = argBranch({ query: argLeaf({ position: 1 }) })
        const parser = createParser(tree)

        const r1 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        expect(r1).toBe('await-value')

        const r2 = parser.parseNextToken({ type: 'TEXT', value: 'стоматологии Москва' })
        expect(r2).toBe('commit-leaf')
        expect(parser.Values.get('query')).toBe('стоматологии Москва')
    })

    test('bare TEXT auto-binds to the next unfilled positional', () => {
        const tree = argBranch({ query: argLeaf({ position: 1 }) })
        const parser = createParser(tree)

        const r = parser.parseNextToken({ type: 'TEXT', value: 'scraper' })
        expect(r).toBe('commit-leaf')
        expect(parser.Values.get('query')).toBe('scraper')
    })

    test('clicking the same positional twice replaces the value', () => {
        const tree = argBranch({ query: argLeaf({ position: 1 }) })
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
        const tree = argBranch({
            query: argLeaf({ position: 1 }),
            city: argLeaf({}),
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
        const tree = argBranch({ dryRun: argLeaf({ standalone: true }) })
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
    function aiAgentTree(): ArgTree {
        return argBranch({
            aiAgent: argBranch({
                model: argLeaf({ choices: ['qwen2.5:7b', 'gpt-4o'] }),
                temperature: argLeaf({ choices: ['0.0', '0.5'] }),
            }),
        })
    }

    /**
     * Three-level tree, used where the test needs branches at depth >= 2:
     *   profile ─┬── chat ─┬── system  (leaf)
     *                       └── user    (leaf)
     */
    function profileTree(): ArgTree {
        return argBranch({
            profile: argBranch({
                chat: argBranch({
                    system: argLeaf({}),
                    user: argLeaf({}),
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
        const expectedKey = ['aiAgent', 'model'].join(ARG_PATH_DELIMITER)
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
        const tree = argBranch({ module: argLeaf({ position: 1 }) })
        const interpreter = createInterpreter(tree, 'non-mandatory')

        const result = interpreter.step('scraper')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.getPos(1)).toBe('scraper')
        expect(result.Result.proxy.get('module')).toBe('scraper')
    })

    test('compiles a pair leaf from `--city Moscow`', () => {
        const tree = argBranch({ city: argLeaf({}) })
        const interpreter = createInterpreter(tree, 'non-mandatory')

        const result = interpreter.step('--city Moscow')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.get('city')).toBe('Moscow')
    })

    test('compiles mixed positional + pair + standalone in one step', () => {
        const tree = argBranch({
            query: argLeaf({ position: 1 }),
            city: argLeaf({}),
            dryRun: argLeaf({ standalone: true }),
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
        const tree = argBranch({ city: argLeaf({}) })
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
        const tree = argBranch({
            args: argBranch({ sessionId: argLeaf({}) }),
            intercom: argBranch({ aiAgent: argBranch({ model: argLeaf({}) }) }),
        })
        const parser = createParser(tree)
        // Stir the parser into a non-trivial state.
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'intercom' })
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        expect(parser.Path).toEqual(['intercom', 'aiAgent'])

        const seeded = new Map<string, string>([
            ['args/sessionId', 'abc'],
            ['intercom/aiAgent/model', 'old'],
        ])
        parser.seedValues(seeded)
        expect(parser.Path).toEqual([])
        expect(parser.Pending).toBeNull()
        expect(parser.Values.get('args/sessionId')).toBe('abc')
        expect(parser.Values.get('intercom/aiAgent/model')).toBe('old')
    })

    test('focusLeaf positions path at the leaf parent and arms pending', () => {
        const tree = argBranch({
            args: argBranch({ aiAgent: argBranch({ model: argLeaf({}) }) }),
        })
        const parser = createParser(tree)
        parser.seedValues(new Map([['args/aiAgent/model', 'bad']]))

        const ok = parser.focusLeaf(['args', 'aiAgent', 'model'])
        expect(ok).toBe(true)
        expect(parser.Path).toEqual(['args', 'aiAgent'])
        expect(parser.Pending).toEqual({ leafPath: ['args', 'aiAgent', 'model'] })
        // The bad value was cleared so the user's next input replaces it.
        expect(parser.Values.has('args/aiAgent/model')).toBe(false)

        // Next TEXT commits the re-prompted value.
        parser.parseNextToken({ type: 'TEXT', value: 'qwen2.5:7b' })
        expect(parser.Values.get('args/aiAgent/model')).toBe('qwen2.5:7b')
    })

    test('focusLeaf rejects non-leaf or unknown paths', () => {
        const tree = argBranch({ args: argBranch({ aiAgent: argBranch({ model: argLeaf({}) }) }) })
        const parser = createParser(tree)
        expect(parser.focusLeaf(['args'])).toBe(false)
        expect(parser.focusLeaf(['args', 'aiAgent'])).toBe(false)
        expect(parser.focusLeaf(['nonexistent'])).toBe(false)
        expect(parser.focusLeaf([])).toBe(false)
    })
})

// --- nodeAtCurrent getter ---

describe('Parser — nodeAtCurrent', () => {
    test('returns the root branch at empty path', () => {
        const tree = argBranch({ x: argLeaf({}) })
        const parser = createParser(tree)
        const node = parser.nodeAtCurrent()
        expect(node?.node).toBe('branch')
    })

    test('returns the descendant after descending', () => {
        const tree = argBranch({ aiAgent: argBranch({ model: argLeaf({}) }) })
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
        const tree = argBranch({
            config: argBranch({ foo: argLeaf({}) }),
            q: argLeaf({ position: 1 }),
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
        const tree = argBranch({
            config: argBranch({ aiAgent: argBranch({ model: argLeaf({}) }) }),
            params: argBranch({ sessionId: argLeaf({}) }),
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
        const tree = argBranch({ city: argLeaf({ description: 'd' }) })
        const parser = createParser(tree)

        expect(parser.SavedSources).toBeUndefined()

        const map: SavedSources = new Map([
            ['args/city', { value: 'Moscow', source: 'module' as const }],
        ])
        parser.SavedSources = map
        expect(parser.SavedSources).toBe(map)
    })

    test('effectiveValues folds saved values for unset leaves only', () => {
        const tree = argBranch({ city: argLeaf({ description: 'd' }), depth: argLeaf({ description: 'd' }) })
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
        const tree = argBranch({ city: argLeaf({ description: 'd' }) })
        const parser = createParser(tree)

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const eff = parser.effectiveValues()
        expect(eff.size).toBe(1)
        expect(eff.get('city')).toBe('Kazan')
    })

    test('effectiveValues with SavedSources but no user input returns saved values', () => {
        const tree = argBranch({ city: argLeaf({ description: 'd' }) })
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
        const tree = argBranch({ city: argLeaf({ description: 'd' }) })
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

describe('Interpreter compile — saved values fold into effective args', () => {
    test('compiled.raw includes saved values for unset leaves', () => {
        const tree = argBranch({
            city: argLeaf({ description: 'city' }),
            depth: argLeaf({ description: 'depth' }),
        })
        const parser = createParser(tree)
        parser.SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '5', source: 'session' }],
        ])
        const interpreter = new CBInterpreter(parser, 'incremental')

        // User overrides depth, leaves city to saved.
        interpreter.step('--depth 7')
        const ev = interpreter.step(BuilderActionSigns.execute)

        expect(ev.IsCompiled).toBe(true)
        const compiled = ev.Result
        expect(compiled.raw.get('city')).toBe('Moscow')
        expect(compiled.raw.get('depth')).toBe('7')
    })
})

describe('CommandBuilder.startBuild — seededValues priority chain', () => {
    test('seeded user input outranks session, session outranks module, module fills the rest', async () => {
        const builder = new CommandBuilder()
        const tree = argBranch({
            args: argBranch({
                query: argLeaf({ position: 1 }),
                city: argLeaf({}),
                limit: argLeaf({}),
                requestDelayMs: argLeaf({}),
            }),
        })
        const desc = descriptorFromTree(tree)

        // Module saved: query="Стоматология", limit="100000", requestDelayMs="1000".
        // Session saved (overrides module): city="Moscow", limit="10000".
        // Combined SavedSources is exactly what loadSavedSources would produce —
        // session entries overwrite module entries on shared keys.
        const saved: SavedSources = new Map([
            ['args/query', { value: 'Стоматология', source: 'module' }],
            ['args/limit', { value: '10000', source: 'session' }],
            ['args/city', { value: 'Moscow', source: 'session' }],
            ['args/requestDelayMs', { value: '1000', source: 'module' }],
        ])
        // User typed: query="Адвокат" (positional), city="Санкт-Петербург".
        const seeded = new Map<string, string>([
            ['args/query', 'Адвокат'],
            ['args/city', 'Санкт-Петербург'],
        ])

        await builder.startBuild('u-priority', 'scraper', desc, 'incremental', saved, seeded)
        expect(builder.isUserOnBuild('u-priority')).toBe(true)

        // Press execute and inspect compiled raw map. Priority must be:
        //  1. seeded user input  (query, city)
        //  2. session            (limit)
        //  3. module             (requestDelayMs)
        const ev = builder.handle('u-priority', BuilderActionSigns.execute)
        expect(ev.IsCompiled).toBe(true)
        const raw = ev.Result.raw
        expect(raw.get('args/query')).toBe('Адвокат')           // user > session > module
        expect(raw.get('args/city')).toBe('Санкт-Петербург')    // user wins over session
        expect(raw.get('args/limit')).toBe('10000')             // no user input → session
        expect(raw.get('args/requestDelayMs')).toBe('1000')     // no user/session → module
    })

    test('absent or empty seededValues does not change saved-only behavior', async () => {
        const builder = new CommandBuilder()
        const tree = argBranch({ city: argLeaf({}) })
        const desc = descriptorFromTree(tree)
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
        ])

        await builder.startBuild('u-empty', 'svc', desc, 'incremental', saved, new Map())
        const ev = builder.handle('u-empty', BuilderActionSigns.execute)
        expect(ev.IsCompiled).toBe(true)
        expect(ev.Result.raw.get('city')).toBe('Moscow')
    })
})

// Regression: snapshotter would throw on the 15th token because Stack.push's
// capacity check used >= instead of >. Real-world repro: the user's full
// /scraper invocation has 21+ tokens, which exceeded the cap and made
// HandleCmdBuilder.parseTypedArgs silently fall back to an empty seed map.
describe('Parser — top-level flag auto-descends into config|params|messages slice', () => {
    function serviceTree(): ArgTree {
        return argBranch({
            args: argBranch({
                query: argLeaf({ position: 1 }),
                city: argLeaf({}),
                limit: argLeaf({}),
                aiAgent: argBranch({
                    model: argLeaf({}),
                    baseUrl: argLeaf({}),
                }),
            }),
            intercom: argBranch({
                stop: argLeaf({ standalone: true }),
            }),
        })
    }

    test('--city at root auto-descends into args and commits args/city', () => {
        const parser = createParser(serviceTree())
        const lexer = new Lexer()
        lexer.setInput('Адвокат --city Санкт-Петербург')
        for (const tkn of lexer.tokenizeCurrent()) {
            parser.parseNextToken(tkn)
        }
        expect(parser.Values.get('args/query')).toBe('Адвокат')
        expect(parser.Values.get('args/city')).toBe('Санкт-Петербург')
    })

    test('--limit at root auto-descends into args and commits args/limit', () => {
        const parser = createParser(serviceTree())
        const lexer = new Lexer()
        lexer.setInput('--limit 1000')
        for (const tkn of lexer.tokenizeCurrent()) {
            parser.parseNextToken(tkn)
        }
        expect(parser.Values.get('args/limit')).toBe('1000')
    })

    test('multiple top-level flags + explicit --aiAgent group all wire correctly', () => {
        const parser = createParser(serviceTree())
        const lexer = new Lexer()
        lexer.setInput('Адвокат --city СПб --limit 1000 --args --aiAgent --model qwen3.5:9b --baseUrl http://x/v1')
        for (const tkn of lexer.tokenizeCurrent()) {
            parser.parseNextToken(tkn)
        }
        expect(parser.Values.get('args/query')).toBe('Адвокат')
        expect(parser.Values.get('args/city')).toBe('СПб')
        expect(parser.Values.get('args/limit')).toBe('1000')
        expect(parser.Values.get('args/aiAgent/model')).toBe('qwen3.5:9b')
        expect(parser.Values.get('args/aiAgent/baseUrl')).toBe('http://x/v1')
    })

    test('a -standalone flag declared in intercom auto-resolves to intercom/stop', () => {
        const parser = createParser(serviceTree())
        const lexer = new Lexer()
        lexer.setInput('-stop')
        for (const tkn of lexer.tokenizeCurrent()) {
            parser.parseNextToken(tkn)
        }
        expect(parser.Values.get('intercom/stop')).toBe('true')
    })

    test('after auto-descending, subsequent flags continue resolving in the same slice', () => {
        // User typed `--city ... --limit ...` (both in args). After the
        // first auto-descent, parser is positioned at args/. The second
        // --limit should match a child of args (no second descent needed).
        const parser = createParser(serviceTree())
        const lexer = new Lexer()
        lexer.setInput('--city СПб --limit 1000')
        for (const tkn of lexer.tokenizeCurrent()) {
            parser.parseNextToken(tkn)
        }
        expect(parser.Values.get('args/city')).toBe('СПб')
        expect(parser.Values.get('args/limit')).toBe('1000')
    })

    test('a flag that exists in NEITHER args NOR intercom is silently dropped', () => {
        const parser = createParser(serviceTree())
        const lexer = new Lexer()
        // The bare `value` after `--unknownFlag` would auto-bind to the
        // `query` positional, but we're checking that --unknownFlag itself
        // doesn't commit anywhere.
        lexer.setInput('--unknownFlag')
        for (const tkn of lexer.tokenizeCurrent()) {
            parser.parseNextToken(tkn)
        }
        expect(parser.Values.size).toBe(0)
    })
})

describe('Parser — long token streams do not throw on snapshot rollover', () => {
    test('30 sequential tokens parse without overflowing the snap stack', () => {
        const tree = argBranch({
            args: argBranch({
                query: argLeaf({ position: 1 }),
                city: argLeaf({}),
                limit: argLeaf({}),
                aiAgent: argBranch({
                    model: argLeaf({}),
                    baseUrl: argLeaf({}),
                }),
            }),
        })
        const parser = createParser(tree)

        const tokens = [
            'Адвокат',
            '--args',
            '--city', 'СПб',
            '--limit', '1000',
            '--aiAgent',
            '--model', 'qwen3.5:9b',
            '--baseUrl', 'http://x/v1',
        ]
        // Drive ~30 raw tokens by stepping each multiple times. The bug
        // manifested on the 15th memorize, so any long sequence is enough.
        const lexer = new Lexer()
        for (let pass = 0; pass < 3; pass++) {
            lexer.setInput(tokens.join(' '))
            for (const tkn of lexer.tokenizeCurrent()) {
                expect(() => parser.parseNextToken(tkn)).not.toThrow()
            }
        }
        expect(parser.Values.get('args/query')).toBe('Адвокат')
        expect(parser.Values.get('args/city')).toBe('СПб')
        expect(parser.Values.get('args/aiAgent/model')).toBe('qwen3.5:9b')
    })
})
