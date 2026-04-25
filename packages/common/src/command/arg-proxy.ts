import { decodePositionalName, isEncodedPositionalName } from "./positional";
import { IArgumentCompiled } from "./argument-descriptor";

function matchesName(arg: IArgumentCompiled, name: string): boolean {
    if (arg.name === name) return true
    return isEncodedPositionalName(arg.name) && decodePositionalName(arg.name).name === name
}

export class CmdArgumentProxy {
    constructor(
        private readonly args: IArgumentCompiled[]
    ) {}

    has(name: string) {
        const v = this.args.find(arg => matchesName(arg, name))
        return v != null && v.value != undefined && v.value != ''
    }

    get(name: string) {
        return this.args.find(arg => matchesName(arg, name))?.value
    }

    getOrThrow(name: string) {
        const v = this.args.find(arg => matchesName(arg, name))
        if (v == null || v.value == undefined || v.value == '') {
            throw new Error(`Argument: "${name}" not passed to command`)
        }
        return v.value
    }

    getPos(number: number) {
        return this.args.find(arg => arg.position === number)?.value
    }
}
