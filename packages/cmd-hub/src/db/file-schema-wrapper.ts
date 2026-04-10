import { DefaultAssets, File } from '@core/db'
import { DefaultAssetsEnum } from '@core/db/schemes/default-assets'
import { getConfig, getInitialConfig } from '@core/config'
import { genRandomString } from '@utils/random'
import log from '@logger';

import * as mime from 'mime-types'
import download from 'download'
import * as fs from 'fs'
import path from 'path'

import { defaultAssets } from './defaultAssets.json'

class Files {
    private static defaultsInited: boolean = false

    constructor() {
        this.copyDefaults();
    }

    private async createDefaultEntry(name: string, path: string) {
        const file_doc = await File.create({
            mime: "image/png",
            path,
            group: "static",
        })

        const existsDefaultAssetEntry = await DefaultAssets.findOne({name})
        if (existsDefaultAssetEntry) {
            await DefaultAssets.updateOne(
                { name },
                { $set: { file_id: file_doc.id } }
            )
        } else {
            await DefaultAssets.create({
                name,
                file_id: file_doc.id
            })
        }

    }

    private async checkDefaults() {
        const cfg = getInitialConfig()

        const registredDefaultAssets = await DefaultAssets.find()
        for (const asset of defaultAssets) {
            const entry = registredDefaultAssets.find(d => d.name === asset.name)
            if (!entry) {
                await this.createDefaultEntry(asset.name, path.join(cfg.server.fileStorage.path, asset.path))
            } else {
                const file = await this.getFile(String(entry.file_id))
                if (!file) {
                    await this.createDefaultEntry(asset.name, path.join(cfg.server.fileStorage.path, asset.path))
                }
            }
        }
    }

    // remove
    private copyDefaults() {
        const cfg = getInitialConfig();
        try {
            const ico_path = path.join(
                cfg.server.fileStorage.path,
                "static", "manager-icon.png")
            const ico_static_path = path.join(
                "assets",
                "manager-icon.png")
            if (!fs.existsSync(ico_path)) {
                log.info("Files::constructor() copying default manager icon...")
                if (!fs.existsSync(path.dirname(ico_path))) {
                    log.info("Files::copyDefaults() creating default manager icon directory...")
                    fs.mkdirSync(path.dirname(ico_path), { recursive: true })
                }
                fs.copyFileSync(ico_static_path, ico_path)
            }
        } catch (e) {
            throw new Error(`Files::constructor() cannot copy default manager icon! ${JSON.stringify(e,null,4)} ${e}`)
        }
    }

    async getFile(id: string) {
        return await File.findById(id)
    }

    async getFileByName(name: string) {
        return await File.findOne({ path: name })
    }

    async saveFile(url: string, group: string) {
        const cfg = await getConfig();

        const _mime = mime.lookup(url);
        const ext = _mime ? mime.extension(_mime) : null;
        const sufix = (ext ? "." + ext : "");
        const filename = genRandomString(10) + sufix;
        const path = cfg.server.fileStorage.path + '/' + filename;
        let res = await download(url, cfg.server.fileStorage.path, { filename: filename });

        let schema = {
            mime: mime.lookup(path) || "unknown",
            path: path,
            group: group
        }
        if (res) {
            return await File.create(schema)
        } else {
            return null;
        }
    }

    async getDefault(name: string) {
        if (!Files.defaultsInited) {
            await this.checkDefaults()
            Files.defaultsInited = true
        }

        let entry = await DefaultAssets.findOne({name})
        if (!entry) {
            await this.createDefaultEntry(name, path.join(getInitialConfig().server.fileStorage.path, "static", name))
            entry = (await DefaultAssets.findOne({name}))!
        }
        return await this.getFile(String(entry.file_id))
    }

    async getDefaultAvatar() {
        const entry = defaultAssets.find(d => d.name === DefaultAssetsEnum.avatar)
        if (!entry) {
            throw new Error("Files::getDefaultAvatar() cannot find default avatar!")
        }
        return await this.getDefault(entry.name)
    }
}

export const FilesWrapper = new Files();
