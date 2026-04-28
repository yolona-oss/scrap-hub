import { ExporterRegistry } from "./registry"
import { JsonExporter } from "./json"

export { ExporterRegistry } from "./registry"
export type { IExporter, ExportResult, ExporterFactory } from "./types"

/** Register the always-on baseline exporter (`json`). Optional
 *  exporters with extra runtime dependencies (csv, google-sheets) live
 *  under `../plugins/` and are registered separately by the app. */
export function registerExporters() {
    ExporterRegistry.register('json', () => new JsonExporter())
}
