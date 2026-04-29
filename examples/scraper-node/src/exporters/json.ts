import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from './types'
import { OrgData, SearchQuery } from '../types'
import { log } from '@cmd-hub/common'

/**
 * JSON exporter — the always-on baseline. Writes a single `.json` file
 * holding the original `SearchQuery` (so a saved file is self-describing
 * for replay) plus the full `OrgData[]` array. No external dependencies,
 * works on any node, no per-user credentials.
 */
export class JsonExporter implements IExporter {
    readonly name = 'json'
    readonly fileExtension = '.json'

    async export(data: OrgData[], query: SearchQuery): Promise<ExportResult> {
        log.debug(`json-exporter.export: rows=${data.length} query="${query.query}"`)
        const dir = path.join('storage', 'exports')
        try {
            fs.mkdirSync(dir, { recursive: true })
        } catch (e: any) {
            log.error(`json-exporter.export: mkdir "${dir}" failed: ${e?.message ?? e}`)
            throw e
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const safeQuery = query.query.replace(/[^a-zA-Zа-яА-Я0-9 ]/g, '').slice(0, 30).trim().replace(/ /g, '_')
        const fileName = `orgs_${safeQuery}_${timestamp}.json`
        const filePath = path.join(dir, fileName)

        const payload = {
            query,
            exportedAt: new Date().toISOString(),
            count: data.length,
            results: data,
        }
        const json = JSON.stringify(payload, null, 2)
        try {
            fs.writeFileSync(filePath, json, 'utf-8')
            log.info(`json-exporter.export: wrote ${data.length} rows to ${filePath} (${json.length}b)`)
        } catch (e: any) {
            log.error(`json-exporter.export: writeFileSync "${filePath}" failed: ${e?.message ?? e}`)
            throw e
        }

        return {
            type: 'file',
            filePath,
            message: `Exported ${data.length} organizations to ${fileName}`,
        }
    }
}
