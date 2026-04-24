import { getCmdArgMetadata } from './argument-decorator'

export class CommandArgumentHolder {
    constructor() {}

    /**
     * Build a populated data-class instance from a flat string map.
     * Reads @CmdArgument metadata off the class; required fields must be
     * present in the map; missing non-required fields take `defaultValue`
     * when declared.
     */
    static fromMap<T extends object>(
        Cls: new () => T,
        args: Record<string, string>,
    ): T {
        const instance = new Cls()
        const assignable = instance as Record<string, string>
        const meta = getCmdArgMetadata<T>(instance)
        for (const key of Object.keys(meta) as (keyof T)[]) {
            const spec = meta[key]
            const name = String(key)
            const raw = args[name]
            if (raw !== undefined) {
                assignable[name] = raw
            } else if (spec.required) {
                throw new Error(`${Cls.name}.${name} is required`)
            } else if (spec.defaultValue !== undefined) {
                assignable[name] = spec.defaultValue
            }
        }
        return instance
    }
}
