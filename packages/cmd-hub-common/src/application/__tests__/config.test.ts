import { Application } from '../application'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

class TestApp extends Application<{ foo: string }> {
    async run(): Promise<void> {}
}

const SCHEMA = z.object({ foo: z.string() })

describe('Application config loading', () => {
    it('loads config from the provided JSON file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
        const cfgPath = path.join(dir, 'config.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ foo: 'hello' }))

        const app = new TestApp({ configPath: cfgPath, baseSchema: SCHEMA })
        await app.Initialize()
        expect(app.config.foo).toBe('hello')
        await app.terminate()
    })

    it('inlineConfig bypasses file loading', async () => {
        const app = new TestApp({
            configPath: '/does/not/exist',
            baseSchema: SCHEMA,
            inlineConfig: { foo: 'inline' },
        })
        await app.Initialize()
        expect(app.config.foo).toBe('inline')
        await app.terminate()
    })

    it('throws clearly when config file is missing', async () => {
        const app = new TestApp({ configPath: '/nope/config.json', baseSchema: SCHEMA })
        await expect(app.Initialize()).rejects.toThrow(/config/)
    })

    it('throws on invalid JSON', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
        const cfgPath = path.join(dir, 'config.json')
        fs.writeFileSync(cfgPath, 'not-json{{')
        const app = new TestApp({ configPath: cfgPath, baseSchema: SCHEMA })
        await expect(app.Initialize()).rejects.toThrow()
    })

    it('throws on schema validation failure with named path', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'))
        const cfgPath = path.join(dir, 'config.json')
        fs.writeFileSync(cfgPath, JSON.stringify({ foo: 42 }))
        const app = new TestApp({ configPath: cfgPath, baseSchema: SCHEMA })
        await expect(app.Initialize()).rejects.toThrow(/foo/)
    })
})
