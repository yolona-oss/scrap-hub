import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from '../exporters/types'
import { ExporterRegistry } from '../exporters/registry'
import { OrgData, SearchQuery } from '../types'

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
        fs.mkdirSync(dir, { recursive: true })

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const safeQuery = query.query.replace(/[^a-zA-Zа-яА-Я0-9 ]/g, '').slice(0, 30).trim().replace(/ /g, '_')
        const fileName = `orgs_${safeQuery}_${timestamp}.csv`
        const filePath = path.join(dir, fileName)

        fs.writeFileSync(filePath, '﻿' + csv, 'utf-8') // BOM for Excel UTF-8

        return {
            type: 'file',
            filePath,
            message: `Exported ${data.length} organizations to ${fileName}`,
        }
    }
}

export function registerCsvExporter(): void {
    ExporterRegistry.register('csv', () => new CsvExporter())
}
