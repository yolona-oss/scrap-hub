import 'reflect-metadata'
import type { CapabilityKey, ICapabilityRegistry } from '../application/capability'
import type { CmdDataClass } from './service-decorator'
import { CommandArgumentHolder } from './argument-holder'
import { decodePositionalName, isEncodedPositionalName } from './positional'

const META_KEY = Symbol.for('cmd-hub.CmdCommand')

/** Per-invocation context for a one-shot command's `invokable`.
 *  `emit({kind:'error'})` does NOT terminate; throwing emits error + done. */
export interface CmdCommandContext<TArgs = Record<string, string>> {
    readonly args: TArgs
    readonly userId: string
    readonly sessionId: string
    require<V>(key: CapabilityKey<V>): V
    emit(event: { kind: 'message'; text: string } | { kind: 'error'; text: string }): void
}

export type CmdCommandInvokable<TArgs = Record<string, string>> =
    (ctx: CmdCommandContext<TArgs>) => Promise<void>

export interface CmdCommandMeta {
    name: string
    description: string
    compatibilityId: string
    version: string
    /** Zero-arg `@CmdArgument`-decorated data class. */
    argsClass?: CmdDataClass
    /** Validated at boot. */
    requires?: ReadonlyArray<CapabilityKey<unknown>>
}

export interface CmdCommandSpec<TArgs = Record<string, string>> extends CmdCommandMeta {
    readonly invokable: CmdCommandInvokable<TArgs>
}

function assertMeta(meta: CmdCommandMeta): void {
    if (!meta.name) throw new Error('CmdCommand: name is required')
    if (!meta.description) throw new Error('CmdCommand: description is required')
    if (!meta.compatibilityId) throw new Error('CmdCommand: compatibilityId is required')
    if (!meta.version) throw new Error('CmdCommand: version is required')
    if (!/^\d+\.\d+\.\d+/.test(meta.version)) {
        throw new Error(`CmdCommand: version must be semver, got "${meta.version}"`)
    }
    if (meta.requires !== undefined && !Array.isArray(meta.requires)) {
        throw new Error('CmdCommand: `requires` must be an array of capability keys')
    }
}

/** Dual-form: call with `{...meta, invokable}` for an inline spec, or with
 *  `meta` only as a class decorator (class must expose `static invokable`). */
export function CmdCommand<TArgs>(
    spec: CmdCommandMeta & { invokable: CmdCommandInvokable<TArgs> },
): CmdCommandSpec<TArgs>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function CmdCommand(meta: CmdCommandMeta): (target: any) => void
export function CmdCommand<TArgs>(
    arg: CmdCommandMeta | (CmdCommandMeta & { invokable: CmdCommandInvokable<TArgs> }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): CmdCommandSpec<TArgs> | ((target: any) => void) {
    if ('invokable' in arg && typeof arg.invokable === 'function') {
        assertMeta(arg)
        const out: CmdCommandSpec<TArgs> = {
            name: arg.name,
            description: arg.description,
            compatibilityId: arg.compatibilityId,
            version: arg.version,
            argsClass: arg.argsClass,
            requires: arg.requires,
            invokable: arg.invokable,
        }
        Reflect.defineMetadata(META_KEY, out, arg.invokable)
        return out
    }
    const meta = arg
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target: any) => {
        assertMeta(meta)
        const invokable: unknown = target?.invokable
        if (typeof invokable !== 'function') {
            throw new Error(
                `@CmdCommand: class "${target?.name ?? '(anon)'}" must declare a static \`invokable\` of type CmdCommandInvokable`,
            )
        }
        const spec: CmdCommandSpec = {
            name: meta.name,
            description: meta.description,
            compatibilityId: meta.compatibilityId,
            version: meta.version,
            argsClass: meta.argsClass,
            requires: meta.requires,
            invokable: invokable as CmdCommandInvokable,
        }
        Reflect.defineMetadata(META_KEY, spec, target)
    }
}

/** Reads CmdCommand meta from a decorated class, an inline-factory spec, or
 *  a stamped invokable. Returns null otherwise. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCmdCommandMeta(target: any): CmdCommandSpec | null {
    if (target == null) return null
    if (
        typeof target === 'object' &&
        typeof target.invokable === 'function' &&
        typeof target.name === 'string' &&
        typeof target.description === 'string' &&
        typeof target.compatibilityId === 'string' &&
        typeof target.version === 'string'
    ) {
        return target as CmdCommandSpec
    }
    return Reflect.getMetadata(META_KEY, target) ?? null
}

/** Decode wire-format args, collapsing `positional-N-name` → `name`. */
export function decodeArgsMap(args: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const key of Object.keys(args)) {
        if (isEncodedPositionalName(key)) {
            const { name } = decodePositionalName(key)
            out[name] = args[key]
        } else {
            out[key] = args[key]
        }
    }
    return out
}

/** Bind raw args to a populated `argsClass` instance, or return the decoded
 *  raw map when `argsClass` is undefined. */
export function bindArgsForSpec<TArgs>(
    spec: CmdCommandSpec<TArgs>,
    rawArgs: Record<string, string>,
): TArgs {
    const decoded = decodeArgsMap(rawArgs)
    if (spec.argsClass) {
        return CommandArgumentHolder.fromMap(spec.argsClass, decoded) as unknown as TArgs
    }
    return decoded as unknown as TArgs
}

/** Build a synthetic ctx for a one-shot command. */
export function makeCmdCommandContext<TArgs>(opts: {
    args: TArgs
    userId: string
    sessionId: string
    registry: ICapabilityRegistry
    emit: (event: { kind: 'message'; text: string } | { kind: 'error'; text: string }) => void
}): CmdCommandContext<TArgs> {
    return {
        args: opts.args,
        userId: opts.userId,
        sessionId: opts.sessionId,
        require<V>(key: CapabilityKey<V>): V {
            const v = opts.registry.get(key)
            if (v === undefined) {
                throw new Error(
                    `CmdCommandContext.require: capability "${key}" not provided — ` +
                    `should have been caught by boot-time validation`,
                )
            }
            return v
        },
        emit: opts.emit,
    }
}
