import { CmdArgument, GlobalServiceParam as BaseGlobalServiceParam } from '@cmd-hub/common'
import { sessionIdValidator } from './utils/session-id-generator'

/**
 * Hub-side `GlobalServiceParam` that re-decorates the `sessionId` / `s` fields
 * with a session-id validator. The common base version carries bare decorators
 * (no validator); hub apps that want input validation subclass this instead.
 *
 *     import { HubGlobalServiceParam } from '@cmd-hub/core'
 *     class ScraperParamsData extends HubGlobalServiceParam { ... }
 *
 * Function-form `pairOptions` autocompletion (live session ids from the
 * dispatcher) was dropped along with runtime resolvers — the wire only
 * carries static option lists. UIs that want session autocompletion can
 * surface it through their own affordances (CLI tab-complete, etc.).
 */
export class HubGlobalServiceParam extends BaseGlobalServiceParam {
    @CmdArgument({
        required: false,
        validator: sessionIdValidator,
        description: 'Session id to restore state from.',
    })
    declare sessionId?: string

    @CmdArgument({
        required: false,
        validator: sessionIdValidator,
        description: 'Session id to restore state from (alias for sessionId).',
    })
    declare s?: string
}
