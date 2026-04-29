import { Tool } from "./types"

export function makeRevisePlanTool(): Tool {
    return {
        name: 'revise_plan',
        description: "Call when the current plan is not working — e.g. chosen sources keep returning rejects, the topic landscape turned out different than expected, or you've hit a dead end. The next turn will be a planning turn where you must emit a new <plan>...</plan> reflecting what you learned. Use sparingly; each revision costs an LLM turn.",
        parameters: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Brief reason why the current plan is failing' },
            },
            required: ['reason'],
        },
        async handler(args): Promise<{ ok: boolean, reasonAccepted: string, hint: string }> {
            return {
                ok: true,
                reasonAccepted: String(args?.reason ?? '').slice(0, 500),
                hint: 'next turn is planning. Output a new <plan>...</plan> reflecting why the current plan failed',
            }
        },
    }
}
