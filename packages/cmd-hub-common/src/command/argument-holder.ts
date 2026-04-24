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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Cls: new (...args: any[]) => T,
        args: Record<string, string>,
    ): T {
        const instance = new Cls()
        const meta = getCmdArgMetadata<T>(instance)
        for (const key of Object.keys(meta) as (keyof T)[]) {
            const spec = meta[key]
            const name = String(key)
            const raw = args[name]
            if (raw !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(instance as any)[name] = raw
            } else if (spec.required) {
                throw new Error(`${Cls.name}.${name} is required`)
            } else if (spec.defaultValue !== undefined) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(instance as any)[name] = spec.defaultValue
            }
        }
        return instance
    }
}
