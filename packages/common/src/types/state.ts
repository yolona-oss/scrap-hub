/** State pattern: a `State` holds a back-reference to its `Ctx`; the `Ctx`
 *  transitions between states by re-binding `_ctx_state`. */
export abstract class AbstractState<Ctx> {
    protected context!: Ctx

    public setContext(context: Ctx): void {
        this.context = context
    }
}

export abstract class AbstractCtx<StateType extends AbstractState<any>> {
    protected _ctx_state!: StateType

    protected get CurrentCtxStateObj(): StateType {
        return this._ctx_state
    }

    constructor(initialState: StateType) {
        this.transitionTo(initialState)
    }

    public transitionTo(state: StateType): void {
        this._ctx_state = state
        this._ctx_state.setContext(this)
    }
}
