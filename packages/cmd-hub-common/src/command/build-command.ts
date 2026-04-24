import { CmdArgumentMetadataRaw, getCmdArgMetadata } from './argument-decorator'
import { getCmdServiceMeta } from './service-decorator'

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

export function buildCommandFromDecorator(ServiceClass: DecoratableServiceClass): ProtoCommand {
    const meta = getCmdServiceMeta(ServiceClass)
    if (!meta) {
        throw new Error(`buildCommandFromDecorator: ${ServiceClass.name || '(anon)'} is not decorated with @CmdService`)
    }

    const args: ProtoArgSpec[] = []
    for (const DataCls of [meta.config, meta.params, meta.messages]) {
        const instance = new DataCls()
        const fields: Record<string, CmdArgumentMetadataRaw> = getCmdArgMetadata(instance)
        for (const [name, f] of Object.entries(fields)) {
            const pairOptions = Array.isArray(f.pairOptions) ? f.pairOptions : []
            args.push({
                name,
                position: f.position ?? 0,
                required: f.required ?? false,
                type: 'string',
                description: f.description ?? '',
                enumValues: pairOptions,
                defaultValue: f.defaultValue ?? '',
                standalone: f.standalone ?? false,
            })
        }
    }

    return {
        name: meta.name,
        compatibilityId: meta.compatibilityId,
        version: meta.version,
        description: meta.description,
        args,
        aliases: [],
    }
}
