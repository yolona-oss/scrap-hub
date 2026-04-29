import { BaseCommandService, CmdService, log } from '@cmd-hub/common'
import { BLANK_USER_ID } from '@cmd-hub/core'
import { z } from 'zod'

import { OrgKind } from '../ui-messages/org'
import { SourceFailedKind } from '../ui-messages/source-failed'
import { SearchQuery } from '../types'
import { SourceRegistry } from '../sources/registry'
import { OrgScraper } from './scraper'
import {
    scraperDefaultData,
    ScraperServiceDataType,
    ScraperArgs,
    ScraperIntercom,
} from './args-tree'

/** Cap how many results we persist back to runtimeState. A 10000-result
 *  run would write a progressively larger array on every periodic save;
 *  capping the tail keeps each save bounded. The CSV/Sheets exporter
 *  remains the source of truth for full result sets — runtimeState is
 *  only for resumption after a node restart, and resuming with the last
 *  N is enough to dedupe future yields. */
const RESULTS_TAIL_CAP = 1000

/** Periodic save cadence: write progress every N committed orgs. */
const SAVE_EVERY_N_ORGS = 10

export const SCRAPER_NAME = 'scraper'
export const SCRAPER_DESCRIPTION = 'Search and collect organization data from open sources'

@CmdService({
    name: SCRAPER_NAME,
    description: SCRAPER_DESCRIPTION,
    compatibilityId: 'com.example.scrap-hub.scraper',
    version: '1.0.0',
    args: ScraperArgs,
    intercom: ScraperIntercom,
})
export class OrgScraperService extends BaseCommandService<ScraperServiceDataType> {
    /** CmdNodeApp reads these statics to build the merged app config schema.
     *  System-tier knobs only — per-user AI/Sheets settings live exclusively
     *  on the `@CmdArg` tree above. */
    static readonly configNamespace = 'scraper'
    static readonly configSchema = z.object({
        chromePath: z.string().default(''),
        requestDelayMs: z.number().default(1000),
        userAgent: z.string().default(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ),
        searxngUrl: z.string().default(''),
    })

    private scraper: OrgScraper | null = null
    private isPaused = false
    /** Tracks the result count at the last `saveProgress` write so a no-op
     *  save (called every 10 orgs but possibly before any new ones arrived)
     *  skips the Mongo round-trip + tail-cap copy. */
    private _lastPersistedResultCount = -1

    constructor(
        userId: string = BLANK_USER_ID,
        inputData: Partial<ScraperServiceDataType> = {},
        name: string = SCRAPER_NAME,
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
                this.sendToWorld('Scraping paused')
                break
            case 'resume':
                this.isPaused = false
                this.sendToWorld('Scraping resumed')
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
        this.registerIntercom({ id: 'export', label: 'Export Now', icon: '📄' })

        const cfg = this.data.args
        if (!cfg.query) {
            this.sendToError('No search query provided')
            return
        }

        const query: SearchQuery = {
            query: cfg.query,
            city: cfg.city,
            sources: this._resolveSourceNames(cfg.sources),
            maxResults: cfg.limit ?? 10_000,
        }

        // Only resume when the saved state is from the same query the user
        // just submitted. Otherwise a previous run's results would silently
        // pre-fill this run, so a brand-new search would short-circuit on
        // stale data instead of actually scraping. `lastQuery` is written
        // by every saveProgress (see below).
        const saved = this.data.state
        const isResumable = saved?.lastQuery !== undefined && saved.lastQuery === cfg.query
        const existingResults = isResumable ? (saved?.results ?? []) : []
        const processedUrls = isResumable ? (saved?.processedUrls ?? []) : []

        this.scraper = new OrgScraper(query, existingResults, processedUrls)

        if (existingResults.length > 0) {
            this.sendToWorld(`Resuming from ${existingResults.length} previously collected organizations`)
        } else if (saved?.lastQuery && saved.lastQuery !== cfg.query) {
            this.sendToWorld(`Starting fresh — previous saved query was "${saved.lastQuery}"`)
        }

        this.sendToWorld(
            `Starting search: "${cfg.query}" | sources: ${query.sources.join(', ')} | limit: ${query.maxResults}`,
        )

        const generator = this.scraper.run({
            onProgress: (msg) => this.sendToWorld(msg),
            onProgressBar: (name, current, total) => this.emit('progress', name, current, total),
            onProgressStatus: (name, status) => this.emit('progressStatus', name, status),
            isPaused: () => this.isPaused,
            context: this.getServiceContext(),
            onSourceFailed: (info) => {
                this.send(SourceFailedKind.build({
                    source: info.source,
                    reason: info.reason,
                    mode: info.kind,
                }))
            },
        })

        for await (const org of generator) {
            if (!this.isRunning()) break

            // Stream each found org as a structured UiMessage so a Telegram
            // contact-card renderer (or future web React OrgCard) can show
            // it in real time. CLI/web Plan-A render via the default text
            // form ("· name · phone · address · <url>").
            this.send(OrgKind.build({
                name: org.name,
                phone: org.phones[0] ?? null,
                email: org.emails[0] ?? null,
                address: org.addresses[0] ?? null,
                url: org.sources.find(s => s.kind === 'org-site')?.url ?? org.sources[0]?.url,
                source: org.sources[0]?.kind,
            }))

            if (this.scraper.count % SAVE_EVERY_N_ORGS === 0) {
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

    /** Translate the user's `sources` config field into a concrete list
     *  of registered source names. `'all'` (or unset) expands to every
     *  registered source; otherwise the comma-separated list is split and
     *  trimmed. Unknown names fall through — `OrgScraper.run()` reports
     *  `unavailable` via `onSourceFailed`. */
    private _resolveSourceNames(raw: string | undefined): string[] {
        if (!raw || raw === 'all') return SourceRegistry.available()
        return raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
    }

    private async saveProgress(): Promise<void> {
        if (!this.scraper) return
        const results = this.scraper.collected
        if (results.length === this._lastPersistedResultCount) return
        const persisted = results.length > RESULTS_TAIL_CAP
            ? results.slice(-RESULTS_TAIL_CAP)
            : results
        try {
            await this.setState({
                results: persisted,
                processedUrls: this.scraper.urls,
                lastQuery: this.data.args.query,
            })
            this._lastPersistedResultCount = results.length
        } catch (e: unknown) {
            log.debug(`Failed to save scraper progress: ${(e as Error).message ?? e}`)
        }
    }

    private async exportAndNotify(): Promise<void> {
        if (!this.scraper || this.scraper.count === 0) {
            this.sendToWorld('No data to export')
            return
        }

        const format = this.data.args.format ?? 'json'
        try {
            const result = await this.scraper.export(format, this.getServiceContext())
            this.sendToWorld(result.message)
            if (result.url) this.sendToWorld(`Link: ${result.url}`)
            if (result.filePath) {
                this.sendToWorld(`File saved: ${result.filePath}`)
                this.emit('file', result.filePath)
            }
        } catch (e: unknown) {
            this.sendToError(`Export failed: ${(e as Error).message ?? e}`)
        }
    }
}
