import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AppLockMiddleware } from '../app-lock-middleware'
import { Application } from '../../application/application'
import { z } from 'zod'

class TestApp extends Application<{ appLock: { lockFile: string } }> {
    async run(): Promise<void> {}
}

describe('AppLockMiddleware', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'))

    it('acquires the lock on install and releases on uninstall', async () => {
        const lockFile = path.join(tmpDir, 't1.lock')
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { appLock: { lockFile } },
        }).use(new AppLockMiddleware())
        await app.Initialize()
        expect(fs.existsSync(lockFile)).toBe(true)
        await app.terminate()
        expect(fs.existsSync(lockFile)).toBe(false)
    })

    it('refuses to start when lock is held by a running process', async () => {
        const lockFile = path.join(tmpDir, 't2.lock')
        fs.writeFileSync(lockFile, String(process.pid))  // current pid is alive
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { appLock: { lockFile } },
        }).use(new AppLockMiddleware())
        await expect(app.Initialize()).rejects.toThrow(/another instance/)
        fs.unlinkSync(lockFile)
    })

    it('overwrites stale lock (process not alive)', async () => {
        const lockFile = path.join(tmpDir, 't3.lock')
        fs.writeFileSync(lockFile, '999999')  // hopefully not a real pid
        const app = new TestApp({
            configPath: '', baseSchema: z.object({}),
            inlineConfig: { appLock: { lockFile } },
        }).use(new AppLockMiddleware())
        await app.Initialize()
        expect(fs.readFileSync(lockFile, 'utf8')).toBe(String(process.pid))
        await app.terminate()
    })
})
