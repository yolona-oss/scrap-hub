import { BaseCommandService } from "@core/ui/types/command/service"
import { BLANK_USER_ID } from "@core/ui/command-processor"
import { scraperDefaultData, ScraperServiceDataType } from "./service-data"
import { OrgScraper } from "./scraper"
import { SearchQuery } from "../types"
import { SourceRegistry } from "../sources/registry"
import log from "@logger"

export const SCRAPER_NAME = 'scraper'
export const SCRAPER_DESCRIPTION = 'Search and collect organization data from open sources'

export class OrgScraperService extends BaseCommandService<ScraperServiceDataType> {
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

        const existingResults = this.data.sessionData?.results ?? []
        const processedUrls = this.data.sessionData?.processedUrls ?? []

        this.scraper = new OrgScraper(query, existingResults, processedUrls)

        if (existingResults.length > 0) {
            this.sendToWorld(`Resuming from ${existingResults.length} previously collected organizations`)
        }

        this.sendToWorld(`Starting search: "${queryStr}" | sources: ${sourceNames.join(', ')} | limit: ${limit}`)

        const generator = this.scraper.run(
            (msg) => this.sendToWorld(msg),
            (name, current, total) => this.emit('progress' as any, name, current, total),
            (name, status) => this.emit('progressStatus' as any, name, status),
            () => this.isPaused
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
            await this.setSessionDataValue('results', this.scraper.collected)
            await this.setSessionDataValue('processedUrls', this.scraper.urls)
            await this.setSessionDataValue('lastQuery', this.data.config.query)
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
                this.emit('file' as any, result.filePath)
            }
        } catch (e: any) {
            this.sendToError(`Export failed: ${e.message ?? e}`)
        }
    }
}
