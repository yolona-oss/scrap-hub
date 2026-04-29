import type { IScraperSource, SourceAvailability } from "../types"
import type { OrgData, SearchQuery } from "../../types"
import type { ServiceContext } from "../../exporters/types"
import { log, sleep } from "@cmd-hub/common"

export interface FakeSourceConfig {
    count: number
    delayMs: number
}

/**
 * Deterministic source used as the regression fixture for the distributed
 * rewrite. Always yields the same N orgs with the same shape — the golden
 * scraper test hard-codes the resulting event sequence and CSV bytes.
 *
 * Gated behind CMD_HUB_ENABLE_FAKE_SOURCE=1 at registration time so it
 * never appears in production runs.
 */
export class FakeSource implements IScraperSource {
    constructor(private readonly cfg: FakeSourceConfig = { count: 50, delayMs: 0 }) {}

    async availability(): Promise<SourceAvailability> {
        return { ok: true }
    }

    async *search(
        _query: SearchQuery,
        onProgress: (found: number) => void,
        _ctx?: ServiceContext,
        _signal?: AbortSignal,
    ): AsyncGenerator<OrgData> {
        log.info(`fake.search: count=${this.cfg.count} delayMs=${this.cfg.delayMs}`)
        for (let i = 1; i <= this.cfg.count; i++) {
            if (this.cfg.delayMs > 0) {
                await sleep(this.cfg.delayMs)
            }
            const n = String(i).padStart(3, '0')
            onProgress(i)
            yield {
                name: `Fake Org ${n}`,
                phones: [`+1${String(i).padStart(10, '0')}`],
                emails: [`org${n}@example.test`],
                addresses: [`${i} Fake Street`],
                sources: [{
                    url: `https://fake.test/${n}`,
                    kind: 'aggregator-detail' as const,
                    extractedAt: new Date().toISOString(),
                    extractionMethod: 'deterministic' as const,
                }],
                status: 'partial' as const,
                confidence: 1.0,
                extractionMethod: 'deterministic' as const,
            }
        }
    }
}
