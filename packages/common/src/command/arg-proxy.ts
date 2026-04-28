import { walkLeaves, branch, type OptionsTree, PAIR_PATH_DELIMITER } from './tree'

/**
 * Read-only view over a parser's committed leaf values, indexed for the
 * three lookup patterns built-ins and one-shots use:
 *
 *   - by **last path segment** — `args.get('sessionId')` matches a leaf at
 *     `params/sessionId` or a one-shot's bare `sessionId`. Used everywhere
 *     in built-ins to keep their bodies tree-agnostic.
 *
 *   - by **full slash-delimited path** — `args.get('config/aiAgent/model')`
 *     when a caller wants to disambiguate two leaves with the same last
 *     segment in different branches.
 *
 *   - by **positional index** — `args.getPos(1)` walks the tree for the
 *     leaf with `position === 1` and reads its committed value. Used by
 *     `/sconfig <serviceName> <key>` and friends.
 *
 * Construction takes the tree alongside the values map so positional
 * lookup can find the leaf without an extra index. The tree is also the
 * authority for `walkLeaves`-based iteration, used by callers that want
 * the full effective-args list.
 */
export class CmdArgumentProxy {
    private readonly _byLastSegment: Map<string, string>
    private readonly _byFullPath: ReadonlyMap<string, string>

    /** Construct a no-args proxy. Useful for invoking commands that
     *  declare no arguments (the dispatcher needs *something* to pass
     *  to the invokable). */
    static empty(): CmdArgumentProxy {
        return new CmdArgumentProxy(new Map(), branch({}))
    }

    constructor(
        values: ReadonlyMap<string, string>,
        private readonly tree: OptionsTree,
    ) {
        this._byFullPath = values
        this._byLastSegment = new Map<string, string>()
        for (const [fullPath, value] of values) {
            const last = lastSegment(fullPath)
            // First-write-wins: a leaf at the shallowest path takes the
            // bare-name slot. Callers wanting a deeper one must pass the
            // full path explicitly.
            if (!this._byLastSegment.has(last)) {
                this._byLastSegment.set(last, value)
            }
        }
    }

    has(name: string): boolean {
        const v = this._lookup(name)
        return v !== undefined && v !== ''
    }

    get(name: string): string | undefined {
        return this._lookup(name)
    }

    getOrThrow(name: string): string {
        const v = this._lookup(name)
        if (v === undefined || v === '') {
            throw new Error(`Argument: "${name}" not passed to command`)
        }
        return v
    }

    /** Find a leaf in the tree with `position === n` and return its
     *  committed value. Skips zero / unset positions. */
    getPos(n: number): string | undefined {
        for (const { pathKey, leaf } of walkLeaves(this.tree)) {
            if (leaf.position === n) {
                return this._byFullPath.get(pathKey)
            }
        }
        return undefined
    }

    /** Read-only access to the underlying flat map (slash-delimited
     *  full paths). The dispatcher uses this to ship args over the
     *  wire — keys go straight into the proto's `args` map. */
    get raw(): ReadonlyMap<string, string> {
        return this._byFullPath
    }

    private _lookup(name: string): string | undefined {
        const direct = this._byFullPath.get(name)
        if (direct !== undefined) return direct
        return this._byLastSegment.get(name)
    }
}

function lastSegment(path: string): string {
    const i = path.lastIndexOf(PAIR_PATH_DELIMITER)
    return i < 0 ? path : path.slice(i + 1)
}
