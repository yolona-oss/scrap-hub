/**
 * Phase 5.12 — golden scraper loopback regression test.
 *
 * Captured fixture: `docs/superpowers/fixtures/golden-scraper/{expected-events.json,
 * expected.csv, golden-harness.ts}`. The harness runs a deterministic
 * fake scraper (fixed orgs, fixed progress cadence, fixed final message)
 * and emits an event sequence that the old distributed stack captured
 * byte-identically in Phase 0.
 *
 * This test drives the NEW stack's event path — harness events go through
 * a FakeCmdNodeClient stub that replays them as proto messages, and come
 * out the hub-side RemoteCmdInvoker via a captured dashboard. If any
 * layer mangles ordering, payload shape, or final text, the assertion
 * fails.
 */
import * as fs from 'fs'
import * as path from 'path'
import { ManifestAggregator, FakeCmdNodeClient, CmdHubProto } from '@cmd-hub/transport'
import { RemoteCmdInvoker } from '../ui/command-processor/remote-invoker'
import type { DashboardEvent } from '../ui/command-processor/dashboard'
import {
    runGoldenScraper,
    orgsToCsvBytes,
    type CapturedEvent,
} from '../../../../docs/superpowers/fixtures/golden-scraper/golden-harness'

const FIXTURE_DIR = path.resolve(__dirname, '../../../../docs/superpowers/fixtures/golden-scraper')

function capturedToProto(e: CapturedEvent): CmdHubProto.InvokeServer {
    const base = { seq: e.seq }
    switch (e.kind) {
        case 'message':
            return { ...base, message: { text: String(e.payload.text) } }
        case 'progress':
            return {
                ...base,
                progress: {
                    name: String(e.payload.name),
                    current: Number(e.payload.current),
                    total: Number(e.payload.total),
                },
            }
        case 'progressStatus':
            return {
                ...base,
                progressStatus: {
                    name: String(e.payload.name),
                    status: String(e.payload.status),
                },
            }
        case 'done':
            return { ...base, done: { finalMessage: String(e.payload.finalMessage) } }
    }
}

describe('golden scraper loopback', () => {
    it('harness CSV still matches the pre-rewrite snapshot', async () => {
        const { csvBytes } = await runGoldenScraper({ count: 50 })
        const expected = fs.readFileSync(path.join(FIXTURE_DIR, 'expected.csv'))
        expect(csvBytes.toString('utf8')).toBe(expected.toString('utf8'))
        expect(orgsToCsvBytes).toBeDefined()
    })

    it('harness events still match the pre-rewrite snapshot', async () => {
        const { events } = await runGoldenScraper({ count: 50 })
        const expected = JSON.parse(
            fs.readFileSync(path.join(FIXTURE_DIR, 'expected-events.json'), 'utf8'),
        )
        expect(events).toEqual(expected)
    })

    it('events survive the hub-side dispatch path byte-identically', async () => {
        const { events: capturedEvents } = await runGoldenScraper({ count: 50 })
        const protoEvents = capturedEvents.map(capturedToProto)

        const aggregator = new ManifestAggregator()
        aggregator.attach({
            nodeId: 'golden-node',
            nodeName: 'golden-node',
            version: '1.0.0',
            commands: [{
                name: 'scraper',
                compatibilityId: 'com.example.golden.scraper',
                version: '1.0.0',
                description: 'golden scraper',
                args: [],
                aliases: [],
            }],
            services: [],
            configs: [],
            hardware: {} as any,
            metrics: {} as any,
        })

        const client = new FakeCmdNodeClient(async (_nodeId, _start, emit) => {
            for (const ev of protoEvents) emit(ev)
        })

        const dashEvents: DashboardEvent[] = []
        const dashboard = {
            attach: async () => {},
            detach: async () => {},
            onEvent: (e: DashboardEvent) => { dashEvents.push(e) },
            sendIntercom: async () => {},
        }

        const invoker = new RemoteCmdInvoker({
            aggregator,
            client,
            createDashboard: () => dashboard as any,
        })

        const result = await invoker.invoke({
            command: 'scraper',
            args: {},
            userId: 'golden-user',
            uiHandle: null,
        })

        expect(result.success).toBe(true)
        expect(dashEvents.length).toBe(capturedEvents.length)

        for (let i = 0; i < capturedEvents.length; i++) {
            const src = capturedEvents[i]
            const got = dashEvents[i]
            expect(got.kind).toBe(src.kind)
            switch (src.kind) {
                case 'message':
                    expect((got as { kind: 'message'; text: string }).text).toBe(src.payload.text)
                    break
                case 'progress':
                    expect(got).toMatchObject({
                        kind: 'progress',
                        name: src.payload.name,
                        current: src.payload.current,
                        total: src.payload.total,
                    })
                    break
                case 'progressStatus':
                    expect(got).toMatchObject({
                        kind: 'progressStatus',
                        name: src.payload.name,
                        status: src.payload.status,
                    })
                    break
                case 'done':
                    expect((got as { kind: 'done'; finalMessage: string }).finalMessage).toBe(
                        src.payload.finalMessage,
                    )
                    break
            }
        }

        const lastDone = capturedEvents[capturedEvents.length - 1]
        expect(lastDone.kind).toBe('done')
        expect(result.markup.text).toBe(lastDone.payload.finalMessage)
    })
})
