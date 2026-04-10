import * as fs from 'fs'
import path from 'path'

import log from '@logger';
import { getInitialConfig } from '@core/config'

const cfg = getInitialConfig()

export function loadFromJson<Ret = any>(dir_name: string, file_name: string): Ret | null {
    const dir = path.join(cfg.server.fileStorage.path, dir_name)
    const dst_path = path.join(dir, `${file_name}.json`)
    if (fs.existsSync(dir)) {
        if (fs.existsSync(dst_path)) {
            try {
                const data = fs.readFileSync(dst_path, 'utf8')
                return JSON.parse(data) as Ret
            } catch(e) {
                log.error(`loadFromJson() error: ${e}.\nMaybe file empty or json syntax error.`)
                return null
            }
        }
    }

    return null
}

export function writeJsonData(dir: string[], file_name: string, data: any) {
    const save_dir = path.join(cfg.server.fileStorage.path, ...dir)
    const save_file = path.join(save_dir, `${file_name}.json`)

    try {
        if (!fs.existsSync(save_dir)) {
            fs.mkdirSync(save_dir, { recursive: true })
        }
    } catch(e) {
        log.error("Error creating save dir:", e)
        return false
    }

    try {
        fs.writeFileSync(save_file, JSON.stringify(data, null, 4))
    } catch(e) {
        log.error(`Error saving JSON: ${e}`)
        return false
    }

    return true
}
