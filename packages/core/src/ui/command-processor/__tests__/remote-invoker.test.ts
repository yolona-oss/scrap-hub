import { RemoteCmdInvoker } from '../remote-invoker'
import { ManifestAggregator, type ICmdNodeClient } from '@cmd-hub/transport'
import type { ISessionLogRepo, SessionLogEntry } from '@cmd-hub/common'

function fakeManifest(nodeId: string, cmd: string): any {
    return {
        nodeId,
        nodeName: nodeId,
        version: '1.0.0',
        commands: [{
            name: cmd,
            compatibilityId: `com.ex.${cmd}`,
            version: '1.0.0',
            description: '',
            aliases: [],
            requires: [],
        }],
        services: [],
        configs: [],
        hardware: {} as any,
        metrics: {} as any,
        publishedCapabilities: [],
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
        const r = await invoker.invoke({ command: 'missing', args: {}, userId: 'u', uiHandle: { ctx: {}, uiImpl: {} as any } })
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
                    yield {
                        seq: 1,
                        uiMessage: {
                            kind: 'text',
                            payloadJson: Buffer.from(JSON.stringify({ text: 'hi' })),
                            severity: '',
                            compatibilityId: 'cmd-hub.builtin.text',
                            version: '1.0.0',
                        },
                    } as any
                    yield { seq: 2, done: { finalMessage: 'bye' } } as any
                },
            }),
        }

        const invoker = new RemoteCmdInvoker({
            aggregator: agg,
            client,
            createDashboard: () => dashboard,
        })

        const r = await invoker.invoke({ command: 'echo', args: {}, userId: 'u', uiHandle: { ctx: {}, uiImpl: {} as any } })
        expect(r.success).toBe(true)
        expect(r.markup.text).toBe('bye')
        expect(dashEvents.map((e) => e.kind)).toEqual(['uiMessage', 'done'])
    })

    it('replays existing log entries before live events when resuming a session', async () => {
        const agg = new ManifestAggregator()
        agg.attach(fakeManifest('A', 'echo'))

        const existing: SessionLogEntry[] = [
            { sessionId: 'r1', seq: 0, ts: 1, kind: 'text', payload: { text: 'old-1' }, compatibilityId: 'x', version: '1.0.0' },
            { sessionId: 'r1', seq: 1, ts: 2, kind: 'text', payload: { text: 'old-2' }, compatibilityId: 'x', version: '1.0.0' },
        ]
        const appended: SessionLogEntry[] = []
        const repo: ISessionLogRepo = {
            async append(entries) { appended.push(...entries) },
            async read() { return existing },
            async latestSeq() { return 1 },
            async deleteBySession() { return 0 },
            async listSessions() { return [] },
        }

        const dashEvents: any[] = []
        const dashboard: any = {
            attach: async () => {},
            detach: async () => {},
            onEvent: (e: any) => { dashEvents.push(e) },
            sendIntercom: async () => {},
        }

        const client: ICmdNodeClient = {
            invoke: async () => ({
                sessionId: 'r1',
                send: async () => {},
                cancel: async () => {},
                async *events() {
                    yield {
                        seq: 1,
                        uiMessage: {
                            kind: 'text',
                            payloadJson: Buffer.from(JSON.stringify({ text: 'live-1' })),
                            severity: '',
                            compatibilityId: 'cmd-hub.builtin.text',
                            version: '1.0.0',
                        },
                    } as any
                    yield { seq: 2, done: { finalMessage: 'ok' } } as any
                },
            }),
        }

        const invoker = new RemoteCmdInvoker({
            aggregator: agg,
            client,
            createDashboard: () => dashboard,
            sessionLogRepo: repo,
        })

        // s='r1' makes the invoker treat this as a resume of session r1.
        const r = await invoker.invoke({
            command: 'echo',
            args: { s: 'r1' },
            userId: 'u',
            uiHandle: { ctx: {}, uiImpl: {} as any },
        })
        expect(r.success).toBe(true)
        // Dashboard saw the two replayed entries first, then the live one,
        // then done.
        expect(dashEvents.map(e => e.kind)).toEqual(['uiMessage', 'uiMessage', 'uiMessage', 'done'])
        const texts = dashEvents.slice(0, 3).map(e => (e.message as { text: string }).text)
        expect(texts).toEqual(['old-1', 'old-2', 'live-1'])
        // The live event's text was also written back through the writer
        // (resumed seq starts at 2 = latestSeq+1).
        expect(appended.length).toBe(1)
        expect(appended[0].seq).toBe(2)
        expect(appended[0].payload).toEqual({ text: 'live-1' })
    })

    it('registers the dashboard with the registry and removes it on success', async () => {
        const agg = new ManifestAggregator()
        agg.attach(fakeManifest('A', 'echo'))

        const dashboard: any = {
            attach: async () => {},
            detach: async () => {},
            onEvent: jest.fn(),
            sendIntercom: async () => {},
        }
        const client: ICmdNodeClient = {
            invoke: async () => ({
                sessionId: 's1',
                send: async () => {},
                cancel: async () => {},
                async *events() {
                    yield { seq: 1, done: { finalMessage: 'ok' } } as any
                },
            }),
        }
        const invoker = new RemoteCmdInvoker({
            aggregator: agg, client, createDashboard: () => dashboard,
        })
        const setSpy = jest.fn()
        const removeSpy = jest.fn()
        const registry = {
            setDashboard: setSpy,
            getDashboard: () => undefined,
            removeDashboard: removeSpy,
            listUserDashboards: () => [],
        }

        await invoker.invoke({
            command: 'echo', args: {}, userId: 'u',
            uiHandle: { ctx: {}, uiImpl: {} as any },
            dashboardRegistry: registry,
        })

        expect(setSpy).toHaveBeenCalledWith('u', 'echo', dashboard)
        expect(removeSpy).toHaveBeenCalledWith('u', 'echo')
        // setDashboard must come strictly before removeDashboard.
        expect(setSpy.mock.invocationCallOrder[0])
            .toBeLessThan(removeSpy.mock.invocationCallOrder[0])
    })

    it('removes the dashboard from the registry when the node throws on invoke', async () => {
        const agg = new ManifestAggregator()
        agg.attach(fakeManifest('A', 'echo'))

        const dashboard: any = {
            attach: async () => {},
            detach: async () => {},
            onEvent: jest.fn(),
            sendIntercom: async () => {},
        }
        const client: ICmdNodeClient = {
            invoke: async () => { throw new Error('node down') },
        }
        const invoker = new RemoteCmdInvoker({
            aggregator: agg, client, createDashboard: () => dashboard,
        })
        const removeSpy = jest.fn()
        const registry = {
            setDashboard: jest.fn(),
            getDashboard: () => undefined,
            removeDashboard: removeSpy,
            listUserDashboards: () => [],
        }

        const r = await invoker.invoke({
            command: 'echo', args: {}, userId: 'u',
            uiHandle: { ctx: {}, uiImpl: {} as any },
            dashboardRegistry: registry,
        })
        expect(r.success).toBe(false)
        expect(removeSpy).toHaveBeenCalledWith('u', 'echo')
    })

    it('surfaces validation_failed envelopes through validationFailed without dashboard error events', async () => {
        const agg = new ManifestAggregator()
        agg.attach(fakeManifest('A', 'doit'))

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
                    yield {
                        seq: 1,
                        validationFailed: {
                            argPath: 'config/limit',
                            message: 'must be a positive integer',
                            rawValue: '-3',
                        },
                    } as any
                },
            }),
        }

        const invoker = new RemoteCmdInvoker({
            aggregator: agg,
            client,
            createDashboard: () => dashboard,
        })

        const r = await invoker.invoke({ command: 'doit', args: { 'config/limit': '-3' }, userId: 'u', uiHandle: { ctx: {}, uiImpl: {} as any } })
        expect(r.success).toBe(false)
        expect(r.validationFailed).toEqual({
            argPath: 'config/limit',
            message: 'must be a positive integer',
            rawValue: '-3',
        })
        // The dashboard never sees the validation event — it's terminal-without-run.
        expect(dashEvents).toHaveLength(0)
    })
})
