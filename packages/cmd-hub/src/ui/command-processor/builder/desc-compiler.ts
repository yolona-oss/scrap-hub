import { BaseUIContext } from "../../../ui"
import { IArgumentDescriptor, IUICommandDescriptor } from "../../../ui/types"
import { IUICommandEntry } from "./../types"
import { ICmdService } from "../../../ui/types/command";
import { CmdArgumentContextType } from "../../../ui/types/command";
import { CmdDispatcher } from "./../dispatcher"
import { IManager, Manager } from "../../../db"
import { CmdArgumentMetadataRaw, exposeCmdArgumentOptions } from "../../../ui/types/command"

export class CBDescriptorCompiler<UICtx extends BaseUIContext> {
    constructor() { }

    compile(command: string, userId: string, mother: CmdDispatcher<UICtx>, ctx: UICtx) {
        const cb = mother.getInvokable(command)
        const configureAs = mother.isService(command) ? "service" : "function"

        return this.configureDescriptors(configureAs, userId, cb, command, mother, ctx)
    }

    private async configureServiceDesc(service: ICmdService, userId: string, dispatcher: CmdDispatcher<UICtx>): Promise<IUICommandDescriptor> {
        const manager = (await Manager.findOne({ userId }))!

        const serviceArgCtx: CmdArgumentContextType[] = ['params', 'config', 'message']
        const builderArgs: IArgumentDescriptor[] = new Array()
        for (const ctxName of serviceArgCtx) {
            const descriptor: Record<string, CmdArgumentMetadataRaw> = service[ctxName === 'message' ? 'receiveMsgDescriptor' : ctxName === 'config' ? 'configDescriptor' : 'paramsDescriptor']()
            //console.log(`Descriptor: ${service.name}:${ctxName}`, JSON.stringify(descriptor, null, 4))

            for (const key in descriptor) {
                const options = descriptor[key].pairOptions ?
                    await exposeCmdArgumentOptions(service.name, descriptor[key].pairOptions, dispatcher, manager as IManager)
                    :
                    undefined;
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
            pairOptions: await exposeCmdArgumentOptions(command, a.pairOptions, dispatcher, ctx.manager as IManager),
            position: a.position,
            validator: a.validator
        })) ?? []

        const args = await Promise.all(promise)
        return {
            args: args
        }
    }

    // TODO set configreAs types in other place and disperce to all code base
    private async configureDescriptors(configureAs: "function" | "service", userId: string, cb: IUICommandEntry<UICtx>, command: string, dispatcher: CmdDispatcher<UICtx>, ctx: UICtx): Promise<IUICommandDescriptor> {
        switch (configureAs) {
            case "function":
                return this.configureFunctionDesc(command, cb as IUICommandEntry<UICtx>, dispatcher, ctx)
            case "service":
                return await this.configureServiceDesc(cb.invokable as ICmdService, userId, dispatcher)
        }
    }

}
