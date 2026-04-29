import { AccountModuleModel } from '../models/account/account-module.model'
import { AccountSessionModel } from '../models/account/account-session.model'

/**
 * One-time migration: rename `data.config` → `data.args` on every
 * AccountModule and AccountSession doc that still carries the old key,
 * and rename `data.runtimeState` → `data.state` on every AccountSession.
 * Idempotent — safe to re-run on already-migrated databases.
 */
export async function migrateConfigToArgs(): Promise<{ moduleCount: number; sessionCount: number }> {
    const moduleResult = await AccountModuleModel.updateMany(
        { 'data.config': { $exists: true } },
        [
            { $set: { 'data.args': '$data.config' } },
            { $unset: ['data.config'] },
        ],
    )

    const sessionResult = await AccountSessionModel.updateMany(
        {
            $or: [
                { 'data.config': { $exists: true } },
                { 'data.runtimeState': { $exists: true } },
            ],
        },
        [
            {
                $set: {
                    'data.args': { $ifNull: ['$data.config', '$data.args'] },
                    'data.state': { $ifNull: ['$data.runtimeState', '$data.state'] },
                },
            },
            { $unset: ['data.config', 'data.runtimeState'] },
        ],
    )

    return {
        moduleCount: moduleResult.modifiedCount ?? 0,
        sessionCount: sessionResult.modifiedCount ?? 0,
    }
}
