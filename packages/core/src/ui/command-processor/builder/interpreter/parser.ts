import { deepClone } from "@cmd-hub/common"
import { IArgumentCompiled, IUICommandDescriptor } from '../../../../ui/types'
import { CmdArgumentContextType, IArgumentDescriptor } from "../../../../ui/types/command";
import { decodePositionalName, isEncodedPositionalName, PAIR_PATH_DELIMITER, PAIR_BRANCH_PREFIX } from "../../../../ui/types/command";
import { StateSnaper } from "./state-span";
import { CBLexerToken } from "./lexer";

import log from "../../../../application/logger";
import { Chain, createChainFallbackHandler, chainHandlerFactory, IChainHandler } from "@cmd-hub/common";
import { removeObjectByFieldsMutate } from "@cmd-hub/common";
import { getArgumentDescType, isArgumentDescPair, isArgumentDescPositional, isArgumentDescStandalone, compileArgumentFromDesc } from "../../../../ui/types/command/argument/descriptor-helpers";

/**
 * @see ParserStateType to get more info
 */
export type ParserStateType =
  'PAIR'        // --pair_option
| 'STAND_ALONE' // -o or -option_without_pair
| 'POSITIONAL'  // simple text
| 'ARG_CTX_SEL' // context name from avaliable
| 'PAIR_VALUE'  // value for PAIR
| 'IDLE'        // idle state, waits for pair, standalone, positional or ctx
| 'WAIT_NEXT_V' // waiting for next value

const stateTransiteMap: Record<ParserStateType, ParserStateType[]> = {
    'IDLE': ['ARG_CTX_SEL', 'STAND_ALONE', 'POSITIONAL', 'PAIR', 'PAIR_VALUE', 'WAIT_NEXT_V', 'IDLE'],
    'ARG_CTX_SEL': ['IDLE'],
    'PAIR_VALUE': ['IDLE'],
    'STAND_ALONE': ['IDLE'],
    'POSITIONAL': ['IDLE'],
    'PAIR': ['PAIR_VALUE'],
    'WAIT_NEXT_V': ['IDLE', 'STAND_ALONE', 'POSITIONAL', 'PAIR']
}

/**
 * @see ParserPerformedAction
 */
export type ParserPerformedAction =
'none' // no action

| 'set-pair'       // set pair name and value
| 'set-pair-name'  // set only pair name
| 'set-pair-value' // set only pair value after pair name setted
| 'set-standalone'   // set standalone option
| 'unset-standalone' // unset standalone option (toggle off)
| 'set-positional' // set positional argument

| 'ctx-switch'    // reading context switched to new
| 'ctx-selection' // state switched to context selection

| 'removed-pair'       // pair was removed
| 'removed-standalone' // standalone was removed
| 'removed-positional' // positional was removed

| 'wait-next-inited'   // waiting for next value setted

| 'pair-descend'       // user drilled into a hierarchical pair-options branch

| 'value-validation-failed' // value validation failed

export interface ICBParserStateRaw {
    command: string
    avaliableCtxs: CmdArgumentContextType[]
    descriptor: IUICommandDescriptor
    currentCtx: CmdArgumentContextType
    state: ParserStateType
    arguments: IArgumentCompiled[]
}

export type PChainReq = {
    tkn: CBLexerToken
    desc?: IArgumentDescriptor
}

export type PChainReqValidated = {
    tkn: Required<CBLexerToken>
    desc: IArgumentDescriptor
}

interface CBParserConfig {
    command: string,
    avaliableArgCtxs: CmdArgumentContextType[],
    descriptor: IUICommandDescriptor,
    switchArgCtxKeyword: string,
    initialArgCtx?: CmdArgumentContextType
}

export class CBParser<PChainResGType extends ParserPerformedAction|string = ParserPerformedAction> {
    private readonly command!: string
    private readonly switchArgCtxKeyword!: string
    private readonly avaliableArgCtxs!: CmdArgumentContextType[]
    private currentArgCtx!: CmdArgumentContextType
    private readonly descriptor!: IUICommandDescriptor
    private state!: ParserStateType
    private _prevState!: ParserStateType
    private arguments!: IArgumentCompiled[]
    private _savedData?: Record<string, any>
    /** Path of branch labels the user has drilled into while in
     *  `PAIR_VALUE`. Empty at the root level; one entry per descent.
     *  Reset on transit-out of `PAIR_VALUE`. */
    private pairPath: string[] = []

