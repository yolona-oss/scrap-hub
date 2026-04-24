import { OpenAI } from "openai"
import { ResolvedAIAgentConfig } from "./config"

export function createClient(cfg: ResolvedAIAgentConfig): OpenAI {
    return new OpenAI({
        baseURL: cfg.baseUrl,
        // The OpenAI SDK requires a non-empty string; local servers accept any placeholder.
        apiKey: cfg.apiKey ?? 'local-no-key',
    })
}
