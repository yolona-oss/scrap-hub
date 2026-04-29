import type { ExtractorTool, ExtractorReport } from '../types'

function clamp01(n: unknown): number {
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 1) return 1
    return n
}

function stringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string')
}

export function makeReportExtractionTool(): ExtractorTool {
    return {
        name: 'report_extraction',
        description: 'Terminal tool. Submit the extracted contacts. Use only values you actually found on the page; do not invent.',
        parameters: {
            type: 'object',
            properties: {
                phones: { type: 'array', items: { type: 'string' } },
                emails: { type: 'array', items: { type: 'string' } },
                addresses: { type: 'array', items: { type: 'string' } },
                candidateName: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                notes: { type: 'array', items: { type: 'string' } },
            },
            required: ['candidateName', 'confidence'],
        },
        terminal: true,
        async handler(args): Promise<ExtractorReport> {
            const a = (args ?? {}) as Record<string, unknown>
            const result: ExtractorReport = {
                outcome: 'extraction',
                phones: stringArray(a.phones),
                emails: stringArray(a.emails),
                addresses: stringArray(a.addresses),
                candidateName: typeof a.candidateName === 'string' ? a.candidateName : '',
                confidence: clamp01(a.confidence),
            }
            const notes = stringArray(a.notes)
            if (notes.length) result.notes = notes
            return result
        },
    }
}
