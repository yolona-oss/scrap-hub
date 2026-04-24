import { Application, MongoMiddleware, ApplicationOptions } from "@cmd-hub/common";
import { getInitialConfig } from "../config";
import { IUI } from "../ui";

import log from '../application/logger';
import { z } from 'zod';

import { clearScreen } from '../utils/console'
import { FIGLET_LOGO, WELCOME_TEXT } from '../constants'
import { BaseCommandService } from "../ui/types/command/service";
import { MongoServiceStore } from "../db/mongo-service-store";

// TODO(phase-4): tighten this schema to describe the actual hub config shape.
const HUB_CONFIG_SCHEMA = z.object({}).passthrough()

type HubConfig = z.infer<typeof HUB_CONFIG_SCHEMA> & {
    mongo?: { url: string; migrateConfigRegistry?: boolean }
}

export interface AppCmdhubOptions extends Omit<ApplicationOptions<HubConfig>, 'baseSchema'> {
    baseSchema?: ApplicationOptions<HubConfig>['baseSchema']
}

export class AppCmdhub extends Application<HubConfig> {
    public readonly ui: IUI<any>

    constructor(opts: AppCmdhubOptions, ui: IUI<any>) {
        super({
            configPath: opts.configPath,
            baseSchema: opts.baseSchema ?? HUB_CONFIG_SCHEMA,
            inlineConfig: opts.inlineConfig,
            name: opts.name ?? 'cmdhub',
        })
        this.ui = ui
    }

    private printCommands() {
        if (!getInitialConfig().show_commands) {
            return
        }

        this.ui.consolePrintCommands()
    }

    private printBanner() {
        if (!getInitialConfig().show_logo) {
            return
        }

        function printLogo() {
            for (const line of FIGLET_LOGO) {
                for (const ch of line) {
                    process.stdout.write(ch)
                }
            }
        }

        if (!getInitialConfig().dev_mode) {
            clearScreen()
        }
        printLogo()
        console.log(WELCOME_TEXT)
    }

    async Initialize(): Promise<void> {
        // Register MongoMiddleware so mongo connects during Storage phase
        // before BaseCommandService.setStore(MongoServiceStore) is called below.
        this.use(new MongoMiddleware())

        await super.Initialize()

        BaseCommandService.setStore(new MongoServiceStore())

        log.info(`Initializing Application with UI: ${this.ui.ContextType()}...`)

        log.info("Creating lock file for UI...")
        const locked = this.ui.lock(this.lockManager)
        if (!locked) {
            log.error("Application with same UI already running")
            process.exit(-1)
        }
    }

    async run(): Promise<void> {
        if (!this.isInitialized()) {
            log.error("Application. Incorrect implementations of Initialize(). Not setInitialized() called.")
            process.exit(-1)
        }

        try {
            log.info("Application::run() ui running...")
            await this.ui.run()
            log.info("Application::run() processing...")
        } catch (e: any) {
            log.error("Application::run() failed ui start:", e)
            log.error("Force terminating.")
            await this.terminate()
        }

        this.printBanner()
        this.printCommands()
    }

    async terminate(): Promise<void> {
        if (this.ui.isRunning()) {
            await this.ui.terminate()
        } else {
            log.info("AppCmdhub::terminate() UI not running")
        }
        await super.terminate()
    }
}
