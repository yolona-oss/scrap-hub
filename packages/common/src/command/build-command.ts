import { CmdArgumentMetadataRaw, getCmdArgMetadata } from './argument-decorator'
import { getCmdServiceMeta } from './service-decorator'
import log from '../application/logger'

export interface ProtoArgSpec {
    name: string
    position: number
    required: boolean
    type: string
    description: string
    enumValues: string[]
    defaultValue: string
    standalone: boolean
}

export interface ProtoCommand {
    name: string
    compatibilityId: string
    version: string
    description: string
    args: ProtoArgSpec[]
    aliases: string[]
}

/** Any class value — we only read decorator metadata off it, never instantiate. */
export type DecoratableServiceClass = Function // eslint-disable-line @typescript-eslint/no-unsafe-function-type

/**
 * Build the `ProtoArgSpec[]` for a single `@CmdArgument`-decorated data class.
 * Function-form `pairOptions` is eagerly resolved (with `(commandName,
 * undefined, undefined)`) so the manifest snapshot carries actual enum
 * values; resolution errors degrade to an empty enum (see `resolvePairOptions`).
 */
export async function buildProtoArgsFromDataClass(
    DataCls: new () => object,
    commandName: string = '',
): Promise<ProtoArgSpec[]> {
    const fields: Record<string, CmdArgumentMetadataRaw> = getCmdArgMetadata(DataCls)
    return Promise.all(Object.entries(fields).map(async ([name, f]) => ({
        name,
        position: f.position ?? 0,
        required: f.required ?? false,
        type: 'string',
        description: f.description ?? '',
        enumValues: await resolvePairOptions(f.pairOptions, commandName, name),
        defaultValue: f.defaultValue ?? '',
        standalone: f.standalone ?? false,
    })))
}

async function resolvePairOptions(
    pairOptions: CmdArgumentMetadataRaw['pairOptions'],
    commandName: string,
    fieldName: string,
): Promise<string[]> {
    if (Array.isArray(pairOptions)) return pairOptions
    if (typeof pairOptions !== 'function') return []
    try {
        const result = await (pairOptions as (cmd: string, d: unknown, m: unknown) => Promise<string[]>)(
            commandName, undefined, undefined,
        )
        return Array.isArray(result) ? result : []
    } catch (e) {
        log.warn(
            `buildProtoArgs: failed to eagerly resolve pairOptions for ` +
            `${commandName || '(anon)'}.${fieldName}: ${(e as Error)?.message ?? e}. ` +
            `Falling back to empty enum.`,
        )
        return []
    }
}

export async function buildCommandFromDecorator(ServiceClass: DecoratableServiceClass): Promise<ProtoCommand> {
    const meta = getCmdServiceMeta(ServiceClass)
    if (!meta) {
        throw new Error(`buildCommandFromDecorator: ${ServiceClass.name || '(anon)'} is not decorated with @CmdService`)
    }

    const buckets = await Promise.all(
        [meta.config, meta.params, meta.messages].map((cls) => buildProtoArgsFromDataClass(cls, meta.name)),
    )
    return {
        name: meta.name,
        compatibilityId: meta.compatibilityId,
        version: meta.version,
        description: meta.description,
        args: buckets.flat(),
        aliases: [],
    }
}
