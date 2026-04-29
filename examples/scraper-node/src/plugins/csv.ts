import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from '../exporters/types'
import { ExporterRegistry } from '../exporters/registry'
import { OrgData, SearchQuery } from '../types'
import { log } from '@cmd-hub/common'

function escapeCsv(value: string | null): string {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
    }
    return str
}

/**
 * CSV exporter, packaged as an opt-in plugin (parallel to
 * `google-sheets.ts`). Writes UTF-8 with BOM so Excel auto-detects the
 * encoding when the user opens the file. Headers are Russian, matching
 * the scraper's primary user base.
 */
export class CsvExporter implements IExporter {
    readonly name = 'csv'
    readonly fileExtension = '.csv'

    async export(data: OrgData[], query: SearchQuery): Promise<ExportResult> {
        log.debug(`csv-exporter.export: rows=${data.length} query="${query.query}"`)
        const headers = ['Наименование организации', 'Источник', 'E-mail', 'Телефон', 'Адрес', 'URL']
        const rows = data.map(org => [
            escapeCsv(org.name),
            escapeCsv(org.source),
            escapeCsv(org.email),
            escapeCsv(org.phone),
            escapeCsv(org.address),
            escapeCsv(org.url ?? null),
        ].join(','))

        const csv = [headers.join(','), ...rows].join('\n')

        const dir = path.join('storage', 'exports')
        try {
            fs.mkdirSync(dir, { recursive: true })
        } catch (e: any) {
            log.error(`csv-exporter.export: mkdir "${dir}" failed: ${e?.message ?? e}`)
            throw e
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const safeQuery = query.query.replace(/[^a-zA-Zа-яА-Я0-9 ]/g, '').slice(0, 30).trim().replace(/ /g, '_')
        const fileName = `orgs_${safeQuery}_${timestamp}.csv`
        const filePath = path.join(dir, fileName)

        try {
            fs.writeFileSync(filePath, '﻿' + csv, 'utf-8') // BOM for Excel UTF-8
            log.info(`csv-exporter.export: wrote ${data.length} rows to ${filePath} (${csv.length}b)`)
        } catch (e: any) {
            log.error(`csv-exporter.export: writeFileSync "${filePath}" failed: ${e?.message ?? e}`)
            throw e
        }

        return {
            type: 'file',
            filePath,
            message: `Exported ${data.length} organizations to ${fileName}`,
        }
    }
}

export function registerCsvExporter(): void {
    log.debug('csv-exporter.registerCsvExporter: registering "csv"')
    ExporterRegistry.register('csv', () => new CsvExporter())
}
