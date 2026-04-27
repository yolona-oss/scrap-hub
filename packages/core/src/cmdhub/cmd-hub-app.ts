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
    UiMessageRendererRegistry,
    IUiMessageRendererRegistry,
    UiUiMessageKindPlugin,
    uiMessageKindCap,
    registerBuiltinRenderers,
    CAP_SessionLogRepo,
    type UiMessage,
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
    /** Per-UI UiMessage renderer registries, keyed by reference identity
     *  with the UI instance. Each UI gets its own registry so its
     *  `federationRequires.supported` reflects what THAT UI can render. */
    private readonly _uiMessageRegistries = new Map<IUI<any>, UiMessageRendererRegistry>()
    /** Drained in `terminate()` so re-run() doesn't accumulate listeners. */
    private _aggregatorUnsubs: Array<() => void> = []

    useUI(ui: IUI<any> & IUIWithAttach): this {
        this._uis.push(ui)
        // Seed the per-UI registry with framework essentials (text + code).
        // UIs that want optional builtins (markdown/list/kv/link) call
        // `app.uiMessageRegistryFor(this)` from `onAppAttach` and register.
        const registry = new UiMessageRendererRegistry(ui.ContextType?.() ?? 'unknown')
        registerBuiltinRenderers(registry, [])  // essentials only
        this._uiMessageRegistries.set(ui, registry)
        return this
    }

    get UIs(): ReadonlyArray<IUI<any> & IUIWithAttach> {
        return this._uis
    }

    /** Returns the renderer registry owned by `ui`. UI plugins call this
     *  in `onAppAttach` to register their per-platform render-halves
     *  (CLI/Telegram/web) and to opt into optional framework builtins. */
    uiMessageRegistryFor(ui: IUI<any>): IUiMessageRendererRegistry {
        const reg = this._uiMessageRegistries.get(ui)
        if (!reg) {
            throw new Error('uiMessageRegistryFor: UI was not registered via useUI()')
        }
        return reg
    }

    /** Override: walk every registered UI and register the render half on
     *  each. Plugin authors can call `useUiMessageKind` once and have
     *  every UI pick it up. */
    protected override _registerUiMessageKindRender<P, R>(plugin: UiUiMessageKindPlugin<P, R>): void {
        for (const reg of this._uiMessageRegistries.values()) {
            reg.register(plugin)
        }
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
                const uiImpl = session.uiHandle.uiImpl
                const registry = this.uiMessageRegistryFor(uiImpl)
                const baseCtx = { ui: uiImpl.ContextType() } as const
                const renderUiMessage = (msg: UiMessage): string =>
                    String(registry.render(msg, baseCtx) ?? '')
                return new ServiceDashboard(
                    uiImpl,
                    session.userId,
                    session.sessionId,
                    { renderUiMessage },
                )
            }
            // Optional: when storage middleware is installed, persist
            // every session's UiMessage history and replay on resume.
            // Absent → invoker runs without persistence (e.g. test harnesses).
            const sessionLogRepo = this.get(CAP_SessionLogRepo)
            remoteInvoker = new RemoteCmdInvoker({
                aggregator,
                client: nodeClient,
                createDashboard,
                sessionLogRepo,
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

                // Inject UiMessage kinds the UI's renderer registry knows
                // about. `text` is always essential (every UI MUST render
                // it); the rest are supported (missing → text fallback).
                const reg = this._uiMessageRegistries.get(ui)
                const kindCaps = reg
                    ? reg.registeredKinds().map(kind => uiMessageKindCap(kind) as string)
                    : []
                const textCap = uiMessageKindCap('text') as string

                const mergedEssential = unique([
                    ...appEssential,
                    ...uiEssential,
                    textCap,
                ])
                // UI essentials win: drop them from supported even if appSupported includes them.
                const mergedSupported = unique([
                    ...appSupported,
                    ...uiSupported,
                    ...kindCaps,
                ]).filter(k => !mergedEssential.includes(k))

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
                'CmdHubApp needs a storage middleware that provides the manager/account/alias/etc. repo capabilities before run()'),
            account:        requireCap(this, CAP_AccountRepo),
            invitationLink: requireCap(this, CAP_InvitationLinkRepo),
            cmdAlias:       requireCap(this, CAP_CmdAliasRepo),
            pendingDelete:  requireCap(this, CAP_PendingDeleteRepo),
            sessionLog:     this.get(CAP_SessionLogRepo),
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
