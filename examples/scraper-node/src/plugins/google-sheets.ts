import { IExporter, ExportResult } from "../exporters/types"
import type { ServiceContext } from "../exporters/types"
import { ExporterRegistry } from "../exporters/registry"
import { OrgData, SearchQuery } from "../types"
import type { ScraperArgs, GoogleSheetsConfig } from "../scraper-service/args-tree"
import { log } from "@cmd-hub/common"

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

export class GoogleSheetsExporter implements IExporter {
    readonly name = 'google-sheets'
    readonly fileExtension = null

    async export(data: OrgData[], query: SearchQuery, context?: ServiceContext): Promise<ExportResult> {
        const gs = ((context?.args ?? {}) as Partial<ScraperArgs>).googleSheets as GoogleSheetsConfig | undefined
        const credentials = gs?.credentials ?? ''
        const spreadsheetId = gs?.spreadsheetId ?? ''

        if (!credentials || !spreadsheetId) {
            return {
                type: 'url',
                message: 'Google Sheets not configured. Use /sconfig scraper googleSheets.credentials <json> and /sconfig scraper googleSheets.spreadsheetId <id>',
            }
        }

        try {
            const { google } = require('googleapis')
            const { GoogleAuth } = require('google-auth-library')

            const creds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials
            const auth = new GoogleAuth({
                credentials: creds,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            })

            const sheets = google.sheets({ version: 'v4', auth })

            const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
            const safeQuery = query.query.replace(/['"!\\*?[\]:]/g, '').slice(0, 80)
            const sheetTitle = `${safeQuery} (${timestamp})`.slice(0, 100)

            // Add a new sheet/tab
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: sheetTitle }
                        }
                    }]
                }
            })

            // Write headers + data (long-format: one row per phone × email × address)
            const header = ['name', 'phone', 'email', 'address', 'status', 'confidence', 'extractionMethod', 'sourceUrls']
            const longRows = data.flatMap(toLongFormatRows)
            const values = [
                header,
                ...longRows.map(r => [r.name, r.phone, r.email, r.address, r.status, r.confidence, r.extractionMethod, r.sourceUrls]),
            ]

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetTitle}'!A1`,
                valueInputOption: 'RAW',
                requestBody: { values }
            })

            const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`

            return {
                type: 'url',
                url,
                message: `Exported ${data.length} organizations (${longRows.length} rows) to Google Sheets tab "${sheetTitle}"`,
            }
        } catch (e: any) {
            log.error(`Google Sheets export error: ${e.message ?? e}`)
            return {
                type: 'url',
                message: `Google Sheets export failed. Check server logs for details.`,
            }
        }
    }
}

export function registerGoogleSheetsPlugin() {
    ExporterRegistry.register('google-sheets', () => new GoogleSheetsExporter())
}
