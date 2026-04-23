import { hardwareInfo } from '../hardware-info'
import * as os from 'os'

describe('hardwareInfo', () => {
    it('returns a shape matching the os module', () => {
        const h = hardwareInfo()
        expect(h.cpuCores).toBe(os.cpus().length)
        expect(h.totalMemoryBytes).toBe(os.totalmem())
        expect(h.os).toBe(os.platform())
        expect(h.arch).toBe(os.arch())
        expect(h.hostname).toBe(os.hostname())
    })
})
