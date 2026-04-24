import { decodePositionalName } from "./positional";
import { IArgumentCompiled } from "./argument-descriptor";

export class CmdArgumentProxy {
    constructor(
        private readonly args: IArgumentCompiled[]
    ) {
        //this.maxPos = this.args.filter(arg => arg.position != null).length
    }

    has(name: string) {
        const v = this.args.find(arg => arg.name === name || decodePositionalName(arg.name).name == name)
        return v != null && v.value != undefined && v.value != ''
    }

    get(name: string) {
        return this.args.find(arg => arg.name === name || decodePositionalName(arg.name).name == name)?.value
    }

    getOrThrow(name: string) {
        const v = this.args.find(arg => arg.name === name || decodePositionalName(arg.name).name == name)
        if (v == null || v.value == undefined || v.value == '') {
            throw new Error(`Argument: "${name}" not passed to command`)
        }
        return v.value
    }

    getPos(number: number) {
        return this.args.find(arg => arg.position === number)?.value
    }
}
