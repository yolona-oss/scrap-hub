import { BaseUIContext } from "../../../ui"
import { IArgumentDescriptor, IUICommandDescriptor } from "../../../ui/types"
import { IUICommandEntry } from "./../types"
import { ICmdService } from "../../../ui/types/command"
import { CmdArgumentContextType } from "../../../ui/types/command"
import { CmdDispatcher, type RemoteCommandSpec } from "./../dispatcher"
import { CmdArgumentMetadataRaw, exposeCmdArgumentOptions } from "../../../ui/types/command"
import type { ManagerRecord } from "@cmd-hub/common"

export class CBDescriptorCompiler<UICtx extends BaseUIContext> {
    constructor() { }

    async compile(command: string, userId: string, mother: CmdDispatcher<UICtx>, ctx: UICtx): Promise<IUICommandDescriptor> {
        // Local-first: descriptors compiled from the in-process registry's
        // ICmdService / ICmdFunction metadata. These already carry rich
        // builder hints (pairOptions, validators, ctx tagging).
        const localEntry = mother.tryGetInvokable(command)
        if (localEntry) {
            const configureAs = mother.isService(command) ? "service" : "function"
            return this.configureDescriptors(configureAs, userId, localEntry, command, mother, ctx)
        }

        // Remote command: synthesize a descriptor from the manifest's
        // ArgSpec list. Remote args land in the `args` ctx as positional;
        // pairOptions become enum-style choices when the proto carries
        // `enumValues`. Validators are no-ops here — the cmd-node decodes
        // and validates against its own zod / decorator schema.
        const remote = mother.tryGetRemoteCommand(command)
        if (remote) {
            return this.configureRemoteDesc(remote)
        }

        throw new Error(`CBDescriptorCompiler: command "${command}" is not registered locally and not served by any attached node`)
    }

    private async configureServiceDesc(service: ICmdService, userId: string, dispatcher: CmdDispatcher<UICtx>): Promise<IUICommandDescriptor> {
        const repos = dispatcher.requireRepos('descCompiler')
        const manager = await repos.manager.findByUserId(userId)
        if (!manager) {
            throw new Error(`CBDescriptorCompiler: Manager not found for userId="${userId}"`)
        }

        const serviceArgCtx: CmdArgumentContextType[] = ['params', 'config', 'message']
        const builderArgs: IArgumentDescriptor[] = new Array()
        for (const ctxName of serviceArgCtx) {
            const descriptor: Record<string, CmdArgumentMetadataRaw> = service[ctxName === 'message' ? 'receiveMsgDescriptor' : ctxName === 'config' ? 'configDescriptor' : 'paramsDescriptor']()

            for (const key in descriptor) {
                const options = descriptor[key].pairOptions ?
                    await exposeCmdArgumentOptions(service.name, descriptor[key].pairOptions, dispatcher, manager)
                    :
                    undefined
                builderArgs.push({
                    ...descriptor[key],
                    ctx: ctxName,
                    pairOptions: options,
                    name: key
                })
            }
        }
        const isActive = dispatcher.isServiceActive(userId, service.name)
        return {
            args: isActive ? builderArgs.filter(a => a.ctx === 'message') : builderArgs.filter(a => a.ctx !== 'message')
        }
    }

    private async configureFunctionDesc(command: string, cb: IUICommandEntry<UICtx>, dispatcher: CmdDispatcher<UICtx>, ctx: UICtx): Promise<IUICommandDescriptor> {
        const promise = cb.args?.map(async (a) => ({
            ctx: 'args' as CmdArgumentContextType,
            name: a.name,
            required: a.required,
            standalone: a.standalone,
            description: a.description,
            pairOptions: await exposeCmdArgumentOptions(command, a.pairOptions, dispatcher, ctx.manager as ManagerRecord),
            position: a.position,
            validator: a.validator
        })) ?? []

        const args = await Promise.all(promise)
        return {
            args: args
        }
    }

    private async configureDescriptors(configureAs: "function" | "service", userId: string, cb: IUICommandEntry<UICtx>, command: string, dispatcher: CmdDispatcher<UICtx>, ctx: UICtx): Promise<IUICommandDescriptor> {
        switch (configureAs) {
            case "function":
                return this.configureFunctionDesc(command, cb as IUICommandEntry<UICtx>, dispatcher, ctx)
            case "service":
                return await this.configureServiceDesc(cb.invokable as ICmdService, userId, dispatcher)
        }
    }

    /** Compile a builder descriptor from a cmd-node's manifest. The
     *  proto-level ArgSpec carries everything the local builder needs:
     *  `name`, `position`, `required`, `description`, `enumValues`
     *  (mapped to `pairOptions` so the builder offers them as buttons),
     *  and `defaultValue`. The validator is a no-op because authoritative
     *  validation runs node-side against the registered zod / decorator
     *  schema.
     *
     *  Argument-type mapping rules — the local builder distinguishes
     *  three shapes (positional / standalone / pair). The proto's
     *  `position` is `0` for non-positional decorators (config / params /
     *  message fields); we map those to **pair** mode so they render as
     *  `--name` buttons and prompt for a value. Only fields with an
     *  explicit `position > 0` become positional. `standalone` (boolean
     *  flag) isn't yet representable in the proto schema — every non-
     *  positional remote arg is currently a pair. */
    private configureRemoteDesc(remote: RemoteCommandSpec): IUICommandDescriptor {
        const args: IArgumentDescriptor[] = remote.args.map((a) => {
            const isPositional = Number.isInteger(a.position) && a.position > 0
            const base = {
                ctx: 'args' as CmdArgumentContextType,
                name: a.name,
                required: a.required,
                description: a.description,
                pairOptions: a.enumValues.length > 0 ? a.enumValues : undefined,
                defaultValue: a.defaultValue || undefined,
                validator: () => true,
            }
            if (isPositional) {
                return {
                    ...base,
                    position: a.position,
                    standalone: false,
                    isPair: false,
                }
            }
            return {
                ...base,
                isPair: true,
                standalone: false,
            }
        })
        return { args }
    }
}
