import { IScraperSource, ScraperSourceFactory, SourceAvailability } from "./types"
import type { ServiceContext } from "../exporters/types"

export class SourceRegistry {
    private static factories = new Map<string, ScraperSourceFactory>()

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
                try {
                    const a = await SourceRegistry.create(name).availability(context)
                    return a.ok ? name : null
                } catch {
                    return null
                }
            }),
        )
        return checks.filter((n): n is string => n !== null)
    }

    static async availabilityOf(name: string, context?: ServiceContext): Promise<SourceAvailability> {
        if (!SourceRegistry.has(name)) return { ok: false, reason: `unknown source "${name}"` }
        try {
            return await SourceRegistry.create(name).availability(context)
        } catch (e: any) {
            return { ok: false, reason: String(e?.message ?? e) }
        }
    }
}
