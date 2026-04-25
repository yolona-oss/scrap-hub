"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CBDescriptorCompiler = void 0;
const command_1 = require("../../../ui/types/command");
class CBDescriptorCompiler {
    constructor() { }
    compile(command, userId, mother, ctx) {
        const cb = mother.getInvokable(command);
        const configureAs = mother.isService(command) ? "service" : "function";
        return this.configureDescriptors(configureAs, userId, cb, command, mother, ctx);
    }
    async configureServiceDesc(service, userId, dispatcher) {
        const repos = dispatcher.requireRepos('descCompiler');
        const manager = await repos.manager.findByUserId(userId);
        if (!manager) {
            throw new Error(`CBDescriptorCompiler: Manager not found for userId="${userId}"`);
        }
        const serviceArgCtx = ['params', 'config', 'message'];
        const builderArgs = new Array();
        for (const ctxName of serviceArgCtx) {
            const descriptor = service[ctxName === 'message' ? 'receiveMsgDescriptor' : ctxName === 'config' ? 'configDescriptor' : 'paramsDescriptor']();
            for (const key in descriptor) {
                const options = descriptor[key].pairOptions ?
                    await (0, command_1.exposeCmdArgumentOptions)(service.name, descriptor[key].pairOptions, dispatcher, manager)
                    :
                        undefined;
                builderArgs.push({
                    ...descriptor[key],
                    ctx: ctxName,
                    pairOptions: options,
                    name: key
                });
            }
        }
        const isActive = dispatcher.isServiceActive(userId, service.name);
        return {
            args: isActive ? builderArgs.filter(a => a.ctx === 'message') : builderArgs.filter(a => a.ctx !== 'message')
        };
    }
    async configureFunctionDesc(command, cb, dispatcher, ctx) {
        const promise = cb.args?.map(async (a) => ({
            ctx: 'args',
            name: a.name,
            required: a.required,
            standalone: a.standalone,
            description: a.description,
            pairOptions: await (0, command_1.exposeCmdArgumentOptions)(command, a.pairOptions, dispatcher, ctx.manager),
            position: a.position,
            validator: a.validator
        })) ?? [];
        const args = await Promise.all(promise);
        return {
            args: args
        };
    }
    async configureDescriptors(configureAs, userId, cb, command, dispatcher, ctx) {
        switch (configureAs) {
            case "function":
                return this.configureFunctionDesc(command, cb, dispatcher, ctx);
            case "service":
                return await this.configureServiceDesc(cb.invokable, userId, dispatcher);
        }
    }
}
exports.CBDescriptorCompiler = CBDescriptorCompiler;
