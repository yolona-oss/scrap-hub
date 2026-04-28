import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { branch, leaf, type OptionsTree } from '@cmd-hub/common'
import { CBParser } from '../ui/command-processor/builder/interpreter/parser'
import { CBLexerToken } from '../ui/command-processor/builder/interpreter/lexer'
import { BuilderMarkuper } from '../ui/command-processor/builder/builder-markuper'
import { BuilderActionSigns } from '../ui/command-processor/builder/default-callbacks'

/** Build a parser for `tree` and feed it `tokens` in order. Returns
 *  the parser positioned at the resulting state — most markuper tests
 *  need this two-step (build + drive) shape. */
function parserAt(tree: OptionsTree, ...tokens: CBLexerToken[]): CBParser {
    const parser = new CBParser({ command: 'test', descriptor: { options: tree } })
    for (const tkn of tokens) parser.parseNextToken(tkn)
    return parser
}

describe('Markuper — Tree-native rendering', () => {
    test('renders one button per child of the current branch at root', async () => {
        const tree = branch({
            aiAgent: branch({ model: leaf({}) }),
            mode: leaf({ options: ['fast', 'slow'] }),
            verbose: leaf({ standalone: true }),
        })
        const m = await BuilderMarkuper.markup(parserAt(tree), { text: { info: '' } })
        const names = m.buttons!.filter(b => b.type === 'name').map(b => b.data)
        // Branches and pair leaves get `--` prefix; standalone gets `-`.
        expect(names).toContain('--aiAgent')
        expect(names).toContain('--mode')
        expect(names).toContain('-verbose')
    })

    test('descending into a branch re-renders that branch\'s children', async () => {
        const tree = branch({
            aiAgent: branch({
                model: leaf({ options: ['qwen2.5:7b', 'gpt-4o'] }),
                temperature: leaf({}),
            }),
        })
        const parser = parserAt(tree, { type: 'DOUBLE_DASH', value: 'aiAgent' })

        const m = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const names = m.buttons!.filter(b => b.type === 'name').map(b => b.data)
        expect(names).toEqual(['--model', '--temperature'])
    })

    test('clicking a leaf with options renders value buttons for those options', async () => {
        const tree = branch({ mode: leaf({ options: ['fast', 'slow'] }) })
        const parser = parserAt(tree, { type: 'DOUBLE_DASH', value: 'mode' })

        const m = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const values = m.buttons!.filter(b => b.type === 'value').map(b => b.data)
        expect(values).toEqual(['fast', 'slow'])
    })

    test('aux row at root is the default builder row', async () => {
        const m = await BuilderMarkuper.markup(parserAt(branch({ x: leaf({}) })), { text: { info: '' } })
        const aux = m.buttons!.filter(b => b.type === 'aux')
        expect(aux.length).toBeGreaterThanOrEqual(2)
        expect(aux.some(b => b.data === BuilderActionSigns.execute)).toBe(true)
        expect(aux.some(b => b.data === BuilderActionSigns.cancelBuild)).toBe(true)
    })

    test('aux row mid-branch shows a single Back button', async () => {
        const tree = branch({ aiAgent: branch({ model: leaf({}) }) })
        const parser = parserAt(tree, { type: 'DOUBLE_DASH', value: 'aiAgent' })

        const m = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const aux = m.buttons!.filter(b => b.type === 'aux')
        expect(aux).toHaveLength(1)
        expect(aux[0].data).toBe(BuilderActionSigns.cancelOp)
        expect(aux[0].text).toMatch(/Back/i)
    })

    test('committed leaves mark the corresponding button as read', async () => {
        const tree = branch({ city: leaf({}) })
        const parser = parserAt(tree,
            { type: 'DOUBLE_DASH', value: 'city' },
            { type: 'TEXT', value: 'Moscow' },
        )

        const m = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const cityBtn = m.buttons!.find(b => b.data === '--city')!
        expect(cityBtn.isRead).toBe(true)
        // Visual check-glyph also lands in the label, regardless of which
        // exact character `UiUnicodeSymbols.check` resolves to.
        expect(cityBtn.text.length).toBeGreaterThan('city'.length)
    })

    test('intro markup lists every leaf with required brackets', async () => {
        const tree = branch({
            query: leaf({ position: 1, required: true, description: 'Search query' }),
            limit: leaf({ description: 'Optional limit' }),
        })
        const m = await BuilderMarkuper.intro(parserAt(tree))
        expect(m.text).toContain('<query>')
        expect(m.text).toContain('Search query')
        expect(m.text).toContain('[limit]')
        expect(m.text).toContain('Optional limit')
    })
})

import type { SavedSources } from '../ui/command-processor/saved-sources'

describe('BuilderMarkuper — saved-source tags', () => {
    function tree() {
        return branch({
            city: leaf({ description: 'city' }),
            depth: leaf({ description: 'depth' }),
        })
    }

    test('intro lists saved entries with source tag', async () => {
        const parser = new CBParser({ command: 'svc', descriptor: { options: tree() } })
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '5', source: 'session' }],
        ])
        const markup = await BuilderMarkuper.intro(parser, saved)
        expect(markup.text).toContain('city: Moscow')
        expect(markup.text).toContain('(module)')
        expect(markup.text).toContain('depth: 5')
        expect(markup.text).toContain('(session)')
    })

    test('user-committed leaf is unmarked; only unset leaves show source tag', async () => {
        const parser = new CBParser({ command: 'svc', descriptor: { options: tree() } })
        const saved: SavedSources = new Map([
            ['city', { value: 'Moscow', source: 'module' }],
            ['depth', { value: '5', source: 'session' }],
        ])
        parser.SavedSources = saved
        // Commit city by typing.
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'city' })
        parser.parseNextToken({ type: 'TEXT', value: 'Kazan' })

        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        // depth is still saved → tag rendered for depth, not for city.
        expect(markup.text).toContain('depth: 5')
        expect(markup.text).toContain('(session)')
        // city was user-committed → no '(module)' next to it.
        // (Look for the saved-defaults block specifically: the user-set commit appears with ✓.)
        const savedSection = markup.text.split('Saved defaults')[1] ?? ''
        expect(savedSection).not.toContain('city')
    })

    test('no SavedSources renders no saved-defaults block', async () => {
        const parser = new CBParser({ command: 'svc', descriptor: { options: tree() } })
        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        expect(markup.text).not.toContain('Saved defaults')
    })
})
