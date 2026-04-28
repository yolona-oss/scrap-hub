import { CmdArgumentMetadataRaw, getCmdArgMetadata } from './argument-decorator'
import { getCmdServiceMeta } from './service-decorator'
import { BaseCommandIdentity } from './identity'
import { isBranched, BranchedPairOptions } from './argument-option-types'
import log from '../application/logger'

/** Eager snapshot of a function-form `pairOptions` resolver, walked at
 *  manifest-build time. Mirrors the proto `BranchedOptions` shape so
 *  encoders/decoders trace through cleanly. Empty tree (`leaves: [],
 *  branches: {}`) means the resolver yielded nothing. */
export interface BranchedOptionsTree {
    leaves: string[]
    branches: Record<string, BranchedOptionsTree>
}

export interface ProtoArgSpec {
    name: string
    position: number
    required: boolean
    type: string
    description: string
    /** Flat root-level leaves. Mirrors `branchedOptions.leaves` for
     *  consumers that don't speak the tree (legacy). */
    enumValues: string[]
    defaultValue: string
    standalone: boolean
    /** Recursive snapshot. `undefined` when `pairOptions` is a `string[]`
     *  literal or absent — in which case `enumValues` is the only payload. */
    branchedOptions?: BranchedOptionsTree
}

export interface ProtoCommand extends BaseCommandIdentity {
    args: ProtoArgSpec[]
    aliases: string[]
}

/** Any class value — we only read decorator metadata off it, never instantiate. */
export type DecoratableServiceClass = Function // eslint-disable-line @typescript-eslint/no-unsafe-function-type

/**
 * Build the `ProtoArgSpec[]` for a single `@CmdArgument`-decorated data class.
 * Function-form `pairOptions` is walked recursively (tree snapshot); literal
 * `string[]` lands directly in `enumValues`. Resolution errors at any branch
 * degrade locally — the bad branch is dropped, siblings are kept.
 */
export async function buildProtoArgsFromDataClass(
    DataCls: new () => object,
    commandName: string = '',
): Promise<ProtoArgSpec[]> {
    const fields: Record<string, CmdArgumentMetadataRaw> = getCmdArgMetadata(DataCls)
    return Promise.all(Object.entries(fields).map(async ([name, f]) => {
        const tree = await snapshotPairOptions(f.pairOptions, commandName, name)
        return {
            name,
            position: f.position ?? 0,
            required: f.required ?? false,
            type: 'string',
            description: f.description ?? '',
            // Flat mirror — root-level leaves only — for legacy consumers.
            enumValues: tree?.leaves ?? (Array.isArray(f.pairOptions) ? f.pairOptions : []),
            defaultValue: f.defaultValue ?? '',
            standalone: f.standalone ?? false,
            branchedOptions: tree,
        }
    }))
}

/**
 * Recursively walk a function-form `pairOptions` resolver. Each path is
 * called with `(commandName, undefined, undefined, path)` — at manifest-
 * build time there's no dispatcher or manager, so resolvers that branch
 * on per-user state are inherently unsupported and snapshot the role-
 * less view (documented constraint of the eager-snapshot model).
 *
 * Returns `undefined` for non-function `pairOptions` so callers can fall
 * back to the literal `string[]` mirror.
 */
async function snapshotPairOptions(
    pairOptions: CmdArgumentMetadataRaw['pairOptions'],
    commandName: string,
    fieldName: string,
): Promise<BranchedOptionsTree | undefined> {
    if (typeof pairOptions !== 'function') return undefined
    const visited = new Set<string>()
    return walk(pairOptions, commandName, fieldName, [], visited)
}

async function walk(
    resolver: Exclude<CmdArgumentMetadataRaw['pairOptions'], string[] | undefined>,
    commandName: string,
    fieldName: string,
    path: string[],
    visited: Set<string>,
): Promise<BranchedOptionsTree> {
    const pathKey = path.join('')
    if (visited.has(pathKey)) {
        log.warn(
            `buildProtoArgs: pairOptions resolver for ${commandName || '(anon)'}.${fieldName} ` +
            `revisited path [${path.join(', ')}]; snapshot truncated to break cycle.`,
        )
        return { leaves: [], branches: {} }
    }
    visited.add(pathKey)

    let result: string[] | BranchedPairOptions
    try {
        result = await (resolver as (
            cmd: string, d: unknown, m: unknown, p: string[],
        ) => Promise<string[] | BranchedPairOptions>)(commandName, undefined, undefined, path)
    } catch (e) {
        log.warn(
            `buildProtoArgs: pairOptions resolver for ${commandName || '(anon)'}.${fieldName} ` +
            `at path [${path.join(', ')}] threw: ${(e as Error)?.message ?? e}. Branch dropped.`,
        )
        return { leaves: [], branches: {} }
    }

    if (Array.isArray(result)) {
        return { leaves: result, branches: {} }
    }
    if (!isBranched(result)) {
        return { leaves: [], branches: {} }
    }
    const branches: Record<string, BranchedOptionsTree> = {}
    for (const branchName of result.branches) {
        branches[branchName] = await walk(resolver, commandName, fieldName, [...path, branchName], visited)
    }
    return { leaves: result.leaves, branches }
}

export async function buildCommandFromDecorator(ServiceClass: DecoratableServiceClass): Promise<ProtoCommand> {
    const meta = getCmdServiceMeta(ServiceClass)
    if (!meta) {
        throw new Error(`buildCommandFromDecorator: ${ServiceClass.name || '(anon)'} is not decorated with @CmdService`)
    }

    const buckets = await Promise.all(
        [meta.config, meta.params, meta.messages].map((cls) => buildProtoArgsFromDataClass(cls, meta.name)),
    )
    return {
        name: meta.name,
        compatibilityId: meta.compatibilityId,
        version: meta.version,
        description: meta.description,
        args: buckets.flat(),
        aliases: [],
    }
}
