import type { ExtractorTool, ExtractorReport } from '../types'

function stringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
}

export function makeReportIncompleteTool(): ExtractorTool {
    return {
        name: 'report_incomplete',
        description: 'Terminal tool. Hand back diagnostics when you cannot extract contacts from this page. The parent agent will use the reason to decide next steps.',
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Short explanation of why extraction failed.' },
                hints: { type: 'array', items: { type: 'string' }, description: 'Optional hints for the parent (e.g. "fetch /contacts").' },
            },
            required: ['reason'],
        },
        terminal: true,
        async handler(args): Promise<ExtractorReport> {
            const a = (args ?? {}) as Record<string, unknown>
            const result: ExtractorReport = {
                outcome: 'incomplete',
                reason: typeof a.reason === 'string' && a.reason.trim()
                    ? a.reason.trim()
                    : 'extractor returned no result',
            }
            const hints = stringArray(a.hints)
            if (hints.length) result.hints = hints
            return result
        },
    }
}
