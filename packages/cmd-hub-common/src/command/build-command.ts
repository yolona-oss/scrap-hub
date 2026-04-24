import { getCmdArgMetadata } from './argument-decorator'
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildCommandFromDecorator(ServiceClass: any): ProtoCommand {
    const meta = getCmdServiceMeta(ServiceClass)
    if (!meta) {
        const label = ServiceClass?.name ?? '(anon)'
        throw new Error(`buildCommandFromDecorator: ${label} is not decorated with @CmdService`)
    }

    const args: ProtoArgSpec[] = []
    for (const DataCls of [meta.config, meta.params, meta.messages]) {
        const instance = new DataCls()
        const fields = getCmdArgMetadata(instance)
        for (const name of Object.keys(fields)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const f = (fields as any)[name]
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
