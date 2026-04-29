import * as fs from 'fs'
import * as path from 'path'
import { IExporter, ExportResult } from './types'
import { OrgData, SearchQuery } from '../types'
import { log } from '@cmd-hub/common'

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

        const countByStatus = {
            verified: data.filter(d => d.status === 'verified').length,
            partial: data.filter(d => d.status === 'partial').length,
            rejected: data.filter(d => d.status === 'rejected').length,
        }
        const aggregatorsHit = Array.from(new Set(
            data.flatMap(d => d.sources)
                .filter(s => s.kind.startsWith('aggregator'))
                .map(s => {
                    try { return new URL(s.url).hostname } catch { return '' }
                })
                .filter(Boolean)
        ))

        const payload = {
            schemaVersion: 2 as const,
            query,
            exportedAt: new Date().toISOString(),
            run: {
                agentVersion: process.env.npm_package_version ?? 'unknown',
                parentModel: '',
                extractorModel: '',
                toolCallsUsed: 0,
                extractionsByMethod: { deterministic: 0, llm: 0 },
                durationMs: 0,
                pagesFetched: 0,
                aggregatorsHit,
            },
            count: data.length,
            countByStatus,
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
