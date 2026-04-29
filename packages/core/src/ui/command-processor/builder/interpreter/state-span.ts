import { Stack } from '@cmd-hub/common'

/**
 * Snapshot of the parser's mutable state, taken at every token. The
 * undo stack lets the interpreter step back one parse on `cancel-op`
 * (the user's "Back" button). Everything is value-cloned at memorize
 * time — `path`/`pending`/`values` are mutable inside the parser, so
 * the snapshot must own copies.
 */
export interface StateSnap {
    /** Current branch path inside the tree. Empty = at root. */
    readonly path: readonly string[]
    /** A leaf the parser is awaiting a value for, or `null`. */
    readonly pending: { readonly leafPath: readonly string[] } | null
    /** Committed leaf values keyed by full slash-delimited path. */
    readonly values: ReadonlyMap<string, string>
}

export class StateSnaper {
    private snaps: Stack<StateSnap>

    constructor(
        private maxSnaps = 15,
        private batchClean = 5,
    ) {
        this.snaps = new Stack(maxSnaps)
        if (batchClean > maxSnaps) {
            throw new Error('StateSnaper: batchClean must be <= maxSnaps')
        }
    }

    memorize(snap: StateSnap): void {
        // Evict BEFORE pushing — Stack's capacity is a hard cap, so pushing
        // when full would throw. The undo stack only needs the most-recent
        // ~maxSnaps states; older snaps are out of reach for `back()` anyway.
        if (this.snaps.size() >= this.maxSnaps) {
            this.snaps.pop(this.batchClean)
        }
        this.snaps.push(snap)
    }

    /** Pop the previous snapshot (skipping the current one). Returns
     *  `undefined` when there's no prior state to step back to. */
    get back(): StateSnap | undefined {
        return this.snaps.pop(2)
    }

    get latest(): StateSnap | undefined {
        return this.snaps.peek()
    }
}
