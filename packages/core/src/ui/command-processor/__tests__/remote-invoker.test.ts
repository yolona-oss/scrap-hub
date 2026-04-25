import { RemoteCmdInvoker } from '../remote-invoker'
import { ManifestAggregator, type ICmdNodeClient } from '@cmd-hub/transport'

function fakeManifest(nodeId: string, cmd: string) {
    return {
        nodeId,
        nodeName: nodeId,
        version: '1.0.0',
        commands: [{
            name: cmd,
            compatibilityId: `com.ex.${cmd}`,
            version: '1.0.0',
            description: '',
            args: [],
            aliases: [],
        }],
        services: [],
        configs: [],
        hardware: {} as any,
        metrics: {} as any,
    }
}

describe('RemoteCmdInvoker', () => {
    it('fails fast when no pool member exists', async () => {
        const agg = new ManifestAggregator()
        const client: ICmdNodeClient = {
            invoke: async () => { throw new Error('should not be called') },
        }
        const invoker = new RemoteCmdInvoker({
            aggregator: agg,
            client,
            createDashboard: () => ({
                attach: async () => {},
                detach: async () => {},
                onEvent: jest.fn(),
                sendIntercom: async () => {},
            } as any),
        })
        const r = await invoker.invoke({ command: 'missing', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/no nodes available/)
    })

    it('streams events through the dashboard and resolves with done text', async () => {
        const agg = new ManifestAggregator()
        agg.attach(fakeManifest('A', 'echo'))

        const dashEvents: any[] = []
        const dashboard: any = {
            attach: async () => {},
            detach: async () => {},
            onEvent: (e: any) => { dashEvents.push(e) },
            sendIntercom: async () => {},
        }

        const client: ICmdNodeClient = {
            invoke: async () => ({
                sessionId: 's1',
                send: async () => {},
                cancel: async () => {},
                async *events() {
                    yield { seq: 1, message: { text: 'hi' } } as any
                    yield { seq: 2, done: { finalMessage: 'bye' } } as any
                },
            }),
        }

        const invoker = new RemoteCmdInvoker({
            aggregator: agg,
            client,
            createDashboard: () => dashboard,
        })

        const r = await invoker.invoke({ command: 'echo', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(true)
        expect(r.markup.text).toBe('bye')
        expect(dashEvents.map((e) => e.kind)).toEqual(['message', 'done'])
    })
})
