import { BaseCommandService, CmdService, PAIR_PATH_DELIMITER, assignToCustomPath } from "@cmd-hub/common"
import { BLANK_USER_ID } from "@cmd-hub/core"
import { z } from "zod"
import {
    scraperDefaultData,
    ScraperServiceDataType,
    ScraperConfigData,
    ScraperParamsData,
    ScraperMessagesData,
} from "./service-data"
import { OrgScraper } from "./scraper"
import { SearchQuery } from "../types"
import { SourceRegistry } from "../sources/registry"
import { log } from "@cmd-hub/common"

/** Keys whose values arrive as path-joined strings from the hierarchical
 *  builder. Base `replaceConfig` is a shallow set, which would erase
 *  siblings; we instead path-target each leaf via `setConfigValue`. */
const BRANCHED_CONFIG_KEYS = ['aiAgent', 'googleSheets'] as const

export const SCRAPER_NAME = 'scraper'
export const SCRAPER_DESCRIPTION = 'Search and collect organization data from open sources'

@CmdService({
    name: SCRAPER_NAME,
    description: SCRAPER_DESCRIPTION,
    compatibilityId: 'com.example.scrap-hub.scraper',
    version: '1.0.0',
    config: ScraperConfigData,
    params: ScraperParamsData,
    messages: ScraperMessagesData,
})
export class OrgScraperService extends BaseCommandService<ScraperServiceDataType> {
    /** CmdNodeApp reads these statics to build the merged app config schema.
     *  `aiAgent` and `googleSheets` are NOT here — they live exclusively in
     *  per-user account/session storage with `scraper-defaults.ts` as
     *  fallback. */
    static readonly configNamespace = 'scraper'
    static readonly configSchema = z.object({
        serpApiKey: z.string().default(''),
        yandexXmlUser: z.string().default(''),
        yandexXmlKey: z.string().default(''),
        chromePath: z.string().default(''),
        requestDelayMs: z.number().default(1000),
        userAgent: z.string().default(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ),
    })

    private scraper: OrgScraper | null = null
    private isPaused = false

    constructor(
        userId: string = BLANK_USER_ID,
        inputData: Partial<ScraperServiceDataType> = {},
        name: string = SCRAPER_NAME
    ) {
        super(userId, scraperDefaultData, inputData, name)
    }

    clone(userId: string, inputData: Partial<ScraperServiceDataType> = {}, newName: string = SCRAPER_NAME) {
        return new OrgScraperService(userId, inputData, newName)
    }

    async Initialize(): Promise<void> {
        const cfg = this.inputServiceData.config as Record<string, unknown> | undefined
        const deferredWrites: Array<{ path: string; value: unknown }> = []
        if (cfg) {
            for (const key of BRANCHED_CONFIG_KEYS) {
                const raw = cfg[key]
                if (typeof raw === 'string' && raw.includes(PAIR_PATH_DELIMITER)) {
                    const segments = raw.split(PAIR_PATH_DELIMITER)
                    const leaf = segments.pop()!
                    const path = `${key}.${segments.join('.')}`
                    deferredWrites.push({ path, value: leaf })
                    delete cfg[key]
                    log.debug(`scraper.Initialize: deferred ${path} = ${leaf}`)
                }
            }
        }

        await super.Initialize()

        // setConfigValue persists; assignToCustomPath patches this.data.config
        // so the current invocation sees the new values without a refresh.
        // Sequential, not Promise.all — both writes target the same Mongoose
        // session doc and concurrent save() would race.
        for (const w of deferredWrites) {
            await this.setConfigValue(w.path, w.value)
            assignToCustomPath(this.data.config as object, w.path, w.value)
        }
    }

    async receiveMsg(msg: string, _args: string[]): Promise<void> {
        switch (msg) {
            case 'pause':
                this.isPaused = true
                this.sendToWorld("Scraping paused")
                break
            case 'resume':
                this.isPaused = false
                this.sendToWorld("Scraping resumed")
                break
            case 'stop':
                await this.exportAndNotify()
                await this.terminate()
                break
            case 'export':
                await this.exportAndNotify()
                break
            default:
                this.sendToWorld(`Unknown command: ${msg}`)
        }
    }

    protected async runWrapper(): Promise<void> {
        // Register intercom actions
        this.registerIntercom({ id: 'export', label: 'Export Now', icon: '📄' })

        const queryStr = this.data.config.query
        if (!queryStr) {
            this.sendToError("No search query provided")
            return
        }

        const limit = parseInt(this.data.config.limit ?? '50')
        const sourceStr = this.data.config.sources
        const sourceNames = (!sourceStr || sourceStr === 'all')
            ? SourceRegistry.available()
            : sourceStr.split(',').map(s => s.trim())

        const query: SearchQuery = {
            query: queryStr,
            city: this.data.config.city,
            sources: sourceNames,
            maxResults: limit,
        }

        const existingResults = this.data.runtimeState?.results ?? []
        const processedUrls = this.data.runtimeState?.processedUrls ?? []

        this.scraper = new OrgScraper(query, existingResults, processedUrls)

        if (existingResults.length > 0) {
            this.sendToWorld(`Resuming from ${existingResults.length} previously collected organizations`)
        }

        this.sendToWorld(`Starting search: "${queryStr}" | sources: ${sourceNames.join(', ')} | limit: ${limit}`)

        const generator = this.scraper.run(
            (msg) => this.sendToWorld(msg),
            (name, current, total) => this.emit('progress', name, current, total),
            (name, status) => this.emit('progressStatus', name, status),
            () => this.isPaused,
            this.getServiceContext(),
        )

        for await (const _org of generator) {
            if (!this.isRunning()) break

            // Periodic save every 10 orgs
            if (this.scraper.count % 10 === 0) {
                await this.saveProgress()
            }
        }

        await this.saveProgress()
        this.sendToWorld(`Collection complete: ${this.scraper.count} organizations`)
        await this.exportAndNotify()
    }

    protected async terminateWrapper(): Promise<void> {
        if (this.scraper) {
            this.scraper.stop()
            await this.saveProgress()
        }
    }

    private async saveProgress(): Promise<void> {
        if (!this.scraper) return
        try {
            await this.setRuntimeStateValue('results', this.scraper.collected)
            await this.setRuntimeStateValue('processedUrls', this.scraper.urls)
            await this.setRuntimeStateValue('lastQuery', this.data.config.query)
        } catch (e: any) {
            log.debug(`Failed to save scraper progress: ${e.message ?? e}`)
        }
    }

    private async exportAndNotify(): Promise<void> {
        if (!this.scraper || this.scraper.count === 0) {
            this.sendToWorld("No data to export")
            return
        }

        const format = this.data.config.format ?? 'csv'
        try {
            const result = await this.scraper.export(format, this.getServiceContext())
            this.sendToWorld(result.message)
            if (result.url) {
                this.sendToWorld(`Link: ${result.url}`)
            }
            if (result.filePath) {
                this.sendToWorld(`File saved: ${result.filePath}`)
                // Emit file event for UI to handle (e.g. Telegram sendDocument)
                this.emit('file', result.filePath)
            }
        } catch (e: any) {
            this.sendToError(`Export failed: ${e.message ?? e}`)
        }
    }
}
