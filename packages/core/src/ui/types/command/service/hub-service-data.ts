import { CmdArgument, GlobalServiceParam as BaseGlobalServiceParam } from '@cmd-hub/common'
import {
    sessionOptsWithRand,
    sessionIdValidator,
} from './utils/session-id-generator'

/**
 * Hub-side `GlobalServiceParam` that re-decorates the `sessionId` / `s` fields
 * with Telegram-autocomplete pairOptions + validator. The common base version
 * intentionally carries bare decorators (no dispatcher/manager coupling); hub
 * apps that want the richer prompt behavior subclass this instead.
 *
 * Usage in a service's params data class:
 *
 *     import { HubGlobalServiceParam } from '@cmd-hub/core'
 *     class ScraperParamsData extends HubGlobalServiceParam { ... }
 *
 * `getCmdArgMetadata` walks the prototype chain with child-wins semantics,
 * so the annotations here override the base class's.
 */
export class HubGlobalServiceParam extends BaseGlobalServiceParam {
    @CmdArgument({
        required: false,
        pairOptions: sessionOptsWithRand,
        validator: sessionIdValidator,
        description: 'Session id to restore state from.',
    })
    declare sessionId?: string

    @CmdArgument({
        required: false,
        pairOptions: sessionOptsWithRand,
        validator: sessionIdValidator,
        description: 'Session id to restore state from.',
    })
    declare s?: string
}
