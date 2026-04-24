import * as fs from 'fs'
import * as path from 'path'
import { runGoldenScraper } from './golden-harness'

describe('golden-harness (self-check before Phase 2.7 uses it as a regression gate)', () => {
    it('reproduces the captured fixture byte-identically', async () => {
        const { events, csvBytes } = await runGoldenScraper({ count: 50 })
        const expectedEvents = JSON.parse(
            fs.readFileSync(path.join(__dirname, 'expected-events.json'), 'utf8'),
        )
        const expectedCsv = fs.readFileSync(path.join(__dirname, 'expected.csv'))
        expect(events).toEqual(expectedEvents)
        expect(csvBytes.equals(expectedCsv)).toBe(true)
    })
})
