import { IScraperSource, ScraperSourceFactory, SourceAvailability } from "./types"
import type { ServiceContext } from "../exporters/types"
import { log } from "@cmd-hub/common"

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
        if (SourceRegistry.factories.has(name)) {
            log.warn(`SourceRegistry.register: overwriting existing factory for "${name}"`)
        }
        log.debug(`SourceRegistry.register: source="${name}"`)
        SourceRegistry.factories.set(name, factory)
    }

    static create(name: string): IScraperSource {
        const factory = SourceRegistry.factories.get(name)
        if (!factory) {
            const available = SourceRegistry.available().join(", ")
            log.error(`SourceRegistry.create: unknown source "${name}" (available: ${available})`)
            throw new Error(`Unknown source "${name}". Available: ${available}`)
        }
        log.trace(`SourceRegistry.create: instantiating "${name}"`)
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
        if (!SourceRegistry.has(name)) {
            log.warn(`SourceRegistry.availabilityOf: unknown source "${name}"`)
            return { ok: false, reason: `unknown source "${name}"` }
        }

        const now = Date.now()
        const cached = SourceRegistry.availabilityCache.get(name)
        if (cached && cached.expiresAt > now) {
            log.trace(`SourceRegistry.availabilityOf: cache hit for "${name}" ok=${cached.result.ok}`)
            return cached.result
        }

        let result: SourceAvailability
        try {
            result = await SourceRegistry.create(name).availability(context)
            log.debug(`SourceRegistry.availabilityOf: probed "${name}" ok=${result.ok}${result.ok ? '' : ` reason="${(result.reason ?? '').slice(0, 200)}"`}`)
        } catch (e: any) {
            log.error(`SourceRegistry.availabilityOf: probe of "${name}" threw: ${e?.message ?? e}`)
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
        log.debug('SourceRegistry.clearAvailabilityCache: wiping')
        SourceRegistry.availabilityCache.clear()
    }
}
