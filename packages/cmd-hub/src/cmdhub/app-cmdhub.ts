import { Application } from "@core/application";
import { getInitialConfig } from "@core/config";
import { BaseUIContext, IUI } from "@core/ui";

import log from '@logger';

import { clearScreen } from '@utils/console'
import { FIGLET_LOGO, WELCOME_TEXT } from '@core/constants'

export class AppCmdhub extends Application<BaseUIContext> {
    constructor(ui: IUI<any>) {
        super("cmdhub", ui)
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
        await super.Initialize()

        log.info(`Initializing Application with UI: ${this.ui.ContextType()}...`)

        log.info("Creating lock file for UI...")
        const locked = this.ui.lock(this.lockManager)
        if (!locked) {
            log.error("Application with same UI already running")
            process.exit(-1)
        }

        super.setInitialized()
    }

    async run(): Promise<void> {
        await super.run()

        this.printBanner()
        this.printCommands()
    }
}
