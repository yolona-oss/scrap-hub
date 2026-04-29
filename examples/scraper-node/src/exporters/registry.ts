import { IExporter, ExporterFactory } from "./types"
import { log } from "@cmd-hub/common"

export class ExporterRegistry {
    private static factories = new Map<string, ExporterFactory>()

    static register(name: string, factory: ExporterFactory): void {
        if (ExporterRegistry.factories.has(name)) {
            log.warn(`ExporterRegistry.register: overwriting existing exporter "${name}"`)
        }
        log.debug(`ExporterRegistry.register: exporter="${name}"`)
        ExporterRegistry.factories.set(name, factory)
    }

    static create(name: string): IExporter {
        const factory = ExporterRegistry.factories.get(name)
        if (!factory) {
            const available = ExporterRegistry.available().join(", ")
            log.error(`ExporterRegistry.create: unknown exporter "${name}" (available: ${available})`)
            throw new Error(`Unknown exporter "${name}". Available: ${available}`)
        }
        log.trace(`ExporterRegistry.create: instantiating "${name}"`)
        return factory()
    }

    static has(name: string): boolean {
        return ExporterRegistry.factories.has(name)
    }

    static available(): string[] {
        return Array.from(ExporterRegistry.factories.keys())
    }
}
