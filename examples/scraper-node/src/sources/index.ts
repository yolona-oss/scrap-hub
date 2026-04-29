import { SourceRegistry } from "./registry"
import { YandexBusinessSource } from "./yandex-business"
import { AIAgentSource } from "./ai-agent"
import { FakeSource } from "./fake"
import { log } from "@cmd-hub/common"

export { SourceRegistry } from "./registry"
export type { IScraperSource, ScraperSourceFactory } from "./types"

export function registerSources() {
    log.info('sources.registerSources: registering built-in sources')
    SourceRegistry.register('yandex-business', () => new YandexBusinessSource())
    SourceRegistry.register('ai-agent', () => new AIAgentSource())
    if (process.env.CMD_HUB_ENABLE_FAKE_SOURCE === '1') {
        log.warn('sources.registerSources: CMD_HUB_ENABLE_FAKE_SOURCE=1 → registering fake source (test mode)')
        SourceRegistry.register('fake', () => new FakeSource())
    }
    log.info(`sources.registerSources: ${SourceRegistry.available().length} sources registered: ${SourceRegistry.available().join(', ')}`)
}
