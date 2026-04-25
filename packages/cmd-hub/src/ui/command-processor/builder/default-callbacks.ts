// TODO: rename file
import { genRandId } from "@cmd-hub/common";

export const BuilderActionSigns = {
    execute:     genRandId(),
    cancelBuild: genRandId(),
    switchCtx:   genRandId(),
    cancelOp:    genRandId(),
    changeInterpritationMode: genRandId() 
}

export function isBuilderActionSign(input: string) {
    return Object.values(BuilderActionSigns).includes(input)
}
