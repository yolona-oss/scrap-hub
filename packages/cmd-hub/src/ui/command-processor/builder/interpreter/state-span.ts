import { CmdArgumentContextType, IArgumentCompiled } from "../../../../ui/types"
import { Stack } from "@cmd-hub/common"
import { ParserStateType } from "./parser"

export class StateSnap {
    constructor(
        public readonly currentCtx: CmdArgumentContextType,
        public readonly state: ParserStateType,
        public readonly _prevState: ParserStateType,
        public readonly waitNextBuf: { type: 'standalone'|'positional'|'pair', value: string }|undefined,
        public readonly args: IArgumentCompiled[],
    ) {}
}

export class StateSnaper {
    private snaps: Stack<StateSnap>

    constructor(
        private maxSnaps = 15,
        private batchClean = 5
    ) {
        this.snaps = new Stack(maxSnaps)
        if (batchClean > maxSnaps) {
            throw new Error(`StateSnaper:: BatchClean must be less than maxSnaps`)
        }
    }

    memorize(snap: StateSnap) {
        this.snaps.push(snap)
        if (this.snaps.size() > this.maxSnaps) {
            this.snaps.pop(this.batchClean)
        }
    }

    get back() {
        return this.snaps.pop(2)
    }

    get latest() {
        return this.snaps.peek()
    }
}

