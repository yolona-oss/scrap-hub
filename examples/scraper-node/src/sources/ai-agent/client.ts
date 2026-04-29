import { OpenAI } from "openai"
import { ResolvedAIAgentConfig } from "./config"
import { log } from "@cmd-hub/common"

export function createClient(cfg: ResolvedAIAgentConfig): OpenAI {
    log.debug(`ai-agent.client: creating OpenAI client baseURL=${cfg.baseUrl} hasApiKey=${Boolean(cfg.apiKey)}`)
    return new OpenAI({
        baseURL: cfg.baseUrl,
        // The OpenAI SDK requires a non-empty string; local servers accept any placeholder.
        apiKey: cfg.apiKey ?? 'local-no-key',
    })
}
