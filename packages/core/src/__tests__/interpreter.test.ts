import 'reflect-metadata'

// Mock heavy deps BEFORE any imports to break circular chains
const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))
// All entity models live in @cmd-hub/storage-mongo now; the parser/interpreter
// tests don't touch storage so no model mocks are needed.

import { CBParser } from '../ui/command-processor/builder/interpreter/parser'
import { CBInterpreter } from '../ui/command-processor/builder/interpreter/interpreter'
import { Lexer } from '../ui/command-processor/builder/interpreter/lexer'
import { IUICommandDescriptor } from '../ui/types'
import { IArgumentDescriptor, CmdArgumentContextType } from '../ui/types/command'

// --- Test Helpers ---

function makeDescriptor(args: Partial<IArgumentDescriptor>[]): IUICommandDescriptor {
    return {
        args: args.map(a => ({
            required: false,
            description: 'test',
            validator: () => true,
            standalone: false,
            isPair: false,
            ctx: 'args' as CmdArgumentContextType,
            name: '',
            ...a,
        })) as IArgumentDescriptor[]
    }
}

function createParser(args: Partial<IArgumentDescriptor>[], contexts: CmdArgumentContextType[] = ['args']) {
    const desc = makeDescriptor(args)
    return new CBParser({
        command: 'test',
        avaliableArgCtxs: contexts,
        descriptor: desc,
        switchArgCtxKeyword: '__switch__',
        initialArgCtx: contexts[0],
    })
}

function createInterpreter(args: Partial<IArgumentDescriptor>[], contexts?: CmdArgumentContextType[]) {
    const desc = makeDescriptor(args)
    const parser = new CBParser({
        command: 'test',
        avaliableArgCtxs: contexts ?? ['args'],
        descriptor: desc,
        switchArgCtxKeyword: '__switch__',
        initialArgCtx: contexts?.[0] ?? 'args',
    })
    return new CBInterpreter(parser)
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
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(0)
    })

    test('handles whitespace-only input', () => {
        lexer.setInput('   ')
        const tokens = lexer.tokenizeCurrent()
        expect(tokens).toHaveLength(0)
    })
})

// --- Parser State Tests ---

describe('Parser — Pair Arguments', () => {
    test('pair arg: --name value sets pair', () => {
        const parser = createParser([
            { name: 'city', isPair: true }
        ])

        const r1 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(r1).toBe('set-pair-name')
        expect(parser.State).toBe('PAIR_VALUE')

        const r2 = parser.parseNextToken({ type: 'TEXT', value: 'Moscow' })
        expect(r2).toBe('set-pair-value')
        expect(parser.State).toBe('IDLE')
        expect(parser.ReadArgs).toHaveLength(1)
        expect(parser.ReadArgs[0].value).toBe('Moscow')
    })

    test('pair arg: switching to another arg mid-pair resets', () => {
        const parser = createParser([
            { name: 'city', isPair: true },
            { name: 'limit', isPair: true },
        ])

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(parser.State).toBe('PAIR_VALUE')

        // User clicks another arg instead of typing value
        const r = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'limit' })
        expect(r).toBe('set-pair-name')
        expect(parser.State).toBe('PAIR_VALUE')
        // The incomplete city pair should be removed
        expect(parser.ReadArgs).toHaveLength(1)
        expect(parser.ReadArgs[0].name).toBe('limit')
    })
})

describe('Parser — Positional Arguments', () => {
    test('positional via button click (DOUBLE_DASH) waits for value', () => {
        const parser = createParser([
            { name: 'query', position: 1, isPair: false }
        ])

        const r1 = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        expect(r1).toBe('wait-next-inited')
        expect(parser.State).toBe('POSITIONAL')

        const r2 = parser.parseNextToken({ type: 'TEXT', value: 'стоматологии Москва' })
        expect(r2).toBe('set-positional')
        expect(parser.State).toBe('IDLE')
        expect(parser.ReadArgs).toHaveLength(1)
        expect(parser.ReadArgs[0].value).toBe('стоматологии Москва')
    })

    test('positional via direct text (non-mandatory mode) sets immediately', () => {
        const parser = createParser([
            { name: 'query', position: 1, isPair: false }
        ])

        // Direct TEXT token (like in non-mandatory compile mode)
        const r = parser.parseNextToken({ type: 'TEXT', value: 'scraper' })
        expect(r).toBe('set-positional')
        expect(parser.State).toBe('IDLE')
        expect(parser.ReadArgs).toHaveLength(1)
        expect(parser.ReadArgs[0].value).toBe('scraper')
    })

    test('positional update: clicking positional button again replaces value', () => {
        const parser = createParser([
            { name: 'query', position: 1, isPair: false }
        ])

        // First set
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        parser.parseNextToken({ type: 'TEXT', value: 'old value' })
        expect(parser.ReadArgs[0].value).toBe('old value')

        // Update
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        parser.parseNextToken({ type: 'TEXT', value: 'new value' })
        expect(parser.ReadArgs).toHaveLength(1)
        expect(parser.ReadArgs[0].value).toBe('new value')
    })

    test('switching from POSITIONAL to another arg resets state', () => {
        const parser = createParser([
            { name: 'query', position: 1, isPair: false },
            { name: 'city', isPair: true },
        ])

        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'query' })
        expect(parser.State).toBe('POSITIONAL')

        // User clicks city instead of typing value
        const r = parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(r).toBe('set-pair-name')
        expect(parser.State).toBe('PAIR_VALUE')
    })
})

