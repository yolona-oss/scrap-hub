import { ExporterRegistry } from "./registry"
import { CsvExporter } from "../plugins/csv"

export { ExporterRegistry } from "./registry"
export type { IExporter, ExportResult, ExporterFactory } from "./types"

export function registerExporters() {
    ExporterRegistry.register('csv', () => new CsvExporter())
}
