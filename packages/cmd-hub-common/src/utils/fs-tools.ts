import { existsSync, mkdirSync } from 'fs'

/** Create `dir` (and any missing parents) if it doesn't exist. No-op when
 *  the directory is already present. Errors propagate from `mkdirSync`. */
export function createDirIfNotExist(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
