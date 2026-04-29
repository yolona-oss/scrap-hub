import { ExporterRegistry } from "./registry"
import { JsonExporter } from "./json"
import { log } from "@cmd-hub/common"

export { ExporterRegistry } from "./registry"
export type { IExporter, ExportResult, ExporterFactory } from "./types"

/** Register the always-on baseline exporter (`json`). Optional
 *  exporters with extra runtime dependencies (csv, google-sheets) live
 *  under `../plugins/` and are registered separately by the app. */
export function registerExporters() {
    log.info('exporters.registerExporters: registering baseline json exporter')
    ExporterRegistry.register('json', () => new JsonExporter())
}
