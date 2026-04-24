// Retained for Phase 5 (session-autocomplete restoration). These helpers are
// currently unreferenced because GlobalServiceParam moved to @cmd-hub/common
// without their pairOptions/validator annotations. Will be re-wired when the
// hub-side GlobalServiceParam subclass is introduced.
import { IManager } from "@core/db"
import { ArgOptionValidator, CmdDispatcher } from "@core/ui/command-processor"
import { genRandomString } from "@core/utils/random"
import { CmdArgumentOptionSetter } from "@core/ui/types/command"

export const sessionOpts: CmdArgumentOptionSetter = async (servName: string, o: CmdDispatcher<any>, manager: IManager) => {
    const avliableSessions = await o.UserServiceSessions(String(manager.userId), servName)
    return avliableSessions
}

export const sessionOptsWithRand: CmdArgumentOptionSetter = async (servName: string, o: CmdDispatcher<any>, manager: IManager) => {
    const avliableSessions = await sessionOpts(servName, o, manager)
    const randIds = new Array<string>(4).fill('').map(() => genRandomString(8))
    avliableSessions.push(...randIds)
    return avliableSessions
}

export const sessionIdValidator: ArgOptionValidator = (v: string) => Boolean(v.match(/^[0-9a-zA-Z]+$/))
