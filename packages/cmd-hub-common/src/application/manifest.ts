import type { CapabilityKey } from './capability'

/** Read-only snapshot of an Application's runtime wiring. Safe to log,
 *  serialise, or pass across async boundaries. */

export interface CapabilityDescriptor {
    readonly key: string
    /** Empty when the publisher didn't declare itself. */
    readonly providedBy: string
}

export interface CommandRegistration {
    readonly name: string
    readonly requires: readonly string[]
}

export interface AppManifestSnapshot {
    readonly capabilities: ReadonlyArray<CapabilityDescriptor>
    readonly commands: ReadonlyArray<CommandRegistration>
}

/** Aggregated boot-time validator failure — one entry per command with
 *  unsatisfied requires. */
export interface CapabilityValidationFailure {
    readonly commandName: string
    readonly missing: readonly string[]
}

export class CapabilityValidationError extends Error {
    constructor(public readonly failures: ReadonlyArray<CapabilityValidationFailure>) {
        super(formatValidationFailures(failures))
        this.name = 'CapabilityValidationError'
    }
}

function formatValidationFailures(failures: ReadonlyArray<CapabilityValidationFailure>): string {
    if (failures.length === 0) return 'CapabilityValidationError: (no failures)'
    const lines = failures.map(f =>
        `  - command "${f.commandName}" needs: ${f.missing.map(m => `"${m}"`).join(', ')}`,
    )
    return [
        `Capability validation failed at boot time:`,
        ...lines,
        `No middleware provides the capabilities listed above. Either install`,
        `the relevant middleware (e.g. MongoStorageMiddleware for storage caps)`,
        `or remove the requirement from the @CmdService.requires declaration.`,
    ].join('\n')
}

export function capabilityKeyToString<V>(key: CapabilityKey<V>): string {
    return key
}
