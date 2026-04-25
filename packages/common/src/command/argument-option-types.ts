// Type-only primitives for @CmdArgument option sets.
// Runtime `exposeCmdArgumentOptions` stays in @cmd-hub/core because it takes
// `CmdDispatcher` and `IManager` which belong to the runtime tier.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SetterPattern = (...args: any[]) => Promise<string[]>

/**
 * Generic signature for a runtime option-setter used by `@CmdArgument({ pairOptions })`.
 * Parameterised by the concrete dispatcher and manager types so @cmd-hub/common
 * avoids a runtime back-dependency on @cmd-hub/core. Consumers re-export a
 * narrowed alias with their `CmdDispatcher<any>` / `IManager` substituted in.
 */
export type CmdArgumentOptionSetterGeneric<Dispatcher, Manager> = (
    cmdName: string,
    dispatcher: Dispatcher,
    manager: Manager,
) => Promise<string[]>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CmdArgumentOptionSetter = CmdArgumentOptionSetterGeneric<any, any>

export type CmdArgumentPairOptionsType<OptionsSetter extends SetterPattern = CmdArgumentOptionSetter> =
    string[] | OptionsSetter

export function isOptionSetterFunc<OptionsSetter extends SetterPattern = CmdArgumentOptionSetter>(
    options: CmdArgumentPairOptionsType<OptionsSetter>,
): options is OptionsSetter {
    return typeof options === 'function'
}

export function isOptionSetterString(options: CmdArgumentPairOptionsType): options is string[] {
    return Array.isArray(options)
}
