import * as fs from 'fs'

export function createDirIfNotExist(path: string) {
    if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true })
    }
}
