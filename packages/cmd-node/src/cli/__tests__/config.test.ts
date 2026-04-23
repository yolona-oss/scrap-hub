import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadNodeConfig } from '../config'

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeJson(dir: string, name: string, value: unknown): string {
    const p = path.join(dir, name)
    fs.writeFileSync(p, JSON.stringify(value))
    return p
}

function writeFile(dir: string, name: string, content = 'dummy'): string {
    const p = path.join(dir, name)
    fs.writeFileSync(p, content)
    return p
}

describe('loadNodeConfig', () => {
    it('accepts a well-formed config when referenced files exist', () => {
        const dir = tmpDir('nodecfg-')
        const cert = writeFile(dir, 'node.crt')
        const key = writeFile(dir, 'node.key')
        const ca = writeFile(dir, 'ca.crt')
        const cfg = writeJson(dir, 'node.json', {
            node: { id: 'n1', token: 't', certPath: cert, keyPath: key },
            hub:  { address: 'localhost:50051', caCertPath: ca },
            mongo: { url: 'mongodb://localhost/db' },
        })

        const r = loadNodeConfig(cfg)
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(r.config.node.id).toBe('n1')
            expect(r.config.hub.address).toBe('localhost:50051')
        }
    })

    it('rejects config missing required fields', () => {
        const dir = tmpDir('nodecfg-')
        const cfg = writeJson(dir, 'node.json', { node: {}, hub: {}, mongo: {} })
        const r = loadNodeConfig(cfg)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(/config validation failed/)
    })

    it('rejects when a cert file is missing', () => {
        const dir = tmpDir('nodecfg-')
        const cert = writeFile(dir, 'node.crt')
        const key = writeFile(dir, 'node.key')
        // Deliberately do NOT create the CA cert file.
        const cfg = writeJson(dir, 'node.json', {
            node: { id: 'n1', token: 't', certPath: cert, keyPath: key },
            hub:  { address: 'localhost:50051', caCertPath: path.join(dir, 'missing-ca.crt') },
            mongo: { url: 'mongodb://localhost/db' },
        })
        const r = loadNodeConfig(cfg)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(/cert file not found/)
    })

    it('rejects a path that does not exist', () => {
        const r = loadNodeConfig('/no/such/config.json')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(/cannot read config/)
    })

    it('rejects invalid JSON', () => {
        const dir = tmpDir('nodecfg-')
        const cfg = path.join(dir, 'node.json')
        fs.writeFileSync(cfg, 'not-json{{')
        const r = loadNodeConfig(cfg)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.error).toMatch(/invalid JSON/)
    })
})
