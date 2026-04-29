import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { JsonExporter } from '../json'
import type { OrgData, SearchQuery } from '../../types'

const ORG: OrgData = {
    name: 'Acme', phones: ['+78121001010'], emails: [], addresses: [],
    sources: [], status: 'partial', confidence: 0.5, extractionMethod: 'deterministic',
}
const QUERY: SearchQuery = { query: 'q', sources: [], maxResults: 10 }

describe('JsonExporter v2 envelope', () => {
    let tmpDir: string
    let prevCwd: string

    beforeAll(() => {
        prevCwd = process.cwd()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-export-test-'))
        process.chdir(tmpDir)
    })

    afterAll(() => {
        process.chdir(prevCwd)
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('writes a v2 envelope with schemaVersion=2 and run/countByStatus blocks', async () => {
        const exporter = new JsonExporter()
        const result = await exporter.export([ORG], QUERY)
        const payload = JSON.parse(fs.readFileSync(result.filePath!, 'utf-8'))
        expect(payload.schemaVersion).toBe(2)
        expect(payload.run).toBeDefined()
        expect(payload.run.toolCallsUsed).toBe(0)
        expect(payload.countByStatus).toEqual({ verified: 0, partial: 1, rejected: 0 })
        expect(payload.results).toHaveLength(1)
        expect(payload.results[0].phones).toEqual(['+78121001010'])
    })

    it('countByStatus reflects mixed statuses', async () => {
        const verified: OrgData = { ...ORG, status: 'verified' }
        const rejected: OrgData = { ...ORG, status: 'rejected' }
        const exporter = new JsonExporter()
        const result = await exporter.export([ORG, verified, verified, rejected], QUERY)
        const payload = JSON.parse(fs.readFileSync(result.filePath!, 'utf-8'))
        expect(payload.countByStatus).toEqual({ verified: 2, partial: 1, rejected: 1 })
    })

    it('aggregatorsHit derives from sources kinds', async () => {
        const o: OrgData = {
            ...ORG,
            sources: [
                { url: 'https://zoon.ru/spb/x/', kind: 'aggregator-detail', extractedAt: '2026-04-30T00:00:00Z', extractionMethod: 'deterministic' },
                { url: 'https://other.ru/', kind: 'org-site', extractedAt: '2026-04-30T00:00:00Z', extractionMethod: 'deterministic' },
            ],
        }
        const exporter = new JsonExporter()
        const result = await exporter.export([o], QUERY)
        const payload = JSON.parse(fs.readFileSync(result.filePath!, 'utf-8'))
        expect(payload.run.aggregatorsHit).toContain('zoon.ru')
        expect(payload.run.aggregatorsHit).not.toContain('other.ru')
    })
})
