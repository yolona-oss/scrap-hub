import mongoose from 'mongoose'
import { CmdNodeRegistry } from '../registry/cmd-node-registry'
import { ManifestAggregator } from '../pool/manifest-aggregator'
import { FileService } from '../files/file-service'
import { GridFSBackend } from '../files/gridfs-backend'
import { InternalTokenVerifier } from '../auth/internal-token-verifier'
import { InternalCertVerifier } from '../auth/internal-cert-verifier'
import { HubDispatcher } from '../dispatcher/hub-dispatcher'
import { SessionIndex } from '../session/session-index'
import { makeNodeBuiltIn } from '../builtins/node'
import { makeHelpBuiltIn } from '../builtins/help'
import { makeConfigBuiltIn, ConfigReloadCallback } from '../builtins/config'
import { MongoSystemConfigStore } from '../builtins/config-store'
import { makeSConfigBuiltIn } from '../builtins/sconfig'
import { MongoAccountModuleStore } from '../builtins/sconfig-store'
import { makeServiceCtrlBuiltIn } from '../builtins/service-ctrl'
import type { ICmdNodeClient } from '../client/cmd-node-client'

export interface IHubUIPlugin {
    start(ctx: { dispatcher: HubDispatcher; sessions: SessionIndex }): Promise<void>
    stop(): Promise<void>
}

export interface CmdHubAppOptions {
    mongoUrl: string
    hubPublicBaseUrl: string
    autoRegister: boolean
    /** Phase-2 concern. If omitted, non-built-in dispatch throws at runtime. */
    cmdNodeClient?: ICmdNodeClient
    /** Phase-2 concern. Sent to each owner node when /config writes a key. */
    configReload?: ConfigReloadCallback
}

/**
 * Top-level orchestrator. Compose with .useUI(impl) — one call per UI plugin.
 * Call .start() once to wire everything up and launch the UIs.
 */
export class CmdHubApp {
    private readonly uis: IHubUIPlugin[] = []
    private readonly tokens = new InternalTokenVerifier()
    readonly certs = new InternalCertVerifier()
    readonly registry = new CmdNodeRegistry({ tokens: this.tokens })
    readonly aggregator = new ManifestAggregator()
    readonly sessions = new SessionIndex()

    private started = false
    private fileService!: FileService
    private dispatcher!: HubDispatcher

    constructor(readonly opts: CmdHubAppOptions) {}

    useUI(ui: IHubUIPlugin): this {
        this.uis.push(ui)
        return this
    }

    get dispatcherInstance(): HubDispatcher {
        if (!this.started) throw new Error('CmdHubApp not started')
        return this.dispatcher
    }
    get fileServiceInstance(): FileService {
        if (!this.started) throw new Error('CmdHubApp not started')
        return this.fileService
    }

    async start(): Promise<void> {
        if (this.started) return

        await mongoose.connect(this.opts.mongoUrl)

        this.fileService = new FileService(new GridFSBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: this.opts.hubPublicBaseUrl,
        }))

        const fallbackClient: ICmdNodeClient = {
            async invoke() {
                throw new Error('no cmd-node client attached — this hub is built-ins only')
            },
        }
        const client = this.opts.cmdNodeClient ?? fallbackClient

        this.dispatcher = new HubDispatcher({ aggregator: this.aggregator, client })

        this.dispatcher.registerBuiltIn('node', makeNodeBuiltIn({
            registry: this.registry,
            aggregator: this.aggregator,
        }))
        this.dispatcher.registerBuiltIn('help', makeHelpBuiltIn({
            aggregator: this.aggregator,
            builtInNames: () => this.dispatcher.builtInNames(),
        }))
        this.dispatcher.registerBuiltIn('config', makeConfigBuiltIn({
            aggregator: this.aggregator,
            store: new MongoSystemConfigStore(),
            configReload: this.opts.configReload ?? (async () => undefined),
        }))
        this.dispatcher.registerBuiltIn('sconfig', makeSConfigBuiltIn({
            aggregator: this.aggregator,
            store: new MongoAccountModuleStore(),
        }))
        this.dispatcher.registerBuiltIn('service-ctrl', makeServiceCtrlBuiltIn({
            sessions: this.sessions,
        }))

        for (const ui of this.uis) {
            await ui.start({ dispatcher: this.dispatcher, sessions: this.sessions })
        }

        this.started = true
    }

    async stop(): Promise<void> {
        if (!this.started) return
        for (const ui of this.uis) await ui.stop()
        await mongoose.disconnect()
        this.started = false
    }
}
