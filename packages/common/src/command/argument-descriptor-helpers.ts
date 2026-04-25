import { isOptionSetterFunc } from "./argument-option-types";
import { ArgumentDescriptorType, IArgumentCompiled, IArgumentDescriptor, IArgumentIdent } from "./argument-descriptor";
import { CmdArgumentMetadataRaw } from "./argument-decorator";
import { encodePositionalName } from "./positional";

/** Sentinel value `compileArgumentFromDesc` writes into `IArgumentCompiled.value`
 *  for `@CmdArgument({ standalone: true })` flags. The arg is "set" by mere
 *  presence — there's no value to capture — but the args list shape requires
 *  a string. Consumers that flatten the compiled list (e.g. `RemoteCmdInvoker`
 *  preparing the proto args map) detect the sentinel and rewrite it back to
 *  an empty string. */
export const STANDALONE_ARG_VALUE = '__standalone__'

export function validateArgumentDescriptor(desc: CmdArgumentMetadataRaw|IArgumentDescriptor) {
    if (desc.position != undefined) {
        if (desc.position <= 0) {
            throw new Error(`position must be greater than 0`)
        }
        if (desc.standalone) {
            throw new Error(`standalone and position can't be used together`)
        }
        if (desc.isPair) {
            throw new Error(`isPair and position can't be used together`)
        }
    }
    if (desc.standalone) {
        if (desc.position != undefined) {
            throw new Error(`standalone and position can't be used together`)
        }
        if (desc.defaultValue != undefined) {
            throw new Error(`standalone and defaultValue can't be used together`)
        }
        if (desc.pairOptions != undefined && (desc.pairOptions.length > 0 || isOptionSetterFunc(desc.pairOptions))) {
            throw new Error(`standalone and pairOptions can't be used together`)
        }
    }

    if (desc.isPair) {
        if (desc.standalone) {
            throw new Error(`isPair and standalone can't be used together`)
        }
        if (desc.position != undefined) {
            throw new Error(`isPair and position can't be used together`)
        }
    }
}

export function getArgumentDescType(desc: IArgumentDescriptor|IArgumentIdent): ArgumentDescriptorType {
    if ('isPair' in desc && desc.isPair === true) {
        return 'pair'
    } else if ('standalone' in desc && desc.standalone === true) {
        return 'standalone'
    } else if ('position' in desc && desc.position != undefined && Number.isInteger(desc.position)) {
        return 'positional'
    } else {
        // Fallback path: cmd-hub's runtime logger isn't available here; emit
        // via console so callers still see the misuse without dragging in
        // @core/application/logger.
        console.error(`Cannot determine argument type.\nSetting to default...\nInvalid argument descriptor: ${JSON.stringify(desc)}`)
        return 'pair'
    }
}

export function isArgumentDescStandalone(desc: IArgumentDescriptor|IArgumentIdent) {
    return getArgumentDescType(desc) === 'standalone'
}

export function isArgumentDescPositional(desc: IArgumentDescriptor|IArgumentIdent) {
    return getArgumentDescType(desc) === 'positional'
}

export function isArgumentDescPair(desc: IArgumentDescriptor|IArgumentIdent) {
    return getArgumentDescType(desc) === 'pair'
}

/**
 * @param desc
 * @param value argument value(will be skiped if desc used as standalone)
 */
export function compileArgumentFromDesc(desc: IArgumentDescriptor|IArgumentIdent, value: string): IArgumentCompiled {
    if (isArgumentDescStandalone(desc)) {
        return {
            name: desc.name,
            value: STANDALONE_ARG_VALUE,
            standalone: true,
            ctx: desc.ctx
        }
    } else if (isArgumentDescPositional(desc)) {
        return {
            name: encodePositionalName(desc.name, desc.position!),
            value: value,
            position: desc.position,
            ctx: desc.ctx
        }
    } else if (isArgumentDescPair(desc)) {
        return {
            name: desc.name,
            value: value,
            isPair: true,
            ctx: desc.ctx
        }
    }
    throw new Error(`Invalid argument descriptor type: ${JSON.stringify(desc)}`)
}
