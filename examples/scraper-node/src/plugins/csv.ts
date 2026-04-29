import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from '../exporters/types'
import { ExporterRegistry } from '../exporters/registry'
import { OrgData, SearchQuery } from '../types'
import { log } from '@cmd-hub/common'

function escapeCsv(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
    }
    return str
}

interface LongFormatRow {
    name: string
    phone: string
    email: string
    address: string
    status: string
    confidence: number
    extractionMethod: string
    sourceUrls: string
}

function toLongFormatRows(org: OrgData): LongFormatRow[] {
    const phones = org.phones.length ? org.phones : ['']
    const emails = org.emails.length ? org.emails : ['']
    const addresses = org.addresses.length ? org.addresses : ['']
    const sourceUrls = org.sources.map(s => s.url).join(';')
    const rows: LongFormatRow[] = []
    for (const phone of phones) {
        for (const email of emails) {
            for (const address of addresses) {
                rows.push({
                    name: org.name,
                    phone, email, address,
                    status: org.status,
                    confidence: org.confidence,
                    extractionMethod: org.extractionMethod,
                    sourceUrls,
                })
            }
        }
    }
    return rows
}

/**
 * CSV exporter, packaged as an opt-in plugin (parallel to
 * `google-sheets.ts`). Writes UTF-8 with BOM so Excel auto-detects the
 * encoding when the user opens the file. One row per (org, phone, email,
 * address) cross-product (long format). Empty arrays still produce one row
 * with empty cells.
 */
export class CsvExporter implements IExporter {
    readonly name = 'csv'
    readonly fileExtension = '.csv'

    async export(data: OrgData[], query: SearchQuery): Promise<ExportResult> {
        log.debug(`csv-exporter.export: orgs=${data.length} query="${query.query}"`)
        const headers = ['name', 'phone', 'email', 'address', 'status', 'confidence', 'extractionMethod', 'sourceUrls']
        const longRows = data.flatMap(toLongFormatRows)
        const rows = longRows.map(r => [
            escapeCsv(r.name),
            escapeCsv(r.phone),
            escapeCsv(r.email),
            escapeCsv(r.address),
            escapeCsv(r.status),
            escapeCsv(r.confidence),
            escapeCsv(r.extractionMethod),
            escapeCsv(r.sourceUrls),
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
            log.info(`csv-exporter.export: wrote ${longRows.length} rows (${data.length} orgs) to ${filePath} (${csv.length}b)`)
        } catch (e: any) {
            log.error(`csv-exporter.export: writeFileSync "${filePath}" failed: ${e?.message ?? e}`)
            throw e
        }

        return {
            type: 'file',
            filePath,
            message: `Exported ${data.length} organizations (${longRows.length} rows) to ${fileName}`,
        }
    }
}

export function registerCsvExporter(): void {
    log.debug('csv-exporter.registerCsvExporter: registering "csv"')
    ExporterRegistry.register('csv', () => new CsvExporter())
}
