import * as os from 'os'

export interface HardwareInfo {
    cpuCores: number
    totalMemoryBytes: number
    os: string
    arch: string
    hostname: string
}

export function hardwareInfo(): HardwareInfo {
    return {
        cpuCores: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        os: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
    }
}
