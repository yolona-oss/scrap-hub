import { Stack } from "./struct/stack";

export type OptsMap = Record<string, Object | null>

export const Opt = {
    String: '',
    Bool: true,
    Number: 0,
    None: null
}

export type ArgOptionMapperBase = string[]|Function

export interface IExtendedOptsMapEntry<ArgOptionsMapper extends ArgOptionMapperBase> {
    name: string,
    argType: "string" | "number" | "none",
    argValidator?: (arg: string, type: "string" | "number" | "none") => boolean,
    argOptions?: ArgOptionsMapper
}

export interface IExtendedOptsMapEntryParsed<ArgOptionsMapper extends ArgOptionMapperBase> extends Omit<IExtendedOptsMapEntry<ArgOptionsMapper>, "argValidator" | "argType"> {
    arg: string|null
}

export type InferParsedOpts<T extends OptsMap> = {
    [K in keyof T]: T[K] extends StringConstructor ? string
        : T[K] extends NumberConstructor ? number
        : T[K] extends BooleanConstructor ? boolean
        : T[K] extends null ? true
        : never
}

export function optsParser<T extends OptsMap>(
    input: string[],
    optsMap: T
) {
    const opts = new Stack<string>(input.length)
    opts.push(...input)
    opts.reverse()

    const ret: Partial<InferParsedOpts<T>> = {}

    while (opts.size() > 0) {
        const opt = opts.pop()
        if (opt && opt in optsMap) {
            const v = optsMap[opt]

            if (v === null) {
                ret[opt as keyof T] = true as InferParsedOpts<T>[keyof T]
                continue
            }

            const val = opts.pop()
            if (!val || val in optsMap) {
                throw new Error(`Missing value for option: ${opt}`)
            }

            if (v === String) {
                ret[opt as keyof T] = val as InferParsedOpts<T>[keyof T]
            } else if (v === Number) {
                const toNum = Number(val)
                if (isNaN(toNum)) {
                    throw new Error(`Invalid number for option: ${opt}`)
                }
                ret[opt as keyof T] = toNum as InferParsedOpts<T>[keyof T]
            } else if (v === Boolean) {
                if (val === 'true') {
                    ret[opt as keyof T] = true as InferParsedOpts<T>[keyof T]
                } else if (val === 'false') {
                    ret[opt as keyof T] = false as InferParsedOpts<T>[keyof T]
                } else {
                    throw new Error(`Invalid boolean for option: ${opt}`)
                }
            } else {
                throw new Error(`Unsupported type for option: ${opt}`)
            }
        }
    }

    return ret
}

export function optsParserWithDefault<T extends OptsMap>(
    input: string[],
    optsMap: T
) {
    const ret = optsParser(input, optsMap)
    return ret as InferParsedOpts<T>
}

export function complexOptParser<Definitions extends IExtendedOptsMapEntry<ArgOptionMapper>[], ArgOptionMapper extends ArgOptionMapperBase>(
    input: string[],
    optsMap: Definitions
): IExtendedOptsMapEntryParsed<ArgOptionMapper>[] {
    const opts = new Stack<string>(input.length)
    opts.push(...input)
    opts.reverse()

    const ret: IExtendedOptsMapEntryParsed<ArgOptionMapper>[] = []

    const convertor = (arg: string, argType: "string" | "number" | "none") => {
        switch (argType) {
            case "string":
                return String(arg)
            case "number":
                return Number(arg)
            case "none":
                return null
        }
    }

    while (opts.size() > 0) {
        const opt = opts.pop()?.trim()
        if (opt && opt in optsMap) {
            const optDef = optsMap.find(itm => itm.name == opt)
            if (!optDef) {
                throw new Error(`Missing option definition for option: ${opt}`)
            }
            let arg = null
            if (optDef.argType != "none") {
                arg = opts.pop()
                if (!arg || (optDef?.argValidator && !optDef.argValidator(arg, optDef.argType))) {
                    throw new Error(`Missing or invalid value for option: ${opt}`)
                }
            }

            ret.push({
                name: opt,
                arg: arg,
                argOptions: optDef.argOptions
            })
        }
    }

    return ret
}