    private snaper = new StateSnaper()

    private tknParseChain: Chain<PChainReq, PChainResGType>
    private chainDirty = true

    constructor(config: CBParserConfig) {
        log.trace(`Parser created for command: ${config.command}\nDescriptor: ${JSON.stringify(config.descriptor, null, 4)}`)

        this.switchArgCtxKeyword = config.switchArgCtxKeyword
        this.snaper = new StateSnaper()
        this.command = config.command
        config.avaliableArgCtxs.forEach(ctx => this.validateContext(ctx))
        this.avaliableArgCtxs = config.avaliableArgCtxs

        config.descriptor.args.forEach(v => {
            if (v.name.trim() == '') {
                throw new Error(`Descriptor Argument name can't be empty`)
            }
        })
        this.descriptor = config.descriptor

        this.currentArgCtx = config.initialArgCtx ? config.initialArgCtx : this.avaliableArgCtxs[0]
        this.state = 'IDLE'
        this._prevState = this.state
        this.arguments = []
        this.tknParseChain = new Chain<PChainReq, PChainResGType>()
    }

    private _appliedHandlers = new Array<IChainHandler<PChainReq, PChainResGType>>()
    public applyHandler(handler: IChainHandler<PChainReq, PChainResGType>) {
        this._appliedHandlers.push(handler)
        this.chainDirty = true
    }

    /* -------------------- *
     * 'TEXT', 'SINGLE_DASH', 'DOUBLE_DASH'
     * 'IDLE', 'CTX', 'POSITIONAL', 'PAIR', 'PAIR_VALUE'
     *
     * State changes
     * TEXT -> CTX: IDLE
     * TEXT -> POSITIONAL: IDLE
     *
     * SINGLE_DASH -> STAND_ALONE: IDLE
     * DOUBLE_DASH -> PAIR -> PAIR_VALUE: IDLE
     * -------------------- */

    private waitNextBuf?: { type: 'standalone'|'positional'|'pair', value: string, tokenType?: string }
    get NextValueSetType() {
        return this.waitNextBuf?.type
    }
    get NextValueSetValue() {
        return this.waitNextBuf?.value
    }