describe('Parser — Standalone Arguments', () => {
    test('standalone toggle on', () => {
        const parser = createParser([
            { name: 'dryRun', standalone: true, isPair: false }
        ])

        const r = parser.parseNextToken({ type: 'SINGLE_DASH', value: 'dryRun' })
        expect(r).toBe('set-standalone')
        expect(parser.State).toBe('IDLE')
        expect(parser.isArgumentStandaloneRead('dryRun')).toBe(true)
    })

    test('standalone toggle off', () => {
        const parser = createParser([
            { name: 'dryRun', standalone: true, isPair: false }
        ])

        // Toggle on
        parser.parseNextToken({ type: 'SINGLE_DASH', value: 'dryRun' })
        expect(parser.isArgumentStandaloneRead('dryRun')).toBe(true)

        // Toggle off
        const r = parser.parseNextToken({ type: 'SINGLE_DASH', value: 'dryRun' })
        expect(r).toBe('unset-standalone')
        expect(parser.isArgumentStandaloneRead('dryRun')).toBe(false)
    })
})

describe('Parser — Multi-context', () => {
    test('auto-switches context when arg found in different context', () => {
        const parser = createParser([
            { name: 'sessionId', isPair: true, ctx: 'params' as CmdArgumentContextType },
            { name: 'city', isPair: true, ctx: 'config' as CmdArgumentContextType },
        ], ['params', 'config'])

        expect(parser.CurrentContext).toBe('params')

        // Click city which is in config context
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        expect(parser.CurrentContext).toBe('config')
    })
})

// --- Interpreter Integration Tests ---

describe('Interpreter — Non-Mandatory Mode', () => {
    test('compiles single positional arg from text', () => {
        const desc = makeDescriptor([
            { name: 'module', position: 1, isPair: false }
        ])
        const parser = new CBParser({
            command: 'config',
            avaliableArgCtxs: ['args'],
            descriptor: desc,
            switchArgCtxKeyword: '__switch__',
            initialArgCtx: 'args',
        })
        const interpreter = new CBInterpreter(parser, 'non-mandatory')

        const result = interpreter.step('scraper')
        expect(result.IsCompiled).toBe(true)

        const compiled = result.Result
        expect(compiled.proxy.getPos(1)).toBe('scraper')
    })

    test('compiles pair args from text', () => {
        const desc = makeDescriptor([
            { name: 'city', isPair: true }
        ])
        const parser = new CBParser({
            command: 'test',
            avaliableArgCtxs: ['args'],
            descriptor: desc,
            switchArgCtxKeyword: '__switch__',
            initialArgCtx: 'args',
        })
        const interpreter = new CBInterpreter(parser, 'non-mandatory')

        const result = interpreter.step('--city Moscow')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.get('city')).toBe('Moscow')
    })

    test('compiles mixed args', () => {
        const desc = makeDescriptor([
            { name: 'query', position: 1, isPair: false },
            { name: 'city', isPair: true },
            { name: 'dryRun', standalone: true, isPair: false },
        ])
        const parser = new CBParser({
            command: 'test',
            avaliableArgCtxs: ['args'],
            descriptor: desc,
            switchArgCtxKeyword: '__switch__',
            initialArgCtx: 'args',
        })
        const interpreter = new CBInterpreter(parser, 'non-mandatory')

        const result = interpreter.step('hello --city Moscow -dryRun')
        expect(result.IsCompiled).toBe(true)
        expect(result.Result.proxy.getPos(1)).toBe('hello')
        expect(result.Result.proxy.get('city')).toBe('Moscow')
        expect(result.Result.proxy.has('dryRun')).toBe(true)
    })
})

describe('Interpreter — Incremental Mode (Interactive)', () => {
    test('step-by-step pair building', () => {
        const desc = makeDescriptor([
            { name: 'city', isPair: true }
        ])
        const parser = new CBParser({
            command: 'test',
            avaliableArgCtxs: ['args'],
            descriptor: desc,
            switchArgCtxKeyword: '__switch__',
            initialArgCtx: 'args',
        })
        const interpreter = new CBInterpreter(parser, 'incremental')

        const r1 = interpreter.step('--city')
        expect(r1.IsCompiled).toBe(false)
        expect(r1.Done).toBe(false)

        const r2 = interpreter.step('Moscow')
        expect(r2.IsCompiled).toBe(false)
        expect(parser.ReadArgs[0].value).toBe('Moscow')
    })
})

