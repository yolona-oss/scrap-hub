export abstract class WithInit {
    private _isInitialized: boolean = false

    protected setInitialized() {
        this._isInitialized = true
    }

    protected setUninitialized() {
        this._isInitialized = false
    }

    public isInitialized(): boolean {
        return this._isInitialized
    }
}
