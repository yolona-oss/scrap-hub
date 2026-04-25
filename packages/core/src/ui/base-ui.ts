import { BaseUI as CommonBaseUI } from '@cmd-hub/common'
import {
    requireCap,
    CAP_ManagerRepo,
    CAP_AccountRepo,
    CAP_InvitationLinkRepo,
    CAP_CmdAliasRepo,
    CAP_PendingDeleteRepo,
} from '@cmd-hub/common'
import type { BaseUIContext, AppLike, ManagerRecord } from '@cmd-hub/common'
import { CmdDispatcher } from './command-processor'
import type { DispatcherRepos } from './command-processor/dispatcher'
import { MessageLifecycleManager } from './message-lifecycle'
import type { IUI } from './types/ui'

/**
 * Cmd-hub's BaseUI narrows the common BaseUI to `CmdDispatcher<Ctx>`, adds the
 * mongoose-backed `MessageLifecycleManager`, and provides shared helpers every
 * concrete UI needs: standard repo wiring (`attachReposFromApp` +
 * `requireRepos`) and a generic null-throw guard (`requireSlice`).
 */
export abstract class BaseUI<CtxType extends BaseUIContext> extends CommonBaseUI<CtxType, CmdDispatcher<CtxType>> {
    public readonly lifecycle: MessageLifecycleManager<CtxType> =
        new MessageLifecycleManager(this as unknown as IUI<CtxType>)

    protected repos: DispatcherRepos | null = null

    /** Resolve every repo cap from the app and wire the lifecycle's persistence
     *  in one call. UIs invoke this from `onAppAttach`. */
    protected attachReposFromApp(app: AppLike): DispatcherRepos {
        this.repos = {
            manager:        requireCap(app, CAP_ManagerRepo),
            account:        requireCap(app, CAP_AccountRepo),
            invitationLink: requireCap(app, CAP_InvitationLinkRepo),
            cmdAlias:       requireCap(app, CAP_CmdAliasRepo),
            pendingDelete:  requireCap(app, CAP_PendingDeleteRepo),
        }
        this.lifecycle.attachRepo(this.repos.pendingDelete)
        return this.repos
    }

    /** Read the repos bag with an actionable error if `onAppAttach` hasn't run. */
    public requireRepos(callerName: string): DispatcherRepos {
        if (!this.repos) {
            throw new Error(`${this.constructor.name}.${callerName}: not attached to app — onAppAttach didn't run`)
        }
        return this.repos
    }

    /** Generic null-throw guard for UI-specific cached slices (config, gates, etc). */
    protected requireSlice<T>(slice: T | null | undefined, callerName: string, sliceName: string): T {
        if (slice === null || slice === undefined) {
            throw new Error(`${this.constructor.name}.${callerName}: ${sliceName} not attached`)
        }
        return slice
    }

    /** Resolve a manager record from a `userId`-shaped lookup. Used by
     *  auth-gate consumers; returns null when no manager is recorded. */
    protected async resolveManagerByLookup(lookup: string | number): Promise<ManagerRecord | null> {
        const repos = this.requireRepos('resolveManagerByLookup')
        return repos.manager.findByUserId(lookup)
    }

    /** Default impl of `IUI.wipeUserMessages`. Walks every message in the
     *  manager's history and calls the UI's own `deleteMessage(userId, msgId)`,
     *  then drops each history entry. Telegram overrides for chat-scoped delete. */
    async wipeUserMessages(userId: string): Promise<{ deleted: number; failed: number }> {
        const repos = this.requireRepos('wipeUserMessages')
        const manager = await repos.manager.findByUserId(userId)
        if (!manager) return { deleted: 0, failed: 0 }
        const handle = await repos.manager.handleById(manager.id)
        if (!handle) return { deleted: 0, failed: 0 }

        const history = await handle.getMessagesHistory()
        let deleted = 0
        let failed = 0
        for (const msg of history) {
            if (!msg.messageId) continue
            try {
                await this.deleteMessage(userId, String(msg.messageId))
                deleted++
            } catch {
                failed++
            }
            try {
                await handle.deleteMessage(msg.messageId)
            } catch { /* ignore — history-row delete is best-effort */ }
        }
        return { deleted, failed }
    }
}
