import * as fs from 'fs'
import path from 'path'

import log from '@logger'

export class LockManager {
    private lockFiles: Set<string> = new Set()

    static createLockFileName(hash: string): string {
        return `${hash}.lock`
    }

    constructor(private lockDir: string) {
        try {
            fs.accessSync(path.dirname(lockDir), fs.constants.W_OK)
        } catch (e) {
            console.log(e)
            throw new Error(`Directory ${lockDir} not writable for user "${process.env.USER || "Unknown User"}"`)
        }
        if (!fs.existsSync(lockDir)) {
            fs.mkdirSync(lockDir, { recursive: true })
        }
    }

    /***
    * @returns file name of lock or null if file exists
    */
    createLockFile(hash: string, data: string = ''): string | null {
        try {
            const filePath = path.join(this.lockDir, LockManager.createLockFileName(hash))
            fs.writeFileSync(filePath, data, { flag: "wx+", encoding: 'utf-8' })
            this.lockFiles.add(filePath)
            return filePath
        } catch(e: any) {
            if (e.code === 'EEXIST') {
                return null
            } else {
                throw e
            }
        }
    }

    getLockFileData(hash: string) {
        try {
            const filePath = path.join(this.lockDir, LockManager.createLockFileName(hash))
            return fs.readFileSync(filePath, { encoding: 'utf-8' })
        } catch (e) {
            return null
        }
    }

    deleteLockFile(filePath: string) {
        if (this.lockFiles.has(filePath)) {
            fs.unlinkSync(filePath)
            this.lockFiles.delete(filePath)
            return true
        }
        return false
    }

    cleanupAll() {
        let unlinked = 0
        for (const filePath of this.lockFiles) {
            try {
                fs.unlinkSync(filePath)
                unlinked++
            } catch (err) {
                log.error(`Failed to delete lock file ${filePath}:`, err)
            }
        }
        this.lockFiles.clear()
        return unlinked
    }
}
