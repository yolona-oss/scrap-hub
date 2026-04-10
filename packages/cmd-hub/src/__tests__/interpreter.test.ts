import 'reflect-metadata'

// Mock heavy deps BEFORE any imports to break circular chains
const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config', () => ({ getConfig: jest.fn(), getInitialConfig: jest.fn(() => ({})), ConfigSign: {} }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))
jest.mock('../db', () => ({
    Manager: {}, Account: {}, AccountModule: {}, AccountSession: {},
    File: {}, CmdAlias: {}, MsgHistory: {}, DefaultAssets: {},
    PendingDelete: {}, SystemConfig: {}, UserConfig: {},
    MongoConnect: jest.fn(), FilesWrapper: { getDefaultAvatar: jest.fn() },
}))
jest.mock('../db/mongoose', () => ({ MongoConnect: jest.fn() }))
jest.mock('../ui/impls/telegram', () => ({ TelegramUI: class {}, TgContext: {} }))
jest.mock('../ui/impls/cli', () => ({ CLIUI: class {}, CLIContext: {} }))
jest.mock('../ui/impls', () => ({
    AvailableUIsEnum: { Telegram: 'telegram', CLI: 'cli' },
    TelegramUI: class {}, CLIUI: class {},
}))
jest.mock('chalk', () => ({ __esModule: true, default: new Proxy({}, { get: () => (s: string) => s }) }))
jest.mock('telegraf', () => ({}))

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
