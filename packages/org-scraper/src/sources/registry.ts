import { IScraperSource, ScraperSourceFactory } from "./types"

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

    static available(): string[] {
        return Array.from(SourceRegistry.factories.keys())
    }
}
