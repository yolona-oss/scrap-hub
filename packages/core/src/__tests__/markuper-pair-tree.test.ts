import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))
jest.mock('../config-registry', () => ({ ConfigRegistry: { register: jest.fn() } }))

import { CBParser } from '../ui/command-processor/builder/interpreter/parser'
import { BuilderMarkuper } from '../ui/command-processor/builder/builder-markuper'
import { BuilderActionSigns } from '../ui/command-processor/builder/default-callbacks'
import { IUICommandDescriptor } from '../ui/types'
import { IArgumentDescriptor, CmdArgumentContextType } from '../ui/types/command'
import { PAIR_BRANCH_PREFIX, PAIR_PATH_DELIMITER } from '@cmd-hub/common'

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
        })) as IArgumentDescriptor[],
    }
}

function newParser(args: Partial<IArgumentDescriptor>[]) {
    return new CBParser({
        command: 'test',
        avaliableArgCtxs: ['args'],
        descriptor: makeDescriptor(args),
        switchArgCtxKeyword: '__switch__',
        initialArgCtx: 'args',
    })
}

describe('Markuper — Hierarchical Pair Options', () => {
    const treeDesc = {
        name: 'aiAgent',
        isPair: true,
        pairOptionsResolver: async (path: string[]) => {
            if (path.length === 0) return { branches: ['model', 'temp'], leaves: [] }
            if (path[0] === 'model') return ['qwen2.5:7b', 'gpt-4o']
            return []
        },
    }

    test('renders branch buttons with PAIR_BRANCH_PREFIX at root level', async () => {
        const parser = newParser([treeDesc])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })

        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const branchBtns = markup.buttons!.filter(b => b.data.startsWith(PAIR_BRANCH_PREFIX))
        expect(branchBtns).toHaveLength(2)
        expect(branchBtns.map(b => b.data)).toEqual([
            `${PAIR_BRANCH_PREFIX}model`,
            `${PAIR_BRANCH_PREFIX}temp`,
        ])
    })

    test('renders leaf buttons (no prefix) at deeper level', async () => {
        const parser = newParser([treeDesc])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}model` })

        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const leafBtns = markup.buttons!.filter(b => !b.data.startsWith(PAIR_BRANCH_PREFIX) && b.type === 'value')
        expect(leafBtns.map(b => b.data)).toEqual(['qwen2.5:7b', 'gpt-4o'])
    })

    test('aux row shows Back button at depth >= 1', async () => {
        const parser = newParser([treeDesc])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}model` })

        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const auxBtns = markup.buttons!.filter(b => b.type === 'aux')
        expect(auxBtns).toHaveLength(1)
        expect(auxBtns[0].data).toBe(BuilderActionSigns.cancelOp)
        expect(auxBtns[0].text).toMatch(/Back/i)
    })

    test('aux row at root level shows the regular cancel-op (no Back label)', async () => {
        const parser = newParser([treeDesc])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        // depth 0 — no path
        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const auxBtns = markup.buttons!.filter(b => b.type === 'aux')
        // The 'selection' aux template is just [cancelOp]; label must NOT
        // contain "Back" because the Back override only kicks in mid-tree.
        expect(auxBtns).toHaveLength(1)
        expect(auxBtns[0].text).not.toMatch(/Back/i)
    })

    test('flat pairOptions still render as leaf-only without prefix', async () => {
        const parser = newParser([
            { name: 'mode', isPair: true, pairOptions: ['fast', 'slow'] },
        ])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'mode' })

        const markup = await BuilderMarkuper.markup(parser, { text: { info: '' } })
        const valueBtns = markup.buttons!.filter(b => b.type === 'value')
        expect(valueBtns.map(b => b.data)).toEqual(['fast', 'slow'])
        expect(valueBtns.every(b => !b.data.startsWith(PAIR_BRANCH_PREFIX))).toBe(true)
    })

    test('full drill + commit cycle yields path-joined value', async () => {
        const parser = newParser([treeDesc])
        parser.parseNextToken({ type: 'DOUBLE_DASH', value: 'aiAgent' })
        parser.parseNextToken({ type: 'TEXT', value: `${PAIR_BRANCH_PREFIX}model` })
        parser.parseNextToken({ type: 'TEXT', value: 'qwen2.5:7b' })
        expect(parser.ReadArgs[0].value).toBe(`model${PAIR_PATH_DELIMITER}qwen2.5:7b`)
    })
})
