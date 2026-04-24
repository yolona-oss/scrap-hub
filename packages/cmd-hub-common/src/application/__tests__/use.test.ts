import { Application } from '../application'
import { IAppMiddleware } from '../middleware-types'
import { Phase } from '../phase'
import { z } from 'zod'

class TestApp extends Application<{ k: string }> {
    async run(): Promise<void> { /* no-op */ }
}

function recordingMiddleware(label: string, phase: Phase, log: string[]): IAppMiddleware {
    return {
        name: label,
        phase,
        install: () => { log.push(`install:${label}`) },
        uninstall: () => { log.push(`uninstall:${label}`) },
    }
}

describe('Application.use()', () => {
    it('installs middlewares sorted by phase; uninstalls in reverse order', async () => {
        const log: string[] = []
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({ k: z.string().default('v') }),
            inlineConfig: { k: 'v' },
        })
        app.use(recordingMiddleware('transport', Phase.Transport, log))
        app.use(recordingMiddleware('storage', Phase.Storage, log))
        app.use(recordingMiddleware('infrastructure', Phase.Infrastructure, log))

        await app.Initialize()
        expect(log).toEqual(['install:infrastructure', 'install:storage', 'install:transport'])

        await app.terminate()
        expect(log).toEqual([
            'install:infrastructure', 'install:storage', 'install:transport',
            'uninstall:transport', 'uninstall:storage', 'uninstall:infrastructure',
        ])
    })
})
