import { Tool } from "./types"

export function makeEndReconTool(): Tool {
    return {
        name: 'end_recon',
        description: 'Call when you have enough information from web_search calls to write a research plan. Looking at 1-3 search results is usually enough; do not exhaust the recon budget. Returns nothing meaningful; the next turn will be a planning turn.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        async handler(): Promise<{ ok: boolean, hint: string }> {
            return {
                ok: true,
                hint: 'next turn is planning. Output a <plan>...</plan> reflecting what you learned in recon',
            }
        },
    }
}
