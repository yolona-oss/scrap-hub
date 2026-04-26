import { IScraperSource, ScraperSourceFactory, SourceAvailability } from "./types"
import type { ServiceContext } from "../exporters/types"

/** TTL for the per-source availability cache. The AI-agent's
 *  `search_source` delegate calls availability() before each delegated
 *  search, so sources that probe over HTTP would fire one HEAD per call
 *  without this cache. Long-enough to cover a single /scrape run, short
 *  enough that a recovered upstream gets re-tried within a minute. */
const AVAILABILITY_CACHE_TTL_MS = 60_000

interface CachedAvailability {
    result: SourceAvailability
    expiresAt: number
}

export class SourceRegistry {
    private static factories = new Map<string, ScraperSourceFactory>()
    private static availabilityCache = new Map<string, CachedAvailability>()

    static register(name: string, factory: ScraperSourceFactory): void {
        SourceRegistry.factories.set(name, factory)
    }

    static create(name: string): IScraperSource {
        const factory = SourceRegistry.factories.get(name)
        if (!factory) {
            const available = SourceRegistry.available().join(", ")
            throw new Error(`Unknown source "${name}". Available: ${available}`)
        }
        return factory()
    }

    static has(name: string): boolean {
        return SourceRegistry.factories.has(name)
    }

    /** All registered sources, regardless of availability. */
    static available(): string[] {
        return Array.from(SourceRegistry.factories.keys())
    }

    /** Sources whose `availability(context)` reports `ok: true`. */
    static async availableFor(context?: ServiceContext): Promise<string[]> {
        const checks = await Promise.all(
            SourceRegistry.available().map(async name => {
                const a = await SourceRegistry.availabilityOf(name, context)
                return a.ok ? name : null
            }),
        )
        return checks.filter((n): n is string => n !== null)
    }

    static async availabilityOf(name: string, context?: ServiceContext): Promise<SourceAvailability> {
        if (!SourceRegistry.has(name)) return { ok: false, reason: `unknown source "${name}"` }

        const now = Date.now()
        const cached = SourceRegistry.availabilityCache.get(name)
        if (cached && cached.expiresAt > now) {
            return cached.result
        }

        let result: SourceAvailability
        try {
            result = await SourceRegistry.create(name).availability(context)
        } catch (e: any) {
            result = { ok: false, reason: String(e?.message ?? e) }
        }
        SourceRegistry.availabilityCache.set(name, {
            result,
            expiresAt: now + AVAILABILITY_CACHE_TTL_MS,
        })
        return result
    }

    /** Wipe the cache. Call from tests or when network conditions are
     *  expected to have changed (e.g., after a node config reload). */
    static clearAvailabilityCache(): void {
        SourceRegistry.availabilityCache.clear()
    }
}
