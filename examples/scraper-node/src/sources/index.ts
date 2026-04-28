import { SourceRegistry } from "./registry"
import { YandexBusinessSource } from "./yandex-business"
import { AIAgentSource } from "./ai-agent"
import { FakeSource } from "./fake"

export { SourceRegistry } from "./registry"
export type { IScraperSource, ScraperSourceFactory } from "./types"

export function registerSources() {
    SourceRegistry.register('yandex-business', () => new YandexBusinessSource())
    SourceRegistry.register('ai-agent', () => new AIAgentSource())
    if (process.env.CMD_HUB_ENABLE_FAKE_SOURCE === '1') {
        SourceRegistry.register('fake', () => new FakeSource())
    }
}
