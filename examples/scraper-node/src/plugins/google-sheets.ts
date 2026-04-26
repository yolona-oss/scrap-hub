import { IExporter, ExportResult } from "../exporters/types"
import type { ServiceContext } from "../exporters/types"
import { ExporterRegistry } from "../exporters/registry"
import { OrgData, SearchQuery } from "../types"
import { resolveScraperUserConfig } from "../scraper-config"
import { log } from "@cmd-hub/common"

export class GoogleSheetsExporter implements IExporter {
    readonly name = 'google-sheets'
    readonly fileExtension = null

    async export(data: OrgData[], query: SearchQuery, context?: ServiceContext): Promise<ExportResult> {
        const { googleSheets } = await resolveScraperUserConfig(context)
        const { credentials, spreadsheetId } = googleSheets

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

            // Write headers + data
            const headers = ['Наименование организации', 'Источник', 'E-mail', 'Телефон', 'Адрес', 'URL']
            const rows = data.map(org => [
                org.name,
                org.source,
                org.email || '',
                org.phone || '',
                org.address || '',
                org.url || '',
            ])

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetTitle}'!A1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [headers, ...rows]
                }
            })

            const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`

            return {
                type: 'url',
                url,
                message: `Exported ${data.length} organizations to Google Sheets tab "${sheetTitle}"`,
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
