import {
    Application,
    ConfigContributor,
    isConfigContributor,
    IUI,
    CapabilityKey,
    requireCap,
    CAP_ManagerRepo,
    CAP_AccountRepo,
    CAP_InvitationLinkRepo,
    CAP_CmdAliasRepo,
    CAP_PendingDeleteRepo,
    CapabilityValidationError,
    log,
    type CapabilityValidationFailure,
} from '@cmd-hub/common'
import {
    CAP_ManifestAggregator,
    CAP_CmdNodeClient,
    type ManifestAggregator,
    type UIRequirementsForFiltering,
    type AttachWarning,
} from '@cmd-hub/transport'
import { CAP_RemoteCmdInvoker, CAP_FederationRequires } from '../capabilities'
import type { DispatcherRepos } from '../ui/command-processor/dispatcher'
import { RemoteCmdInvoker, type DashboardSession } from '../ui/command-processor/remote-invoker'
import { ServiceDashboard } from '../ui/command-processor/dashboard/service-dashboard'
import { unique } from "@cmd-hub/common"

/** Federation requirements: cmd-node caps a UI plugin expects.
 *  `essential` — missing → command dropped from this UI's pool with a warning.
 *  `supported` — missing → command kept, warning only. */
export interface UIFederationRequires {
    readonly essential?: ReadonlyArray<CapabilityKey<unknown>>
    readonly supported?: ReadonlyArray<CapabilityKey<unknown>>
}

export interface IUIWithAttach {
    onAppAttach?(app: CmdHubApp<any>): void | Promise<void>
    /** Fired when a node attaches/detaches; e.g. Telegram re-pushes setMyCommands. */
    onFederationChange?(): void | Promise<void>
    readonly federationRequires?: UIFederationRequires
}

interface DispatcherForAttach {
    attachManifestAggregator?(a: unknown): void
    attachRemoteInvoker?(c: unknown): void
    attachNodeClient?(c: unknown): void
    attachRepos?(r: DispatcherRepos): void
    collectRegisteredCommands?(): { name: string; requires: readonly CapabilityKey<unknown>[] }[]
}

/** Hub-side Application with first-class UI plugins. */
export class CmdHubApp<Cfg = unknown> extends Application<Cfg> {
    private readonly _uis: Array<IUI<any> & IUIWithAttach> = []
    /** Drained in `terminate()` so re-run() doesn't accumulate listeners. */
    private _aggregatorUnsubs: Array<() => void> = []

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
        const aggregator = this.get(CAP_ManifestAggregator)
        const nodeClient = this.get(CAP_CmdNodeClient)
        let remoteInvoker = this.get(CAP_RemoteCmdInvoker)

        // The remote invoker needs aggregator + nodeClient + a UI-aware
        // dashboard factory, so it's constructed here once UIs are known
        // rather than by a middleware.
        if (!remoteInvoker && aggregator && nodeClient) {
            const createDashboard = (session: DashboardSession): ServiceDashboard => {
                return new ServiceDashboard(
                    session.uiHandle.uiImpl,
                    session.userId,
                    session.sessionId,
                )
            }
            remoteInvoker = new RemoteCmdInvoker({
                aggregator,
                client: nodeClient,
                createDashboard,
            })
            this.provide(CAP_RemoteCmdInvoker, remoteInvoker)
        }

        // Build per-UI federation requirements: merge app-level (from
        // FederationCapsMiddleware, if installed) with each UI's own.
        if (aggregator) {
            const fedReq = this.get(CAP_FederationRequires)
            const appEssential = (fedReq?.essential ?? []).map(k => k as string)
            const appSupported = (fedReq?.supported ?? []).map(k => k as string)

            const uiReqs: UIRequirementsForFiltering[] = []
            for (const ui of this._uis) {
                const uiEssential = (ui.federationRequires?.essential ?? []).map(k => k as string)
                const uiSupported = (ui.federationRequires?.supported ?? []).map(k => k as string)

                const mergedEssential = unique([...appEssential, ...uiEssential])
                // UI essentials win: drop them from supported even if appSupported includes them.
                const mergedSupported = unique([...appSupported, ...uiSupported])
                    .filter(k => !mergedEssential.includes(k))

                if (mergedEssential.length === 0 && mergedSupported.length === 0) continue
                uiReqs.push({
                    uiName: ui.ContextType(),
                    essential: mergedEssential,
                    supported: mergedSupported,
                })
            }
            aggregator.setUIRequirements(uiReqs)
            this._wrapAggregatorWarnings(aggregator)
        }
        const repos: DispatcherRepos = {
            manager:        requireCap(this, CAP_ManagerRepo,
                'CmdHubApp needs a storage middleware (e.g. MongoStorageMiddleware) before run()'),
            account:        requireCap(this, CAP_AccountRepo),
            invitationLink: requireCap(this, CAP_InvitationLinkRepo),
            cmdAlias:       requireCap(this, CAP_CmdAliasRepo),
            pendingDelete:  requireCap(this, CAP_PendingDeleteRepo),
        }

