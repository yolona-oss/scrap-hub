import type { ExtractorTool } from '../types'

export function makeReadJsonBlobTool(): ExtractorTool {
    return {
        name: 'read_json_blob',
        description: 'Read a parsed JSON blob from the page. name="next-data" returns the __NEXT_DATA__ blob (or null). name="json-ld" returns all JSON-LD blobs as an array.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', enum: ['next-data', 'json-ld'] },
            },
            required: ['name'],
        },
        terminal: false,
        async handler(args, ctx) {
            const name = String(args?.name ?? '')
            if (name === 'next-data') {
                return { blob: ctx.input.nextDataBlob ?? null }
            }
            if (name === 'json-ld') {
                return { blobs: ctx.input.jsonLdBlobs }
            }
            return { error: `unknown blob name: ${name}` }
        },
    }
}
