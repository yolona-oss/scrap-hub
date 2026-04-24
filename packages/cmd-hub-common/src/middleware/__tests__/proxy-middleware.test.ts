// socks-proxy-agent / https-proxy-agent ship as ESM-only; jest's CJS runtime
// can't require them directly. Stub both modules before importing the
// middleware so we test its branching logic, not the concrete agents.
jest.mock('socks-proxy-agent', () => ({
    SocksProxyAgent: class { constructor(public readonly url: string) {} },
}), { virtual: true })
jest.mock('https-proxy-agent', () => ({
    HttpsProxyAgent: class { constructor(public readonly url: string) {} },
}), { virtual: true })

import { ProxyMiddleware } from '../proxy-middleware'
import { CAP_HttpAgent } from '../capabilities'
import { Application } from '../../application/application'
import { z } from 'zod'

class TestApp extends Application<{ proxy: { socks: string | null; https: string | null } }> {
    async run(): Promise<void> {}
}

describe('ProxyMiddleware', () => {
    it('creates a SOCKS agent when config.proxy.socks is set', async () => {
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { proxy: { socks: 'socks5://127.0.0.1:1080', https: null } },
        }).use(new ProxyMiddleware())
        await app.Initialize()
        expect(app.get(CAP_HttpAgent)).toBeDefined()
        await app.terminate()
    })

    it('does nothing when no proxy urls are set', async () => {
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { proxy: { socks: null, https: null } },
        }).use(new ProxyMiddleware())
        await app.Initialize()
        expect(app.get(CAP_HttpAgent)).toBeUndefined()
        await app.terminate()
    })
})
