import { AllowNoneOrOne } from "../types/type-checks"
import { validateArgumentDescriptor } from "./argument-descriptor-helpers"
import { CmdArgumentOptionSetter, CmdArgumentPairOptionsType } from "./argument-option-types"
import "reflect-metadata"

export const COMMAND_ARG_DESC_KEY = Symbol('descriptor:command-argument')

/** An argument is one of three kinds — standalone, positional, or pair.
 *  Position and standalone are mutually exclusive; if both are absent the
 *  argument is a pair. */
export interface CmdArgumentMetadataRaw {
    readonly required: boolean
    readonly description: string
    readonly validator: (arg: string) => boolean

    readonly standalone?: boolean
    readonly position?: number
    readonly isPair?: boolean

    readonly pairOptions?: CmdArgumentPairOptionsType<CmdArgumentOptionSetter>
    readonly defaultValue?: string
}

export type CmdArgumentMetadataDef = AllowNoneOrOne<Partial<CmdArgumentMetadataRaw>, 'standalone' | 'position'>

const CmdArgumentDefaults: CmdArgumentMetadataRaw = {
    validator: () => true,
    required: false,
    description: "Common argument",

    standalone: false,
    position: undefined,
    isPair: false,

    pairOptions: undefined,
    defaultValue: undefined
}

/** Default: pair, not required, empty description, no autocomplete or defaultValue. */
export function CmdArgument(metadata: CmdArgumentMetadataDef) {
    return (target: any, propertyKey: string) => {
        let defaulted = {
            ...CmdArgumentDefaults,
            ...metadata
        }
        validateArgumentDescriptor(defaulted)
        if (
            defaulted.position == undefined &&
                (defaulted.standalone == undefined || defaulted.standalone == false)
        ) {
            defaulted.isPair = true
        }
        const existingMetadata = Reflect.getMetadata(COMMAND_ARG_DESC_KEY, target) || {}
        existingMetadata[propertyKey] = defaulted
        Reflect.defineMetadata(COMMAND_ARG_DESC_KEY, existingMetadata, target)
    }
}

export type CommandMetadata<T extends string|number|symbol = string> = Record<T, CmdArgumentMetadataRaw>
export type CommandArgumentKeyHolder = Record<string, any>

/** Walks the prototype chain so child-class metadata wins over parent. */
export function getCmdArgMetadata<T>(
    target: any
): CommandMetadata<keyof T> {
    let metadataMap: Partial<Record<keyof T, CmdArgumentMetadataRaw>> = {}
    let proto = target.prototype || Object.getPrototypeOf(target)

    while (proto && proto !== Object.prototype) {
        const metadata = Reflect.getMetadata(COMMAND_ARG_DESC_KEY, proto)
        if (metadata) {
            for (const key in metadata) {
                const value = metadata[key]
                if (typeof value !== 'object' || value === null || !('required' in value)) {
                    continue
                }
                metadataMap[key as keyof T] = {
                    ...value,
                    ...metadataMap[key as keyof T],
                }
            }
        }
        proto = Object.getPrototypeOf(proto)
    }

    return metadataMap as CommandMetadata<keyof T>
}


export type ICmdArgumentDefinition = CommandArgumentKeyHolder
/** @deprecated Use ICmdArgumentDefinition */
export type ICmdArgumentDefenition = ICmdArgumentDefinition