    private buildChain(): void {
        this.tknParseChain = new Chain<PChainReq, PChainResGType>()

        const switchArgCtx = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            const { tkn } = req
            if (
                this.state === 'ARG_CTX_SEL' &&
                    tkn.type == 'TEXT' &&
                    tkn.value &&
                    this.IsContextInAvaliable(tkn.value)
            ) {
                this.currentArgCtx = tkn.value as CmdArgumentContextType
                this.transitState('IDLE')
                return 'ctx-switch' as PChainResGType
            }
            return
        })

        const switchToArgCtxSelection = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            const { tkn } = req
            if (
                this.state == 'IDLE' &&
                    tkn.type == 'TEXT' &&
                    tkn.value &&
                    tkn.value === this.switchArgCtxKeyword
            ) {
                this.transitState('ARG_CTX_SEL')
                return 'ctx-selection' as PChainResGType
            }
            return
        })

        const validateRequest = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            if (req.tkn.value === undefined || req.tkn.value === null) {
                return 'none' as PChainResGType
            }

            // When in POSITIONAL state and token is plain TEXT, it's the value — use buffered descriptor
            // DOUBLE_DASH/SINGLE_DASH tokens mean the user selected a different argument
            if (this.state === 'POSITIONAL' && this.waitNextBuf && req.tkn.type === 'TEXT') {
                const bufDesc = this.findDescriptorByName(this.waitNextBuf.value)
                if (bufDesc) {
                    req.desc = bufDesc
                    return
                }
            }

            // If in POSITIONAL state but user clicked a different argument (-- or -), reset to IDLE
            if (this.state === 'POSITIONAL' && (req.tkn.type === 'DOUBLE_DASH' || req.tkn.type === 'SINGLE_DASH')) {
                this.waitNextBuf = undefined
                this.transitState('IDLE')
            }

            // If in PAIR_VALUE state but user clicked a different argument, abort current pair and reset
            if (this.state === 'PAIR_VALUE' && (req.tkn.type === 'DOUBLE_DASH' || req.tkn.type === 'SINGLE_DASH')) {
                // Remove the incomplete pair entry (name set, no value yet)
                const lastArg = this.arguments[this.arguments.length - 1]
                if (lastArg && (!lastArg.value || lastArg.value === '')) {
                    this.arguments.pop()
                }
                this.transitState('IDLE')
            }

            let desired_name
            if (this.state === 'PAIR_VALUE') {
                desired_name = this.arguments[this.arguments.length - 1].name
            } else if (this.state == 'WAIT_NEXT_V') {
                desired_name = this.waitNextBuf!.value
            } else if (req.tkn.type == 'DOUBLE_DASH' || req.tkn.type == 'SINGLE_DASH') {
                desired_name = req.tkn.value
            }
            let desc = this.findDescriptorByName(desired_name ?? '')

            // preserve positional without passing its name before
            if (!desc && !(req.tkn.type == 'DOUBLE_DASH' || req.tkn.type == 'SINGLE_DASH')) {
                if (this.NextPositionalInd <= this.MaxPositionalInd) {
                    desc = this.descriptor.args.find(arg => arg.position === this.NextPositionalInd)
                }
            }

            if (!desc) {
                log.debug(`Descriptor for ${desired_name ?? `positional(${this.NextPositionalInd})`} not found`)
                return 'none' as PChainResGType
            }

            req.desc = desc

            return
        })

        const setWaitNextBuf = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn, desc } = req
            if (this.state == 'IDLE') {
                const type = getArgumentDescType(desc)
                this.waitNextBuf = {
                    type,
                    value: tkn.value,
                    tokenType: tkn.type
                }
                this.transitState('WAIT_NEXT_V')

                switch (type) {
                    case 'positional':
                        // Don't return early — let transitByBuf run to enter POSITIONAL state
                        break
                    case 'pair':
                        if (tkn.type !== 'DOUBLE_DASH') {
                            log.debug(`DOUBLE_DASH token expected for descriptor but got ${tkn.type}`)
                            this.state = this._prevState
                        }
                        break
                    case 'standalone':
                        break
                }
            }
            return
        })

        const transitByBuf = chainHandlerFactory<PChainReqValidated, PChainResGType>(() => {
            if (this.state == 'WAIT_NEXT_V') {
                if (this.waitNextBuf === undefined) {
                    throw new Error(`Can't set value from undefined next value setting`)
                }

                // Read buf BEFORE transitState (which clears waitNextBuf)
                const bufType = this.waitNextBuf.type
                const bufTokenType = this.waitNextBuf.tokenType

                log.trace(`transitByBuf: ${JSON.stringify(this.waitNextBuf)}`)
                if (bufType === 'standalone') {
                    this.transitState('STAND_ALONE')
                } else if (bufType === 'positional') {
                    this.transitState('POSITIONAL')
                    // Only wait for next step if this was a button click (DOUBLE_DASH token)
                    // For direct TEXT input (non-mandatory mode), the token IS the value — continue chain
                    if (bufTokenType === 'DOUBLE_DASH' || bufTokenType === 'SINGLE_DASH') {
                        return 'wait-next-inited' as PChainResGType
                    }
                } else if (bufType === 'pair') {
                    this.transitState('PAIR')
                } else {
                    throw new Error(`Can't set value from undefined next value setting`)
                }
            }
            return
        })

        const expectUniqExistance = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn, desc } = req

            if (this.state === 'POSITIONAL') {
                // Use descriptor position, not token value (token may be plain text, not encoded)
                const pos = desc?.position ?? (isEncodedPositionalName(tkn.value) ? decodePositionalName(tkn.value).position : undefined)
                if (pos !== undefined) {
                    removeObjectByFieldsMutate(this.arguments, { position: pos, ctx: this.currentArgCtx })
                }
            } else if (this.state === 'PAIR') {
                removeObjectByFieldsMutate(this.arguments, { name: tkn.value, ctx: this.currentArgCtx })
            }
        })

        const setPairName = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn, desc } = req
            if (this.state === 'PAIR') {
                if (!isArgumentDescPair(desc)) {
                    throw new Error(`Argument descriptor is not pair: ${tkn.value}`)
                }
                this.arguments.push(compileArgumentFromDesc(desc, ''))

                this.transitState('PAIR_VALUE')
                return 'set-pair-name' as PChainResGType
            }
            return
        })

        const validateArgumentValue = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn, desc } = req
            if (
                this.state === 'STAND_ALONE' ||
                    this.state === 'POSITIONAL' ||
                    this.state === 'PAIR_VALUE'
            ) {
                if (!desc.validator(tkn.value)) {
                    return 'value-validation-failed' as PChainResGType
                }
            }
            return
        })

        const descendPairBranch = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn } = req
            if (
                tkn.type === 'TEXT' &&
                    this.state === 'PAIR_VALUE' &&
                    this.arguments.length !== 0 &&
                    typeof tkn.value === 'string' &&
                    tkn.value.startsWith(PAIR_BRANCH_PREFIX)
            ) {
                const desc = this.findDescriptorByName(this.LastReadArg.name)
                if (!desc?.pairOptionsResolver) {
                    // No tree resolver — strip the prefix and fall through;
                    // the literal label was emitted by the markuper for a
                    // flat-options descriptor and must commit as a leaf.
                    req.tkn = { ...tkn, value: tkn.value.slice(PAIR_BRANCH_PREFIX.length) }
                    return
                }
                const label = tkn.value.slice(PAIR_BRANCH_PREFIX.length)
                this.pairPath.push(label)
                return 'pair-descend' as PChainResGType
            }
            return
        })

        const setPairValue = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn } = req
            if (
                tkn.type == 'TEXT' &&
                    this.state == 'PAIR_VALUE' &&
                    this.arguments.length !== 0
            ) {
                if (this.LastReadArg.value != '') {
                    throw new Error(`Pair value already set`)
                }
                const desc = this.findDescriptorByName(this.LastReadArg.name)
                const sep = desc?.pairOptionsSeparator ?? PAIR_PATH_DELIMITER
                this.LastReadArg.value = this.pairPath.length > 0
                    ? [...this.pairPath, tkn.value].join(sep)
                    : tkn.value
                this.pairPath = []

                this.transitState('IDLE')

                return 'set-pair-value' as PChainResGType
            }
            return
        })

        const setPositional = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn } = req
            if (this.state == 'POSITIONAL') {
                // For button clicks (DOUBLE_DASH): waitNextBuf has the arg name, use it to find descriptor
                // For direct text (TEXT): req.desc was already resolved by validateRequest
                let desc = req.desc
                if (this.waitNextBuf && this.waitNextBuf.tokenType !== 'TEXT') {
                    const bufDesc = this.findDescriptorByName(this.waitNextBuf.value)
                    if (bufDesc) desc = bufDesc
                }

                if (!desc || !isArgumentDescPositional(desc)) {
                    throw new Error(`Argument descriptor is not positional for: ${tkn.value}`)
                }

                // Remove old value if updating
                removeObjectByFieldsMutate(this.arguments, { position: desc.position, ctx: desc.ctx })

                this.arguments.push(compileArgumentFromDesc(desc, tkn.value))
                this.waitNextBuf = undefined

                this.transitState('IDLE')
                return 'set-positional' as PChainResGType
            }
            return
        })

        const setStandalone = chainHandlerFactory<PChainReqValidated, PChainResGType>((req) => {
            const { tkn, desc } = req
            if (this.state == 'STAND_ALONE') {
                if (!isArgumentDescStandalone(desc)) {
                    throw new Error(`Argument descriptor is not standalone: ${tkn.value}`)
                }
                const wasAlreadySet = this.isArgumentStandaloneRead(tkn.value)
                // Remove previous entry so we can toggle or replace
                removeObjectByFieldsMutate(this.arguments, { name: tkn.value, standalone: true, ctx: this.currentArgCtx })
                // Toggle: if was already set, removal is the toggle-off
                if (wasAlreadySet) {
                    this.transitState('IDLE')
                    return 'unset-standalone' as PChainResGType
                }
                if (desc.validator(tkn.value)) {
                    this.arguments.push(compileArgumentFromDesc(desc, tkn.value))
                    this.transitState('IDLE')
                    return 'set-standalone' as PChainResGType
                } else {
                    this.back()
                }
            }
            return
        })

        // custom handlers phase
        for (const hndl of this._appliedHandlers) {
            this.tknParseChain.use(hndl)
        }

        // change arg ctx phase
        this.tknParseChain.use(switchToArgCtxSelection)
        this.tknParseChain.use(switchArgCtx)

        // applying and transforming needed data phase
        this.tknParseChain.use(validateRequest)
        this.tknParseChain.use(setWaitNextBuf)
        this.tknParseChain.use(transitByBuf)

        // applying data to arguments
        this.tknParseChain.use(expectUniqExistance)
        this.tknParseChain.use(setPairName)
        this.tknParseChain.use(validateArgumentValue)
        this.tknParseChain.use(descendPairBranch)
        this.tknParseChain.use(setPairValue)
        this.tknParseChain.use(setPositional)
        this.tknParseChain.use(setStandalone)

        // fallback
        this.tknParseChain.use(createChainFallbackHandler<PChainReq, PChainResGType>('none' as PChainResGType))
    }

    private validateContext(ctx: CmdArgumentContextType) {
        if (ctx.length == 0) {
            throw new Error(`Invalid context name "${ctx}"`)
        }
        if (/[^a-zA-Z0-9_]/.test(ctx)) {
            throw new Error(`Invalid context name "${ctx}"`)
        }
    }

    /**
     * @returns deep clone of current state
     */
    toRawState(): ICBParserStateRaw {
        return deepClone({
            command: this.command,
            avaliableCtxs: this.avaliableArgCtxs,
            descriptor: this.descriptor,
            currentCtx: this.currentArgCtx,
            state: this.state,
            arguments: this.arguments,
        })
    }

    private snap() {
        this.snaper.memorize({
            currentCtx: this.currentArgCtx,
            state: this.state,
            _prevState: this._prevState,
            args: deepClone(this.arguments),
            waitNextBuf: deepClone(this.waitNextBuf),
            pairPath: [...this.pairPath],
        })
    }

    public back() {
        const snap = this.snaper.back
        if (snap) {
            this.currentArgCtx = snap.currentCtx
            this.state = snap.state
            this.arguments = snap.args
            this._prevState = snap._prevState
            this.waitNextBuf = snap.waitNextBuf
            this.pairPath = snap.pairPath ? [...snap.pairPath] : []
        } else {
            throw new Error('Can\'t back parser state')
        }
    }

    //region Getters

    get State() {
        return this.state
    }

    get CurrentContext() {
        return this.currentArgCtx
    }

    get AvaliableContexts() {
        return this.avaliableArgCtxs
    }

    IsContextInAvaliable(ctx: string) {
        return this.avaliableArgCtxs.includes(ctx as CmdArgumentContextType)
    }

    get ReadArgs() {
        return this.arguments
    }

    get LastReadArg() {
        return this.arguments[this.arguments.length - 1]
    }

    /** Snapshot of the current branch path. Empty when not drilled into a
     *  hierarchical pair-options tree. The markuper consults this to know
     *  which level to render. */
    get PairPath(): string[] {
        return [...this.pairPath]
    }

    /** Pop one branch from the current pair-path. Used by the interpreter
     *  on `cancel-op` so the user can step back one level instead of
     *  exiting the build entirely. Returns true if a level was popped. */
    popPairPath(): boolean {
        if (this.pairPath.length === 0) return false
        this.pairPath.pop()
        return true
    }

    /** Wipe the pair-path. Used on `cancel-build` and other hard exits. */
    clearPairPath(): void {
        this.pairPath = []
    }

    get Descriptor() {
        return this.descriptor
    }

    get Command() {
        return this.command
    }

    get SavedData(): Record<string, any> | undefined {
        return this._savedData
    }

    set SavedData(data: Record<string, any> | undefined) {
        this._savedData = data
    }

    get DescriptorPosArgs() {
        return this.descriptor.args.filter(arg => isArgumentDescPositional(arg))
    }

    get DescriptorPairArgs() {
        return this.descriptor.args.filter(arg => isArgumentDescPair(arg))
    }

    get ReadPositionals() {
        return this.arguments
            .filter(arg => arg.position !== undefined)
            .sort((arg1, arg2) => arg1.position! - arg2.position!)
    }

    get IsDescriptorEmpty() {
        return this.descriptor.args.length === 0
    }

    get IsDescriptorRequiredEmpty() {
        return this.descriptor.args.filter(arg => arg.required).length === 0
    }

    get NextPositionalInd() {
        return this.ReadPositionals.length + 1
    }

    get MaxPositionalInd() {
        return this.DescriptorPosArgs.length
    }

    /**
    * @returns current context if passed, otherwise current
    */
    private ctxOrCurrent(ctx?: CmdArgumentContextType): CmdArgumentContextType {
        return ctx ? ctx : this.currentArgCtx
    }

    private isAllArgumentRead_fromDescriptorSlice(descSlice: IUICommandDescriptor) {
        for (const argDesc of descSlice.args) {
            switch (getArgumentDescType(argDesc)) {
                case 'standalone':
                    if (!this.isArgumentStandaloneRead(argDesc.name)) {
                        return false
                    }
                    break;
                case 'positional':
                    if (!this.isArgumentPositionalRead(argDesc.position!)) {
                        return false
                    }
                    break;
                case 'pair':
                    if (!this.isArgumentNameRead(argDesc.name)) {
                        return false
                    }
                    break;
                default:
                    throw new Error(`Invalid argument descriptor type: ${JSON.stringify(argDesc, null, 2)}`)
            }
        }

        return true
    }

    isEveryArgumentsRead() {
        return this.isAllArgumentRead_fromDescriptorSlice(this.descriptor)
    }

    isRequiredArgumentsRead() {
        const requiredOnly = deepClone(this.descriptor)
        requiredOnly.args = requiredOnly.args.filter(arg => arg.required)
        return this.isAllArgumentRead_fromDescriptorSlice(requiredOnly)
    }

    /**
     * @returns true if argument name is read and value is empty or ''
     */
    isArgumentNameRead(input: string, ctx?: CmdArgumentContextType) {
        ctx = this.ctxOrCurrent(ctx)
        const searchArray = this.arguments.filter(arg => arg.ctx === (ctx))
        for (const read of searchArray) {
            if (read.name === input && read.value != '') {
                return true
            } else if (isEncodedPositionalName(read.name) && read.value != '') {
                const { name } = decodePositionalName(read.name)
                if (name === input) {
                    return true
                }
            }
        }
        return false
    }

    isArgumentRead(input: string, ctx?: CmdArgumentContextType): boolean {
        ctx = this.ctxOrCurrent(ctx)
        const searchArray = this.arguments.filter(arg => arg.ctx === (ctx))
        for (const read of searchArray) {
            if (read.name === input) {
                return true
            } else if (isEncodedPositionalName(read.name) && read.value != '') {
                const { name } = decodePositionalName(read.name)
                if (name === input) {
                    return true
                }
            }
        }
        return false
    }

    isArgumentStandaloneRead(input: string, ctx?: CmdArgumentContextType): boolean {
        ctx = this.ctxOrCurrent(ctx)
        return this.arguments.some(arg => arg.name === input && arg.ctx === ctx && arg.standalone === true)
    }

    isArgumentPositionalRead(pos: number, ctx?: CmdArgumentContextType): boolean {
        ctx = this.ctxOrCurrent(ctx)
        return this.arguments.some(arg => arg.position === pos && arg.ctx === ctx && arg.value != '')
    }

    findDescriptorByName(name: string, ctx?: CmdArgumentContextType): IArgumentDescriptor | undefined {
        // Try current context first
        const inCurrent = this.descriptor.args.find(arg => arg.name === name && arg.ctx === (ctx ?? this.currentArgCtx))
        if (inCurrent) return inCurrent

        // If not found, search all contexts and auto-switch
        if (!ctx) {
            const inAny = this.descriptor.args.find(arg => arg.name === name)
            if (inAny) {
                this.currentArgCtx = inAny.ctx
            }
            return inAny
        }
        return undefined
    }

    findReadArgumentByDescritor(desc: IArgumentDescriptor): IArgumentCompiled | undefined {
        return this.arguments.find(arg => arg.name === desc.name && arg.ctx === desc.ctx)
    }

    isDescriptorExists(name: string, ctx?: CmdArgumentContextType) {
        return this.findDescriptorByName(name, ctx) !== undefined
    }

    /**
     * @description Transits parser state by transit map and autocleans state resources
     */
    private transitState(to: ParserStateType): void {
        log.trace(`Transiting from ${this.state} to ${to}`)
        if (to === this.state) {
            return
        }

        if (stateTransiteMap[this.state].includes(to)) {
            this._prevState = this.state
            this.state = to
            // waitNextBuf is cleared explicitly by handlers that consume it
            // (setPositional, setStandalone, validateRequest state resets)
            // Pair-path is only meaningful while in PAIR_VALUE; clear on
            // every transit out (commit, cancel, or arg switch).
            if (to !== 'PAIR_VALUE') {
                this.pairPath = []
            }
            return
        }

        throw new Error(`Can't transite from ${this.state} to ${to}. Invalid state transition`)
    }

    /**
    * @description Parser entry point
    */
    parseNextToken(tkn: CBLexerToken): PChainResGType {
        if (this.chainDirty) {
            this.buildChain()
            this.chainDirty = false
        }
        this.snap()
        return this.tknParseChain.handle({tkn})
    }
}
