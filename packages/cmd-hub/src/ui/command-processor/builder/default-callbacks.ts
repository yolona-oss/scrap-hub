// TODO: rename file
import { genRandId } from "@core/types/identificable";

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
