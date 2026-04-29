import { CmdArg, GlobalServiceArgs as BaseGlobalServiceArgs } from '@cmd-hub/common'
import { sessionIdValidator } from './utils/session-id-generator'

/**
 * Hub-side `GlobalServiceArgs` that re-decorates the `sessionId` / `s`
 * fields with a session-id validator. The common base version carries
 * bare decorators (no validator); hub apps that want input validation
 * subclass this instead.
 *
 *     import { HubGlobalServiceArgs } from '@cmd-hub/core'
 *     class ScraperArgsData extends HubGlobalServiceArgs { ... }
 */
export class HubGlobalServiceArgs extends BaseGlobalServiceArgs {
    @CmdArg({
        required: false,
        validator: sessionIdValidator,
        description: 'Session id to restore state from.',
    })
    declare sessionId?: string

    @CmdArg({
        required: false,
        validator: sessionIdValidator,
        description: 'Session id to restore state from (alias for sessionId).',
    })
    declare s?: string
}
