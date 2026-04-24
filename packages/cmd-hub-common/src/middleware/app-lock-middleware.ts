import { z } from 'zod'
import * as fs from 'fs'
import { IAppMiddleware, ConfigContributor, AppLike } from '../application/middleware-types'
import { Phase } from '../application/phase'

/**
 * Writes a pid lock file on install. Throws if another live process holds the
 * lock; silently overwrites a stale lock (pid no longer alive).
 */
export class AppLockMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'AppLockMiddleware'
    readonly phase = Phase.Infrastructure
    readonly namespace = 'appLock'
    readonly schema = z.object({
        lockFile: z.string().min(1),
    })

    private acquiredPath: string | null = null

    install(app: AppLike): void {
        const cfg = (app.config as { appLock: { lockFile: string } }).appLock
        if (fs.existsSync(cfg.lockFile)) {
            const pid = fs.readFileSync(cfg.lockFile, 'utf8').trim()
            if (pid && isProcessAlive(Number(pid))) {
                throw new Error(`another instance is running (pid ${pid}); lock file: ${cfg.lockFile}`)
            }
            // Stale lock — overwrite below.
        }
        fs.writeFileSync(cfg.lockFile, String(process.pid), { mode: 0o600 })
        this.acquiredPath = cfg.lockFile
    }

    uninstall(_app: AppLike): void {
        if (this.acquiredPath && fs.existsSync(this.acquiredPath)) {
            fs.unlinkSync(this.acquiredPath)
        }
        this.acquiredPath = null
    }
}

function isProcessAlive(pid: number): boolean {
    if (!pid || Number.isNaN(pid)) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
}
