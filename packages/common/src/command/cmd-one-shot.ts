import type { CapabilityKey, ICapabilityRegistry } from '../application/capability'
import type { CmdDataClass } from './service-decorator'
import {
    BaseCommandIdentityWithRequires,
    assertCommandIdentity,
    assertRequires,
} from './identity'
import { defineDecoratorMeta, readDecoratorMeta, makeMetaKey } from './metadata'
import { buildTreeFromClass } from './argument-decorator'
import { unflattenValue, type OptionsTree } from './tree'

const META_KEY = makeMetaKey('CmdOneShot')

/** Per-invocation context for a one-shot command's `invokable`.
 *  `emit({kind:'error'})` does NOT terminate; throwing emits error + done. */
export interface CmdOneShotContext<TArgs = Record<string, string>> {
    readonly args: TArgs
    readonly userId: string
    readonly sessionId: string
    require<V>(key: CapabilityKey<V>): V
    emit(event: { kind: 'message'; text: string } | { kind: 'error'; text: string }): void
}

/** Node-side wire/exec callback for a one-shot. */
export type CmdOneShotInvokable<TArgs = Record<string, string>> =
    (ctx: CmdOneShotContext<TArgs>) => Promise<void>

export interface CmdOneShotMeta extends BaseCommandIdentityWithRequires {
    /** `@CmdArgument`-decorated data class. Optional: a one-shot with no
     *  arguments at all simply omits this. */
    argsClass?: CmdDataClass
}

export interface CmdOneShotSpec<TArgs = Record<string, string>> extends CmdOneShotMeta {
    readonly invokable: CmdOneShotInvokable<TArgs>
}

function assertOneShotMeta(meta: CmdOneShotMeta): void {
    assertCommandIdentity(meta, '@CmdOneShot')
    assertRequires(meta.requires, '@CmdOneShot')
}

function makeSpec<TArgs>(
    meta: CmdOneShotMeta,
    invokable: CmdOneShotInvokable<TArgs>,
): CmdOneShotSpec<TArgs> {
    return {
        name: meta.name,
        description: meta.description,
        compatibilityId: meta.compatibilityId,
        version: meta.version,
        argsClass: meta.argsClass,
        requires: meta.requires,
        invokable,
    }
}

export function CmdOneShot<TArgs>(
    spec: CmdOneShotMeta & { invokable: CmdOneShotInvokable<TArgs> },
): CmdOneShotSpec<TArgs>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function CmdOneShot(meta: CmdOneShotMeta): (target: any) => void
export function CmdOneShot<TArgs>(
    arg: CmdOneShotMeta | (CmdOneShotMeta & { invokable: CmdOneShotInvokable<TArgs> }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): CmdOneShotSpec<TArgs> | ((target: any) => void) {
    if ('invokable' in arg && typeof arg.invokable === 'function') {
        assertOneShotMeta(arg)
        const out = makeSpec(arg, arg.invokable)
        defineDecoratorMeta(META_KEY, arg.invokable, out)
        return out
    }
    const meta = arg
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target: any) => {
        assertOneShotMeta(meta)
        const invokable: unknown = target?.invokable
        if (typeof invokable !== 'function') {
            throw new Error(
                `@CmdOneShot: class "${target?.name ?? '(anon)'}" must declare a static \`invokable\` of type CmdOneShotInvokable`,
            )
        }
        defineDecoratorMeta(META_KEY, target, makeSpec(meta, invokable as CmdOneShotInvokable))
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCmdOneShotMeta(target: any): CmdOneShotSpec | null {
    if (target == null) return null
    if (
        typeof target === 'object' &&
        typeof target.invokable === 'function' &&
        typeof target.name === 'string' &&
        typeof target.description === 'string' &&
        typeof target.compatibilityId === 'string' &&
        typeof target.version === 'string'
    ) {
        return target as CmdOneShotSpec
    }
    return readDecoratorMeta<CmdOneShotSpec>(META_KEY, target)
}

/** Bind a flat dot-path-keyed wire-args map to a typed nested object,
 *  using the spec's `argsClass` (if any) as the schema. Falls back to
 *  the raw map when the spec declares no `argsClass`. */
export function bindArgsForSpec<TArgs>(
    spec: CmdOneShotSpec<TArgs>,
    rawArgs: Record<string, string>,
): TArgs {
    if (!spec.argsClass) {
        return rawArgs as unknown as TArgs
    }
    const tree: OptionsTree = buildTreeFromClass(spec.argsClass)
    const flat = new Map(Object.entries(rawArgs))
    return unflattenValue(tree, flat) as TArgs
}

export function makeCmdOneShotContext<TArgs>(opts: {
    args: TArgs
    userId: string
    sessionId: string
    registry: ICapabilityRegistry
    emit: (event: { kind: 'message'; text: string } | { kind: 'error'; text: string }) => void
}): CmdOneShotContext<TArgs> {
    return {
        args: opts.args,
        userId: opts.userId,
        sessionId: opts.sessionId,
        require<V>(key: CapabilityKey<V>): V {
            const v = opts.registry.get(key)
            if (v === undefined) {
                throw new Error(
                    `CmdOneShotContext.require: capability "${key}" not provided — ` +
                    `should have been caught by boot-time validation`,
                )
            }
            return v
        },
        emit: opts.emit,
    }
}
