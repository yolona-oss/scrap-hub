import { NodeManifest, InvokeServer } from '../generated/cmd_node'

describe('protobuf round-trip', () => {
    it('encodes and decodes a minimal NodeManifest', () => {
        const m: NodeManifest = {
            nodeId: 'n1',
            nodeName: 'node-one',
            version: '1.0.0',
            commands: [{
                name: 'scraper',
                compatibilityId: 'com.example.scraper',
                version: '1.0.0',
                description: 'scrapes',
                args: [],
                aliases: [],
            }],
            services: [],
            configs: [],
            hardware: {
                cpuCores: 4,
                totalMemoryBytes: 8_000_000_000,
                os: 'linux',
                arch: 'x64',
                hostname: 'h',
            },
            metrics: { gauges: [], counters: [], histograms: [] },
        }
        const bytes = NodeManifest.encode(m).finish()
        const back = NodeManifest.decode(bytes)
        expect(back.commands).toHaveLength(1)
        expect(back.commands[0].name).toBe('scraper')
        expect(back.commands[0].compatibilityId).toBe('com.example.scraper')
        expect(back.hardware?.cpuCores).toBe(4)
    })

    it('round-trips an InvokeServer with a message variant', () => {
        const msg: InvokeServer = {
            seq: 7,
            message: { text: 'hi' },
        }
        const bytes = InvokeServer.encode(msg).finish()
        const back = InvokeServer.decode(bytes)
        expect(back.seq).toBe(7)
        expect(back.message?.text).toBe('hi')
        expect(back.done).toBeUndefined()
    })

    it('round-trips an InvokeServer with a done variant', () => {
        const msg: InvokeServer = {
            seq: 99,
            done: { finalMessage: 'ok' },
        }
        const bytes = InvokeServer.encode(msg).finish()
        const back = InvokeServer.decode(bytes)
        expect(back.seq).toBe(99)
        expect(back.done?.finalMessage).toBe('ok')
        expect(back.message).toBeUndefined()
    })
})
