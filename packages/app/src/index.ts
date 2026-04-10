import { AppCmdhub } from '@core/cmdhub'
import { CmdDispatcher } from '@core/ui/command-processor'
import { TgContext, TelegramUI } from '@core/ui/impls/telegram'
import { WebUI, type WebContext } from '@core/ui/impls/web'
import { getInitialConfig } from '@core/config'
import log from '@logger'

const { SocksProxyAgent } = require('socks-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')

import { initializePlugins, initializeCommands } from './commands'

function createProxyAgent() {
    const socksUrl = process.env.ALL_PROXY || process.env.all_proxy
        || process.env.SOCKS_PROXY || process.env.socks_proxy
    if (socksUrl) {
        log.info(`Using SOCKS proxy: ${socksUrl}`)
        return new SocksProxyAgent(socksUrl)
    }
    const httpsUrl = process.env.HTTPS_PROXY || process.env.https_proxy
        || process.env.HTTP_PROXY || process.env.http_proxy
    if (httpsUrl) {
        log.info(`Using HTTPS proxy: ${httpsUrl}`)
        return new HttpsProxyAgent(httpsUrl)
    }
    return undefined
}

type Ctx = TgContext

async function bootstrap() {
    initializePlugins()

    const handler = new CmdDispatcher<Ctx>()
    const cmds = initializeCommands<Ctx>()
    handler.registerMany(cmds)
    handler.done()

    const cfg = getInitialConfig()

    // --- Telegram UI ---
    const ui = new TelegramUI(cfg.bot.token, handler)
    const agent = createProxyAgent()
    if (agent) {
        ui.bot.telegram.options.agent = agent as any
    }

    // --- Web UI ---
    // const ui = new WebUI(cfg.server.port, handler)

    const app = new AppCmdhub(ui)

    app.setErrorInterceptor(function(error: Error, _origin: any) {
        log.error(`Internal error: ${error}`)
    })

    await app.Initialize()
    app.run()
}

bootstrap()
