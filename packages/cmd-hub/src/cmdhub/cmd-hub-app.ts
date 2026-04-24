import {
    Application,
    ConfigContributor,
    isConfigContributor,
    IUI,
} from '@cmd-hub/common'

/**
 * IUI implementations may declare an `onAppAttach` hook so they can grab
 * references off the Application (e.g. the dispatcher, the remote invoker,
 * middlewares' published context) during Initialize, before run().
 */
export interface IUIWithAttach {
    onAppAttach?(app: CmdHubApp<any>): void | Promise<void>
}

/**
 * Hub-side Application with first-class UI support.
 *
 * UIs are registered via `.useUI(...)`. During `run()`, each UI's
 * `onAppAttach(this)` fires (if defined) and then its `run()`.
 * `terminate()` tears UIs down in reverse order before calling
 * `super.terminate()`.
 *
 * UIs that implement `ConfigContributor` automatically surface their
 * config schema through `_collectSubclassContributors()`, the same
 * mechanism the base `Application` uses for middleware contributors.
 */
export class CmdHubApp<Cfg = unknown> extends Application<Cfg> {
    private readonly _uis: Array<IUI<any> & IUIWithAttach> = []

    useUI(ui: IUI<any> & IUIWithAttach): this {
        this._uis.push(ui)
        return this
    }

    get UIs(): ReadonlyArray<IUI<any> & IUIWithAttach> {
        return this._uis
    }

    protected _collectSubclassContributors(): ConfigContributor[] {
        const out: ConfigContributor[] = []
        for (const ui of this._uis) {
            if (isConfigContributor(ui)) out.push(ui)
        }
        return out
    }

    async run(): Promise<void> {
        // Propagate federation-level capabilities (ManifestAggregator,
        // RemoteCmdInvoker, ICmdNodeClient) into each UI's CmdDispatcher
        // before it starts. Middlewares (Grpc, CmdNodeClient) stashed these
        // on the app during the Transport/Services phases; UIs don't see
        // them until now.
        const aggregator = (this as any)._aggregator
        const nodeClient = (this as any)._cmdNodeClient
        const remoteInvoker = (this as any)._remoteInvoker
        for (const ui of this._uis) {
            const dispatcher = (ui as { dispatcher?: unknown }).dispatcher as
                | {
                      attachManifestAggregator?(a: unknown): void
                      attachRemoteInvoker?(c: unknown): void
                      attachNodeClient?(c: unknown): void
                  }
                | undefined
            if (dispatcher?.attachManifestAggregator && aggregator) {
                dispatcher.attachManifestAggregator(aggregator)
            }
            if (dispatcher?.attachNodeClient && nodeClient) {
                dispatcher.attachNodeClient(nodeClient)
            }
            if (dispatcher?.attachRemoteInvoker && remoteInvoker) {
                dispatcher.attachRemoteInvoker(remoteInvoker)
            }

            if (typeof ui.onAppAttach === 'function') {
                await ui.onAppAttach(this)
            }
            await ui.run()
        }
    }

    async terminate(): Promise<void> {
        for (const ui of [...this._uis].reverse()) {
            try {
                if (ui.isRunning?.()) {
                    await ui.terminate()
                }
            } catch { /* best effort */ }
        }
        await super.terminate()
    }
}
