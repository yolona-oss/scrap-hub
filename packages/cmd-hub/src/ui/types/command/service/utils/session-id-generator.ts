// Session-autocomplete helpers consumed by `HubGlobalServiceParam`
// (see ../hub-service-data.ts). `sessionOpts` reads the manager's active
// session ids via the dispatcher; `sessionOptsWithRand` appends a handful
// of random ids as "start a new session" shortcuts; `sessionIdValidator`
// keeps session names alphanumeric-only.
import type { ManagerRecord } from "@cmd-hub/common"
import { ArgOptionValidator, CmdDispatcher } from "../../../../../ui/command-processor"
import { genRandomString } from "../../../../../utils/random"
import { CmdArgumentOptionSetter } from "../../../../../ui/types/command"

export const sessionOpts: CmdArgumentOptionSetter = async (servName: string, o: CmdDispatcher<any>, manager: ManagerRecord) => {
    const avliableSessions = await o.UserServiceSessions(String(manager.userId), servName)
    return avliableSessions
}

export const sessionOptsWithRand: CmdArgumentOptionSetter = async (servName: string, o: CmdDispatcher<any>, manager: ManagerRecord) => {
    const avliableSessions = await sessionOpts(servName, o, manager)
    const randIds = new Array<string>(4).fill('').map(() => genRandomString(8))
    avliableSessions.push(...randIds)
    return avliableSessions
}

export const sessionIdValidator: ArgOptionValidator = (v: string) => Boolean(v.match(/^[0-9a-zA-Z]+$/))
