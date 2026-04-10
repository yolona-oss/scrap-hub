import { IExporter, ExporterFactory } from "./types"

export class ExporterRegistry {
    private static factories = new Map<string, ExporterFactory>()

    static register(name: string, factory: ExporterFactory): void {
        ExporterRegistry.factories.set(name, factory)
    }

    static create(name: string): IExporter {
        const factory = ExporterRegistry.factories.get(name)
        if (!factory) {
            const available = ExporterRegistry.available().join(", ")
            throw new Error(`Unknown exporter "${name}". Available: ${available}`)
        }
        return factory()
    }

    static has(name: string): boolean {
        return ExporterRegistry.factories.has(name)
    }

    static available(): string[] {
        return Array.from(ExporterRegistry.factories.keys())
    }
}
