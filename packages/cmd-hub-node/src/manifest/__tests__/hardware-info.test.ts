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

    it('reports positive numeric cpuCores and totalMemoryBytes', () => {
        const h = hardwareInfo()
        expect(typeof h.cpuCores).toBe('number')
        expect(h.cpuCores).toBeGreaterThan(0)
        expect(typeof h.totalMemoryBytes).toBe('number')
        expect(h.totalMemoryBytes).toBeGreaterThan(0)
    })

    it('yields the same values when called repeatedly within one tick', () => {
        const a = hardwareInfo()
        const b = hardwareInfo()
        expect(a.cpuCores).toBe(b.cpuCores)
        expect(a.os).toBe(b.os)
        expect(a.arch).toBe(b.arch)
        expect(a.hostname).toBe(b.hostname)
    })
})
