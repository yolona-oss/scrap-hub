import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from './types'
import { OrgData, SearchQuery } from '../types'

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
        const dir = path.join('storage', 'exports')
        fs.mkdirSync(dir, { recursive: true })

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
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')

        return {
            type: 'file',
            filePath,
            message: `Exported ${data.length} organizations to ${fileName}`,
        }
    }
}
