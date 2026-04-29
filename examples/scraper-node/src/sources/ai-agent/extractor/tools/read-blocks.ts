import type { ExtractorTool } from '../types'

export function makeReadBlocksTool(): ExtractorTool {
    return {
        name: 'read_blocks',
        description: 'Read additional pre-extracted blocks from the current page. selector matches by substring against block.selector ("header", "footer", "contact", "address", "*" for all).',
        parameters: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'Substring to match against block selectors, or "*" for all.' },
            },
            required: ['selector'],
        },
        terminal: false,
        async handler(args, ctx) {
            const sel = String(args?.selector ?? '').trim()
            if (!sel || sel === '*') {
                return { blocks: ctx.input.candidateBlocks }
            }
            const blocks = ctx.input.candidateBlocks.filter(b => b.selector.toLowerCase().includes(sel.toLowerCase()))
            return { blocks }
        },
    }
}
