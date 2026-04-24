import { SourceRegistry } from "./registry"
import { GoogleSearchSource } from "./google-search"
import { YandexSearchSource } from "./yandex-search"
import { YandexBusinessSource } from "./yandex-business"
import { AvitoSource } from "./avito"
import { AIAgentSource } from "./ai-agent"
import { FakeSource } from "./fake"

export { SourceRegistry } from "./registry"
export type { IScraperSource, ScraperSourceFactory } from "./types"

export function registerSources() {
    SourceRegistry.register('google', () => new GoogleSearchSource())
    SourceRegistry.register('yandex', () => new YandexSearchSource())
    SourceRegistry.register('yandex-business', () => new YandexBusinessSource())
    SourceRegistry.register('avito', () => new AvitoSource())
    SourceRegistry.register('ai-agent', () => new AIAgentSource())
    if (process.env.CMD_HUB_ENABLE_FAKE_SOURCE === '1') {
        SourceRegistry.register('fake', () => new FakeSource())
    }
}
