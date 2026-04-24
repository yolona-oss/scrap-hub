import { OrgData, SearchQuery } from "../types"
import { SourceRegistry } from "../sources/registry"
import { ExporterRegistry } from "../exporters/registry"
import { ExportResult, ServiceContext } from "../exporters/types"
import log from "@logger"


function normalizeString(s: string | null): string {
    if (!s) return ''
    return s.toLowerCase().replace(/[^\wа-яё]/gi, '').trim()
}

function dedupKey(org: OrgData): string {
    const name = normalizeString(org.name)
    const phone = normalizeString(org.phone)
    const address = normalizeString(org.address)
    // Primary: name+phone, fallback: name+address
    return phone ? `${name}::${phone}` : `${name}::${address}`
}

export class OrgScraper {
    private results: OrgData[] = []
    private seen = new Map<string, OrgData>()
    private _isRunning = true

    constructor(
        private query: SearchQuery,
        existingResults: OrgData[] = [],
        private processedUrls: string[] = []
    ) {
        // Restore from session
        for (const org of existingResults) {
            const key = dedupKey(org)
            this.seen.set(key, org)
        }
        this.results = existingResults
    }

    get collected(): OrgData[] { return this.results }
    get urls(): string[] { return this.processedUrls }
    get count(): number { return this.results.length }

    stop() { this._isRunning = false }

    private addOrg(org: OrgData): boolean {
        const key = dedupKey(org)
        if (this.seen.has(key)) {
            // Merge missing fields
            const existing = this.seen.get(key)!
            if (!existing.email && org.email) existing.email = org.email
            if (!existing.phone && org.phone) existing.phone = org.phone
            if (!existing.address && org.address) existing.address = org.address
            return false
        }
        this.seen.set(key, org)
        this.results.push(org)
        return true
    }

    async* run(
        onProgress: (msg: string) => void,
        onProgressBar: (name: string, current: number, total: number) => void,
        onProgressStatus: (name: string, status: 'active' | 'done' | 'failed' | 'skipped') => void,
        isPaused: () => boolean,
        context?: ServiceContext,
    ): AsyncGenerator<OrgData> {
        const sourceNames = this.query.sources.length > 0
            ? this.query.sources
            : SourceRegistry.available()

        // Each source gets the full limit independently
        const sourceLimit = this.query.maxResults

        for (const sourceName of sourceNames) {
            if (!this._isRunning) break
            if (!SourceRegistry.has(sourceName)) {
                onProgress(`${sourceName}: not found, skipping`)
                onProgressStatus(`scraping.${sourceName}`, 'skipped')
                continue
            }
            let sourceCount = 0
            let sourceFailed = false
            onProgressBar(`scraping.${sourceName}`, 0, sourceLimit)

            try {
                const source = SourceRegistry.create(sourceName)
                const gen = source.search(this.query, (n) => {
                    sourceCount = n
                    onProgressBar(`scraping.${sourceName}`, Math.min(n, sourceLimit), sourceLimit)
                }, context)

                for await (const org of gen) {
                    if (!this._isRunning) break

                    while (isPaused() && this._isRunning) {
                        await new Promise(r => setTimeout(r, 500))
                    }

                    if (this.addOrg(org)) {
                        yield org
                        onProgressBar(`scraping.${sourceName}`, Math.min(sourceCount, sourceLimit), sourceLimit)
                    }

                    // Per-source limit check
                    if (sourceCount >= sourceLimit) {
                        onProgress(`${sourceName}: reached limit of ${sourceLimit}`)
                        break
                    }
                }
            } catch (e: any) {
                sourceFailed = true
                log.error(`Source "${sourceName}" error: ${e.message ?? e}`)
                onProgress(`${sourceName}: failed — ${e.message ?? e}`)
            }

            if (sourceFailed || sourceCount === 0) {
                onProgressStatus(`scraping.${sourceName}`, sourceFailed ? 'failed' : 'skipped')
                onProgress(`${sourceName}: ${sourceFailed ? 'FAILED' : 'no results'}`)
            } else {
                onProgressBar(`scraping.${sourceName}`, sourceCount, sourceLimit)
                onProgressStatus(`scraping.${sourceName}`, 'done')
                onProgress(`${sourceName}: ${sourceCount} found, ${this.results.length} total unique`)
            }
        }
    }

    async export(format: string, context?: ServiceContext): Promise<ExportResult> {
        const exporter = ExporterRegistry.create(format)
        // Snapshot current results — don't block or interfere with ongoing scraping
        const snapshot = [...this.results]
        return await exporter.export(snapshot, this.query, context)
    }
}
