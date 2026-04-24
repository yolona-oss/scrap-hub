import { AllowNoneOrOne } from "../types/type-checks"
import { validateArgumentDescriptor } from "./argument-descriptor-helpers"
import { CmdArgumentOptionSetter, CmdArgumentPairOptionsType } from "./argument-option-types"
import "reflect-metadata"

// TODO may be create mutations for CmdArgumentMeta that describes one of three types of arguments(standalone, positional, pair)

export const COMMAND_ARG_DESC_KEY = Symbol('descriptor:command-argument')

/**
 * @param required - is argument required
 * @param description - argument description
 * @param validator - argument validator
 * @param pairOptions - autocompete helper options
 * @param defaultValue - argument default value
 *
 * @description only one of position or standalone can be used in a single argument.
 *              if both undefined - argument is pair
 * @param position - is argument position
 * @param standalone - is argument standalone
 * @param isPair - is argument pair
 */
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

/**
 * @description
 * Command argument metadata definition must have one of position or standalone, or field isPair will be set to true
 */
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

/**
 * @description
 * Creates description-like definition for argument
 * Applies metadata to object property
 *
 * @default by default argument is pair and not required with empty description
 *          and without autocompete and default value
 */
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

/**
 * @description @CmdArgument decorator metadata getter. Handles inheritance.
 * @returns Command argument metadata
 */
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
                // Skip entries that aren't argument metadata objects
                if (typeof value !== 'object' || value === null || !('required' in value)) {
                    continue
                }
                // Child class metadata takes priority over parent
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

/**
 * @description Command argument definition
 *
 * use this notation:
 * class CommandEchoArgs {
 *     @CmdArgument({
 *         required: true,
 *         description: "Message to echo",
 *     })
 *     echo?: string
 * }
 *
 * const EchoCommand = {
 *      command: 'echo',
 *      args: new CommandEchoArgs
 *      exec: async function(args: ..., ctx: UIContext) {
 *          ctx.reply(args.echo)
 *      }
 * }
 */
export type ICmdArgumentDefinition = CommandArgumentKeyHolder
/** @deprecated Use ICmdArgumentDefinition */
export type ICmdArgumentDefenition = ICmdArgumentDefinition
