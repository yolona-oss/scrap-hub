import log from '../../application/logger'
import type { DispatcherRepos } from './dispatcher'

export type SavedSource = 'session' | 'module'

export interface SavedEntry {
    readonly value: string
    readonly source: SavedSource
}

export type SavedSources = Map<string, SavedEntry>

/** Walk a nested record into flat slash-delimited entries. Skips
 *  null / undefined / empty-string values — those carry no signal
 *  for the builder's saved-defaults overlay. */
function flatten(prefix: string, obj: Record<string, unknown>, out: Map<string, string>): void {
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined || v === '') continue
        const key = prefix.length > 0 ? `${prefix}/${k}` : k
        if (typeof v === 'object' && !Array.isArray(v)) {
            flatten(key, v as Record<string, unknown>, out)
            continue
        }
        out.set(key, String(v))
    }
}

/** Read account-module + most-recent session config and return a
 *  flat slash-delimited map of `pathKey → { value, source }`. Session
 *  values override module values on key collision (matches
 *  BaseCommandService.initSession's account < session precedence).
 *
 *  Keys are emitted under the `config/` slice prefix so they line up
 *  with the wire convention used by the parser's value map.
 *
 *  Returns an empty map on any DB error so the caller falls through
 *  to a fresh builder rather than failing the dispatch. */
export async function loadSavedSources(
    repos: DispatcherRepos,
    userId: string,
    command: string,
): Promise<SavedSources> {
    const result: SavedSources = new Map()
    try {
        const owner = await repos.manager.findByUserId(userId)
        if (!owner?.accountId) return result
        const account = await repos.account.handleById(owner.accountId)
        if (!account) return result
        const { module } = await account.getModuleByNameOrCreate(command)

        const moduleConfig = (module.record.data?.config ?? {}) as Record<string, unknown>
        const moduleFlat = new Map<string, string>()
        flatten('config', moduleConfig, moduleFlat)
        for (const [k, v] of moduleFlat) result.set(k, { value: v, source: 'module' })

        const sessions = await module.getSessions()
        if (sessions.length > 0) {
            // Most recent first by createTime; sessions without createTime sort to the end.
            const sorted = [...sessions].sort((a, b) =>
                (b.record.createTime ?? 0) - (a.record.createTime ?? 0),
            )
            const latest = sorted[0]
            const sessionConfig = (latest.record.data?.config ?? {}) as Record<string, unknown>
            const sessionFlat = new Map<string, string>()
            flatten('config', sessionConfig, sessionFlat)
            for (const [k, v] of sessionFlat) result.set(k, { value: v, source: 'session' })
        }
    } catch (e) {
        log.debug(`loadSavedSources: ${(e as Error).message}`)
        return new Map()
    }
    return result
}
