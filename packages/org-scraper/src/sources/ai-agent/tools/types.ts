import type { ChatCompletionTool } from "openai/resources/chat/completions"

export interface Tool {
    name: string
    description: string
    parameters: Record<string, any>
    handler: (args: any) => Promise<any>
}

export function toOpenAISchema(tool: Tool): ChatCompletionTool {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }
}