// --- Hierarchical (branched) pair-options tests ---

import { PAIR_BRANCH_PREFIX, PAIR_PATH_DELIMITER } from '@cmd-hub/common'
import { BuilderActionSigns } from '../ui/command-processor/builder/default-callbacks'

describe('Parser — Hierarchical Pair Options', () => {
    function createTreeParser() {
        const desc = makeDescriptor([
            {
                name: 'aiAgent',
                isPair: true,
                pairOptionsResolver: async (path: string[]) => {
                    if (path.length === 0) {
                        return { branches: ['model', 'temperature'], leaves: [] }
                    }
                    if (path[0] === 'model') return ['qwen2.5:7b', 'gpt-4o']
                    if (path[0] === 'temperature') return ['0.0', '0.5']
                    return []
                },
            },
        ])
        return new CBParser({
            command: 'test',
            avaliableArgCtxs: ['args'],
            descriptor: desc,
            switchArgCtxKeyword: '__switch__',
            initialArgCtx: 'args',
        })
    }

    test('drilling a branch pushes the path; leaf commit joins with delimiter', () => {
        const parser = createTreeParser()
        // Click the --aiAgent button
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        expect(parser.State).toBe('PAIR_VALUE')
        expect(parser.PairPath).toEqual([])

        // Click the "model →" branch button
        const r1 = parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}model` })
        expect(r1).toBe('pair-descend')
        expect(parser.State).toBe('PAIR_VALUE')
        expect(parser.PairPath).toEqual(['model'])

        // Click a leaf — committed value is path-joined
        const r2 = parser.parseNextToken({ type: 'TEXT', value: 'qwen2.5:7b' })
        expect(r2).toBe('set-pair-value')
        expect(parser.State).toBe('IDLE')
        expect(parser.ReadArgs).toHaveLength(1)
        expect(parser.ReadArgs[0].value).toBe(`model${PAIR_PATH_DELIMITER}qwen2.5:7b`)
        expect(parser.PairPath).toEqual([])
    })

    test('popPairPath steps back one level; clearPairPath resets', () => {
        const parser = createTreeParser()
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}model` })
        expect(parser.PairPath).toEqual(['model'])

        expect(parser.popPairPath()).toBe(true)
        expect(parser.PairPath).toEqual([])
        // popping from root returns false
        expect(parser.popPairPath()).toBe(false)
    })

    test('flat pairOptions descriptors are unaffected (non-branched)', () => {
        const parser = createParser([
            { name: 'mode', isPair: true, pairOptions: ['fast', 'slow'] }
        ])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'mode' })
        // With no resolver, the BRANCH_PREFIX gets stripped and the value
        // commits as a leaf — keeps backwards compat for any caller that
        // accidentally sends a prefixed value.
        const r = parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}fast` })
        expect(r).toBe('set-pair-value')
        expect(parser.ReadArgs[0].value).toBe('fast')
    })

    test('cancel-op via interpreter pops one path level instead of full back', () => {
        const desc = makeDescriptor([
            {
                name: 'aiAgent',
                isPair: true,
                pairOptionsResolver: async (path: string[]) => {
                    if (path.length === 0) return { branches: ['model'], leaves: [] }
                    return ['qwen2.5:7b']
                },
            },
        ])
        const parser = new CBParser({
            command: 'test',
            avaliableArgCtxs: ['args'],
            descriptor: desc,
            switchArgCtxKeyword: '__switch__',
            initialArgCtx: 'args',
        })
        const interpreter = new CBInterpreter(parser, 'incremental')

        interpreter.step('--aiAgent')
        interpreter.step(`${PAIR_BRANCH_PREFIX}model`)
        expect(parser.PairPath).toEqual(['model'])

        // The cancelOp action sign is what aux "Back" button sends
        const r = interpreter.step(BuilderActionSigns.cancelOp)
        expect(r.Done).toBe(false)
        expect(parser.PairPath).toEqual([])
        expect(parser.State).toBe('PAIR_VALUE')
    })

    test('transit out of PAIR_VALUE clears the pair path', () => {
        const parser = createParser([
            {
                name: 'aiAgent',
                isPair: true,
                pairOptionsResolver: async () => ({ branches: ['model'], leaves: [] }),
            },
            { name: 'other', isPair: true, pairOptions: ['x'] },
        ])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}model` })
        expect(parser.PairPath).toEqual(['model'])

        // Switching to a different pair arg mid-tree wipes the path
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'other' })
        expect(parser.PairPath).toEqual([])
    })

    test('custom separator is honored on commit', () => {
        const parser = createParser([
            {
                name: 'aiAgent',
                isPair: true,
                pairOptionsSeparator: '::',
                pairOptionsResolver: async (path: string[]) =>
                    path.length === 0 ? { branches: ['a'], leaves: [] } : ['leaf'],
            },
        ])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}a` })
        parser.parseNextToken({ type: 'TEXT', value: 'leaf' })
        expect(parser.ReadArgs[0].value).toBe('a::leaf')
    })
})
