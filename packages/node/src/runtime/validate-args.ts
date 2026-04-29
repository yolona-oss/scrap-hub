import {
    walkArgLeaves,
    ARG_PATH_DELIMITER,
    type ArgTree,
} from '@cmd-hub/common'

/**
 * Thrown when a leaf's validator rejects the wire-supplied raw value.
 *
 * The hub's `RemoteCmdInvoker` translates this into a `validation_failed`
 * proto envelope (terminal — distinct from `done`). The dispatcher uses
 * `argPath` to focus the previously-active parser back onto the failed
 * leaf so the user fixes only that input without rebuilding the rest of
 * the command.
 *
 * `argPath` is a slash-delimited path (e.g. `args/aiAgent/model`)
 * matching the wire convention; the parser splits on the same delimiter
 * via `focusLeaf`.
 */
export class ValidationFailedError extends Error {
    constructor(
        readonly argPath: string,
        readonly reason: string,
        readonly rawValue: string,
    ) {
        super(`validation failed at "${argPath}": ${reason}`)
        this.name = 'ValidationFailedError'
    }
}

/** Walk every leaf in `tree` whose validator is defined and run it
 *  against the wire-supplied raw value at the leaf's path. Throws on
 *  the first failure. `slicePrefix` (e.g. `'args/'`) is prepended to
 *  the failure path so the hub-side parser can address the leaf in the
 *  full service tree. Pass `''` for one-shots whose root has no slice. */
export function runLeafValidators(
    tree: ArgTree,
    rawArgs: { [k: string]: string },
    slicePrefix: string = '',
): void {
    for (const { pathKey, leaf } of walkArgLeaves(tree)) {
        if (!leaf.validator) continue
        const raw = lookupRaw(rawArgs, slicePrefix, pathKey)
        if (raw === undefined) continue
        const result = leaf.validator(raw)
        if (result === true) continue
        const reason = typeof result === 'string' ? result : 'validation failed'
        throw new ValidationFailedError(`${slicePrefix}${pathKey}`, reason, raw)
    }
}

function lookupRaw(
    rawArgs: { [k: string]: string },
    slicePrefix: string,
    pathKey: string,
): string | undefined {
    if (slicePrefix.length === 0) return rawArgs[pathKey]
    return rawArgs[`${slicePrefix}${pathKey}`]
}

/** Strip a single trailing `/` so callers can pass either form. */
export function makeSlicePrefix(slice: string | undefined): string {
    if (!slice) return ''
    return slice.endsWith(ARG_PATH_DELIMITER) ? slice : `${slice}${ARG_PATH_DELIMITER}`
}
