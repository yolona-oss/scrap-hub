/**
 * HubGlobalServiceParam re-decorates `sessionId` and `s` on top of the
 * common base class so Telegram-side autocomplete picks them up. Verify
 * the child class's metadata wins the prototype-chain walk.
 */
import 'reflect-metadata'
import { getCmdArgMetadata } from '@cmd-hub/common'
import { HubGlobalServiceParam } from '../hub-service-data'
import {
    sessionOptsWithRand,
    sessionIdValidator,
} from '../utils/session-id-generator'

describe('HubGlobalServiceParam', () => {
    it('attaches sessionOptsWithRand + sessionIdValidator to sessionId and s', () => {
        const meta = getCmdArgMetadata<HubGlobalServiceParam>(new HubGlobalServiceParam())

        expect(meta.sessionId.pairOptions).toBe(sessionOptsWithRand)
        expect(meta.sessionId.validator).toBe(sessionIdValidator)
        expect(meta.s.pairOptions).toBe(sessionOptsWithRand)
        expect(meta.s.validator).toBe(sessionIdValidator)
    })

    it('preserves the base class decoration for noDashboard', () => {
        const meta = getCmdArgMetadata<HubGlobalServiceParam>(new HubGlobalServiceParam())

        expect(meta.noDashboard).toBeDefined()
        expect(meta.noDashboard.standalone).toBe(true)
        expect(meta.noDashboard.required).toBe(false)
    })
})