        // Attach every UI's dispatcher BEFORE validation, since some UIs
        // lazy-construct theirs in `onAppAttach`.
        for (const ui of this._uis) {
            if (typeof ui.onAppAttach === 'function') {
                await ui.onAppAttach(this)
            }
            const dispatcher = (ui as { dispatcher?: unknown }).dispatcher as DispatcherForAttach | undefined
            if (dispatcher?.attachManifestAggregator && aggregator) {
                dispatcher.attachManifestAggregator(aggregator)
            }
            if (dispatcher?.attachNodeClient && nodeClient) {
                dispatcher.attachNodeClient(nodeClient)
            }
            if (dispatcher?.attachRemoteInvoker && remoteInvoker) {
                dispatcher.attachRemoteInvoker(remoteInvoker)
            }
            if (dispatcher?.attachRepos) {
                dispatcher.attachRepos(repos)
            }
        }

        if (aggregator) {
            for (const ui of this._uis) {
                if (typeof ui.onFederationChange !== 'function') continue
                const unsub = aggregator.onChange(() => {
                    void Promise.resolve(ui.onFederationChange!()).catch((e: unknown) => {
                        log.warn(`UI "${ui.ContextType()}" onFederationChange failed: ${(e as Error)?.message ?? e}`)
                    })
                })
                this._aggregatorUnsubs.push(unsub)
            }
        }

        this._validateAttachedDispatchers()

        log.info(`CmdHubApp: starting ${this._uis.length} UI(s)`)
        for (const ui of this._uis) {
            log.info(`CmdHubApp: starting UI "${ui.ContextType()}"`)
            await ui.run()
        }
    }

    /** Idempotent — checks a marker property to avoid double-wrapping. */
    private _wrapAggregatorWarnings(aggregator: ManifestAggregator): void {
        const marker = '__cmdHubAppWarningsWrapped' as const
        type Wrappable = ManifestAggregator & { [marker]?: true }
        const w = aggregator as Wrappable
        if (w[marker]) return
        const original = aggregator.attach.bind(aggregator)
        aggregator.attach = (m, uiReqs) => {
            const result = original(m, uiReqs)
            for (const warning of result.warnings) {
                this._logAttachWarning(warning)
            }
            return result
        }
        w[marker] = true
    }

    private _logAttachWarning(w: AttachWarning): void {
        const cmd = `${w.commandName} @ ${w.compatibilityId} v${w.commandVersion}`
        const caps = w.missingCaps.join(', ')
        if (w.severity === 'rejected') {
            log.warn(
                `[ManifestAggregator] dropped ${cmd} from UI "${w.uiName}" routing pool ` +
                `on node ${w.nodeId} — essential cap(s) missing: ${caps}`,
            )
        } else {
            log.warn(
                `[ManifestAggregator] kept ${cmd} for UI "${w.uiName}" routing on node ${w.nodeId} ` +
                `with degraded support — supported cap(s) missing: ${caps}`,
            )
        }
    }

    private _validateAttachedDispatchers(): void {
        const failures: CapabilityValidationFailure[] = []
        for (const ui of this._uis) {
            const dispatcher = (ui as { dispatcher?: unknown }).dispatcher as DispatcherForAttach | undefined
            if (!dispatcher?.collectRegisteredCommands) continue
            for (const cmd of dispatcher.collectRegisteredCommands()) {
                const missing = cmd.requires.filter(key => !this.has(key)).map(k => k as string)
                if (missing.length > 0) {
                    failures.push({ commandName: cmd.name, missing })
                }
            }
        }
        if (failures.length > 0) throw new CapabilityValidationError(failures)
    }

    async terminate(): Promise<void> {
        for (const unsub of this._aggregatorUnsubs) {
            try { unsub() } catch { /* best effort */ }
        }
        this._aggregatorUnsubs = []
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
